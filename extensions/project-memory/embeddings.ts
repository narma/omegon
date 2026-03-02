/**
 * Project Memory — Embeddings
 *
 * Local vector embeddings via Ollama for semantic retrieval.
 * Uses qwen3-embedding models (0.6b or 4b) for zero-cost on-device embeddings.
 *
 * Storage: facts_vec table in the same SQLite DB as facts.
 * Vectors stored as raw Float32Array buffers for compact storage and fast cosine similarity.
 *
 * Graceful degradation: if Ollama is unavailable, falls back to FTS5 keyword search.
 */

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const EMBED_MODELS = ["qwen3-embedding:0.6b", "qwen3-embedding:4b"] as const;

/** Known embedding dimensions by model — used for mismatch detection */
export const MODEL_DIMS: Record<string, number> = {
  "qwen3-embedding:0.6b": 1024,
  "qwen3-embedding:4b": 2048,
};

export interface EmbeddingResult {
  embedding: Float32Array;
  model: string;
  dims: number;
}

/**
 * Embed a single text string via Ollama.
 * Tries models in preference order (smallest first for speed).
 */
export async function embed(
  text: string,
  opts?: { baseUrl?: string; model?: string; timeout?: number },
): Promise<EmbeddingResult | null> {
  const baseUrl = opts?.baseUrl ?? process.env.LOCAL_INFERENCE_URL ?? DEFAULT_OLLAMA_URL;
  const timeout = opts?.timeout ?? 5000;

  const models = opts?.model ? [opts.model] : [...EMBED_MODELS];

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const resp = await fetch(`${baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: text }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) continue;

      const data = (await resp.json()) as { embedding: number[] };
      if (!data.embedding?.length) continue;

      const arr = new Float32Array(data.embedding);
      return { embedding: arr, model, dims: arr.length };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Cosine similarity between two Float32Arrays.
 * Optimized inner loop — no allocations.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Serialize Float32Array to Buffer for SQLite BLOB storage.
 */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/**
 * Deserialize Buffer from SQLite BLOB to Float32Array.
 */
export function blobToVector(blob: Buffer): Float32Array {
  // Copy to aligned buffer (SQLite buffers may not be aligned)
  const aligned = new ArrayBuffer(blob.length);
  const view = new Uint8Array(aligned);
  view.set(blob);
  return new Float32Array(aligned);
}

/**
 * Check if Ollama is reachable and has an embedding model available.
 */
export async function isEmbeddingAvailable(baseUrl?: string): Promise<{ available: boolean; model?: string }> {
  const url = baseUrl ?? process.env.LOCAL_INFERENCE_URL ?? DEFAULT_OLLAMA_URL;
  try {
    const resp = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return { available: false };
    const data = (await resp.json()) as { models: { name: string }[] };
    const names = data.models?.map((m) => m.name) ?? [];
    for (const model of EMBED_MODELS) {
      if (names.some((n) => n === model || n.startsWith(model.split(":")[0]))) {
        return { available: true, model };
      }
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}
