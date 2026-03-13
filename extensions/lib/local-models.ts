/**
 * Canonical local model registry for Omegon.
 *
 * Single source of truth consumed by: offline-driver, effort, cleave, project-memory.
 * Update this file as new models are released — all preference logic reads from here.
 *
 * PREFERENCE ORDERING PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 * Quality-first: best available model wins automatically.
 * Users install what fits their hardware; the lists handle selection.
 *
 *   64GB  → 70B tier   (qwen2.5:72b, llama3.3:70b)
 *   32GB  → 32B tier   (qwen3:32b, qwen2.5:32b)
 *   24GB  → 14B Q8 or MoE 30B Q4 (qwen3-coder:30b, qwen3:14b)
 *   16GB  → 8B Q8     (qwen3:8b, llama3.1:8b)
 *    8GB  → 4B Q8     (qwen3:4b, phi4-mini)
 *
 * MoE NOTE: qwen3-coder:30b has 30B total params but only 3.3B activated —
 * weight file is ~18GB at Q4 but inference cost is like a 3-4B dense model.
 * Fits on 24GB, runs fast, explicitly trained on SWE-Bench agentic tasks.
 *
 * CONTEXT WINDOW NOTE: phi4:14b has 16K context (too small for deep agent
 * sessions) — excluded from main preferences. phi4-mini has 128K and is fine.
 * mistral:7b and codestral:22b are capped at 32K; prefer Qwen/Llama at those sizes.
 *
 * Last reviewed: 2026-03-07
 * Next review triggers: major Qwen4/Llama4/Gemma4 releases, new MoE coding models.
 */

export interface LocalModelMeta {
  /** Human-readable display name */
  label: string;
  /** Emoji icon for UI display */
  icon: string;
  /** Native context window in tokens */
  contextWindow: number;
  /** Max generation tokens */
  maxTokens: number;
}

// ---------------------------------------------------------------------------
// Model registry — metadata for known models
// ---------------------------------------------------------------------------

