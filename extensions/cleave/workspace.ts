/**
 * cleave/workspace — Lightweight workspace management.
 *
 * Creates and manages workspace directories under ~/.pi/cleave/ containing:
 * - state.json: serialized CleaveState
 * - {n}-task.md: child task files
 *
 * Workspaces live outside the target repo to avoid polluting the working tree.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChildPlan, CleaveState, SplitPlan } from "./types.js";
import type { OpenSpecContext } from "./openspec.js";

/** Base directory for all cleave workspaces. */
const CLEAVE_HOME = join(homedir(), ".pi", "cleave");

/**
 * Generate a unique workspace directory path from a directive.
 *
 * Creates a human-readable path: ~/.pi/cleave/add-jwt-auth/
 * Appends numeric suffix if collision: ~/.pi/cleave/add-jwt-auth-2/
 */
export function generateWorkspacePath(directive: string): string {
	mkdirSync(CLEAVE_HOME, { recursive: true });

	let slug = directive
		.toLowerCase()
		.replace(/[^\w\s-]/g, "")
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	if (slug.length > 40) slug = slug.slice(0, 40).replace(/-$/, "");
	if (!slug) slug = "task";

	let candidate = join(CLEAVE_HOME, slug);
	if (!existsSync(candidate)) return candidate;

	let counter = 2;
	while (existsSync(join(CLEAVE_HOME, `${slug}-${counter}`))) counter++;
	return join(CLEAVE_HOME, `${slug}-${counter}`);
}

/**
 * Initialize a cleave workspace directory.
 *
 * Creates the workspace directory, state.json, and child task files.
 * Workspace lives under ~/.pi/cleave/, not inside the target repo.
 */
export function initWorkspace(
	state: CleaveState,
	plan: SplitPlan,
	_repoPath: string,
	openspecContext?: OpenSpecContext | null,
): string {
	const wsPath = generateWorkspacePath(state.directive);
	mkdirSync(wsPath, { recursive: true });

	state.workspacePath = wsPath;

	// Write initial state
	saveState(state);

	// Pre-compute scenario assignments across all children (orphan detection)
	const scenarioAssignments = matchScenariosToChildren(plan.children, openspecContext);

	// Generate child task files
	for (let i = 0; i < plan.children.length; i++) {
		const child = plan.children[i];
		const childScenarios = scenarioAssignments.get(i) ?? [];
		const taskContent = generateTaskFile(i, child, plan.children, state.directive, openspecContext, childScenarios);
		writeFileSync(join(wsPath, `${i}-task.md`), taskContent, "utf-8");
	}

	return wsPath;
}

