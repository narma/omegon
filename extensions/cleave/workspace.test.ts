/**
 * Tests for cleave/workspace — scenario matching and orphan detection.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { matchScenariosToChildren, type AssignedScenario } from "./workspace.js";
import type { ChildPlan } from "./types.js";
import type { OpenSpecContext } from "./openspec.js";

function makeCtx(scenarios: OpenSpecContext["specScenarios"]): OpenSpecContext {
	return {
		changePath: "/tmp/test",
		designContent: null,
		decisions: [],
		fileChanges: [],
		specScenarios: scenarios,
		apiContract: null,
	};
}

function makeChild(overrides: Partial<ChildPlan> & { label: string }): ChildPlan {
	return {
		description: overrides.description ?? overrides.label,
		scope: overrides.scope ?? [],
		dependsOn: [],
		...overrides,
	};
}

// ─── matchScenariosToChildren ───────────────────────────────────────────────

describe("matchScenariosToChildren", () => {
	it("returns empty maps when no scenarios", () => {
		const children = [makeChild({ label: "task-a" })];
		const result = matchScenariosToChildren(children, makeCtx([]));
		assert.equal(result.get(0)!.length, 0);
	});

	it("returns empty maps when no context", () => {
		const children = [makeChild({ label: "task-a" })];
		const result = matchScenariosToChildren(children, null);
		assert.equal(result.get(0)!.length, 0);
	});

	// Tier 1: Annotation match
	it("matches scenario by spec-domain annotation", () => {
		const children = [
			makeChild({ label: "rbac-enforcement", specDomains: ["relay/rbac"] }),
			makeChild({ label: "rate-limits", specDomains: ["relay/limits"] }),
		];
		const ctx = makeCtx([
			{ domain: "relay/rbac", requirement: "Check capability", scenarios: ["Given..."] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		assert.equal(result.get(0)!.length, 1);
		assert.equal(result.get(0)![0].crossCutting, false);
		assert.equal(result.get(1)!.length, 0);
	});

	it("annotation match takes precedence over word overlap", () => {
		const children = [
			makeChild({ label: "rbac-enforcement", description: "handle RBAC and capabilities", specDomains: ["relay/rbac"] }),
			makeChild({ label: "service-layer", description: "RBAC checks in service layer", specDomains: ["relay/service"] }),
		];
		const ctx = makeCtx([
			{ domain: "relay/rbac", requirement: "RBAC gating", scenarios: ["Given a user..."] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		// Should go to child 0 (annotation match), not child 1 (word overlap on "RBAC")
		assert.equal(result.get(0)!.length, 1);
		assert.equal(result.get(1)!.length, 0);
	});

	// Tier 2: Scope match
	it("falls back to scope match when no annotation", () => {
		const children = [
			makeChild({ label: "models", scope: ["rbac.py"] }),
			makeChild({ label: "service", scope: ["relay_service.py"] }),
		];
		const ctx = makeCtx([
			{ domain: "relay/rbac", requirement: "Check capability in relay_service", scenarios: ["When create_session is called on relay_service"] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		// "relay_service" appears in scenario text and matches child 1's scope
		assert.equal(result.get(1)!.length, 1);
	});

	// Tier 3: Word overlap fallback
	it("falls back to word overlap when no annotation or scope match", () => {
		const children = [
			makeChild({ label: "database", description: "Database migrations and models" }),
			makeChild({ label: "authentication", description: "RBAC enforcement and capability checks" }),
		];
		const ctx = makeCtx([
			{ domain: "auth/rbac", requirement: "Capability enforcement", scenarios: ["Given..."] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		// "enforcement" and "capability" match child 1
		assert.equal(result.get(1)!.length, 1);
	});

	// Orphan detection
	it("auto-injects orphan scenario with cross-cutting marker", () => {
		const children = [
			makeChild({ label: "models", description: "Add model fields", scope: ["models/"] }),
			makeChild({ label: "config", description: "Configuration parsing", scope: ["config/"] }),
		];
		const ctx = makeCtx([
			{ domain: "obscure/domain", requirement: "Unrelated requirement", scenarios: ["Given something unrelated"] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		// Should be injected as orphan into some child
		const allAssigned = [...result.values()].flat();
		assert.equal(allAssigned.length, 1);
		assert.equal(allAssigned[0].crossCutting, true);
	});

	it("orphan injection prefers scope match on When clause", () => {
		const children = [
			makeChild({ label: "models", scope: ["rbac.py"] }),
			makeChild({ label: "service", scope: ["relay_service.py"] }),
		];
		const ctx = makeCtx([
			{
				domain: "obscure/niche",
				requirement: "Niche requirement",
				scenarios: ["Niche scenario\nWhen relay_service handles the request\nThen it succeeds"],
			},
		]);
		const result = matchScenariosToChildren(children, ctx);
		// Orphan, but When clause mentions relay_service → child 1
		assert.equal(result.get(1)!.length, 1);
		assert.equal(result.get(1)![0].crossCutting, true);
	});

	it("all scenarios assigned — no scenario left unmatched", () => {
		const children = [
			makeChild({ label: "rbac", specDomains: ["relay/rbac"] }),
			makeChild({ label: "limits", specDomains: ["relay/limits"] }),
		];
		const ctx = makeCtx([
			{ domain: "relay/rbac", requirement: "Check caps", scenarios: ["S1"] },
			{ domain: "relay/limits", requirement: "Rate limit", scenarios: ["S2"] },
			{ domain: "relay/unknown", requirement: "Mystery", scenarios: ["S3"] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		const total = [...result.values()].reduce((sum, arr) => sum + arr.length, 0);
		// All 3 scenarios assigned (2 by annotation, 1 orphan auto-injected)
		assert.equal(total, 3);
	});

	it("orphan falls back to last child when no match at all", () => {
		const children = [
			makeChild({ label: "aaa", description: "xxx" }),
			makeChild({ label: "bbb", description: "yyy" }),
			makeChild({ label: "zzz", description: "integration" }),
		];
		const ctx = makeCtx([
			{ domain: "q/r", requirement: "w", scenarios: ["s"] },
		]);
		const result = matchScenariosToChildren(children, ctx);
		// No word overlap, no scope — should go to last child
		assert.equal(result.get(2)!.length, 1);
		assert.equal(result.get(2)![0].crossCutting, true);
	});
});
