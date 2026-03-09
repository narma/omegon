import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { generateFrontmatter } from "../design-tree/tree.ts";
import type { DesignNode, NodeStatus } from "../design-tree/types.ts";
import { evaluateLifecycleReconciliation, formatReconciliationIssues } from "./reconcile.ts";

function writeDesignDoc(docsDir: string, id: string, status: NodeStatus, openspecChange?: string): void {
	const node: DesignNode = {
		id,
		title: `Test ${id}`,
		status,
		dependencies: [],
		related: [],
		tags: [],
		open_questions: [],
		branches: [],
		openspec_change: openspecChange,
		filePath: path.join(docsDir, `${id}.md`),
		lastModified: Date.now(),
	};
	const fm = generateFrontmatter(node);
	const content = fm + `\n# ${node.title}\n\n## Overview\n\nTest node.\n`;
	fs.writeFileSync(path.join(docsDir, `${id}.md`), content);
}

describe("evaluateLifecycleReconciliation", () => {
	let tmpDir: string;
	let docsDir: string;
	let changeDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "openspec-reconcile-"));
		docsDir = path.join(tmpDir, "docs");
		changeDir = path.join(tmpDir, "openspec", "changes", "my-change");
		fs.mkdirSync(docsDir, { recursive: true });
		fs.mkdirSync(changeDir, { recursive: true });
		fs.writeFileSync(path.join(changeDir, "proposal.md"), "# Proposal");
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("passes when tasks are complete and a design node is bound", () => {
		writeDesignDoc(docsDir, "my-change", "implementing", "my-change");
		fs.writeFileSync(path.join(changeDir, "tasks.md"), [
			"## 1. A",
			"- [x] 1.1 Done",
		].join("\n"));

		const result = evaluateLifecycleReconciliation(tmpDir, "my-change");
		assert.deepStrictEqual(result.boundNodeIds, ["my-change"]);
		assert.equal(result.issues.length, 0);
	});

	it("reports incomplete tasks as stale lifecycle state", () => {
		writeDesignDoc(docsDir, "my-change", "implementing", "my-change");
		fs.writeFileSync(path.join(changeDir, "tasks.md"), [
			"## 1. A",
			"- [x] 1.1 Done",
			"- [ ] 1.2 Remaining",
		].join("\n"));

		const result = evaluateLifecycleReconciliation(tmpDir, "my-change");
		assert.equal(result.issues.length, 1);
		assert.equal(result.issues[0].code, "incomplete_tasks");
	});

	it("reports missing design-tree binding", () => {
		fs.writeFileSync(path.join(changeDir, "tasks.md"), [
			"## 1. A",
			"- [x] 1.1 Done",
		].join("\n"));

		const result = evaluateLifecycleReconciliation(tmpDir, "my-change");
		assert.equal(result.issues.length, 1);
		assert.equal(result.issues[0].code, "missing_design_binding");
	});

	it("formats reconciliation issues for operator-facing messages", () => {
		const text = formatReconciliationIssues([
			{
				code: "missing_design_binding",
				message: "Missing design binding",
				suggestedAction: "Bind the change first.",
			},
		]);
		assert.match(text, /Missing design binding/);
		assert.match(text, /Bind the change first/);
	});
});
