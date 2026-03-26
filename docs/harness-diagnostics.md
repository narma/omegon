---
id: harness-diagnostics
title: "Harness diagnostics — structured runtime observability and queryable failure introspection"
status: exploring
parent: omega
tags: [observability, runtime, tooling, diagnostics]
open_questions:
  - "What must persist across restarts for post-mortem analysis: only crashes/fatal exits, or also a bounded history of warnings, tool failures, and child-process results?"
  - "What is the agent-facing query surface: one general diagnostics tool (`harness_diagnostics`) with filters, or separate tools for status, crashes, and recent failures?"
  - "Where should diagnostics live: append-only JSONL in `.omegon/`, sqlite alongside session/memory state, or an in-memory ring buffer plus persisted crash reports?"
  - "How do diagnostics interact with secrecy/redaction — which fields are safe to persist verbatim, which must be redacted, and which should be excluded entirely?"
  - "What is the crash capture contract on panic/fatal exit: backtrace, last active tool, current model/provider, recent event tail, TUI state, child-run state, and session identifier?"
dependencies: []
related: []
---

# Harness diagnostics — structured runtime observability and queryable failure introspection

## Overview

Provide first-class, structured diagnostics for Omegon itself: startup traces, tool/runtime failures, child-process outcomes, crash/panic records, and queryable agent-facing introspection such as 'why did you crash?'. This should be a broad harness surface, not ad hoc log scraping.

## Open Questions

- What must persist across restarts for post-mortem analysis: only crashes/fatal exits, or also a bounded history of warnings, tool failures, and child-process results?
- What is the agent-facing query surface: one general diagnostics tool (`harness_diagnostics`) with filters, or separate tools for status, crashes, and recent failures?
- Where should diagnostics live: append-only JSONL in `.omegon/`, sqlite alongside session/memory state, or an in-memory ring buffer plus persisted crash reports?
- How do diagnostics interact with secrecy/redaction — which fields are safe to persist verbatim, which must be redacted, and which should be excluded entirely?
- What is the crash capture contract on panic/fatal exit: backtrace, last active tool, current model/provider, recent event tail, TUI state, child-run state, and session identifier?
