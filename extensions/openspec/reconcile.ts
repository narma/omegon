import * as path from "node:path";

import { scanDesignDocs } from "../design-tree/tree.ts";
import type { DesignNode } from "../design-tree/types.ts";
import { getChange } from "./spec.ts";

export type ReconciliationIssueCode = "incomplete_tasks" | "missing_design_binding";

export interface ReconciliationIssue {
	code: ReconciliationIssueCode;
	message: string;
	suggestedAction: string;
}

export interface LifecycleReconciliationStatus {
	changeName: string;
	boundNodeIds: string[];
	issues: ReconciliationIssue[];
}

function findBoundNodes(cwd: string, changeName: string): DesignNode[] {
	const docsDir = path.join(cwd, "docs");
	const tree = scanDesignDocs(docsDir);
	return Array.from(tree.nodes.values()).filter((node) =>
		node.openspec_change === changeName || node.id === changeName,
	);
}

export function evaluateLifecycleReconciliation(cwd: string, changeName: string): LifecycleReconciliationStatus {
	const issues: ReconciliationIssue[] = [];
	const change = getChange(cwd, changeName);
	const boundNodes = findBoundNodes(cwd, changeName);

	if (boundNodes.length === 0) {
		issues.push({
			code: "missing_design_binding",
			message: `OpenSpec change '${changeName}' is not bound to any design-tree node via openspec_change or matching node ID.`,
			suggestedAction: `Bind the change to a decided/implementing design node before archive so lifecycle tracking stays traceable.`,
		});
	}

	if (change && change.hasTasks && change.totalTasks > 0 && change.doneTasks < change.totalTasks) {
		issues.push({
			code: "incomplete_tasks",
			message: `OpenSpec change '${changeName}' still has ${change.totalTasks - change.doneTasks} incomplete task(s) in tasks.md.`,
			suggestedAction: "Reconcile tasks.md to match implemented work or finish the remaining tasks before archive.",
		});
	}

	return {
		changeName,
		boundNodeIds: boundNodes.map((node) => node.id),
		issues,
	};
}

export function formatReconciliationIssues(issues: readonly ReconciliationIssue[]): string {
	return issues.map((issue) => `- ${issue.message}\n  → ${issue.suggestedAction}`).join("\n");
}