export const KNOWN_MODELS: Record<string, LocalModelMeta> = {
  // ── 70B tier (64GB+) ──────────────────────────────────────────────────────
  "qwen2.5:72b":           { label: "Qwen2.5 72B",            icon: "🧠", contextWindow: 131072,  maxTokens: 32768 },
  "llama3.3:70b":          { label: "Llama 3.3 70B",          icon: "🦙", contextWindow: 131072,  maxTokens: 32768 },
  "llama3.1:70b":          { label: "Llama 3.1 70B",          icon: "🦙", contextWindow: 131072,  maxTokens: 32768 },

  // ── 32B tier (32GB+, or 24GB at Q4) ──────────────────────────────────────
  "qwen3:32b":             { label: "Qwen3 32B",              icon: "🐉", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5:32b":           { label: "Qwen2.5 32B",            icon: "🧠", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5-coder:32b":     { label: "Qwen2.5-Coder 32B",      icon: "💻", contextWindow: 131072,  maxTokens: 32768 },

  // ── MoE 30B tier — runs lean despite total param count ───────────────────
  // qwen3-coder: 30B total / 3.3B active, ~18GB at Q4. Fits 24GB+.
  // Explicitly trained on SWE-Bench; best local code-agent model at its size.
  "qwen3-coder:30b":       { label: "Qwen3-Coder 30B (MoE)",  icon: "🤖", contextWindow: 262144,  maxTokens: 32768 },
  "qwen3:30b":             { label: "Qwen3 30B",              icon: "🐲", contextWindow: 131072,  maxTokens: 32768 },
  "nemotron-3-nano:30b":   { label: "Nemotron 3 Nano 30B",    icon: "🏔️", contextWindow: 1048576, maxTokens: 32768 },

  // ── 22–27B tier (16GB+ at Q4, 32GB at Q8) ───────────────────────────────
  "gemma3:27b":            { label: "Gemma3 27B",             icon: "♊", contextWindow: 131072,  maxTokens: 32768 },
  // devstral:24b is the current canonical Ollama tag (replaces devstral-small-2:24b)
  // Built on Mistral-Small-3.1; 53.6% SWE-Bench verified (top OSS as of mid-2025)
  "devstral:24b":          { label: "Devstral 24B",           icon: "⚙️", contextWindow: 131072,  maxTokens: 32768 },
  "devstral-small-2:24b":  { label: "Devstral Small 2 24B",   icon: "⚙️", contextWindow: 393216,  maxTokens: 32768 },
  "mistral-small":         { label: "Mistral Small 22B",      icon: "🌬️", contextWindow: 32768,   maxTokens: 32768 },
  "codestral:22b":         { label: "Codestral 22B",          icon: "💻", contextWindow: 32768,   maxTokens: 32768 },

  // ── 14B tier (16GB+) ─────────────────────────────────────────────────────
  "qwen3:14b":             { label: "Qwen3 14B",              icon: "🐉", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5:14b":           { label: "Qwen2.5 14B",            icon: "🧠", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5-coder:14b":     { label: "Qwen2.5-Coder 14B",      icon: "💻", contextWindow: 131072,  maxTokens: 32768 },
  "mistral-nemo":          { label: "Mistral Nemo 12B",       icon: "🌬️", contextWindow: 131072,  maxTokens: 32768 },

  // ── 7–9B tier (8GB+) ─────────────────────────────────────────────────────
  "qwen3:8b":              { label: "Qwen3 8B",               icon: "🐉", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5:7b":            { label: "Qwen2.5 7B",             icon: "🧠", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5-coder:7b":      { label: "Qwen2.5-Coder 7B",       icon: "💻", contextWindow: 131072,  maxTokens: 32768 },
  "llama3.1:8b":           { label: "Llama 3.1 8B",           icon: "🦙", contextWindow: 131072,  maxTokens: 32768 },
  "llama3.2:11b":          { label: "Llama 3.2 11B",          icon: "🦙", contextWindow: 131072,  maxTokens: 32768 },
  "gemma3:9b":             { label: "Gemma3 9B",              icon: "♊", contextWindow: 131072,  maxTokens: 32768 },
  "phi4-mini":             { label: "Phi-4 Mini 3.8B",        icon: "Φ",  contextWindow: 131072,  maxTokens: 32768 },
  "mistral:7b":            { label: "Mistral 7B",             icon: "🌬️", contextWindow: 32768,   maxTokens: 32768 },

  // ── 3–4B tier (8GB, last useful resort for tool calling) ─────────────────
  "qwen3:4b":              { label: "Qwen3 4B",               icon: "🐉", contextWindow: 131072,  maxTokens: 32768 },
  "qwen2.5-coder:3b":      { label: "Qwen2.5-Coder 3B",       icon: "💻", contextWindow: 131072,  maxTokens: 32768 },
  "gemma3:4b":             { label: "Gemma3 4B",              icon: "♊", contextWindow: 131072,  maxTokens: 32768 },
  "llama3.2:3b":           { label: "Llama 3.2 3B",           icon: "🦙", contextWindow: 131072,  maxTokens: 32768 },

  // ── Sub-3B (emergency fallback — too small for reliable orchestration) ────
  "qwen3:1.7b":            { label: "Qwen3 1.7B",             icon: "🐣", contextWindow: 131072,  maxTokens: 8192  },
  "llama3.2:1b":           { label: "Llama 3.2 1B",           icon: "🐣", contextWindow: 131072,  maxTokens: 8192  },
  "qwen3:0.6b":            { label: "Qwen3 0.6B",             icon: "🐣", contextWindow: 131072,  maxTokens: 8192  },
};

// ---------------------------------------------------------------------------
// Preference lists — consumed by offline-driver, effort, cleave
// ---------------------------------------------------------------------------

/**
 * General orchestration preference — best installed model wins.
 * Ordered 70B → 32B → MoE-30B → 14B → 8B → 4B → sub-3B.
 * On any hardware, only installed models are found; others are skipped.
 */
export const PREFERRED_ORDER: string[] = [
  // 70B tier (64GB+)
  "qwen2.5:72b", "llama3.3:70b", "llama3.1:70b",
  // 32B tier (32GB+)
  "qwen3:32b", "qwen2.5:32b",
  // MoE 30B (fits 24GB+ at Q4 despite total param count)
  "qwen3-coder:30b", "qwen3:30b", "nemotron-3-nano:30b",
  // 22–27B tier
  "gemma3:27b", "devstral:24b", "devstral-small-2:24b", "mistral-small",
  // 14B tier (16GB+)
  "qwen3:14b", "qwen2.5:14b", "mistral-nemo",
  // 7–9B tier (8GB+)
  "qwen3:8b", "llama3.2:11b", "gemma3:9b", "qwen2.5:7b", "llama3.1:8b", "mistral:7b",
  // 4B tier
  "qwen3:4b", "phi4-mini", "gemma3:4b",
  // Sub-3B (last resort)
  "llama3.2:3b", "qwen3:1.7b", "llama3.2:1b", "qwen3:0.6b",
];

/**
 * Code-focused preference for cleave leaf workers.
 * Biases toward Coder/Devstral/Codestral variants at each size tier.
 */
export const PREFERRED_ORDER_CODE: string[] = [
  // 32B code tier
  "qwen2.5-coder:32b", "qwen3:32b", "codestral:22b",
  // MoE 30B (excellent for agentic code tasks, lean inference)
  "qwen3-coder:30b", "devstral:24b", "devstral-small-2:24b",
  // 30B general
  "qwen3:30b",
  // 14B code tier
  "qwen2.5-coder:14b", "qwen3:14b", "qwen2.5:14b",
  // 7–8B code tier
  "qwen2.5-coder:7b", "qwen3:8b", "llama3.1:8b",
  // Small code
  "qwen2.5-coder:3b", "qwen3:4b", "llama3.2:3b",
  // General fallbacks
  "nemotron-3-nano:30b", "qwen2.5:7b", "gemma3:9b",
];

/**
 * Model family prefixes for startsWith matching (used by project-memory compaction).
 * Catches any installed variant not listed explicitly in PREFERRED_ORDER.
 * Ordered by general capability preference within each family.
 */
export const PREFERRED_FAMILIES: string[] = [
  "qwen3-coder", "qwen3", "qwen2.5-coder", "qwen2.5",
  "llama3", "gemma3", "devstral", "mistral", "nemotron", "phi",
];
