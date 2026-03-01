---
description: Context distillation for session handoff. Creates portable summaries for fresh context bootstrap.
---
# Session Distillation

Analyze the full conversation context and produce a portable distillation that can bootstrap a fresh session with equivalent understanding.

## Output Structure

### Session Overview
- Primary objectives and outcomes
- What was accomplished vs. what remains

### Technical State
- Repository and branch state
- Key file changes and their purposes
- Versions, dependencies, tool state

### Decisions Made
- Architectural choices and trade-offs
- Why alternatives were rejected
- Constraints that drove decisions

### Open Threads
- Pending work with enough context to resume
- Blocked items and what unblocks them
- Questions that need user input

### Critical Context
- Non-obvious facts that would be lost without this summary
- Environment details, credentials state, service URLs
- Gotchas and things that surprised us

## Guidelines

- Be specific — include file paths, command outputs, version numbers
- Prefer concrete over abstract — "changed line 47 of foo.ts to use X" not "updated foo"
- Include enough context that a fresh session can resume without re-asking the user
- Mark items as DONE, IN PROGRESS, or BLOCKED
- Keep it under 2000 words — density over completeness

## Output

Write the distillation to `.claude/distillations/{timestamp}-{slug}.md` in the project directory, where:
- `{timestamp}` is `YYYY-MM-DD-HHmmss` in local time
- `{slug}` is a 2-3 word kebab-case summary of the session focus
