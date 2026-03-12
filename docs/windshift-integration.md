---
id: windshift-integration
title: Windshift PM Integration — Design Tree + OpenSpec sync
status: seed
tags: [integration, project-management, windshift, lifecycle, self-hosted]
open_questions:
  - Does Windshift add personal access token (PAT) support? Without it, programmatic access requires storing a session cookie — fragile and not suitable for an extension.
  - Do we want push-only (design-tree → Windshift on lifecycle transitions) or bidirectional sync? Bidirectional adds complexity but lets the operator triage in the Windshift UI.
  - Should OpenSpec changes map to Windshift Milestones or parent Items? Milestones have a completion semantic but less flexibility; parent Items allow full hierarchy.
  - Wait for Windshift to stabilize (API versioning, PAT support, webhooks) or build against current surface and accept churn? Project is days old.
---

# Windshift PM Integration — Design Tree + OpenSpec sync

## Overview

Explore bidirectional sync between pi-kit's design-tree/OpenSpec lifecycle and a self-hosted Windshift instance. Windshift is a Go+Svelte, SQLite-default work management platform (AGPL-3.0) with a hierarchical Item model, built-in LLM integration, and SCM hooks. The goal is to surface pi-kit's internal lifecycle state (design nodes, OpenSpec changes, cleave tasks) as first-class items in Windshift — giving a human-readable PM view without abandoning the code-native workflow.

## Research

### Windshift API surface (assessed 2026-03-12)

- **Backend**: Go 1.25+, net/http, flat REST routes. No versioning prefix.
- **Frontend**: Svelte 5 + Vite + Tailwind
- **DB**: SQLite (default) or PostgreSQL
- **Auth**: Session + JWT. No personal access tokens visible in routes — blocker for programmatic access.
- **Item model**: Hierarchical (`parent_id`, `children`), `custom_field_values`, `status_id`, `milestone_id`, `iteration_id`, `is_task` flag. Strong mapping to design-tree nodes.
- **AI routes**: `/ai/items/{id}/decompose`, `/ai/items/{id}/catch-me-up`, `/ai/plan-my-day`. OpenAI-compatible LLM client, admin-configurable.
- **SCM**: GitHub, GitLab, Gitea, Bitbucket integration built in.
- **Auth**: OIDC/SSO, WebAuthn/FIDO2, SCIM 2.0.
- **No outbound webhooks found** — extension would need to poll.
- **No API versioning** — breaking changes will be silent.
- **Repo**: github.com/Windshiftapp/core — AGPL-3.0, 3 stars, very early (updated 2026-03-12).

### Concept mapping

| pi-kit concept | Windshift concept |
|---|---|
| Design node | Item (hierarchical, custom fields) |
| Node status (seed/exploring/decided/implemented) | Configurable workspace Status |
| OpenSpec change | Milestone or parent Item |
| tasks.md group | Item with `is_task: true` children |
| Cleave child | Sub-item under the OpenSpec item |
| `feature/*` branch | SCM link on the item |
| Design tree tag | Label |

### Rust-native PM alternatives sweep (2026-03-12)



### Beads feature mapping against pi-kit extensions (2026-03-12)

## Beads core feature set

From steveyegge/beads (canonical), beads-rs, beads_rust:

| Feature | Description |
|---|---|
| Issues | JSONL records with id, title, type, status, priority |
| Types | epic, feature, bug, chore, task (configurable) |
| Status | open, in_progress, blocked, closed (with defer) |
| Dependencies | Directed edges: A depends_on B → A blocked until B closed |
| `bd ready` | Returns issues with all deps satisfied — the "what to do next" query |
| `bd blocked` | Shows issues with unsatisfied deps |
| `bd context` | Injects relevant issue context into agent prompt |
| `bd graph` | Renders dependency graph |
| Git storage | JSONL in `.beads/` committed to repo; beads-rs uses git refs directly |
| Labels/tags | Free-form labels on issues |
| Priority | 1-5 numeric |
| Children | Issues can have children (epics contain features/tasks) |
| `bd sync` | Merges beads state across branches (not needed in beads-rs) |
| Linear bridge | Optional sync to Linear PM |

---

## Feature-by-feature mapping to pi-kit

### ✅ Already built — full coverage

