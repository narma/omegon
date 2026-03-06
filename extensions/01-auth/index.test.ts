/**
 * Tests for 01-auth — error diagnosis, formatting, and provider registry.
 */

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
	diagnoseError,
	extractErrorLine,
	ALL_PROVIDERS,
	formatResults,
	findProvider,
	type AuthResult,
	type AuthStatus,
} from "./index.js";

// ─── diagnoseError ──────────────────────────────────────────────

describe("diagnoseError", () => {
	it("detects expired token", () => {
		const result = diagnoseError("Error: token has expired, please refresh");
		assert.equal(result.status, "expired");
	});

	it("detects ExpiredToken (AWS style)", () => {
		const result = diagnoseError("An error occurred (ExpiredTokenException): The security token included in the request is expired");
		assert.equal(result.status, "expired");
	});

	it("detects session expired", () => {
		const result = diagnoseError("error: session expired, please re-authenticate");
		assert.equal(result.status, "expired");
	});

	it("detects invalid credentials", () => {
		const result = diagnoseError("HTTP 401: Bad credentials");
		assert.equal(result.status, "invalid");
	});

	it("detects unauthorized", () => {
		const result = diagnoseError("Error: unauthorized - authentication failed");
		assert.equal(result.status, "invalid");
	});

	it("detects revoked token", () => {
		const result = diagnoseError("Token has been revoked by the user");
		assert.equal(result.status, "invalid");
	});

	it("detects forbidden / insufficient scope", () => {
		const result = diagnoseError("Error: 403 Forbidden - insufficient scope for this request");
		assert.equal(result.status, "invalid");
	});

	it("detects not logged in", () => {
		const result = diagnoseError("You are not logged in. Run `gh auth login` to authenticate.");
		assert.equal(result.status, "none");
	});

	it("detects no token", () => {
		const result = diagnoseError("no token found");
		assert.equal(result.status, "none");
	});

	it("defaults to none for unrecognized errors", () => {
		const result = diagnoseError("Something completely unexpected happened");
		assert.equal(result.status, "none");
	});

	it("returns the error message as reason", () => {
		const result = diagnoseError("Error: bad credentials\nPlease try again");
		assert.ok(result.reason.length > 0);
	});
});

// ─── extractErrorLine ───────────────────────────────────────────

describe("extractErrorLine", () => {
	it("extracts line with error keyword", () => {
		const result = extractErrorLine("Starting check...\nError: token expired\nDone.");
		assert.ok(result.includes("token expired"));
	});

	it("falls back to first line if no error keyword", () => {
		const result = extractErrorLine("Some output\nMore output");
		assert.equal(result, "Some output");
	});

	it("handles empty input", () => {
		const result = extractErrorLine("");
		assert.equal(result, "Unknown error");
	});

	it("truncates long lines", () => {
		const longLine = "Error: " + "x".repeat(300);
		const result = extractErrorLine(longLine);
		assert.ok(result.length <= 200);
	});
});

// ─── Provider Registry ──────────────────────────────────────────

describe("ALL_PROVIDERS", () => {
	it("has at least 6 providers", () => {
		assert.ok(ALL_PROVIDERS.length >= 6, `Expected >= 6, got ${ALL_PROVIDERS.length}`);
	});

	it("every provider has required fields", () => {
		for (const p of ALL_PROVIDERS) {
			assert.ok(p.id, `Missing id`);
			assert.ok(p.name, `Missing name for ${p.id}`);
			assert.ok(p.cli, `Missing cli for ${p.id}`);
			assert.ok(p.refreshCommand, `Missing refreshCommand for ${p.id}`);
			assert.equal(typeof p.check, "function", `Missing check() for ${p.id}`);
		}
	});

	it("has unique ids", () => {
		const ids = ALL_PROVIDERS.map(p => p.id);
		assert.equal(new Set(ids).size, ids.length, "Duplicate provider IDs");
	});

	it("includes git, github, gitlab, aws, kubernetes, oci", () => {
		const ids = ALL_PROVIDERS.map(p => p.id);
		for (const expected of ["git", "github", "gitlab", "aws", "kubernetes", "oci"]) {
			assert.ok(ids.includes(expected), `Missing provider: ${expected}`);
		}
	});
});

// ─── findProvider ───────────────────────────────────────────────

describe("findProvider", () => {
	it("finds by id", () => {
		const p = findProvider("github");
		assert.ok(p);
		assert.equal(p.id, "github");
	});

	it("finds by name (case-insensitive)", () => {
		const p = findProvider("GitHub");
		assert.ok(p);
		assert.equal(p.id, "github");
	});

	it("finds by lowercase name", () => {
		const p = findProvider("gitlab");
		assert.ok(p);
		assert.equal(p.id, "gitlab");
	});

	it("returns undefined for unknown", () => {
		assert.equal(findProvider("bitbucket"), undefined);
	});
});

// ─── formatResults ──────────────────────────────────────────────

describe("formatResults", () => {
	it("formats ok results", () => {
		const results: AuthResult[] = [
			{ provider: "GitHub", status: "ok", detail: "cwilson613" },
		];
		const text = formatResults(results);
		assert.ok(text.includes("✓"));
		assert.ok(text.includes("GitHub"));
		assert.ok(text.includes("cwilson613"));
		assert.ok(!text.includes("To fix"));
	});

	it("includes refresh commands for fixable results", () => {
		const results: AuthResult[] = [
			{ provider: "GitHub", status: "expired", detail: "Token expired", refresh: "gh auth login" },
		];
		const text = formatResults(results);
		assert.ok(text.includes("⚠"));
		assert.ok(text.includes("To fix"));
		assert.ok(text.includes("gh auth login"));
		assert.ok(text.includes("expired"));
	});

	it("includes secret hint for invalid credentials", () => {
		const results: AuthResult[] = [
			{
				provider: "GitLab",
				status: "invalid",
				detail: "Bad credentials",
				refresh: "glab auth login",
				secretHint: "GITLAB_TOKEN",
			},
		];
		const text = formatResults(results);
		assert.ok(text.includes("/secrets configure GITLAB_TOKEN"));
	});

	it("shows error detail for failed checks", () => {
		const results: AuthResult[] = [
			{
				provider: "AWS",
				status: "none",
				detail: "Not authenticated",
				error: "An error occurred: no credentials found",
				refresh: "aws sso login",
			},
		];
		const text = formatResults(results);
		assert.ok(text.includes("no credentials found"));
	});

	it("skips missing providers in fix section", () => {
		const results: AuthResult[] = [
			{ provider: "glab", status: "missing", detail: "glab CLI not installed" },
		];
		const text = formatResults(results);
		assert.ok(text.includes("·"));  // missing icon
		assert.ok(!text.includes("To fix"));  // missing isn't fixable via refresh
	});

	it("handles mixed statuses", () => {
		const results: AuthResult[] = [
			{ provider: "Git", status: "ok", detail: "user <email>" },
			{ provider: "GitHub", status: "ok", detail: "cwilson613" },
			{ provider: "GitLab", status: "none", detail: "Not authenticated", refresh: "glab auth login", secretHint: "GITLAB_TOKEN" },
			{ provider: "AWS", status: "missing", detail: "aws CLI not installed" },
		];
		const text = formatResults(results);
		assert.ok(text.includes("✓"));
		assert.ok(text.includes("✗"));
		assert.ok(text.includes("·"));
		assert.ok(text.includes("To fix"));
		// Only GitLab should be in the fix section (missing isn't fixable)
		assert.ok(text.includes("glab auth login"));
	});
});