/** Persist CleaveState to workspace/state.json */
export function saveState(state: CleaveState): void {
	if (!state.workspacePath) throw new Error("Cannot save state: workspacePath not set");
	const statePath = join(state.workspacePath, "state.json");
	writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Load CleaveState from workspace/state.json */
export function loadState(workspacePath: string): CleaveState {
	const statePath = join(workspacePath, "state.json");
	if (!existsSync(statePath)) {
		throw new Error(`State file not found: ${statePath}`);
	}
	return JSON.parse(readFileSync(statePath, "utf-8"));
}

/**
 * Generate a child task markdown file.
 *
 * Slim template that the child agent reads to understand its mission.
 */
function generateTaskFile(
	taskId: number,
	child: ChildPlan,
	allChildren: ChildPlan[],
	rootDirective: string,
	openspecContext?: OpenSpecContext | null,
	assignedScenarios?: AssignedScenario[],
): string {
	const siblingRefs = allChildren
		.filter((_, i) => i !== taskId)
		.map((c, i) => `${i >= taskId ? i + 1 : i}:${c.label}`)
		.join(", ");

	const scopeList = child.scope.length > 0
		? child.scope.map((s) => `- \`${s}\``).join("\n")
		: "- (entire scope defined by description)";

	const depsNote = child.dependsOn.length > 0
		? `**Depends on:** ${child.dependsOn.join(", ")}`
		: "**Depends on:** none (independent)";

	// Build optional OpenSpec design context section
	const designSection = buildDesignSection(child, openspecContext, assignedScenarios);

	return `---
task_id: ${taskId}
label: ${child.label}
siblings: [${siblingRefs}]
---

# Task ${taskId}: ${child.label}

## Root Directive

> ${rootDirective}

## Mission

${child.description}

## Scope

${scopeList}

${depsNote}
${designSection}
## Contract

1. Only work on files within your scope
2. Update the Result section below when done
3. Commit your work with clear messages — do not push
4. If the task is too complex, set status to NEEDS_DECOMPOSITION

## Result

**Status:** PENDING

**Summary:**

**Artifacts:**

**Decisions Made:**

**Assumptions:**

**Interfaces Published:**

**Verification:**
- Command: \`\`
- Output:
- Edge cases:
`;
}

// ─── Scenario Matching ──────────────────────────────────────────────────────

export interface AssignedScenario {
	domain: string;
	requirement: string;
	scenarios: string[];
	/** Whether this was auto-injected as an orphan */
	crossCutting: boolean;
}

/**
 * Match spec scenarios to children using 3-tier priority:
 * 1. Annotation match — child's specDomains (from <!-- specs: ... -->) includes the scenario domain
 * 2. Scope match — child's file scope includes files referenced in the scenario
 * 3. Word-overlap fallback — shared words between child description and scenario text
 *
 * Any scenario matching zero children is auto-injected into the best candidate
 * with a cross-cutting marker.
 *
 * Returns a Map from child index to its assigned scenarios.
 */
export function matchScenariosToChildren(
	children: ChildPlan[],
	ctx?: OpenSpecContext | null,
): Map<number, AssignedScenario[]> {
	const result = new Map<number, AssignedScenario[]>();
	for (let i = 0; i < children.length; i++) result.set(i, []);

	if (!ctx || ctx.specScenarios.length === 0) return result;

	for (const ss of ctx.specScenarios) {
		const assigned = assignScenario(ss, children);

		if (assigned.length > 0) {
			// Matched via annotation, scope, or word overlap
			for (const idx of assigned) {
				result.get(idx)!.push({
					domain: ss.domain,
					requirement: ss.requirement,
					scenarios: ss.scenarios,
					crossCutting: false,
				});
			}
		} else {
			// Orphan — auto-inject into best candidate
			const target = findOrphanTarget(ss, children);
			result.get(target)!.push({
				domain: ss.domain,
				requirement: ss.requirement,
				scenarios: ss.scenarios,
				crossCutting: true,
			});
		}
	}

	return result;
}

/**
 * Assign a scenario to children using 3-tier priority.
 * Returns array of child indices (may be multiple for annotation matches).
 */
function assignScenario(
	ss: { domain: string; requirement: string; scenarios: string[] },
	children: ChildPlan[],
): number[] {
	// Tier 1: Annotation match — child declared this spec domain
	const annotationMatches = children
		.map((c, i) => ({ idx: i, child: c }))
		.filter(({ child }) =>
			child.specDomains?.some((d) =>
				ss.domain === d || ss.domain.startsWith(d + "/") || d.startsWith(ss.domain + "/"),
			),
		)
		.map(({ idx }) => idx);

	if (annotationMatches.length > 0) return annotationMatches;

	// Tier 2: Scope match — scenario text references files in child's scope
	const scenarioText = `${ss.requirement} ${ss.scenarios.join(" ")}`.toLowerCase();
	const scopeMatches: number[] = [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.scope.length === 0) continue;
		const hasMatch = child.scope.some((s) => {
			const scopeClean = s.replace(/\*+/g, "").replace(/\/$/, "").toLowerCase();
			const scopeParts = scopeClean.split("/");
			const filename = scopeParts[scopeParts.length - 1];
			// Check if the scenario text mentions this file or path
			return filename.length > 3 && scenarioText.includes(filename);
		});
		if (hasMatch) scopeMatches.push(i);
	}

	if (scopeMatches.length > 0) return scopeMatches;

	// Tier 3: Word-overlap fallback
	const specText = `${ss.domain} ${ss.requirement}`.toLowerCase();
	const specWords = specText.split(/\s+/).filter((w) => w.length > 3);

	let bestIdx = -1;
	let bestScore = 0;
	for (let i = 0; i < children.length; i++) {
		const childText = `${children[i].label} ${children[i].description}`.toLowerCase();
		const score = specWords.filter((w) => childText.includes(w)).length;
		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}

	return bestIdx >= 0 && bestScore > 0 ? [bestIdx] : [];
}

/**
 * Find the best injection target for an orphan scenario.
 * Priority: scope match on When clause → word overlap → last child.
 */
