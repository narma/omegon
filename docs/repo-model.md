---
id: repo-model
title: RepoModel — git state tracking in Rust core
status: seed
parent: git-harness-integration
tags: [rust, git, architecture]
open_questions: []
---

# RepoModel — git state tracking in Rust core

## Overview

Shared struct initialized at agent startup. Tracks current branch, dirty files (working set), submodule map, and pending lifecycle changes. Updated by edit/write/change tools on every file mutation. Queried by cleave preflight, commit tool, and session-close handler. Replaces all ad-hoc git status calls with a coherent model.

## Open Questions

*No open questions.*
