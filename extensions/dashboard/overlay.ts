/**
 * Dashboard interactive overlay (Layer 2).
 *
 * Right-anchored sidepanel with three tabs:
 *   [1] Design Tree — node list with status icons, expand to show questions
 *   [2] OpenSpec    — change list with stage/progress
 *   [3] Cleave      — dispatch children with status/elapsed
 *
 * Keyboard:
 *   Tab / 1-3    — switch tabs
 *   ↑/↓          — navigate items
 *   Enter/→      — expand/collapse item
 *   ←            — collapse expanded item
 *   Esc          — close overlay
 *
 * Reads sharedState for all data. Subscribes to dashboard:update for live refresh.
 */

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { sharedState, DASHBOARD_UPDATE_EVENT } from "../shared-state.ts";

// ── Tab definitions ─────────────────────────────────────────────

type TabId = "design" | "openspec" | "cleave";

interface Tab {
  id: TabId;
  label: string;
  shortcut: string;
}

const TABS: Tab[] = [
  { id: "design", label: "Design Tree", shortcut: "1" },
  { id: "openspec", label: "OpenSpec", shortcut: "2" },
  { id: "cleave", label: "Cleave", shortcut: "3" },
];

// ── Item model for navigable lists ──────────────────────────────

interface ListItem {
  key: string;
  depth: number;
  expandable: boolean;
  lines: (theme: Theme, width: number) => string[];
}

/** Maximum content lines before the footer hint row (prevents maxHeight truncation). */
const MAX_CONTENT_LINES = 30;

// ── Overlay Component ───────────────────────────────────────────

export class DashboardOverlay {
  private tui: TUI;
  private theme: Theme;
  private done: (result: void) => void;

  private activeTab: TabId = "design";
  private selectedIndex = 0;
  private flatItems: ListItem[] = [];
  private expandedKeys = new Set<string>();

  /** Event unsubscribe handle for live refresh. */
  private unsubscribe: (() => void) | null = null;

  constructor(tui: TUI, theme: Theme, done: (result: void) => void) {
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.rebuildItems();
  }

  /** Attach to the pi event bus for live data refresh while overlay is open. */
  setEventBus(events: { on(event: string, handler: (data: unknown) => void): () => void }): void {
    this.unsubscribe = events.on(DASHBOARD_UPDATE_EVENT, () => {
      this.rebuildItems();
      this.tui.requestRender();
    });
  }

