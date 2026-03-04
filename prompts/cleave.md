---
description: Recursive task decomposition via cleave extension
---
# Recursive Task Decomposition

Route complex directives through the cleave extension.

## Usage

```
/cleave "directive text"
```

## Tools

- `cleave_assess` — Assess complexity, get execute/cleave/needs_assessment decision
- `cleave_run` — Execute a split plan with git worktree isolation

## Workflow

1. Assess directive complexity (automatic or via `cleave_assess`)
2. If `openspec/` exists with a matching change, use its `tasks.md` as the plan
3. Otherwise, generate split plan via LLM (2–4 children)
4. Confirm plan with user
5. Dispatch children in dependency-ordered waves
6. Harvest results, detect conflicts, merge branches
7. Report status with per-child duration and merge outcomes

## OpenSpec

When `openspec/changes/<name>/tasks.md` exists and matches the directive,
cleave skips LLM planning and uses the pre-built task groups directly.
Groups where all tasks are done are filtered out. Dependencies are inferred
from "after/requires/depends on" markers in task descriptions.

OpenSpec is optional — cleave falls back to its LLM planner when absent.

See `skills/cleave/SKILL.md` for the full reference.
