---
id: textarea-editor-upgrade
title: Replace custom Editor with ratatui-textarea — multi-line input with clipboard paste
status: decided
parent: rust-phase-2
tags: [tui, editor, input, clipboard, ux]
open_questions: []
issue_type: feature
priority: 2
---

# Replace custom Editor with ratatui-textarea — multi-line input with clipboard paste

## Overview

Replace the custom 514-line Editor (editor.rs) with ratatui-textarea. Gains: multi-line editing with proper cursor navigation, clipboard paste (bracketed paste mode from crossterm), undo/redo, word movement, and optional vim keybindings. The dependency is already added (0.8, crossterm feature). Migration touches: event handling in mod.rs (crossterm events → textarea Input), history management (currently custom), reverse-search (may need to reimplement on top), and render integration (textarea is a Widget). The existing Editor::render_text() / cursor_position() API surface maps cleanly to textarea.lines() / cursor().

## Open Questions

*No open questions.*
