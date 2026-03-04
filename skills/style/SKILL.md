---
name: style
description: Unified visual style guide. Defines the Verdant color system, typography, spacing, and semantic palette shared across pi TUI theme, Excalidraw diagrams, Mermaid diagrams, and generated images. Use when creating any visual output to ensure consistency.
---

# Style Guide

Canonical design system for all visual output. Every diagram, theme, and generated image should derive from these tokens. When in doubt, reference this — not ad-hoc hex values.

## When Invoked Directly

When the user runs `/style` (or `/skill:style`), respond based on arguments:

| Invocation | Action |
|------------|--------|
| `/style` (no args) | Display the Quick Reference Card (bottom of this doc) as a formatted code block, then offer: "Run `/style palette` to render a visual swatch, or `/style check <file>` to audit colors." |
| `/style palette` | Render a Mermaid diagram showing the full Verdant palette as a visual swatch — use labeled colored nodes for each token group (core, signals, excalidraw semantics). |
| `/style mermaid` | Output the Mermaid `%%{init}%%` dark theme block ready to copy-paste. |
| `/style check <file>` | Read the specified file, find any hardcoded hex colors, and report which ones match Verdant tokens, which match Excalidraw semantics, and which are off-palette. |
| `/style excalidraw` | Display the Excalidraw semantic palette table with fill/stroke pairs and usage guidance. |
| `/style <anything else>` | Treat as a question about the style system and answer from this document. |

---

## Design Philosophy

**Verdant** — dark, organic, high-contrast. Forest canopy at night: deep backgrounds, teal-green accents, warm semantic signals. Clean lines, zero roughness, monospace text. Professional but not sterile.

Principles:
1. **Semantic color, not decorative** — every color communicates purpose
2. **Contrast over subtlety** — dark backgrounds demand bright, readable foregrounds
3. **Consistency across mediums** — same palette whether it's a TUI, an Excalidraw diagram, or a Mermaid chart
4. **Hierarchy through scale and weight** — not through color proliferation

---

## Color System

### Core Palette

Derived from `themes/verdant.json`. These are the ground-truth tokens.

| Token | Hex | Role |
|-------|-----|------|
| `primary` | `#3dc9b0` | Brand accent, interactive elements, focus |
| `primaryMuted` | `#4a9e90` | Secondary accent, labels, links |
| `primaryBright` | `#8ac4b8` | Headings, highlighted text |
| `fg` | `#d4e8e4` | Primary text on dark backgrounds |
| `mutedFg` | `#8a9a96` | Secondary text, tool output, muted content |
| `dimFg` | `#5c6b67` | Tertiary text, comments, inactive elements |
| `bg` | `#0c0e12` | Main background |
| `cardBg` | `#151c20` | Elevated surface (cards, panels) |
| `surfaceBg` | `#1a2428` | Secondary surface |
| `borderColor` | `#2d4a47` | Standard borders |
| `borderDim` | `#1e3533` | Subtle borders, separators |

### Signal Colors

| Signal | Hex | Usage |
|--------|-----|-------|
| `green` | `#3daa8e` | Success, completion, positive |
| `red` | `#f44747` | Error, destructive, critical |
| `orange` | `#e98100` | Warning, attention needed |
| `yellow` | `#e9c400` | Caution, numbers, highlights |

### Excalidraw Semantic Palette

For diagram elements. Maps purpose → fill/stroke pairs. Defined in `extensions/render/excalidraw/types.ts`.

| Purpose | Fill | Stroke | When to Use |
|---------|------|--------|-------------|
| `primary` | `#3b82f6` | `#1e3a5f` | Default components, neutral nodes |
| `secondary` | `#60a5fa` | `#1e3a5f` | Supporting/related components |
| `tertiary` | `#93c5fd` | `#1e3a5f` | Third-level, background detail |
| `start` | `#fed7aa` | `#c2410c` | Entry points, triggers, inputs |
| `end` | `#a7f3d0` | `#047857` | Outputs, completion, results |
| `decision` | `#fef3c7` | `#b45309` | Conditionals, branches, choices |
| `ai` | `#ddd6fe` | `#6d28d9` | AI/LLM components, inference |
| `warning` | `#fee2e2` | `#dc2626` | Warnings, degraded states |
| `error` | `#fecaca` | `#b91c1c` | Error states, failures |
| `evidence` | `#1e293b` | `#334155` | Code snippets, data samples, dark blocks |
| `inactive` | `#dbeafe` | `#1e40af` | Disabled, inactive, future-state |

**Text on semantic fills:**
- Light fills (`start`, `end`, `decision`, `warning`, `error`, `inactive`): use `#374151` (dark gray)
- Dark fills (`primary`, `secondary`, `evidence`): use `#ffffff` (white)
- The element factories handle this automatically via luminance calculation

### Mermaid Theme Colors

When using `render_diagram`, Mermaid uses its own theming. For consistency with Verdant:

