/**
 * Profile definitions and project detection logic.
 *
 * A profile is a named group of tools that should be active together.
 * Detection functions scan the cwd for project signals to determine
 * which profiles apply.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Profile Definitions ─────────────────────────────────────────

export interface Profile {
  /** Profile identifier */
  id: string;
  /** Human-readable label */
  label: string;
  /** Description shown in /profile list */
  description: string;
  /** Tool name patterns to include. Exact match or glob-like prefix (e.g. "mcp_scribe_*") */
  tools: string[];
  /** Detection function: returns true if this profile should be auto-activated */
  detect: (cwd: string) => boolean;
  /** If true, always included regardless of detection */
  alwaysOn?: boolean;
}

/** Check if a command exists on PATH */
function hasCmd(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function fileExists(cwd: string, ...paths: string[]): boolean {
  return paths.some((p) => existsSync(join(cwd, p)));
}

/** Check if any file with the given extension exists in common content directories (shallow). */
function dirHasExt(cwd: string, ext: string): boolean {
  // Only check top-level and common content dirs — never walk node_modules/.git/etc.
  const SCAN_DIRS = [".", "docs", "assets", "images", "diagrams", "design", "src", "lib"];
  for (const dir of SCAN_DIRS) {
    try {
      const fullDir = join(cwd, dir);
      const entries = readdirSync(fullDir);
      if (entries.some((e) => e.endsWith(ext))) return true;
    } catch {
      // Directory doesn't exist, skip
    }
  }
  return false;
}

function readJsonField(cwd: string, file: string, field: string): unknown {
  try {
    const raw = readFileSync(join(cwd, file), "utf8");
    const json = JSON.parse(raw);
    return json[field];
  } catch {
    return undefined;
  }
}

export const PROFILES: Profile[] = [
  {
    id: "core",
    label: "Core",
    description: "Essential tools: built-in file/shell ops, memory, chronos, auth, model control",
    alwaysOn: true,
    tools: [
      // pi built-in tools (lowercase — these are pi's native tools, not Claude Code's
      // PascalCase variants). Must be included or setActiveTools() deactivates them.
      "read", "write", "edit", "bash",
      // Memory
      "memory_query", "memory_recall", "memory_episodes", "memory_focus",
      "memory_release", "memory_store", "memory_supersede", "memory_search_archive",
      "memory_connect", "memory_archive", "memory_compact",
      // Utilities
      "chronos", "whoami",
      // Model control
      "set_model_tier", "set_thinking_level", "switch_to_offline_driver",
      // Tool management
      "manage_tools",
    ],
    detect: () => true,
  },
  {
    id: "coding",
    label: "Coding",
    description: "Cleave decomposition, OpenSpec, design tree",
    tools: [
      "cleave_assess", "cleave_run",
      "openspec_manage",
      "design_tree", "design_tree_update",
    ],
    detect: (cwd) => fileExists(cwd, ".git"),
  },
  {
    id: "visual",
    label: "Visual",
    description: "Image generation, D2 diagrams, Excalidraw rendering",
    tools: [
      "generate_image_local", "render_diagram", "render_excalidraw",
    ],
    detect: (cwd) =>
      fileExists(cwd, "images") ||
      dirHasExt(cwd, ".excalidraw") ||
      dirHasExt(cwd, ".d2"),
  },
  {
    id: "local-ai",
    label: "Local AI",
    description: "Ollama local inference (ask_local_model, manage_ollama)",
    tools: [
      "ask_local_model", "list_local_models", "manage_ollama",
    ],
    detect: () => hasCmd("ollama"),
  },
  {
    id: "web",
    label: "Web & View",
    description: "Web search and file viewing",
    alwaysOn: true,
    tools: ["web_search", "view"],
    detect: () => true,
  },
  {
    id: "scribe",
    label: "Scribe",
    description: "Partnership tracking via MCP bridge (mcp_scribe_*)",
    tools: ["mcp_scribe_*"],
    detect: (cwd) => {
      // Detect if scribe MCP is configured — check for .pi/mcp.json or similar
      return fileExists(cwd, ".pi/mcp.json") ||
        existsSync(join(homedir(), ".pi", "mcp.json"));
    },
  },
  {
    id: "pi-dev",
    label: "Pi Development",
    description: "All tools enabled — for working on Omegon itself",
    tools: ["*"],
    detect: (cwd) => {
      const piExts = readJsonField(cwd, "package.json", "pi") as { extensions?: string[] } | undefined;
      return !!piExts?.extensions;
    },
  },
];

// ── Profile Config (persisted) ──────────────────────────────────

export interface ProfileConfig {
  /** Profiles to force-include regardless of detection */
  include?: string[];
  /** Profiles to force-exclude regardless of detection */
  exclude?: string[];
  /** Individual tool overrides */
  tools?: {
    enable?: string[];
    disable?: string[];
  };
}

export function loadProfileConfig(cwd: string): ProfileConfig {
  const configPath = join(cwd, ".pi", "profile.json");
  try {
    return JSON.parse(readFileSync(configPath, "utf8")) as ProfileConfig;
  } catch {
    return {};
  }
}

// ── Detection & Merge ───────────────────────────────────────────

/** Detect which profiles should be active for the given cwd */
export function detectProfiles(cwd: string): string[] {
  return PROFILES
    .filter((p) => p.alwaysOn || p.detect(cwd))
    .map((p) => p.id);
}

/** Match a tool name against a pattern (exact or wildcard suffix) */
export function matchTool(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return toolName === pattern;
}

/** Given detected profiles + config overrides, compute the active tool set */
export function resolveActiveTools(
  allToolNames: string[],
  detectedProfileIds: string[],
  config: ProfileConfig,
): string[] {
  // Apply include/exclude overrides to detected profiles
  let activeProfileIds = new Set(detectedProfileIds);

  for (const id of config.include ?? []) {
    activeProfileIds.add(id);
  }
  for (const id of config.exclude ?? []) {
    activeProfileIds.delete(id);
  }

  // Collect tool patterns from active profiles
  const activeProfiles = PROFILES.filter((p) => activeProfileIds.has(p.id));
  const patterns = activeProfiles.flatMap((p) => p.tools);

  // Check for wildcard — if any profile has "*", enable all
  if (patterns.includes("*")) {
    let tools = new Set(allToolNames);
    for (const name of config.tools?.disable ?? []) {
      tools.delete(name);
    }
    return [...tools];
  }

  // Match tools against patterns
  let enabledTools = new Set<string>();
  for (const toolName of allToolNames) {
    if (patterns.some((p) => matchTool(toolName, p))) {
      enabledTools.add(toolName);
    }
  }

  // Apply individual tool overrides
  for (const name of config.tools?.enable ?? []) {
    if (allToolNames.includes(name)) {
      enabledTools.add(name);
    }
  }
  for (const name of config.tools?.disable ?? []) {
    enabledTools.delete(name);
  }

  return [...enabledTools];
}

/** Format a summary of active/inactive profiles for display */
export function formatProfileSummary(
  detectedIds: string[],
  config: ProfileConfig,
  allToolNames: string[],
): string {
  const activeTools = resolveActiveTools(allToolNames, detectedIds, config);
  const lines: string[] = [];

  lines.push("## Tool Profiles\n");

  for (const profile of PROFILES) {
    const detected = detectedIds.includes(profile.id);
    const included = config.include?.includes(profile.id);
    const excluded = config.exclude?.includes(profile.id);

    let status: string;
    if (excluded) {
      status = "⊘ excluded";
    } else if (detected || included) {
      status = included && !detected ? "✓ forced" : "✓ active";
    } else {
      status = "○ inactive";
    }

    const toolCount = profile.tools.includes("*")
      ? "all"
      : `${profile.tools.length} tools`;

    lines.push(`- **${profile.label}** (${profile.id}): ${status} — ${toolCount}`);
  }

  lines.push("");
  lines.push(`**Active:** ${activeTools.length}/${allToolNames.length} tools`);

  if (config.tools?.enable?.length || config.tools?.disable?.length) {
    lines.push("\n**Overrides:**");
    for (const t of config.tools?.enable ?? []) lines.push(`  + ${t}`);
    for (const t of config.tools?.disable ?? []) lines.push(`  - ${t}`);
  }

  return lines.join("\n");
}
