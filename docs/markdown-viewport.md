---
id: markdown-viewport
title: Markdown Viewport — Lightweight FOSS viewer for agent-generated docs
status: exploring
tags: [viewport, markdown, documentation, foss]
open_questions:
  - "Which rendering approach: Astro extract, vanilla HTML+marked.js, Zola, mdBook, or something else?"
  - Should this live in pi-kit (as a skill/extension) or as a standalone tool that pi-kit invokes?
  - What directories should be scanned? .pi/ only, openspec/ only, or configurable roots?
---

# Markdown Viewport — Lightweight FOSS viewer for agent-generated docs

## Overview

A lightweight, FOSS tool to render interlinked agent-generated markdown (design tree, OpenSpec, memory) as a navigable web UI with graph view. Reuses the remark-wikilinks plugin and local graph component from styrene's Astro site. Goal: zero-friction human viewport into agent state — not a data store, not bidirectional.

## Open Questions

- Which rendering approach: Astro extract, vanilla HTML+marked.js, Zola, mdBook, or something else?
- Should this live in pi-kit (as a skill/extension) or as a standalone tool that pi-kit invokes?
- What directories should be scanned? .pi/ only, openspec/ only, or configurable roots?
