/**
 * Core Tool Renderers — Sci-UI rendering for pi built-in tools.
 *
 * Uses registerToolRenderer() to attach renderCall/renderResult
 * to built-in tools (bash, read, edit, write) without replacing them.
 *
 * The built-in renderers handle syntax highlighting, diffs, and streaming —
 * we only override the COLLAPSED view to match the Sci-UI visual language.
 * Expanded views fall through to the built-in renderer.
 */
import type { ExtensionAPI } from "@cwilson613/pi-coding-agent";
import { sciCall, sciOk, sciErr, sciLoading } from "./sci-ui.ts";

/** Shorten a file path for display — keep last 2-3 segments. */
function shortenPath(p: string | null | undefined, maxLen = 55): string {
	if (!p) return "…";
	if (p.length <= maxLen) return p;
	const parts = p.split("/");
	// Show last 3 segments at most
	const tail = parts.slice(-3).join("/");
	return tail.length <= maxLen ? tail : "…" + p.slice(-(maxLen - 1));
}

export default function coreRenderers(pi: ExtensionAPI): void {
	// ── Read ──────────────────────────────────────────────────────────────
	pi.registerToolRenderer("read", {
		renderCall(args: any, theme: any) {
			const p = shortenPath(args?.file_path ?? args?.path);
			let range = "";
			if (args?.offset != null || args?.limit != null) {
				const start = args.offset ?? 1;
				const end = args.limit != null ? start + args.limit - 1 : "";
				range = `:${start}${end ? `-${end}` : ""}`;
			}
			return sciCall("read", `${p}${range}`, theme);
		},
		// renderResult omitted — built-in handles syntax highlighting + truncation
	});

	// ── Edit ──────────────────────────────────────────────────────────────
	pi.registerToolRenderer("edit", {
		renderCall(args: any, theme: any) {
			const p = shortenPath(args?.file_path ?? args?.path);
			// Show the size of the change: lines changed
			const oldLines = (args?.old_text ?? args?.oldText ?? "").split("\n").length;
			const newLines = (args?.new_text ?? args?.newText ?? "").split("\n").length;
			const delta = newLines - oldLines;
			const deltaStr = delta === 0 ? `${oldLines}L` : delta > 0 ? `+${delta}L` : `${delta}L`;
			return sciCall("edit", `${p} (${deltaStr})`, theme);
		},
		// renderResult omitted — built-in handles diff rendering
	});

	// ── Write ─────────────────────────────────────────────────────────────
	pi.registerToolRenderer("write", {
		renderCall(args: any, theme: any) {
			const p = shortenPath(args?.file_path ?? args?.path);
			const content = args?.content ?? "";
			const lines = content.split("\n").length;
			return sciCall("write", `${p} (${lines}L)`, theme);
		},
		// renderResult omitted — built-in handles syntax highlighting
	});

	// ── Bash ──────────────────────────────────────────────────────────────
	pi.registerToolRenderer("bash", {
		renderCall(args: any, theme: any) {
			const cmd = args?.command ?? "";
			// Truncate long commands
			const display = cmd.length > 70 ? cmd.slice(0, 67) + "…" : cmd;
			return sciCall("bash", display, theme);
		},
		// renderResult omitted — built-in handles output display + truncation
	});

	// ── Grep ──────────────────────────────────────────────────────────────
	pi.registerToolRenderer("grep", {
		renderCall(args: any, theme: any) {
			const pattern = args?.pattern ?? "";
			const p = shortenPath(args?.path);
			const glob = args?.glob ? ` (${args.glob})` : "";
			return sciCall("grep", `/${pattern}/ in ${p}${glob}`, theme);
		},
	});

	// ── Find ──────────────────────────────────────────────────────────────
	pi.registerToolRenderer("find", {
		renderCall(args: any, theme: any) {
			const pattern = args?.pattern ?? "";
			const p = shortenPath(args?.path);
			return sciCall("find", `${pattern} in ${p}`, theme);
		},
	});

	// ── Ls ─────────────────────────────────────────────────────────────────
	pi.registerToolRenderer("ls", {
		renderCall(args: any, theme: any) {
			const p = shortenPath(args?.path || ".");
			return sciCall("ls", p, theme);
		},
	});
}
