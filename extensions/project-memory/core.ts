/**
 * project-memory/core — Pure computation functions
 *
 * Zero dependencies: no DB, no pi API, no Node.js built-ins except crypto
 * (available in all JS environments). This module is the direct Rust port target.
 *
 * Rust equivalents:
 *   computeConfidence → src/memory/decay.rs::compute_confidence
 *   cosineSimilarity  → src/memory/vectors.rs::cosine_similarity
 *   vectorToBlob      → src/memory/vectors.rs::vector_to_blob
 *   blobToVector      → src/memory/vectors.rs::blob_to_vector
 *   contentHash       → src/memory/store.rs::content_hash
 *   normalizeForHash  → src/memory/store.rs::normalize_for_hash
 *
 * Any behavioural change here must be reflected in the Rust implementation
 * and verified by cross-impl tests (same inputs → same outputs).
 */

import * as crypto from "node:crypto";

// ─── Decay profiles ──────────────────────────────────────────────────────────

/** Project-level decay. Base half-life 14d; each reinforcement extends by 1.8×. */
export const DECAY = {
  baseRate: 0.05,           // ≈ ln(2)/14 — single unreinforced fact fades in ~2 weeks
  reinforcementFactor: 1.8,
  minimumConfidence: 0.1,
  halfLifeDays: 14,
} as const;

/** Global-level decay. Shorter base (30d); cross-project reinforcement dramatically extends. */
export const GLOBAL_DECAY = {
  baseRate: Math.LN2 / 30,
  reinforcementFactor: 2.5,
  minimumConfidence: 0.1,
  halfLifeDays: 30,
} as const;

/**
 * Recent Work decay — ephemeral session breadcrumbs.
 * halfLifeDays=2: written Monday, gone by Wednesday at ~50%.
 * reinforcementFactor=1.0: reinforcement does NOT extend half-life.
 */
export const RECENT_WORK_DECAY = {
  baseRate: Math.LN2 / 2,
  reinforcementFactor: 1.0,
  minimumConfidence: 0.01,
  halfLifeDays: 2,
} as const;

export type DecayProfile = typeof DECAY | typeof GLOBAL_DECAY | typeof RECENT_WORK_DECAY;

/** Stored profile discriminant — persisted in the `decay_profile` DB column. */
export type DecayProfileName = "standard" | "global" | "recent_work";

/** Map DB column value → DecayProfile object. Exhaustive — all names must be handled. */
export function resolveDecayProfile(name: DecayProfileName): DecayProfile {
  switch (name) {
    case "standard":    return DECAY;
    case "global":      return GLOBAL_DECAY;
    case "recent_work": return RECENT_WORK_DECAY;
  }
}

/**
 * Maximum effective half-life regardless of reinforcement count.
 * Prevents immortal facts — even highly reinforced facts decay eventually.
 * Facts needing longer survival must be pinned via memory_focus.
 */
const MAX_HALF_LIFE_DAYS = 90;

/**
 * Compute current confidence for a fact based on time since last reinforcement.
 *
 * halfLife = profile.halfLifeDays × (profile.reinforcementFactor ^ (reinforcement_count - 1))
 * halfLife = clamp(halfLife, 0, MAX_HALF_LIFE_DAYS)
 * confidence = e^(−ln(2) × daysSinceReinforced / halfLife)
 *
 * Rust port: src/memory/decay.rs::compute_confidence
 * Must produce bit-compatible results for the same float inputs.
 */
export function computeConfidence(
  daysSinceReinforced: number,
  reinforcementCount: number,
  profile: DecayProfile = DECAY,
): number {
  const rawHalfLife = profile.halfLifeDays * Math.pow(profile.reinforcementFactor, reinforcementCount - 1);
  const halfLife = Math.min(rawHalfLife, MAX_HALF_LIFE_DAYS);
  const confidence = Math.exp(-Math.LN2 * daysSinceReinforced / halfLife);
  return Math.max(confidence, 0);
}

// ─── Vector math ─────────────────────────────────────────────────────────────

/**
 * Cosine similarity between two Float32Arrays.
 * Returns 0 if either vector has zero norm or dimensions differ.
 *
 * Rust port: src/memory/vectors.rs::cosine_similarity
 * LLVM auto-vectorizes the inner loop on x86 (SSE/AVX) and ARM (NEON).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Serialize Float32Array to Buffer for SQLite BLOB storage.
 * Layout: raw IEEE 754 little-endian f32 array (matches Rust's [f32] memory layout).
 *
 * Rust port: src/memory/vectors.rs — use bytemuck::cast_slice or std::mem::transmute.
 */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Deserialize Buffer from SQLite BLOB to Float32Array.
 * Allocates a fresh aligned ArrayBuffer — safe regardless of Buffer alignment.
 *
 * Rust port: src/memory/vectors.rs — bytemuck::cast_slice::<u8, f32>.
 */
export function blobToVector(blob: Buffer): Float32Array {
  const aligned = new ArrayBuffer(blob.length);
  const view = new Uint8Array(aligned);
  view.set(blob);
  return new Float32Array(aligned);
}

// ─── Content hashing ─────────────────────────────────────────────────────────

/**
 * Normalize content for dedup hashing.
 * Strips leading bullet dash, trims whitespace, lowercases, collapses runs of spaces.
 *
 * Rust port: src/memory/store.rs::normalize_for_hash
 */
export function normalizeForHash(content: string): string {
  return content
    .replace(/^-\s*/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Compute a 16-hex-char content hash for deduplication.
 * Uses sha256 truncated to 64 bits — collision probability negligible at expected fact counts.
 *
 * Rust port: src/memory/store.rs::content_hash — sha2::Sha256, hex encode, truncate to 16.
 */
export function contentHash(content: string): string {
  return crypto.createHash("sha256")
    .update(normalizeForHash(content))
    .digest("hex")
    .slice(0, 16);
}
