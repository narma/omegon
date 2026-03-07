/**
 * cleave/guardrails — Deterministic guardrail discovery and execution.
 *
 * STUB: This file provides the interface contract for guardrail integration.
 * The full implementation is created by the guardrail-engine sibling task
 * and will replace this file on merge.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single guardrail check discovered from the project */
export interface GuardrailCheck {
	/** Human-readable name, e.g. "typecheck" */
	name: string;
	/** Shell command to run */
	command: string;
	/** Source of discovery: "package.json" | "skill" | "config" */
	source: string;
}

/** Result of running a single guardrail check */
export interface GuardrailResult {
	/** The check that was run */
	check: GuardrailCheck;
	/** Whether the check passed */
	passed: boolean;
	/** Command output (stdout + stderr) */
	output: string;
	/** Exit code */
	exitCode: number;
	/** Duration in milliseconds */
	durationMs: number;
}

/** Suite of guardrail results */
export interface GuardrailSuite {
	results: GuardrailResult[];
	/** Overall pass/fail */
	passed: boolean;
	/** Total duration in milliseconds */
	totalDurationMs: number;
}

// ─── Discovery ──────────────────────────────────────────────────────────────

/**
 * Discover guardrail checks from a project directory.
 *
 * Looks for:
 * - package.json scripts: "typecheck", "lint", "test"
 * - tsconfig.json → infers `npx tsc --noEmit`
 * - .eslintrc / eslint config → infers `npx eslint .`
 */
export function discoverGuardrails(cwd: string): GuardrailCheck[] {
	const checks: GuardrailCheck[] = [];

	// Check package.json for scripts
	const pkgPath = join(cwd, "package.json");
	if (existsSync(pkgPath)) {
		try {
			const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
			const scripts = pkg.scripts ?? {};

			if (scripts.typecheck) {
				checks.push({ name: "typecheck", command: `npm run typecheck`, source: "package.json" });
			} else if (existsSync(join(cwd, "tsconfig.json"))) {
				checks.push({ name: "typecheck", command: "npx tsc --noEmit", source: "tsconfig.json" });
			}

			if (scripts.lint) {
				checks.push({ name: "lint", command: "npm run lint", source: "package.json" });
			}
		} catch {
			// Ignore parse errors
		}
	}

	return checks;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Run all discovered guardrail checks.
 */
export function runGuardrails(cwd: string, checks: GuardrailCheck[]): GuardrailSuite {
	const results: GuardrailResult[] = [];
	const suiteStart = Date.now();

	for (const check of checks) {
		const start = Date.now();
		let output = "";
		let exitCode = 0;
		let passed = true;

		try {
			output = execSync(check.command, {
				cwd,
				encoding: "utf-8",
				timeout: 120_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (err: unknown) {
			const e = err as { status?: number; stdout?: string; stderr?: string };
			exitCode = e.status ?? 1;
			output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
			passed = false;
		}

		results.push({
			check,
			passed,
			output: output.slice(0, 10_000), // Truncate very long output
			exitCode,
			durationMs: Date.now() - start,
		});
	}

	return {
		results,
		passed: results.every((r) => r.passed),
		totalDurationMs: Date.now() - suiteStart,
	};
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format guardrail results for injection into review prompts or task files.
 */
export function formatGuardrailResults(suite: GuardrailSuite): string {
	if (suite.results.length === 0) return "";

	const lines: string[] = [];
	for (const r of suite.results) {
		const status = r.passed ? "✅ PASS" : "❌ FAIL";
		lines.push(`**${r.check.name}** (${status}) — \`${r.check.command}\``);
		if (!r.passed && r.output.trim()) {
			lines.push("```");
			lines.push(r.output.trim().slice(0, 3000));
			lines.push("```");
		}
	}

	return lines.join("\n");
}
