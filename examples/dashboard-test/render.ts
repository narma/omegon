#!/usr/bin/env npx tsx
/**
 * Dashboard render harness — exercises dashboard display logic with seed data.
 *
 * This is a standalone renderer that replicates the DashboardFooter's rendering
 * logic without importing pi-tui (which isn't resolvable outside pi's jiti).
 * It populates the globalThis shared state and renders formatted output to show
 * what each scenario looks like at different widths and modes.
 *
 * Usage:
 *   npx tsx examples/dashboard-test/render.ts [compact|raised|cycle]
 */

import {
  designTreeFull,
  designTreeAllDecided,
  designTreeEmpty,
  openspecMixed,
  openspecSingle,
  openspecEmpty,
  cleaveIdle,
  cleaveDispatching,
  cleaveDone,
  cleaveFailed,
  cleaveAssessing,
  cleaveMerging,
} from "./seed-data.ts";
import type {
  DesignTreeDashboardState,
  OpenSpecDashboardState,
  CleaveState,
} from "../../extensions/dashboard/types.ts";

// ── ANSI helpers ─────────────────────────────────────────────

const A = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bg: {
    green: "\x1b[42m",
    yellow: "\x1b[43m",
    red: "\x1b[41m",
    gray: "\x1b[100m",
  },
} as const;

function fg(color: keyof typeof A, text: string): string {
  const code = A[color];
  return typeof code === "string" ? `${code}${text}${A.reset}` : text;
}

function truncate(text: string, maxWidth: number): string {
  // Strip ANSI for length calculation (rough)
  const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
  if (stripped.length <= maxWidth) return text;
  // Crude truncation — good enough for display
  return text.slice(0, maxWidth + (text.length - stripped.length) - 1) + "…";
}

// ── Context gauge (mirrors footer.ts buildContextGauge) ──────

