/**
 * Project Memory — Embeddings
 *
 * Cloud-first vector embeddings for semantic retrieval.
 * Defaults to OpenAI `text-embedding-3-small` for low-cost background
 * indexing, with optional Ollama support when explicitly configured.
 *
 * Storage: facts_vec table in the same SQLite DB as facts.
 * Vectors stored as raw Float32Array buffers for compact storage and fast cosine similarity.
 *
 * Graceful degradation: if the configured embedding backend is unavailable,
 * project-memory falls back to FTS5 keyword search.
 */

export type EmbeddingProvider = "openai" | "ollama";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OPENAI_EMBED_MODEL = "text-embedding-3-small";
const OLLAMA_EMBED_MODELS = ["qwen3-embedding:0.6b", "qwen3-embedding:4b"] as const;

/** Known embedding dimensions by model — used for mismatch detection */
export const MODEL_DIMS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "qwen3-embedding:0.6b": 1024,
  "qwen3-embedding:4b": 2048,
};

export interface EmbeddingResult {
  embedding: Float32Array;
  model: string;
  dims: number;
}

export interface EmbeddingOptions {
  provider?: EmbeddingProvider;
  model?: string;
  baseUrl?: string;
  timeout?: number;
  apiKey?: string;
}

function resolveProvider(opts?: EmbeddingOptions): EmbeddingProvider {
  if (opts?.provider) return opts.provider;
  if (opts?.model?.startsWith("qwen3-embedding")) return "ollama";
  return "openai";
}

async function embedOpenAI(text: string, opts?: EmbeddingOptions): Promise<EmbeddingResult | null> {
  const apiKey = opts?.apiKey ?? process.env.MEMORY_EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (opts?.baseUrl ?? process.env.MEMORY_EMBEDDING_BASE_URL ?? process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL)
    .replace(/\/$/, "");
  const model = opts?.model ?? process.env.MEMORY_EMBEDDING_MODEL ?? DEFAULT_OPENAI_EMBED_MODEL;
  const timeout = opts?.timeout ?? 5000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!resp.ok) return null;

    const data = (await resp.json()) as { data?: Array<{ embedding?: number[] }> };
    const values = data.data?.[0]?.embedding;
    if (!values?.length) return null;

    const arr = new Float32Array(values);
    return { embedding: arr, model, dims: arr.length };
  } catch {
    return null;
  }
}

async function embedOllama(text: string, opts?: EmbeddingOptions): Promise<EmbeddingResult | null> {
  const baseUrl = (opts?.baseUrl ?? process.env.LOCAL_INFERENCE_URL ?? DEFAULT_OLLAMA_URL).replace(/\/$/, "");
  const timeout = opts?.timeout ?? 5000;
  const models = opts?.model ? [opts.model] : [...OLLAMA_EMBED_MODELS];

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

      const data = (await resp.json()) as { embedding?: number[] };
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
 * Embed a single text string via the configured embedding backend.
 */
export async function embed(
  text: string,
  opts?: EmbeddingOptions,
): Promise<EmbeddingResult | null> {
  const provider = resolveProvider(opts);
  return provider === "ollama" ? embedOllama(text, opts) : embedOpenAI(text, opts);
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
 * Check if the configured embedding backend is reachable and usable.
 */
export async function isEmbeddingAvailable(opts?: EmbeddingOptions): Promise<{ available: boolean; model?: string; dims?: number }> {
  const result = await embed("embedding healthcheck", opts);
  if (!result) return { available: false };
  return { available: true, model: result.model, dims: result.dims };
}