  // ── Keyboard handling ───────────────────────────────────────────

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.done();
      return;
    }

    // Tab switching
    if (matchesKey(data, "tab")) {
      const idx = TABS.findIndex((t) => t.id === this.activeTab);
      this.activeTab = TABS[(idx + 1) % TABS.length]!.id;
      this.selectedIndex = 0;
      this.rebuildItems();
      this.tui.requestRender();
      return;
    }

    for (const tab of TABS) {
      if (data === tab.shortcut) {
        this.activeTab = tab.id;
        this.selectedIndex = 0;
        this.rebuildItems();
        this.tui.requestRender();
        return;
      }
    }

    // Navigation — guard empty list
    if (this.flatItems.length === 0) return;

    if (matchesKey(data, "up")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.selectedIndex = Math.min(this.flatItems.length - 1, this.selectedIndex + 1);
      this.tui.requestRender();
      return;
    }

    // Expand/collapse
    if (matchesKey(data, "return") || matchesKey(data, "right")) {
      const item = this.flatItems[this.selectedIndex];
      if (item?.expandable) {
        if (this.expandedKeys.has(item.key)) {
          this.expandedKeys.delete(item.key);
        } else {
          this.expandedKeys.add(item.key);
        }
        this.rebuildItems();
        this.tui.requestRender();
      }
      return;
    }

    if (matchesKey(data, "left")) {
      const item = this.flatItems[this.selectedIndex];
      if (item && this.expandedKeys.has(item.key)) {
        this.expandedKeys.delete(item.key);
        this.rebuildItems();
        this.tui.requestRender();
      }
      return;
    }
  }

  // ── Rendering ─────────────────────────────────────────────────

  render(width: number): string[] {
    const th = this.theme;
    const innerW = Math.max(1, width - 2);
    const border = (c: string) => th.fg("border", c);
    const pad = (s: string) => truncateToWidth(s, innerW, "…", true);
    const lines: string[] = [];

    // Top border with title
    const title = " Dashboard ";
    const titleW = visibleWidth(title);
    const topLeft = "─".repeat(Math.floor((innerW - titleW) / 2));
    const topRight = "─".repeat(Math.max(0, innerW - titleW - topLeft.length));
    lines.push(border("╭" + topLeft) + th.fg("accent", title) + border(topRight + "╮"));

    // Tab bar
    const tabParts: string[] = [];
    for (const tab of TABS) {
      if (tab.id === this.activeTab) {
        tabParts.push(th.fg("accent", `[${tab.shortcut}] ${tab.label}`));
      } else {
        tabParts.push(th.fg("dim", `[${tab.shortcut}] ${tab.label}`));
      }
    }
    lines.push(border("│") + pad(" " + tabParts.join("  ")) + border("│"));
    lines.push(border("├" + "─".repeat(innerW) + "┤"));

    // Content area (capped to prevent maxHeight from eating the footer)
    const contentLines = this.renderContent(innerW).slice(0, MAX_CONTENT_LINES);
    if (contentLines.length === 0) {
      lines.push(border("│") + pad(th.fg("dim", " (no data)")) + border("│"));
    } else {
      for (const cl of contentLines) {
        lines.push(border("│") + pad(cl) + border("│"));
      }
    }

    // Footer with key hints
    lines.push(border("├" + "─".repeat(innerW) + "┤"));
    lines.push(border("│") + pad(th.fg("dim", " ↑↓ navigate  ←→/↵ expand  Tab switch  Esc close")) + border("│"));
    lines.push(border("╰" + "─".repeat(innerW) + "╯"));

    return lines;
  }

  private renderContent(innerW: number): string[] {
    const th = this.theme;
    const lines: string[] = [];

    for (let i = 0; i < this.flatItems.length; i++) {
      const item = this.flatItems[i]!;
      const isSelected = i === this.selectedIndex;
      const indent = "  ".repeat(item.depth);
      const cursor = isSelected ? th.fg("accent", "→ ") : "  ";

      // Expand indicator
      let expandIcon = "  ";
      if (item.expandable) {
        expandIcon = this.expandedKeys.has(item.key)
          ? th.fg("dim", "▾ ")
          : th.fg("dim", "▸ ");
      }

      const itemLines = item.lines(th, innerW - 4 - item.depth * 2);
      if (itemLines.length > 0) {
        lines.push(`${cursor}${indent}${expandIcon}${itemLines[0]}`);
        for (let j = 1; j < itemLines.length; j++) {
          lines.push(`  ${indent}  ${itemLines[j]}`);
        }
      }
    }

    return lines;
  }

  // ── Data building ─────────────────────────────────────────────

  private rebuildItems(): void {
    switch (this.activeTab) {
      case "design":
        this.flatItems = this.buildDesignItems();
        break;
      case "openspec":
        this.flatItems = this.buildOpenSpecItems();
        break;
      case "cleave":
        this.flatItems = this.buildCleaveItems();
        break;
    }

    // Clamp selection to valid range (handles empty lists correctly)
    if (this.flatItems.length === 0) {
      this.selectedIndex = 0;
    } else if (this.selectedIndex >= this.flatItems.length) {
      this.selectedIndex = this.flatItems.length - 1;
    }
  }

  // ── Design Tree tab ───────────────────────────────────────────

  private buildDesignItems(): ListItem[] {
    const dt = sharedState.designTree;
    if (!dt || dt.nodeCount === 0) return [];

    const items: ListItem[] = [];

    // Summary item
    items.push({
      key: "dt-summary",
      depth: 0,
      expandable: false,
      lines: (th) => {
        const parts: string[] = [];
        if (dt.decidedCount > 0) parts.push(th.fg("success", `${dt.decidedCount} decided`));
        if (dt.exploringCount > 0) parts.push(th.fg("accent", `${dt.exploringCount} exploring`));
        if (dt.blockedCount > 0) parts.push(th.fg("error", `${dt.blockedCount} blocked`));
        if (dt.openQuestionCount > 0) parts.push(th.fg("warning", `${dt.openQuestionCount} open questions`));
        return [parts.join(" · ") || th.fg("dim", "empty")];
      },
    });

    // Focused node (if any)
    const focused = dt.focusedNode;
    if (focused) {
      const hasQuestions = focused.questions.length > 0;
      const focusedKey = `dt-focused-${focused.id}`;
      items.push({
        key: focusedKey,
        depth: 0,
        expandable: hasQuestions,
        lines: (th) => {
          const statusIcon = this.statusIcon(focused.status, th);
          const focusLabel = th.fg("accent", " (focused)");
          return [`${statusIcon} ${focused.title}${focusLabel}`];
        },
      });

      // Show questions if expanded
      if (hasQuestions && this.expandedKeys.has(focusedKey)) {
        for (let qi = 0; qi < focused.questions.length; qi++) {
          items.push({
            key: `dt-q-${focused.id}-${qi}`,
            depth: 1,
            expandable: false,
            lines: (th) => [th.fg("warning", `? ${focused.questions[qi]}`)],
          });
        }
      }
    }

    // Node-count breakdown when no focused node (give the tab more content)
    if (!focused) {
      const seedCount = dt.nodeCount - dt.decidedCount - dt.exploringCount - dt.blockedCount;
      if (seedCount > 0) {
        items.push({
          key: "dt-seeds",
          depth: 0,
          expandable: false,
          lines: (th) => [th.fg("muted", `${seedCount} seed${seedCount > 1 ? "s" : ""} — use /design focus to explore`)],
        });
      }
    }

    return items;
  }

  private statusIcon(status: string, th: Theme): string {
    const colorMap: Record<string, ThemeColor> = {
      decided: "success",
      exploring: "accent",
      seed: "muted",
      blocked: "error",
      deferred: "warning",
    };
    const iconMap: Record<string, string> = {
      decided: "●",
      exploring: "◐",
      seed: "◌",
      blocked: "✕",
      deferred: "◑",
    };
    const color = colorMap[status] ?? "dim";
    const icon = iconMap[status] ?? "○";
    return th.fg(color, icon);
  }

  // ── OpenSpec tab ──────────────────────────────────────────────

  private buildOpenSpecItems(): ListItem[] {
    const os = sharedState.openspec;
    if (!os || os.changes.length === 0) return [];

    const items: ListItem[] = [];

    // Summary
    items.push({
      key: "os-summary",
      depth: 0,
      expandable: false,
      lines: (th) => [th.fg("dim", `${os.changes.length} active change${os.changes.length > 1 ? "s" : ""}`)],
    });

    // Each change
    for (const change of os.changes) {
      const done = change.tasksTotal > 0 && change.tasksDone >= change.tasksTotal;
      const hasDetails = change.stage !== undefined || change.tasksTotal > 0;
      const key = `os-change-${change.name}`;

      items.push({
        key,
        depth: 0,
        expandable: hasDetails,
        lines: (th) => {
          const icon = done ? th.fg("success", "✓") : th.fg("dim", "◦");
          const progress = change.tasksTotal > 0
            ? th.fg(done ? "success" : "dim", ` ${change.tasksDone}/${change.tasksTotal}`)
            : "";
          return [`${icon} ${change.name}${progress}`];
        },
      });

      // Expanded detail
      if (hasDetails && this.expandedKeys.has(key)) {
        if (change.stage) {
          items.push({
            key: `os-stage-${change.name}`,
            depth: 1,
            expandable: false,
            lines: (th) => [th.fg("dim", `stage: ${change.stage}`)],
          });
        }
        if (change.tasksTotal > 0) {
          const pct = Math.round((change.tasksDone / change.tasksTotal) * 100);
          items.push({
            key: `os-progress-${change.name}`,
            depth: 1,
            expandable: false,
            lines: (th) => {
              const barW = 20;
              const filled = Math.round((change.tasksDone / change.tasksTotal) * barW);
              const bar = th.fg("success", "█".repeat(filled)) + th.fg("dim", "░".repeat(barW - filled));
              return [`${bar} ${pct}%`];
            },
          });
        }
      }
    }

    return items;
  }

  // ── Cleave tab ────────────────────────────────────────────────

  private buildCleaveItems(): ListItem[] {
    const cl = sharedState.cleave;
    if (!cl) return [];

    const items: ListItem[] = [];

    // Status header
    const statusColor: ThemeColor = cl.status === "done" ? "success"
      : cl.status === "failed" ? "error"
      : cl.status === "idle" ? "dim"
      : "warning";

    items.push({
      key: "cl-status",
      depth: 0,
      expandable: false,
      lines: (th) => {
        const runLabel = cl.runId ? th.fg("dim", ` (${cl.runId})`) : "";
        return [th.fg(statusColor, cl.status) + runLabel];
      },
    });

    // Children
    if (cl.children && cl.children.length > 0) {
      const doneCount = cl.children.filter((c) => c.status === "done").length;
      const failCount = cl.children.filter((c) => c.status === "failed").length;
      const runCount = cl.children.filter((c) => c.status === "running").length;

      items.push({
        key: "cl-summary",
        depth: 0,
        expandable: false,
        lines: (th) => {
          const parts: string[] = [];
          parts.push(`${cl.children!.length} children`);
          if (doneCount > 0) parts.push(th.fg("success", `${doneCount} ✓`));
          if (runCount > 0) parts.push(th.fg("warning", `${runCount} ⟳`));
          if (failCount > 0) parts.push(th.fg("error", `${failCount} ✕`));
          return [parts.join("  ")];
        },
      });

      for (const child of cl.children) {
        const key = `cl-child-${child.label}`;
        const hasElapsed = child.elapsed !== undefined;

        items.push({
          key,
          depth: 0,
          expandable: hasElapsed,
          lines: (th) => {
            const icon = child.status === "done" ? th.fg("success", "✓")
              : child.status === "failed" ? th.fg("error", "✕")
              : child.status === "running" ? th.fg("warning", "⟳")
              : th.fg("dim", "○");
            return [`${icon} ${child.label}`];
          },
        });

        if (hasElapsed && this.expandedKeys.has(key)) {
          items.push({
            key: `cl-elapsed-${child.label}`,
            depth: 1,
            expandable: false,
            lines: (th) => {
              const secs = child.elapsed ?? 0;
              const m = Math.floor(secs / 60);
              const s = Math.round(secs % 60);
              const elapsed = m > 0 ? `${m}m ${s}s` : `${s}s`;
              return [th.fg("dim", `elapsed: ${elapsed}`)];
            },
          });
        }
      }
    }

    return items;
  }

  // ── Component lifecycle ───────────────────────────────────────

  invalidate(): void {}

  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Show the dashboard overlay as a right-anchored sidepanel.
 * Blocks until the user presses Esc.
 */
export async function showDashboardOverlay(ctx: ExtensionContext, pi?: { events: { on(e: string, h: () => void): () => void } }): Promise<void> {
  await ctx.ui.custom<void>(
    (tui, theme, _kb, done) => {
      const overlay = new DashboardOverlay(tui, theme, done);
      if (pi?.events) {
        overlay.setEventBus(pi.events);
      }
      return overlay;
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "right-center",
        width: "40%",
        minWidth: 40,
        maxHeight: "80%",
        margin: { top: 1, right: 1, bottom: 1 },
        visible: (termWidth: number) => termWidth >= 80,
      },
    },
  );
}