function buildContextGauge(
  barWidth: number,
  inputTokens: number,
  outputTokens: number,
  memoryTokens: number,
): string {
  const maxContext = 200000;
  const totalTokens = inputTokens + outputTokens;
  const pct = Math.min(100, Math.round((totalTokens / maxContext) * 100));
  const filledSlots = Math.round((pct / 100) * barWidth);

  let bar = "";
  for (let i = 0; i < barWidth; i++) {
    if (i < filledSlots) {
      if (pct > 80) bar += `${A.bg.red} ${A.reset}`;
      else if (pct > 60) bar += `${A.bg.yellow} ${A.reset}`;
      else bar += `${A.bg.green} ${A.reset}`;
    } else {
      bar += `${A.bg.gray} ${A.reset}`;
    }
  }

  const tokStr = formatTokens(totalTokens);
  const memStr = memoryTokens > 0 ? ` mem:${formatTokens(memoryTokens)}` : "";
  return `${bar} ${pct}% ${fg("dim", `${tokStr}${memStr}`)}`;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1000000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

// ── Compact renderer (mirrors footer.ts renderCompact) ───────

function renderCompact(
  width: number,
  dt?: DesignTreeDashboardState,
  os?: OpenSpecDashboardState,
  cl?: CleaveState,
  memTokens = 0,
): string[] {
  const lines: string[] = [];
  const wide = width >= 120;
  const ultraWide = width >= 160;

  const dashParts: string[] = [];

  // Design tree
  if (dt && dt.nodeCount > 0) {
    if (ultraWide && dt.focusedNode) {
      const statusIcon = dt.focusedNode.status === "decided" ? "●"
        : dt.focusedNode.status === "implementing" ? "⚙"
        : dt.focusedNode.status === "exploring" ? "◐"
        : "○";
      const qSuffix = dt.focusedNode.questions.length > 0
        ? fg("dim", ` (${dt.focusedNode.questions.length}?)`)
        : "";
      dashParts.push(fg("cyan", `◈ ${dt.decidedCount}/${dt.nodeCount}`) +
        ` ${statusIcon} ${dt.focusedNode.title}${qSuffix}`);
    } else if (wide) {
      const parts = [`${dt.decidedCount} decided`];
      if (dt.exploringCount > 0) parts.push(`${dt.exploringCount} exploring`);
      if (dt.implementingCount > 0) parts.push(`${dt.implementingCount} impl`);
      if (dt.openQuestionCount > 0) parts.push(`${dt.openQuestionCount}?`);
      dashParts.push(fg("cyan", `◈ Design`) + fg("dim", ` ${parts.join(", ")}`));
    } else {
      let dtSummary = `◈ D:${dt.decidedCount}`;
      if (dt.implementingCount > 0) dtSummary += ` I:${dt.implementingCount}`;
      if (dt.implementedCount > 0) dtSummary += ` ✓:${dt.implementedCount}`;
      dtSummary += `/${dt.nodeCount}`;
      dashParts.push(fg("cyan", dtSummary));
    }
  }

  // OpenSpec
  if (os && os.changes.length > 0) {
    const active = os.changes.filter(c => c.stage !== "archived");
    if (active.length > 0) {
      if (wide) {
        const limit = ultraWide ? 4 : 2;
        const changeParts = active.slice(0, limit).map(c => {
          const done = c.tasksTotal > 0 && c.tasksDone >= c.tasksTotal;
          const icon = done ? fg("green", "✓") : "";
          const progress = c.tasksTotal > 0
            ? fg("dim", ` ${c.tasksDone}/${c.tasksTotal}`)
            : "";
          return `${c.name}${progress}${icon}`;
        });
        const overflow = active.length > limit
          ? fg("dim", ` +${active.length - limit}`)
          : "";
        dashParts.push(fg("cyan", "◎ Spec") + " " + changeParts.join(fg("dim", " · ")) + overflow);
      } else {
        dashParts.push(fg("cyan", `◎ OS:${active.length}`));
      }
    }
  }

  // Cleave
  if (cl) {
    if (cl.status === "idle") {
      dashParts.push(fg("dim", "⚡ idle"));
    } else if (cl.status === "done") {
      const childInfo = wide && cl.children
        ? ` ${cl.children.filter(c => c.status === "done").length}/${cl.children.length}`
        : "";
      dashParts.push(fg("green", `⚡ done${childInfo}`));
    } else if (cl.status === "failed") {
      dashParts.push(fg("red", "⚡ fail"));
    } else {
      if (wide && cl.children && cl.children.length > 0) {
        const done = cl.children.filter(c => c.status === "done").length;
        const running = cl.children.filter(c => c.status === "running").length;
        dashParts.push(fg("yellow", `⚡ ${cl.status}`) +
          fg("dim", ` ${done}✓ ${running}⟳ /${cl.children.length}`));
      } else {
        dashParts.push(fg("yellow", `⚡ ${cl.status}`));
      }
    }
  }

  // Context gauge
  const barWidth = ultraWide ? 24 : wide ? 20 : 16;
  dashParts.push(buildContextGauge(barWidth, 45200, 12800, memTokens));

  if (dashParts.length > 0) {
    lines.push(truncate(dashParts.join("  "), width));
  }

  // Footer data lines
  lines.push(fg("dim", `~/workspace/ai/omegon`) + "  " +
    fg("magenta", "feature/unified-dashboard") + "  " +
    fg("dim", "claude-sonnet-4") + " " + fg("yellow", "◆med"));
  lines.push(fg("dim", `In:${formatTokens(45200)} Out:${formatTokens(12800)} $0.12  5 ext ok  3 providers`));

  return lines;
}

// ── Raised renderer (mirrors footer.ts renderRaised) ─────────

function renderRaised(
  width: number,
  dt?: DesignTreeDashboardState,
  os?: OpenSpecDashboardState,
  cl?: CleaveState,
  memTokens = 0,
): string[] {
  const lines: string[] = [];
  const wide = width >= 120;

  // Header
  lines.push(fg("bold", "┄ Dashboard") + "  " + fg("dim", "Ctrl+Shift+B to lower"));

  // Design tree section
  if (dt && dt.nodeCount > 0) {
    let dtLine = fg("cyan", "◈ Design") + fg("dim", ` ${dt.nodeCount} nodes:`);
    dtLine += ` ${dt.decidedCount}● ${dt.exploringCount}◐ ${dt.implementingCount}⚙ ${dt.blockedCount}✕`;
    if (dt.openQuestionCount > 0) dtLine += fg("yellow", ` ${dt.openQuestionCount}?`);
    lines.push(dtLine);

    if (dt.focusedNode) {
      lines.push(fg("dim", "  → ") + fg("cyan", dt.focusedNode.title) +
        fg("dim", ` (${dt.focusedNode.status})`) +
        (dt.focusedNode.branch ? fg("magenta", ` ⎇ ${dt.focusedNode.branch}`) : ""));
    }
    if (dt.implementingNodes && dt.implementingNodes.length > 0) {
      for (const n of dt.implementingNodes.slice(0, 2)) {
        lines.push(fg("dim", "  ⚙ ") + n.title +
          (n.branch ? fg("magenta", ` ⎇ ${n.branch}`) : ""));
      }
    }
  }

  // OpenSpec section
  if (os && os.changes.length > 0) {
    const active = os.changes.filter(c => c.stage !== "archived");
    if (active.length > 0) {
      lines.push(fg("cyan", "◎ OpenSpec") + fg("dim", ` ${active.length} active`));
      for (const c of active.slice(0, 3)) {
        const done = c.tasksTotal > 0 && c.tasksDone >= c.tasksTotal;
        const pct = c.tasksTotal > 0 ? Math.round((c.tasksDone / c.tasksTotal) * 100) : 0;
        const bar = c.tasksTotal > 0
          ? ` [${("█".repeat(Math.round(pct / 10)) + "░".repeat(10 - Math.round(pct / 10)))}]`
          : ` [${c.stage}]`;
        const icon = done ? fg("green", " ✓") : "";
        lines.push(fg("dim", "  ") + c.name + fg("dim", bar) +
          (c.tasksTotal > 0 ? fg("dim", ` ${c.tasksDone}/${c.tasksTotal}`) : "") + icon);
      }
      if (active.length > 3) {
        lines.push(fg("dim", `  +${active.length - 3} more`));
      }
    }
  }

  // Cleave section
  if (cl && cl.status !== "idle") {
    const statusColor = cl.status === "done" ? "green"
      : cl.status === "failed" ? "red" : "yellow";
    lines.push(fg(statusColor as any, `⚡ Cleave: ${cl.status}`) +
      (cl.runId ? fg("dim", ` ${cl.runId}`) : ""));
    if (cl.children) {
      for (const ch of cl.children.slice(0, wide ? 5 : 3)) {
        const icon = ch.status === "done" ? fg("green", "✓")
          : ch.status === "running" ? fg("yellow", "⟳")
          : ch.status === "failed" ? fg("red", "✕")
          : fg("dim", "○");
        const elapsed = ch.elapsed ? fg("dim", ` ${(ch.elapsed / 1000).toFixed(1)}s`) : "";
        lines.push(fg("dim", "  ") + `${icon} ${ch.label}${elapsed}`);
      }
    }
  }

  // Footer data (last 2 lines, same as compact)
  lines.push(fg("dim", `~/workspace/ai/omegon`) + "  " +
    fg("magenta", "feature/unified-dashboard") + "  " +
    fg("dim", "claude-sonnet-4") + " " + fg("yellow", "◆med"));

  const barWidth = wide ? 20 : 16;
  const gauge = buildContextGauge(barWidth, 45200, 12800, memTokens);
  lines.push(gauge + "  " +
    fg("dim", `In:${formatTokens(45200)} Out:${formatTokens(12800)} $0.12`));

  return lines;
}

// ── Scenario Definitions ─────────────────────────────────────

interface Scenario {
  name: string;
  dt?: DesignTreeDashboardState;
  os?: OpenSpecDashboardState;
  cl?: CleaveState;
  mem?: number;
}

const scenarios: Scenario[] = [
  {
    name: "Full activity — exploring + dispatching",
    dt: designTreeFull(),
    os: openspecMixed(),
    cl: cleaveDispatching(),
    mem: 2800,
  },
  {
    name: "All decided — single spec — idle",
    dt: designTreeAllDecided(),
    os: openspecSingle(),
    cl: cleaveIdle(),
    mem: 1200,
  },
  {
    name: "Cleave done — specs complete",
    dt: designTreeFull(),
    os: openspecMixed(),
    cl: cleaveDone(),
    mem: 3500,
  },
  {
    name: "Cleave failed",
    dt: designTreeFull(),
    os: openspecEmpty(),
    cl: cleaveFailed(),
  },
  {
    name: "Assessing complexity",
    dt: designTreeEmpty(),
    os: openspecSingle(),
    cl: cleaveAssessing(),
  },
  {
    name: "Merging children",
    dt: designTreeAllDecided(),
    os: openspecMixed(),
    cl: cleaveMerging(),
    mem: 4200,
  },
  {
    name: "Empty — no data at all",
    dt: undefined,
    os: undefined,
    cl: undefined,
  },
];

const widths = [80, 120, 160];

// ── Main ─────────────────────────────────────────────────────

const modeArg = process.argv[2] as "compact" | "raised" | undefined;
const modes: Array<"compact" | "raised"> =
  modeArg === "compact" ? ["compact"] :
  modeArg === "raised" ? ["raised"] :
  ["compact", "raised"];

console.log(`\n${A.bold}Dashboard Footer Test Harness${A.reset}`);
console.log(`Modes: ${modes.join(", ")}  |  Widths: ${widths.join(", ")}  |  Scenarios: ${scenarios.length}\n`);

let renderCount = 0;

for (const scenario of scenarios) {
  for (const mode of modes) {
    console.log(`${"═".repeat(70)}`);
    console.log(`  ${A.bold}${scenario.name}${A.reset}  [${mode}]`);
    console.log(`${"═".repeat(70)}`);

    for (const w of widths) {
      console.log(`\n  ${fg("dim", `── ${w} cols ${"─".repeat(w < 100 ? 20 : 40)}`)} `);
      const lines = mode === "compact"
        ? renderCompact(w, scenario.dt, scenario.os, scenario.cl, scenario.mem)
        : renderRaised(w, scenario.dt, scenario.os, scenario.cl, scenario.mem);

      if (lines.length === 0) {
        console.log(`  ${fg("dim", "(no output)")}`);
      } else {
        for (const line of lines) {
          console.log(`  │ ${line}`);
        }
        console.log(`  ${fg("dim", `(${lines.length} lines)`)}`);
      }
      renderCount++;
    }
    console.log();
  }
}

console.log(`${A.bold}Done.${A.reset} ${renderCount} renders total.\n`);
