/**
 * Embedding Service — Sprint 25
 *
 * Provides semantic text embedding for vector-based memory retrieval.
 * Supports multiple providers with graceful fallback.
 *
 * Providers:
 * - OpenAI text-embedding-3-small (1536 dims, $0.02/1M tokens)
 * - SiliconFlow BAAI/bge-large-zh-v1.5 (1024 dims)
 *
 * Design principles:
 * - Fail-safe: any error returns null, caller must handle gracefully
 * - Configurable: provider/model/dimensions via env vars
 * - Rate-limit aware: input truncated to 8000 chars to prevent oversized requests
 */

import { config } from "../config.js";

export interface EmbeddingConfig {
  provider: "openai" | "siliconflow";
  apiKey: string;
  model: string;
  dimensions: number;
  enabled: boolean;
  // SiliconFlow 专用配置
  siliconflowApiKey: string;
  siliconflowBaseUrl: string;
}

/**
 * Get embedding vector for text.
 * Returns null if embedding is disabled or any error occurs.
 */
export async function getEmbedding(text: string): Promise<number[] | null> {
  if (!config.embedding?.enabled) {
    return null;
  }

  try {
    const provider = config.embedding.provider;

    if (provider === "openai") {
      return await getOpenAIEmbedding(text, config.embedding);
    }

    if (provider === "siliconflow") {
      return await getSiliconFlowEmbedding(text, config.embedding);
    }

    return null;
  } catch {
    // Fail-safe: any error returns null
    return null;
  }
}

async function getOpenAIEmbedding(
  text: string,
  cfg: EmbeddingConfig
): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text.slice(0, 8000),
      dimensions: cfg.dimensions,
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return data.data[0]?.embedding ?? null;
}

async function getSiliconFlowEmbedding(
  text: string,
  cfg: EmbeddingConfig
): Promise<number[] | null> {
  // 优先用专用 siliconflowApiKey，否则降级到 apiKey
  const apiKey = cfg.siliconflowApiKey || cfg.apiKey;
  const baseUrl = cfg.siliconflowBaseUrl || "https://api.siliconflow.cn";
  const url = `${baseUrl}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      input: text.slice(0, 8000),
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return data.data[0]?.embedding ?? null;
}

/**
 * Calculate cosine similarity between two vectors.
 * Returns 0-1 where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