**Issues / work items**
→ **Design tree nodes** (`extensions/design-tree/`)
- `DesignNode` has: id, title, status, parent, dependencies, tags, branches, openspec_change
- Status enum: seed/exploring/decided/implementing/implemented/blocked/deferred — richer than beads' open/in_progress/blocked/closed
- Dependencies tracked in frontmatter, rendered by `design_tree` tool
- Stored as markdown files in `docs/` — git-native, human-readable

**Dependency graph**
→ **design_tree dependencies** + **memory_connect** facts
- `DesignNode.dependencies: string[]` — explicit blocking relationships
- `memory_connect` creates labeled edges between facts (depends_on, contradicts, enables, etc.)
- The graph exists; it's just not visualized as a Beads-style dependency view

**Types (epic/feature/task/bug)**
→ **Partial via tags** on DesignNode
- Tags are free-form; no enforced type enum
- OpenSpec changes serve as the "epic" level; tasks.md groups as "tasks"
- Design nodes implicitly type themselves by status and position in hierarchy

**`bd ready` — "what's unblocked and ready to work"**
→ **lifecycle `canImplement` flag** in design-tree lifecycle
- `canImplement: true` when node is decided + no open questions + no blocking deps
- Dashboard surfaces this
- But: NOT queryable by the agent in a structured way like `bd ready --json`
- Gap: no single "give me all ready work" tool call

**Context injection**
→ **project-memory context auto-injection**
- Semantic retrieval pulls relevant facts per message
- Working memory pinning (`memory_focus`) keeps critical facts in context
- Episodic memory provides session narrative continuity
- `memory_recall` for targeted semantic search
- Richer than beads context (vector search vs keyword match)

