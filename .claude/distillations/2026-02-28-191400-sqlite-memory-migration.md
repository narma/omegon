# Session Distillation: SQLite-backed Memory with Confidence Decay

Generated: 2026-02-28T19:14:00-05:00
Working Directory: ~/.pi/agent/extensions/project-memory
Repository: project-memory (local extension, no remote)

## Session Overview

Redesigned the project-memory extension's storage layer from markdown files to SQLite with a confidence-decay reinforcement model. The session progressed through analysis of the current system's limitations (no timestamps, no supersession, string-based dedup), research into LLM format comprehension benchmarks, schema design, adversarial review, and full implementation with 44 passing tests. The core insight: **store in SQLite, render as Markdown-KV for LLM injection** — benchmarks show Markdown-KV has 60.7% accuracy vs 45% for JSONL when LLMs comprehend structured data.

## Technical State

### Repository Status
- Branch: `master`
- Last commit: `06e4e4b feat: trigger extraction on compaction`
- Uncommitted changes: new SQLite storage layer (factstore.ts, extraction-v2.ts, migration.ts, index-v2.ts → index.ts), tests, package.json with better-sqlite3 dependency

### Key Changes This Session

- **`factstore.ts` (812 lines)**: Core SQLite storage. Two tables (`facts`, `minds`), FTS5 virtual table with sync triggers, 7 indexes (including partial indexes on active status). Facts have confidence decay with spaced-repetition-style reinforcement — half-life extends exponentially with each reinforcement (`halfLife = 14 * 1.8^(count-1)` days).
- **`extraction-v2.ts` (179 lines)**: New extraction agent prompt that outputs JSONL actions (`observe`, `reinforce`, `supersede`, `archive`) instead of rewriting the entire markdown file. Facts are presented to the agent with IDs so it can reference them for supersession/archival.
- **`migration.ts` (293 lines)**: Idempotent migration from markdown memory.md + archive/*.md + minds/*/memory.md into SQLite. Migrated facts get `reinforcement_count: 5` (proven durable), archive facts get `2`. Uses content-hash dedup so running twice is safe.
- **`index.ts` (now v2, 880 lines)**: Integration layer rewired to use FactStore instead of MemoryStorage. Tools (`memory_query`, `memory_store`, `memory_search_archive`) work against SQLite. Added `/memory stats` subcommand.
- **`factstore.test.ts` (36 tests)** + **`migration.test.ts` (8 tests)**: All 44 passing. Cover CRUD, dedup, supersession chains, archival, session rollback, FTS5 search, cross-mind search, Markdown-KV rendering, mind lifecycle, extraction action processing, decay math, migration idempotency.
- **`package.json`**: Added for `better-sqlite3` native dependency. Falls back to `node:sqlite` (experimental) if better-sqlite3 unavailable.
- **`index-v1.ts`**: Backup of the original markdown-based integration layer.

### Versions/Dependencies
- Node.js v25.6.1
- better-sqlite3 v12.6.2 (native C++ binding)
- pi coding agent v0.55.3
- Extension has no tsconfig — raw ESM loaded directly by pi runtime

### Schema

```sql
-- facts: individual knowledge atoms with decay
facts(id TEXT PK, mind TEXT FK, section TEXT, content TEXT, status TEXT,
      created_at TEXT, created_session TEXT, supersedes TEXT FK,
      superseded_at TEXT, archived_at TEXT, source TEXT, content_hash TEXT,
      confidence REAL, last_reinforced TEXT, reinforcement_count INT, decay_rate REAL)

-- minds: named memory stores
minds(name TEXT PK, description TEXT, status TEXT, origin_type TEXT,
      origin_path TEXT, origin_url TEXT, readonly INT, parent TEXT,
      created_at TEXT, last_sync TEXT)

-- settings: key-value for active mind state
settings(key TEXT PK, value TEXT)

-- facts_fts: FTS5 virtual table synced via triggers
```

Indexes: `idx_facts_active` (partial, status='active'), `idx_facts_hash`, `idx_facts_section` (partial), `idx_facts_supersedes`, `idx_facts_temporal`, `idx_facts_confidence` (partial), `idx_facts_session`.

## Decisions Made

1. **SQLite over JSONL** — JSONL wins at <50 facts but loses at scale. At 500+ facts, every operation (dedup, search, supersession) requires full-file scan. SQLite handles indexed queries, ACID, concurrent sessions. Memory is .gitignored anyway, so binary-file diffing is irrelevant.

2. **Markdown-KV for LLM injection, not JSONL** — ImprovingAgents benchmark showed Markdown-KV at 60.7% accuracy vs JSONL at 45% for LLM comprehension of structured data. We initially planned to inject JSONL directly but research disproved that assumption. Storage format ≠ presentation format.

3. **Confidence decay with reinforcement** (inverted supersession) — Instead of requiring explicit "fact X replaces fact Y" (which requires the extraction agent to match IDs accurately), facts naturally decay unless sessions encounter them. Each reinforcement extends the half-life via `halfLife = 14 * 1.8^(count-1)` days. A fact reinforced 15 times stays >80% confident after 90 days. An unreinforced fact drops below 30% after 30 days. This makes supersession **emergent** rather than explicit.

