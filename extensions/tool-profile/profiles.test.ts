import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  matchTool,
  resolveActiveTools,
  detectProfiles,
  formatProfileSummary,
  PROFILES,
} from "./profiles.ts";

const ALL_TOOLS = [
  "memory_query", "memory_recall", "memory_store", "chronos", "whoami",
  "set_model_tier", "set_thinking_level", "switch_to_offline_driver",
  "cleave_assess", "cleave_run", "openspec_manage", "design_tree", "design_tree_update",
  "generate_image_local", "render_diagram", "render_excalidraw",
  "ask_local_model", "list_local_models", "manage_ollama",
  "web_search", "view",
  "mcp_scribe_list_partnerships", "mcp_scribe_get_partnership", "mcp_scribe_create_log_entry",
  "manage_tools",
];

describe("matchTool", () => {
  it("matches exact names", () => {
    assert.ok(matchTool("web_search", "web_search"));
    assert.ok(!matchTool("web_search", "view"));
  });

  it("matches wildcard prefix", () => {
    assert.ok(matchTool("mcp_scribe_list_partnerships", "mcp_scribe_*"));
    assert.ok(matchTool("mcp_scribe_get_partnership", "mcp_scribe_*"));
    assert.ok(!matchTool("web_search", "mcp_scribe_*"));
  });

  it("matches global wildcard", () => {
    assert.ok(matchTool("anything", "*"));
  });
});

describe("resolveActiveTools", () => {
  it("core + web profiles enable expected tools", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core", "web"], {});
    assert.ok(active.includes("memory_query"));
    assert.ok(active.includes("chronos"));
    assert.ok(active.includes("web_search"));
    assert.ok(active.includes("view"));
    assert.ok(!active.includes("cleave_assess"));
    assert.ok(!active.includes("generate_image_local"));
    assert.ok(!active.includes("mcp_scribe_list_partnerships"));
  });

  it("coding profile adds cleave/openspec/design-tree", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core", "web", "coding"], {});
    assert.ok(active.includes("cleave_assess"));
    assert.ok(active.includes("openspec_manage"));
    assert.ok(active.includes("design_tree"));
  });

  it("scribe profile matches wildcard prefix", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core", "scribe"], {});
    assert.ok(active.includes("mcp_scribe_list_partnerships"));
    assert.ok(active.includes("mcp_scribe_get_partnership"));
    assert.ok(active.includes("mcp_scribe_create_log_entry"));
  });

  it("pi-dev profile enables everything", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["pi-dev"], {});
    assert.equal(active.length, ALL_TOOLS.length);
  });

  it("config include adds profiles", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core"], { include: ["visual"] });
    assert.ok(active.includes("generate_image_local"));
    assert.ok(active.includes("render_diagram"));
  });

  it("config exclude removes profiles", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core", "coding"], { exclude: ["coding"] });
    assert.ok(!active.includes("cleave_assess"));
    assert.ok(active.includes("chronos"));
  });

  it("config tools.enable adds individual tools", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core"], {
      tools: { enable: ["render_diagram"] },
    });
    assert.ok(active.includes("render_diagram"));
  });

  it("config tools.disable removes individual tools", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["core", "web"], {
      tools: { disable: ["web_search"] },
    });
    assert.ok(!active.includes("web_search"));
    assert.ok(active.includes("view"));
  });

  it("pi-dev with disable still respects disable", () => {
    const active = resolveActiveTools(ALL_TOOLS, ["pi-dev"], {
      tools: { disable: ["generate_image_local"] },
    });
    assert.ok(!active.includes("generate_image_local"));
    assert.ok(active.includes("web_search"));
  });
});

describe("detectProfiles", () => {
  it("always includes core and web", () => {
    // Use /tmp as a generic non-project directory
    const detected = detectProfiles("/tmp");
    assert.ok(detected.includes("core"));
    assert.ok(detected.includes("web"));
  });

  it("detects pi-dev for pi-kit itself", () => {
    // This test runs inside pi-kit which has pi.extensions in package.json
    const detected = detectProfiles(process.cwd());
    assert.ok(detected.includes("pi-dev"));
  });
});

describe("formatProfileSummary", () => {
  it("produces readable output", () => {
    const summary = formatProfileSummary(["core", "web", "coding"], {}, ALL_TOOLS);
    assert.ok(summary.includes("Core"));
    assert.ok(summary.includes("✓ active"));
    assert.ok(summary.includes("○ inactive"));
    assert.ok(summary.includes("Active:"));
  });

  it("shows exclusions", () => {
    const summary = formatProfileSummary(["core", "coding"], { exclude: ["coding"] }, ALL_TOOLS);
    assert.ok(summary.includes("⊘ excluded"));
  });

  it("shows forced includes", () => {
    const summary = formatProfileSummary(["core"], { include: ["visual"] }, ALL_TOOLS);
    assert.ok(summary.includes("✓ forced"));
  });
});

describe("PROFILES", () => {
  it("all profiles have unique ids", () => {
    const ids = PROFILES.map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  it("core profile tools are all valid tool-like names", () => {
    const core = PROFILES.find((p) => p.id === "core")!;
    for (const tool of core.tools) {
      assert.ok(tool.match(/^[a-z_]+$/), `Invalid tool name: ${tool}`);
    }
  });

  it("manage_tools is in the core profile so it cannot disable itself", () => {
    const core = PROFILES.find((p) => p.id === "core")!;
    assert.ok(core.tools.includes("manage_tools"),
      "manage_tools must be in core profile or it gets disabled on non-pi-dev projects");
  });
});
