---
id: functional-plugins
title: Functional plugins — code-backed skills with tools, endpoints, and runtime logic
status: exploring
parent: persona-system
tags: [plugins, architecture, extensions, tools, mcp, code]
open_questions:
  - Should script-backed tools declare their runtime dependencies (requirements.txt, package.json) and should omegon auto-install them?
  - "Sandboxing: should script-backed tools run in a restricted environment (no network, limited filesystem access) or trust the operator?"
issue_type: feature
priority: 2
---

# Functional plugins — code-backed skills with tools, endpoints, and runtime logic

## Overview

Markdown-only plugins (persona/tone/skill) are passive — they inject context. Functional plugins have executable code: tools backed by HTTP endpoints, WASM modules, or subprocess scripts. The question: how does someone write a plugin that *does* something, not just *says* something? This bridges the existing HTTP plugin system (plugin.toml with tools/endpoints) and the new armory manifest format.

## Research

### The spectrum: passive → functional → autonomous

Plugins exist on a spectrum of capability:

**Passive (what we have)**
- Persona: PERSONA.md + mind/facts.jsonl → context injection only
- Tone: TONE.md + exemplars → prompt modification only
- Skill: SKILL.md → guidance injection only
- Zero code, zero runtime, zero risk.

**Functional (what we need)**
- Tool-bearing: exposes tools the agent can call (HTTP, subprocess, WASM)
- Context-producing: generates dynamic context at runtime (not static markdown)
- Event-reacting: listens for agent events and takes action
- Has code, has runtime, needs sandboxing.

**Autonomous (future)**
- Sub-agent: spawns its own agent loop for delegated work
- Long-running: maintains state across sessions
- This is the Omega coordinator tier — out of scope here.

The existing HTTP plugin system (`manifest.rs` + `http_feature.rs`) already handles functional plugins via HTTP endpoints. The gap is: **there's no easy way to write one.** An operator shouldn't need to run a separate HTTP server just to add a tool that reads a CSV file.

### Three execution models for functional plugins

**1. Script-backed tools (simplest)**

A tool defined in plugin.toml that runs a local script when invoked:

```toml
[plugin]
type = "extension"
id = "dev.example.csv-analyzer"
name = "CSV Analyzer"
version = "1.0.0"
description = "Analyze CSV files with pandas"

[[tools]]
name = "analyze_csv"
description = "Run statistical analysis on a CSV file"
runner = "python"
script = "tools/analyze.py"
parameters = { type = "object", properties = { path = { type = "string" }, query = { type = "string" } }, required = ["path"] }
timeout_secs = 30
```

The harness spawns `python tools/analyze.py` with args as JSON on stdin, reads JSON result from stdout. Simple, language-agnostic, zero infrastructure.

**2. HTTP-backed tools (existing)**

```toml
[[tools]]
name = "scribe_status"
description = "Get engagement status"
endpoint = "http://localhost:3000/api/status"
method = "GET"
```

Requires the operator to run a server. Good for services that are already running (Scribe, Jira, etc). Not good for one-off tools.

**3. WASM-backed tools (future, sandboxed)**

```toml
[[tools]]
name = "diagram_render"
description = "Render a D2 diagram to SVG"
runner = "wasm"
module = "tools/diagram.wasm"
```

Sandboxed execution, portable, no external runtime. Requires WASM toolchain for authors. Best for compute-intensive or security-sensitive operations.

**Recommendation**: Script-backed tools are the 80% solution. They're what Claude Code plugins would be if Claude Code had an open plugin system. The operator writes a Python/Node/Bash script, declares it in plugin.toml, done.

The stdin/stdout JSON contract:
- Input: `{"path": "/data/sales.csv", "query": "mean revenue by quarter"}`  
- Output: `{"result": "...", "error": null}` or `{"result": null, "error": "..."}`
- Exit code 0 = success, non-zero = error
- Timeout enforced by harness (default 30s)

WASM is the long-term play but script-backed gets us 80% now.

### Unified plugin.toml covers all types

The beauty of the unified manifest: a single plugin can be both passive AND functional. A PCB designer persona can bundle markdown guidance AND executable tools:

```toml
[plugin]
type = "persona"
id = "dev.styrene.omegon.pcb-designer"
name = "PCB Designer"
version = "1.0.0"
description = "PCB design persona with KiCad integration"

[persona.identity]
directive = "PERSONA.md"

[persona.mind]
seed_facts = "mind/facts.jsonl"

# Functional: tools the agent can call
[[tools]]
name = "drc_check"
description = "Run KiCad Design Rule Check on the current PCB"
runner = "python"
script = "tools/drc_check.py"
parameters = { type = "object", properties = { pcb_path = { type = "string" } }, required = ["pcb_path"] }
timeout_secs = 60

[[tools]]
name = "bom_export"
description = "Export Bill of Materials from schematic"
runner = "python"
script = "tools/bom_export.py"
parameters = { type = "object", properties = { sch_path = { type = "string" }, format = { type = "string", enum = ["csv", "json"] } } }

# Dynamic context: refresh component library status on session start
[context]
runner = "python"
script = "context/library_status.py"
ttl_turns = 50

[detect]
file_patterns = ["*.kicad_pcb", "*.kicad_sch", "*.kicad_pro"]
```

This is one plugin.toml, one install command, one repo. The operator gets: domain expertise (PERSONA.md), domain knowledge (mind/facts.jsonl), and domain tools (DRC check, BOM export) — all from `omegon plugin install https://github.com/someone/pcb-designer`.

The `runner` field distinguishes script-backed from HTTP-backed:
- `runner = "python"` + `script = "..."` → subprocess with JSON stdin/stdout
- `runner = "node"` + `script = "..."` → same pattern, Node.js
- `runner = "bash"` + `script = "..."` → shell script
- No `runner` + `endpoint = "..."` → HTTP call (existing behavior)
- `runner = "wasm"` + `module = "..."` → future WASM execution

## Open Questions

- Should script-backed tools declare their runtime dependencies (requirements.txt, package.json) and should omegon auto-install them?
- Sandboxing: should script-backed tools run in a restricted environment (no network, limited filesystem access) or trust the operator?