4. **better-sqlite3 primary, node:sqlite fallback** — `node:sqlite` is still experimental with no stabilization timeline. better-sqlite3 is battle-tested (3900+ npm dependents) but requires native compilation. Fallback via `loadDatabase()` function that tries require("better-sqlite3") first.

5. **Extraction agent outputs JSONL actions** — Instead of rewriting the entire markdown file (opaque, clobbers metadata, bypasses dedup), the extraction agent emits discrete actions: `observe` (add or reinforce), `reinforce` (by ID), `supersede` (by ID + new content), `archive` (by ID). Every decision is auditable. Simpler contract than full rewrite — the agent just says "what facts did I observe."

6. **FTS5 from day one** — Full-text search across all facts, all minds, all statuses. Kept in sync via SQLite triggers on insert/update/delete.

7. **Migrated facts get elevated reinforcement counts** — Active facts get `reinforcement_count: 5` (they've survived in memory for months, proving durability). Archive facts get `2`. This prevents the cold-start problem where all existing knowledge immediately starts decaying.

## Pending Items

### Incomplete Work
- **Linked mind sync** — The old filesystem-based link/sync flow needs reimplementation for SQLite. Currently shows "being rebuilt" warning in UI. The `minds` table has `origin_type`/`origin_path` columns ready.
- **Direct edit** — Editing rendered Markdown-KV back into facts is a lossy round-trip. The old markdown editor flow doesn't map cleanly. Currently warns users to use `memory_store` tool instead.
- **`/memory archive` subcommand** — Needs rethinking. Archival is now per-fact status, not monthly file splits. The old "list archive months" doesn't apply.
- **Live session test** — The integration layer hasn't been tested in a live pi session. Restarting the session will trigger migration on the current project's 65-line memory.md. This is the real proof point.

### Known Issues
- **node:sqlite experimental warning** — If fallback is used, Node prints `ExperimentalWarning` to stderr. May confuse users.
- **Extraction agent reliability** — Making the agent output valid JSONL with correct IDs is more demanding than markdown output. Malformed lines are silently skipped (graceful degradation) but could mean lost observations. The `parseExtractionOutput` function is tolerant — skips bad lines, accepts `action` as alias for `type`.
- **Concurrent sessions** — Active mind state is now in SQLite (`settings` table) which gives ACID, but two sessions running extraction simultaneously could still produce duplicate facts (mitigated by content-hash dedup).
- **package.json in extension dir** — The extension now has a `package.json` and `node_modules/`. This is a structural change from the previous no-dependency model. Unclear if pi's extension loader handles this cleanly in all cases.

### Planned Next Steps
1. **Restart session** to test live migration and verify the new extension loads correctly
2. **Verify migration** — check that all 65 lines of existing memory imported correctly into facts.db
3. **Test extraction cycle** — let the background extraction agent run and verify it outputs valid JSONL
4. **Implement linked mind sync** for SQLite
5. **Add `/memory stats` output to the HTML visualizer** for at-a-glance health metrics
6. **Consider `memory_update` tool** — a dedicated tool for explicit supersession where the LLM provides old fact ID + new content

## Critical Context

- **The extension has no remote git repo** — all 20+ commits are local only at `~/.pi/agent/extensions/project-memory/`. Be careful with destructive operations.
- **Extension changes require session restart** — pi loads extensions at startup, no hot-reload.
- **The old v1 code is preserved** as `index-v1.ts`. The old `storage.ts`, `template.ts`, `minds.ts`, and `extraction.ts` are still present and importable. The v2 index.ts still imports `extraction.ts` for the `shouldExtract` and `createTriggerState` functions (trigger logic didn't change, only the extraction output format).
- **Decay parameters**: `halfLifeDays: 14`, `reinforcementFactor: 1.8`, `minimumConfidence: 0.1`. A fact with 1 reinforcement hits 50% confidence at 14 days. With 10 reinforcements, half-life is ~1.4 years.
- **The `better-sqlite3` require() is in a try/catch** — the extension will still load if the native module fails, falling back to node:sqlite. This is intentional defense in depth.
- **Content hash is SHA-256 truncated to 16 hex chars** of normalized content (lowercase, trimmed, whitespace-collapsed, bullet-stripped). This determines dedup identity.

## File Reference

Key files for continuation:
- `factstore.ts`: Core storage layer — all SQLite schema, CRUD, decay math, rendering, mind management
- `extraction-v2.ts`: New JSONL extraction prompt and subprocess runner
- `migration.ts`: Markdown → SQLite migration logic
- `index.ts` (v2): Pi extension integration — lifecycle hooks, tools, commands, UI
- `index-v1.ts`: Original markdown-based integration (backup/rollback)
- `factstore.test.ts`: 36 tests for core storage
- `migration.test.ts`: 8 tests for migration
- `extraction.ts`: Original extraction (still used for `shouldExtract`/`createTriggerState`)
- `storage.ts`: Original markdown storage (still present, used by v1)
- `template.ts`: Section constants, `appendToSection` (still imported by migration.ts)
- `types.ts`: Config types and defaults
- `/tmp/memory-schema.html`: Interactive schema visualization (ER diagram, data flow, etc.)
