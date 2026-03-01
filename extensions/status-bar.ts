/**
 * status-bar — Rich status bar with context window gauge
 *
 * Renders: ⎇ main • claude-opus-4-6 • ████████░░░░ 68%/200k • ✓ T3
 *
 * Green → tan → red context gauge shows how much of the model's
 * context window is consumed. Updates on every turn.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let lastContextPercent: number | null = null;
  let lastContextWindow = 0;
  let turnCount = 0;
  let currentBranch = "";

  // ANSI 256-color — raw codes so the bar is consistent regardless of theme
  const ansi = (code: number, text: string) => `\x1b[38;5;${code}m${text}\x1b[0m`;

  function contextBar(theme: ExtensionContext["ui"]["theme"], percent: number | null): string {
    const BAR_WIDTH = 16;
    const FILLED = "█";
    const EMPTY = "░";

    if (percent === null) {
      return theme.fg("dim", EMPTY.repeat(BAR_WIDTH));
    }

    const clamped = Math.max(0, Math.min(100, percent));
    const filled = Math.round((clamped / 100) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;

    // Per-block color: green → tan → red
    //   0-40%:  green (34)
    //   40-60%: tan/gold (180)
    //   60%+:   red (196)
    let filledStr = "";
    for (let i = 0; i < filled; i++) {
      const blockPercent = ((i + 0.5) / BAR_WIDTH) * 100;
      let color: number;
      if (blockPercent <= 40) {
        color = 34;  // green
      } else if (blockPercent <= 60) {
        color = 180; // tan/gold
      } else {
        color = 196; // red
      }
      filledStr += ansi(color, FILLED);
    }

    return filledStr + theme.fg("dim", EMPTY.repeat(empty));
  }

  function formatTokenWindow(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return tokens.toString();
  }

  function updateStatusBar(ctx: ExtensionContext, state?: "working" | "idle") {
    if (!ctx.hasUI) return;

    try {
      const theme = ctx.ui.theme;
      const sep = theme.fg("dim", " • ");
      const parts: string[] = [];

      // Git branch
      if (currentBranch) {
        parts.push(theme.fg("accent", `⎇ ${currentBranch}`));
      }

      // Model name
      const modelName = ctx.model?.name || ctx.model?.id || "";
      if (modelName) {
        parts.push(theme.fg("muted", modelName));
      }

      // Context bar
      const usage = ctx.getContextUsage();
      const pct = lastContextPercent ?? usage?.percent ?? null;
      const win = lastContextWindow || usage?.contextWindow || ctx.model?.contextWindow || 0;
      const bar = contextBar(theme, pct);
      const pctStr = pct !== null ? `${Math.round(pct)}%` : "?%";
      const windowStr = win > 0 ? `/${formatTokenWindow(win)}` : "";
      parts.push(`${bar} ${theme.fg("dim", pctStr + windowStr)}`);

      // Turn counter
      if (turnCount > 0) {
        const icon = state === "working" ? theme.fg("warning", "●") : theme.fg("success", "✓");
        parts.push(`${icon} ${theme.fg("dim", `T${turnCount}`)}`);
      }

      ctx.ui.setStatus("status-bar", parts.join(sep));
    } catch {
      // Don't break anything
    }
  }

  // Detect git branch on startup
  pi.on("session_start", async (_event, ctx) => {
    turnCount = 0;
    lastContextPercent = null;
    lastContextWindow = 0;

    try {
      const result = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 });
      if (result.code === 0) {
        currentBranch = (result.stdout || "").trim();
      }
    } catch {
      // Not a git repo
    }

    updateStatusBar(ctx, "idle");
  });

  pi.on("turn_start", async (_event, ctx) => {
    turnCount++;
    updateStatusBar(ctx, "working");
  });

  pi.on("turn_end", async (_event, ctx) => {
    const usage = ctx.getContextUsage();
    if (usage) {
      lastContextPercent = usage.percent;
      lastContextWindow = usage.contextWindow;
    }
    updateStatusBar(ctx, "idle");
  });

  // Refresh branch after tool executions (might have switched branches)
  pi.on("tool_execution_end", async (_event, ctx) => {
    const usage = ctx.getContextUsage();
    if (usage) {
      lastContextPercent = usage.percent;
      lastContextWindow = usage.contextWindow;
    }
    updateStatusBar(ctx, "working");
  });
}