**Git-native storage**
→ **.pi/memory/facts.jsonl** + **docs/*.md design nodes**
- `facts.jsonl` tracked in git with `merge=union` gitattribute
- Design nodes are markdown files tracked in git
- Already ships with git-native storage for both layers

**Labels/tags**
→ **DesignNode.tags** + **Fact sections** in project-memory
- Design nodes have free-form tags array
- Memory facts have section classification (Architecture/Decisions/Constraints/etc)

**Priority**
→ **Not implemented**
- No priority field on design nodes or OpenSpec changes
- Effort tiers (Servitor→Omnissiah) exist for inference cost, not work priority

**Children / parent hierarchy**
→ **DesignNode.parent** + OpenSpec tasks.md groups + Cleave children
- `parent` field tracks containment hierarchy
- OpenSpec change → tasks.md groups → cleave children is a 3-level hierarchy
- But: hierarchy is implicit across 3 systems, not a unified model

**`bd blocked`**
→ **Dashboard "blocked" status** + design-tree `blocked` status
- Dashboard surfaces blocked nodes
- But: no agent-queryable "show me all blocked work and why" tool

**`bd graph`**
→ **markdown-viewport** (deferred) would provide this
- Wikilink graph view planned but not built
- memory_connect edges exist but aren't visualized

**Issue types as first-class citizens**
→ **Not unified**
- Epics: implicitly OpenSpec changes or parent design nodes
- Features: design nodes
- Tasks: tasks.md + cleave children
- Bugs: no bug/defect tracking at all — gap

**`bd sync`**
→ **facts.jsonl merge=union gitattribute**
- Multi-agent/multi-branch fact merging handled by git union merge
- Design nodes merge as normal markdown files

---

## Gap analysis summary

| Beads feature | Pi-kit status | Gap severity |
|---|---|---|
| Work items with status | ✅ Design nodes | None |
| Dependency edges | ✅ DesignNode.dependencies + memory_connect | None |
| Git-native storage | ✅ facts.jsonl + docs/*.md | None |
| Context injection | ✅ project-memory (richer than beads) | None |
| Labels/tags | ✅ DesignNode.tags | None |
| Parent/child hierarchy | ✅ Partial (3-system) | Low |
| `bd ready` — agent query | ⚠️ lifecycle canImplement exists but not tool-queryable as a list | Medium |
| `bd blocked` — agent query | ⚠️ blocked status exists but no structured query tool | Medium |
| `bd context` — auto-inject on session start | ✅ project-memory does this better | None |
| Priority field | ❌ Missing | Low |
| Bug/defect issue type | ❌ Missing | Low |
| Epic type enforcement | ⚠️ Implicit via OpenSpec, not enforced | Low |
| Dependency graph visualization | ❌ Missing (markdown-viewport deferred) | Low |
| Multi-agent sync | ✅ facts.jsonl merge=union | None |

---

## The two real gaps

**Gap 1 — `bd ready` equivalent**: The agent cannot ask "give me all work items that are unblocked and ready to implement" in one tool call. The data exists (canImplement, status, dependencies) spread across design-tree + openspec, but there's no aggregating query. A `design_tree` action like `ready` or a dedicated tool returning all canImplement=true nodes would close this.

**Gap 2 — `bd blocked` equivalent**: No structured query for "what's blocked and why". Blocked nodes exist in the design tree but can't be listed with their blocking deps in one call.

Both gaps are small additions to the existing `design_tree` tool — new `action` variants, not new extensions.

## Open Questions

- Does Windshift add personal access token (PAT) support? Without it, programmatic access requires storing a session cookie — fragile and not suitable for an extension.
- Do we want push-only (design-tree → Windshift on lifecycle transitions) or bidirectional sync? Bidirectional adds complexity but lets the operator triage in the Windshift UI.
- Should OpenSpec changes map to Windshift Milestones or parent Items? Milestones have a completion semantic but less flexibility; parent Items allow full hierarchy.
- Wait for Windshift to stabilize (API versioning, PAT support, webhooks) or build against current surface and accept churn? Project is days old.

## Beads ecosystem (strongest signal)

Beads is a git-backed, dependency-aware issue tracker explicitly designed for AI coding agents. Multiple Rust implementations exist:

**beads-rs** (`delightful-ai/beads-rs`) — crates.io
- Pure git storage: everything lives in `refs/heads/beads/store`, no SQLite
- Designed for agent swarms: one daemon per machine, instant sync across clones
- "Conflicts are impossible" — immutable append-only model
- Primitive map: issues, dependencies, status, labels
- Missing: epics, milestones, iterations (flat model only)

**beads_rust** (`Dicklesworthstone/beads_rust`)
- Local-first SQLite + JSONL export for git-friendly collaboration
- ~20K lines of Rust, full feature port of original Python beads
- Has graph-aware TUI viewer (`beads_viewer` — separate repo)
- SQLite + JSONL gives both query power and git diff-ability
- Missing: epics/milestones explicitly, but hierarchical via parent_id possible

**rusty-beads** (crates.io)
- Rust port of steveyegge/beads
- Context store + dependency tracking + semantic compaction
- Designed for AI coding agents specifically

**Concept fit for pi-kit:**
| Beads concept | pi-kit concept |
|---|---|
| Issue | Design node or OpenSpec change |
| Dependency | design_tree dependency edge |
| Ready status | "canImplement" lifecycle flag |
| Context store | memory facts |
| Git-native storage | .pi/ directory already in git |

---

## project_management crate (`pbower/project_management`) — strong fit

**Four-level hierarchy: Product → Epic → Task → Subtask**
- Milestones attachable to any level
- File-based (markdown/TOML — no server)
- Optional TUI
- Covers exactly the PM primitives Windshift provides
- Pure Rust, embeddable, no external service needed

**Concept fit:**
| PM crate concept | pi-kit concept |
|---|---|
| Product | Repository / project root |
| Epic | OpenSpec change or design tree cluster |
| Task | tasks.md group |
| Subtask | Cleave child |
| Milestone | Release / version tag |

---

## git-bug (Go, not Rust) — honorable mention

- Fully embedded in git as objects — offline-first, distributed
- Issues, comments, labels, milestones, status
- Bridges to GitHub/GitLab
- Written in Go — can't embed in pi-kit natively but could invoke as subprocess
- Most mature of the offline-first trackers

---

## Summary assessment

**Best match for "what Windshift provides, Rust-first":**

1. **`project_management` crate** — covers the full Epic/Task/Subtask/Milestone hierarchy as a file-based library. No server, embeds cleanly. Directly replaces Windshift's Item model.

2. **`beads_rust` or `rusty-beads`** — agent-native dependency tracking and context injection. Better fit for tracking *what needs to be done and why* (the agent memory angle) than for human PM visibility.

3. **Hybrid**: use `project_management` for human-visible PM state (epics/milestones) and beads for agent-facing dependency/readiness tracking. Both live in the repo. No external service needed at all.

**The Windshift blocker (no PAT support, no API versioning, days old) disappears entirely with this approach.**
