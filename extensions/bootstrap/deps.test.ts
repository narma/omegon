import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { DEPS, checkAll, formatReport, bestInstallCmd, sortByRequires, type DepStatus } from "./deps.ts";

describe("bootstrap/deps", () => {
	it("has unique dep IDs", () => {
		const ids = DEPS.map((d) => d.id);
		assert.deepStrictEqual(ids, [...new Set(ids)]);
	});

	it("every dep has at least one install command", () => {
		for (const dep of DEPS) {
			assert.ok(dep.install.length > 0, `${dep.id} has no install commands`);
		}
	});

	it("every dep has a purpose and usedBy", () => {
		for (const dep of DEPS) {
			assert.ok(dep.purpose.length > 0, `${dep.id} missing purpose`);
			assert.ok(dep.usedBy.length > 0, `${dep.id} missing usedBy`);
		}
	});

	it("checkAll returns a status for every dep", () => {
		const statuses = checkAll();
		assert.equal(statuses.length, DEPS.length);
		for (const s of statuses) {
			assert.equal(typeof s.available, "boolean");
		}
	});

	it("tiers are valid", () => {
		const validTiers = new Set(["core", "recommended", "optional"]);
		for (const dep of DEPS) {
			assert.ok(validTiers.has(dep.tier), `${dep.id} has invalid tier: ${dep.tier}`);
		}
	});

	it("formatReport produces markdown with tier headers and install hints for missing deps", () => {
		const statuses: DepStatus[] = [
			{ dep: DEPS[0], available: true },
			{ dep: DEPS[DEPS.length - 1], available: false },
		];
		const report = formatReport(statuses);
		assert.ok(report.includes("# Omegon Dependencies"));
		assert.ok(report.includes("✅") || report.includes("❌"));
		// Missing dep should show install hint
		assert.ok(report.includes("→"), "missing dep should show install command");
	});

	it("core deps include ollama and d2", () => {
		const coreIds = DEPS.filter((d) => d.tier === "core").map((d) => d.id);
		assert.ok(coreIds.includes("ollama"));
		assert.ok(coreIds.includes("d2"));
	});

	it("bestInstallCmd returns platform-appropriate command", () => {
		const ollama = DEPS.find((d) => d.id === "ollama")!;
		const cmd = bestInstallCmd(ollama);
		assert.ok(cmd, "should return a command");
		assert.ok(typeof cmd === "string");
	});

	it("requires references exist in registry", () => {
		const ids = new Set(DEPS.map((d) => d.id));
		for (const dep of DEPS) {
			for (const req of dep.requires ?? []) {
				assert.ok(ids.has(req), `${dep.id} requires '${req}' which is not in registry`);
			}
		}
	});

	it("sortByRequires puts prerequisites before dependents", () => {
		const cargo: DepStatus = { dep: DEPS.find((d) => d.id === "cargo")!, available: false };
		const mdserve: DepStatus = { dep: DEPS.find((d) => d.id === "mdserve")!, available: false };
		// Pass in wrong order — mdserve first
		const sorted = sortByRequires([mdserve, cargo]);
		const ids = sorted.map((s) => s.dep.id);
		assert.ok(ids.indexOf("cargo") < ids.indexOf("mdserve"),
			`cargo should come before mdserve, got: ${ids.join(", ")}`);
	});

	it("install options have valid platforms", () => {
		const valid = new Set(["darwin", "linux", "any"]);
		for (const dep of DEPS) {
			for (const opt of dep.install) {
				assert.ok(valid.has(opt.platform), `${dep.id} has invalid platform: ${opt.platform}`);
			}
		}
	});
});
