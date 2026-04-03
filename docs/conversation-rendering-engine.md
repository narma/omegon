---
id: conversation-rendering-engine
title: "Conversation Rendering Engine"
status: exploring
tags: [tui, rendering, conversation, artifacts]
open_questions: []
dependencies: []
related:
  - conversation-widget
  - inline-image-rendering
  - display-tool-artifacts
  - embedded-web-dashboard
  - native-plan-mode
---

# Conversation Rendering Engine

## Overview

Own the terminal-side conversation rendering architecture: segment-based rendering, markdown/text layout, tool cards, inline image rendering, display artifacts, and operator-facing visual presentation inside Omegon. This node explicitly excludes the broader browser-based project intelligence portal and auspex-hosted dashboard concerns, which should live outside this rendering-engine scope.

## Research

### Boundary split versus markdown-viewport and Auspex

Boundary cleanup conclusion:
- `conversation-rendering-engine` owns terminal-side conversation rendering inside Omegon: segment architecture, inline images, display artifacts, and operator-facing visual presentation in the TUI conversation stream.
- `embedded-web-dashboard` and `native-plan-mode` remain Omegon-local because they are specifically about the built-in `/dash` surface served from the omegon binary.
- `markdown-viewport` should remain the browser/project-intelligence portal epic derived from mdserve/Auspex, not be repurposed as the terminal rendering umbrella.
- `pikit-auspex-extension`, `mdserve-lifecycle-backend`, `mdserve-dioxus-frontend`, and `mdserve-nix-distribution` belong with the browser/Auspex track, not under terminal conversation rendering.

## Decisions

### Decision: Conversation Rendering Engine is the terminal-side parent for display artifacts

**Status:** decided

**Rationale:** The existing markdown-viewport umbrella had mixed terminal conversation rendering with browser-based project intelligence work. The terminal segment system, inline media, and display tool belong under a narrower parent dedicated to conversation rendering inside Omegon.

### Decision: `markdown-viewport` remains the browser/project-intelligence epic

**Status:** decided

**Rationale:** The existing `markdown-viewport` node is not actually about terminal rendering; its content is a browser-based project intelligence portal derived from mdserve/Auspex. Repurposing it as the terminal rendering parent would reintroduce the same category error. Keep it as the browser portal epic and carve terminal rendering into its own parent.

### Decision: `embedded-web-dashboard` stays Omegon-local, separate from Auspex/mdserve

**Status:** decided

**Rationale:** `embedded-web-dashboard` is specifically the lightweight localhost UI served from the omegon binary for live in-process session state. It is not the same thing as the broader mdserve/Auspex intelligence portal, even though both are browser surfaces. Keep it under Omegon-local design ownership rather than folding it into the external portal track.

### Decision: Terminal rendering work moves under `conversation-rendering-engine`

**Status:** decided

**Rationale:** Terminal-side nodes such as conversation-widget, inline-image-rendering, clipboard-image-paste, and display-tool-artifacts form a coherent subsystem around conversation rendering and artifact presentation. They should be grouped under a dedicated terminal rendering parent instead of hanging from the browser portal epic.