function findOrphanTarget(
	ss: { domain: string; requirement: string; scenarios: string[] },
	children: ChildPlan[],
): number {
	// Try to extract function/file references from When clauses
	const whenText = ss.scenarios
		.join("\n")
		.split("\n")
		.filter((l) => /^\s*when\s/i.test(l))
		.join(" ")
		.toLowerCase();

	// Check which child's scope contains referenced files/functions
	for (let i = 0; i < children.length; i++) {
		const child = children[i];
		if (child.scope.length === 0) continue;
		const hasMatch = child.scope.some((s) => {
			const filename = s.replace(/\*+/g, "").split("/").pop()?.toLowerCase() ?? "";
			return filename.length > 3 && whenText.includes(filename);
		});
		if (hasMatch) return i;
	}

	// Word overlap fallback
	const scenarioText = `${ss.domain} ${ss.requirement}`.toLowerCase();
	const words = scenarioText.split(/\s+/).filter((w) => w.length > 3);

	let bestIdx = children.length - 1; // default: last child
	let bestScore = 0;
	for (let i = 0; i < children.length; i++) {
		const childText = `${children[i].label} ${children[i].description}`.toLowerCase();
		const score = words.filter((w) => childText.includes(w)).length;
		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}

	return bestIdx;
}

// ─── Design Section Builder ─────────────────────────────────────────────────

/**
 * Build the optional "Design Context" section for a child task file.
 *
 * Uses pre-computed scenario assignments (from matchScenariosToChildren)
 * instead of per-child heuristic matching.
 */
function buildDesignSection(
	child: ChildPlan,
	ctx?: OpenSpecContext | null,
	assignedScenarios?: AssignedScenario[],
): string {
	if (!ctx) return "";

	const sections: string[] = [];

	// Architecture decisions — all decisions apply to all children
	if (ctx.decisions.length > 0) {
		sections.push(
			"### Architecture Decisions",
			"",
			"Follow these design decisions from the project's design.md:",
			"",
			...ctx.decisions.map((d) => `- ${d}`),
		);
	}

	// File changes relevant to this child
	if (ctx.fileChanges.length > 0) {
		const childLabelWords = child.label.replace(/-/g, " ").split(" ");
		const childDescLower = child.description.toLowerCase();

		const relevant = ctx.fileChanges.filter((fc) => {
			const fpLower = fc.path.toLowerCase();
			const pathParts = fpLower.split("/");
			return (
				childLabelWords.some((w) => w.length > 2 && pathParts.some((p) => p.includes(w))) ||
				childDescLower.includes(fpLower) ||
				child.scope.some((s) => fpLower.startsWith(s.replace(/\*+/g, "")))
			);
		});

		if (relevant.length > 0) {
			sections.push(
				"### File Changes (from design.md)",
				"",
				"These specific file changes are planned for this task:",
				"",
				...relevant.map((fc) => `- \`${fc.path}\` (${fc.action})`),
			);
		}
	}

	// Spec scenarios from pre-computed assignments
	if (assignedScenarios && assignedScenarios.length > 0) {
		const regular = assignedScenarios.filter((s) => !s.crossCutting);
		const crossCutting = assignedScenarios.filter((s) => s.crossCutting);

		if (regular.length > 0) {
			sections.push(
				"### Acceptance Criteria (from specs)",
				"",
				"Your implementation should satisfy these spec scenarios:",
				"",
			);
			for (const ss of regular) {
				sections.push(`**${ss.domain} → ${ss.requirement}**`);
				for (const scenario of ss.scenarios) {
					const scenarioLines = scenario.split("\n").map((l) => `  ${l}`);
					sections.push(...scenarioLines);
				}
				sections.push("");
			}
		}

		if (crossCutting.length > 0) {
			sections.push(
				"### ⚠️ CROSS-CUTTING Acceptance Criteria",
				"",
				"These scenarios were not directly assigned to any task group but affect your scope.",
				"Ensure your implementation does not break them, and wire any enforcement logic they require:",
				"",
			);
			for (const ss of crossCutting) {
				sections.push(`**⚠️ ${ss.domain} → ${ss.requirement}**`);
				for (const scenario of ss.scenarios) {
					const scenarioLines = scenario.split("\n").map((l) => `  ${l}`);
					sections.push(...scenarioLines);
				}
				sections.push("");
			}
		}
	}

	if (sections.length === 0) return "";
	return "\n## Design Context\n\n" + sections.join("\n") + "\n\n";
}

/**
 * Read all task files from a workspace and return their contents.
 */
export function readTaskFiles(workspacePath: string): Map<number, string> {
	const tasks = new Map<number, string>();
	let i = 0;
	while (true) {
		const taskPath = join(workspacePath, `${i}-task.md`);
		if (!existsSync(taskPath)) break;
		tasks.set(i, readFileSync(taskPath, "utf-8"));
		i++;
	}
	return tasks;
}
