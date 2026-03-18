# Next Session: Test Rust Cleave Orchestrator End-to-End

## Context

We replaced the entire TypeScript cleave child dispatch pipeline with a Rust orchestrator. The TS `cleave_run` tool now calls `omegon-agent cleave` (Rust binary) instead of `dispatchChildren()` (TypeScript/jiti).

The Rust binary was tested standalone (`omegon-agent cleave --plan ... --workspace ...`) and worked: 2 children, 19s, both merged, clean exit. But the **full wired path** (TS prep → Rust dispatch → TS reporting) has NOT been tested yet.

## What to Test

Run a real `cleave_run` through the tool interface. Pick any small decided design node or create a throwaway one. The test validates:

1. `initWorkspace` writes enriched task files
2. `dispatchViaNative()` spawns `omegon-agent cleave` and it finds the bridge, task files, and workspace
3. Children complete and exit cleanly (no hanging, no pipe breaks)
4. State.json is read back correctly into TS state
5. Post-merge reporting works (spec verification, guardrails, lifecycle reconciliation)
6. Dashboard shows native backend, not cloud

## Quick Test Command

```
Pick any 2-file change and run cleave_run with a simple 2-child plan.
The key thing to watch: do children show backend=native in the report?
Do they exit cleanly without operator intervention?
```

## Key Files Changed

- `extensions/cleave/index.ts` — cleave_run execute() now calls dispatchViaNative()
- `extensions/cleave/native-dispatch.ts` — spawns omegon-agent cleave binary
- `core/crates/omegon/src/cleave/` — Rust orchestrator (plan, waves, worktree, state, orchestrator)
- `core/crates/omegon/src/main.rs` — cleave subcommand added
- `extensions/lib/omegon-subprocess.ts` — removed stale singleton cache on resolveNativeAgent()

## Known Risks

- Bridge path resolution: the Rust binary needs `--bridge` pointing to `core/bridge/llm-bridge.mjs`. The TS bridge passes `nativeAgent.bridgePath` which should resolve correctly.
- State.json field name mapping: Rust uses camelCase serde, TS expects camelCase. Should match but untested through the full round-trip.
- The Rust orchestrator creates its own worktrees. The TS code no longer creates them (that block was replaced). If the Rust binary fails to create worktrees, children have nowhere to run.
- Review mode (`params.review`) is NOT wired through native dispatch yet — it's TS-only. Cleave runs with `review: true` will silently skip review.

## Design Node

`rust-cleave-orchestrator` — status: decided. Focus it to get context.