```
%%{init: {'theme': 'dark', 'themeVariables': {
  'primaryColor': '#3b82f6',
  'primaryTextColor': '#ffffff',
  'primaryBorderColor': '#1e3a5f',
  'secondaryColor': '#1a2428',
  'tertiaryColor': '#151c20',
  'lineColor': '#3dc9b0',
  'textColor': '#d4e8e4',
  'mainBkg': '#151c20',
  'nodeBorder': '#2d4a47',
  'clusterBkg': '#0c0e12',
  'clusterBorder': '#2d4a47',
  'titleColor': '#8ac4b8',
  'edgeLabelBackground': '#151c20',
  'noteTextColor': '#d4e8e4',
  'noteBkgColor': '#1a2428',
  'noteBorderColor': '#2d4a47'
}}}%%
```

Paste this `%%{init}%%` block at the top of Mermaid diagram source when dark-themed output is needed. For quick diagrams where theming doesn't matter, omit it.

---

## Typography

### Font Stack

| Context | Font | Family ID | Notes |
|---------|------|-----------|-------|
| Diagrams (Excalidraw) | Cascadia | `3` | Monospace, clean, technical |
| Code blocks | Cascadia | — | Matches diagram text |
| TUI | Terminal default | — | Inherits from terminal emulator |

### Scale

| Level | Size | Color | Use |
|-------|------|-------|-----|
| Title | 28px | `#1e40af` | Diagram titles, section headers |
| Subtitle | 20px | `#3b82f6` | Sub-sections, group labels |
| Body | 16px | `#64748b` | Default text, labels |
| Small | 12px | `#8a9a96` | Annotations, fine print |

### Text on Backgrounds

| Background | Text Color | Example |
|------------|------------|---------|
| Dark (`bg`, `cardBg`, evidence fills) | `#ffffff` or `#d4e8e4` | White/light green on black |
| Light (start, end, decision fills) | `#374151` | Dark gray on pastel |
| Transparent / no fill | Stroke color or `#64748b` | Inherits from context |

---

## Spacing & Layout

### Grid

- Base unit: **20px**
- Excalidraw grid: 20px, step 5
- Minimum element gap: 20px
- Comfortable gap: 40px
- Section gap: 80px

### Element Sizes (Excalidraw)

| Scale | Width × Height | Use |
|-------|---------------|-----|
| Hero | 300 × 150 | Visual anchor, primary focus |
| Primary | 180 × 90 | Standard components |
| Secondary | 120 × 60 | Supporting elements |
| Small | 60 × 40 | Indicators, dots, badges |
| Dot | 12 × 12 | Timeline markers, bullets |

### Stroke

| Style | Width | Use |
|-------|-------|-----|
| Standard | 2px | Default for all elements |
| Emphasized | 3px | Highlighted paths, primary flow |
| Subtle | 1px | Background connections, annotations |

---

## Rendering Defaults

### Excalidraw

- `roughness: 0` — clean, not hand-drawn
- `fillStyle: "solid"` — no hatching
- `strokeStyle: "solid"` — default; use `"dashed"` for optional/future
- `roundness: { type: 3 }` — adaptive corners on rectangles
- `fontFamily: 3` — Cascadia (monospace)
- `viewBackgroundColor: "#ffffff"` — white canvas (prints well; dark theme elements still pop)

### Mermaid

- Default theme is fine for quick structural diagrams
- Use the dark `%%{init}%%` block (above) for presentation-quality output
- Keep diagrams simple — Mermaid is for structure, Excalidraw is for argument

### FLUX.1 (Image Generation)

- Use `diagram` preset (1024×768) for technical visuals
- Use `schnell` for iteration, `dev` for finals
- Quantize to `4` bits on 16GB machines
- Prompts should reference the verdant palette by description: "dark teal-green accent on deep charcoal background"

---

## Quick Reference Card

```
BACKGROUNDS          ACCENTS              SIGNALS
bg:       #0c0e12    primary:    #3dc9b0  green:  #3daa8e
cardBg:   #151c20    primaryMu:  #4a9e90  red:    #f44747
surfaceBg:#1a2428    primaryBr:  #8ac4b8  orange: #e98100
                                          yellow: #e9c400

TEXT                 BORDERS
fg:       #d4e8e4    border:     #2d4a47
mutedFg:  #8a9a96    borderDim:  #1e3533
dimFg:    #5c6b67

EXCALIDRAW SEMANTICS (fill / stroke)
primary:   #3b82f6 / #1e3a5f    start:     #fed7aa / #c2410c
secondary: #60a5fa / #1e3a5f    end:       #a7f3d0 / #047857
decision:  #fef3c7 / #b45309    ai:        #ddd6fe / #6d28d9
warning:   #fee2e2 / #dc2626    error:     #fecaca / #b91c1c
evidence:  #1e293b / #334155    inactive:  #dbeafe / #1e40af
```
