---
id: workspace-ownership-first-pass
title: "Workspace ownership first pass — local lease registry and startup enforcement"
status: exploring
parent: workspace-ownership-model
tags: []
open_questions:
  - "Where in the startup path should mutable-workspace admission be enforced first: TUI bootstrap/session start, daemon attach, or a shared workspace-admission layer used by both?"
  - "What is the minimum release/benchmark authority check in first pass: warn-only, hard refusal outside `release`/`benchmark` roles, or explicit override with operator confirmation?"
dependencies: []
related: []
---

# Workspace ownership first pass — local lease registry and startup enforcement

## Overview

This node defines the minimum viable implementation of the workspace ownership model.

The first pass is not trying to solve distributed coordination or full remote backend orchestration. It is solving the immediate and recurring problem:

> multiple mutable Omegon agents must not silently share one filesystem surface.

The first pass should introduce a machine-local runtime workspace contract that:
- records workspace identity and ownership
- prevents accidental dual mutable occupancy
- creates or suggests isolated workspaces when parallel mutable work is needed
- gives cleave the same workspace discipline as general multi-agent operation
- isolates release and benchmark authority from casual mutable development

## Decisions

### First pass uses local lease file + project registry + shared admission layer

**Status:** proposed

**Rationale:** The minimum viable system should use both a per-workspace lease file and a project-level local registry, with a shared admission layer called from TUI startup, daemon attach, cleave child creation, and release/benchmark authority checks. This gives local self-description, operator visibility, and a single policy surface without prematurely building distributed coordination.
