# Cleave dirty-tree checkpointing

## Summary

`/cleave` needs a clean git state before it can create worktrees, dispatch child agents, and merge their branches back safely. Dirty-tree checkpointing adds an explicit preflight step so operator intent is captured before parallel execution begins.

The workflow is designed around three policy decisions:

- cleave should surface a **dirty-tree preflight** instead of failing with a bare git error
- **checkpoint commits are lifecycle milestones**, not just end-of-change archive events
- approved **volatile artifacts** such as `.pi/memory/facts.jsonl` stay visible but should not block cleave by default

## Why this exists

OpenSpec and design-tree work often leave the repository in a legitimate in-progress state:

- a proposal, design, or `tasks.md` file was just rewritten
- a previous feature is ready to checkpoint but not yet archived
- tracked operational files changed during the session

Without preflight handling, `/cleave` treats all of that as the same kind of failure. The result is repeated "working tree has uncommitted changes" interruptions at exactly the moment the operator is trying to start parallel work.

## Preflight behavior

When `/cleave` sees a dirty tree, pi-kit should classify the changed paths before doing any git mutation.

### Classification buckets

1. **Related**
   - files confidently tied to the active OpenSpec change
   - includes lifecycle artifacts such as `proposal.md`, `design.md`, `tasks.md`, bound design docs, and change-scoped implementation files
2. **Unrelated or unknown**
   - files outside the active change scope
   - low-confidence matches that should not be silently swept into a checkpoint
3. **Volatile**
   - approved operational artifacts such as `.pi/memory/facts.jsonl`
   - visible to the operator, but not treated like substantive implementation drift

### Operator actions

The preflight step should offer explicit choices:

- **checkpoint**
- **stash-unrelated**
- **stash-volatile**
- **proceed-without-cleave**
- **cancel**

The important property is that pi-kit performs the mechanics after the operator makes one policy decision; the operator should not need to manually juggle git commands.

## Checkpoint policy

Checkpointing is intentionally conservative.

- pi-kit may prepare a scoped staged set from confidently related files
- pi-kit may suggest a conventional commit message scoped to the active change
- pi-kit must **not create the commit until the operator explicitly approves it**
- low-confidence or unknown files are excluded from the checkpoint scope by default

That means checkpointing is assisted, not automatic.

## Volatile-file policy

Volatile files are part of the preflight summary so the operator can see them, but they should not block cleave the same way feature drift does.

Expected handling:

- keep volatile paths visible in the summary
- allow a one-step volatile-only stash action
- avoid forcing a full checkpoint or cancel flow when the tree is only dirty because of approved operational artifacts

## Generic mode without OpenSpec

Dirty-tree preflight still matters when there is no active OpenSpec change.

In that case, pi-kit should still:

- separate volatile from non-volatile changes
- summarize what it can classify generically from git state
- offer checkpoint, stash, continue-without-cleave, or cancel

The classification is less informed, so the system should bias even harder toward conservative inclusion.

## Lifecycle implications

Checkpointing is part of the implementation lifecycle, not just repo hygiene.

Useful checkpoint moments include:

- after a previous task group is implementation-complete
- after proposal, spec, or tasks rewrites settle
- immediately before a new `/cleave` run starts

Archive is still the completion milestone, but pre-cleave checkpointing is the practical milestone that keeps worktrees and merges safe.

## Acceptance criteria captured in tests/specs

The lifecycle artifacts for `cleave-dirty-tree-checkpointing` preserve these expectations:

- clean trees bypass preflight interruption
- dirty trees are summarized by related, unrelated or unknown, and volatile files
- volatile-only dirt does not block cleave by default
- checkpoint flows require explicit operator approval before committing
- low-confidence files stay out of checkpoint scope unless the operator says otherwise
- generic dirty-tree classification still works without active OpenSpec context
