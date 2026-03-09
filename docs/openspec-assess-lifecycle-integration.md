---
id: openspec-assess-lifecycle-integration
title: OpenSpec lifecycle integration with structured assessment results
status: implementing
parent: agent-assess-tooling-access
tags: [openspec, assess, lifecycle, workflow, harness]
open_questions: []
branches: ["feature/openspec-assess-lifecycle-integration"]
openspec_change: openspec-assess-lifecycle-integration
---

# OpenSpec lifecycle integration with structured assessment results

## Overview

Harden OpenSpec and cleave lifecycle workflows so verify, archive, and reconciliation steps consume structured assessment results directly instead of depending on operator-only command sequencing or human-readable assessment text.

## Research

### Why this hardening is needed

Bridging `/assess` solves command reachability, but the lifecycle remains soft if `/opsx:verify`, `/opsx:archive`, and follow-up reconciliation still depend on prose conventions or operator memory. OpenSpec should be able to consume structured assessment outcomes directly so pass/reopen/ambiguous states are explicit and machine-actionable.

### Desired workflow shape

The hardened workflow should look like: implement → bridged `/assess spec` (or equivalent structured verifier) → structured result consumed by OpenSpec reconciliation → `/opsx:verify` and `/opsx:archive` operate on explicit assessment state instead of assuming the operator interpreted the prior command correctly. Cleave review and diff review should participate in the same model when they reopen work or alter file scope/constraints.

### OpenSpec-first architecture implication

If OpenSpec is the lifecycle authority, then assessment should be treated as an OpenSpec artifact class rather than an external note. Design-tree, cleave, and command bridging may produce or consume assessment results, but the authoritative persisted state for workflow gating should live with the OpenSpec change so every workflow component reads from the same source of truth.

### Recommended v1 artifact shape

A practical v1 shape is an assessment record file under each change directory, for example `openspec/changes/<name>/assessment.json`, containing the latest relevant structured assessment plus snapshot metadata. OpenSpec commands can update and read this file directly. Later versions could add a history log, but v1 only needs a durable latest-known-state artifact for gating and reconciliation.

## Decisions

### Decision: OpenSpec is the lifecycle authority and must own persisted assessment state

**Status:** decided
**Rationale:** OpenSpec is the underpinning workflow framework for design-tree, cleave, assess, and adjacent operations. Assessment outcomes that affect lifecycle progression therefore belong to OpenSpec, not as ephemeral command output only. OpenSpec should persist the latest structured assessment state per active change so verify, archive, reconciliation, dashboarding, and future workflow tools can all read the same authoritative lifecycle record.

### Decision: Persist the latest structured assessment result inside each OpenSpec change

**Status:** decided
**Rationale:** Assessment state must be attributable to a specific change, review kind, and implementation snapshot. The simplest durable v1 design is for each active change to carry its own assessment artifact or metadata file inside the change directory, rather than storing it in transient process memory or a separate global cache. This keeps lifecycle state co-located with proposal/design/spec/tasks and makes archive gating inspectable and reproducible.

### Decision: `/opsx:verify` should execute or refresh structured assessment, not only render cached state

**Status:** decided
**Rationale:** Verification is an active lifecycle checkpoint, not just a reporting view. `/opsx:verify` should invoke the relevant structured assessment path or confirm that an equivalent assessment result is current for the present implementation snapshot, then render the outcome for humans and expose it for agents. Cached assessment state is useful, but verify should not silently trust stale results.

### Decision: Archive must fail closed on missing, stale, ambiguous, or reopened assessment state

**Status:** decided
**Rationale:** Because OpenSpec is the lifecycle authority, archive cannot rely on best-effort operator sequencing. If the latest relevant assessment is absent, predates implementation changes, reports ambiguity, or explicitly reopens work, archive should refuse to proceed and point the operator/agent to verify and reconcile first. Only explicit pass state for the current implementation snapshot should satisfy the archive gate.

### Decision: Assessment records should capture implementation snapshot and lifecycle relevance

**Status:** decided
**Rationale:** To decide whether assessment state is current, OpenSpec needs more than pass/fail. Persisted records should include assessment kind (`spec`, `diff`, `cleave`), target change, outcome (`pass`, `reopen`, `ambiguous`), timestamp, implementation snapshot signal (such as git HEAD and/or changed-file fingerprint), and any reconciliation hints (file-scope drift, new constraints, recommended `reconcile_after_assess`). That gives archive and verify a reliable basis for gating.

## Open Questions

*No open questions.*

## Implementation Notes

### File Scope

- `extensions/openspec/index.ts` (modified) — Consume structured assessment outcomes in verify/archive/reconcile flows and surface lifecycle gates
- `extensions/cleave/index.ts` (modified) — Ensure assess structured results expose the lifecycle fields OpenSpec needs consistently
- `extensions/cleave/assessment.ts` (modified) — Tighten assessment result contracts for pass/reopen/ambiguous and reconciliation metadata
- `extensions/lib/slash-command-bridge.ts` (modified) — Preserve structured command result metadata needed by lifecycle consumers
- `openspec/changes/*/tasks.md` (modified) — Potentially reflect assessment/reconciliation checkpoints more explicitly in lifecycle guidance
- `docs/openspec-assess-lifecycle-integration.md` (modified) — Document the hardened lifecycle model and archive/verify gates
- `extensions/openspec/index.ts` (modified) — Make verify execute or refresh structured assessment, persist assessment records, and enforce archive gates from assessment state
- `extensions/openspec/spec.ts` (modified) — Add helpers for reading/writing per-change assessment artifacts and computing stale/current state against implementation snapshot
- `extensions/cleave/index.ts` (modified) — Ensure bridged assess results include change name, outcome, snapshot, and reconciliation hints in a form OpenSpec can persist directly
- `extensions/cleave/assessment.ts` (modified) — Normalize lifecycle-oriented assessment record schema and outcome vocabulary
- `docs/openspec-assess-lifecycle-integration.md` (modified) — Document OpenSpec-owned assessment artifacts, verify behavior, and archive fail-closed policy
- `openspec/changes/*/assessment.json` (new) — Per-change durable latest assessment artifact used by verify/archive gating

### Constraints

- Archive should fail closed when the relevant assessment state is missing, stale, ambiguous, or explicitly reopened.
- Assessment state consumed by OpenSpec must be machine-readable and attributable to a specific change and assessment kind.
- Verification and archive flows should not require parsing prior human-readable terminal output.
- Reconciliation hooks must preserve the existing operator UX while enabling autonomous lifecycle progression in the harness.
- OpenSpec-owned assessment state is authoritative for lifecycle gating even if produced by assess/cleave tooling.
- `/opsx:verify` must execute or refresh assessment for the current implementation snapshot rather than trusting stale cached output.
- Archive must fail closed unless the latest relevant assessment for the current snapshot is an explicit pass.
- Persisted assessment records must include change name, assessment kind, outcome, timestamp, snapshot identity, and reconciliation hints.
