/**
 * Memory Retrieval Service — MR-001 + MR-003 + Sprint 25 (Hybrid Retrieval)
 *
 * Implements the v2/v3 retrieval policy for memory injection.
 *
 * Retrieval Strategy:
 * - v1 (legacy): ORDER BY importance DESC, updated_at DESC
 * - v2 (category-aware): score each entry by (recency + importance + keyword match),
 *   then apply per-category injection policies.
 * - v3 (Sprint 25, hybrid): vector similarity (60%) + keyword (15%) + importance (15%) + recency (10%)
 *
 * Design goals:
 * - Explainable: every score has a human-readable `reason` string
 * - Configurable: category policies live in config.ts, not hard-coded
 * - Safe fallback: if v2/v3 returns no results, falls back to v1
 * - Graceful degradation: if embedding unavailable, falls back to keyword-only
 *
 * MR-003 additions:
 * - Stopword-filtered token extraction for both query and content
 * - Normalized relevance scoring (Jaccard) to prevent long-text inflation
 * - Keyword stems are pre-computed once per entry, cached in Map
 *
 * Sprint 25 additions:
 * - pgvector-based semantic similarity search
 * - Hybrid scoring with configurable weights
 * - Async retrieval pipeline
 */

import type {
  MemoryEntry,
  MemoryRetrievalContext,
  MemoryRetrievalResult,
  MemoryCategoryPolicy,
} from "../types/index.js";
import { getEmbedding } from "./embedding.js";
import { MemoryEntryRepo, EvidenceRepo } from "../db/repositories.js";

// ── Scoring helpers ──────────────────────────────────────────────────────────

/** Sprint 25: Hybrid scoring weights (total = 100) */
const SCORE_WEIGHTS = {
  vector: 60,      // Semantic similarity (pgvector)
  keyword: 15,     // Keyword match (MR-003)
  importance: 15,  // Entry importance (1-5)
  recency: 10,     // Time decay
};

/**
 * Compute a relevance score for a single memory entry given retrieval context.
 * Sprint 25: Hybrid scoring with optional vector similarity.
 *
 * Score breakdown:
 * - Vector similarity: 0-60 points (if embedding available)
 * - Keyword match: 0-15 points
 * - Importance: 0-15 points (5 levels × 3)
 * - Recency: 0-10 points
 */
export function scoreEntry(
  entry: MemoryEntry,
  context: MemoryRetrievalContext,
  vectorSimilarity?: number  // 0-1 from pgvector
): { score: number; reason: string } {
  const reasons: string[] = [];

  // Vector component: 0-60 points (Sprint 25)
  let vectorScore = 0;
  if (vectorSimilarity !== undefined && vectorSimilarity > 0) {
    vectorScore = Math.round(vectorSimilarity * SCORE_WEIGHTS.vector);
    reasons.push(`vector=${vectorScore}pts(sim=${vectorSimilarity.toFixed(2)})`);
  }

  // Importance component: 0-15 points (5 levels × 3)
  const importanceScore = entry.importance * 3;
  reasons.push(`importance=${importanceScore}pts`);

  // Recency component: 0-10 points
  const ageMs = Date.now() - new Date(entry.updated_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyScore = Math.max(0, Math.round(SCORE_WEIGHTS.recency * Math.pow(0.9, ageDays / 10)));
  reasons.push(`recency=${recencyScore}pts`);

  // Keyword component: 0-15 points (MR-003)
  const kw = computeKeywordRelevance(context.userMessage, entry);
  if (kw.score > 0) {
    // Normalize kw.score (0-15) to our weight
    const keywordScore = Math.round((kw.score / 15) * SCORE_WEIGHTS.keyword);
    reasons.push(`keyword=${keywordScore}pts(${kw.matchedKeywords.join(",")})`);
  }

  const total = vectorScore + importanceScore + recencyScore + kw.score;
  return { score: total, reason: reasons.join(" | ") };
}

// ── Category eligibility ─────────────────────────────────────────────────────

/**
 * Determine if a memory entry is eligible for injection under category policy.
 * Returns { eligible, reason }.
 */
export function isEligibleForInjection(
  entry: MemoryEntry,
  policy: MemoryCategoryPolicy
): { eligible: boolean; reason: string } {
  if (entry.importance < policy.minImportance) {
    return {
      eligible: false,
      reason: `importance ${entry.importance} < minImportance ${policy.minImportance}`,
    };
  }
  if (policy.alwaysInject) {
    return { eligible: true, reason: "alwaysInject=true" };
  }
  return { eligible: true, reason: "relevance-gated" };
}

// ── Retrieval pipeline ─────────────────────────────────────────────────────

export interface RetrievalPipelineInput {
  entries: MemoryEntry[];
  context: MemoryRetrievalContext;
  categoryPolicy: Record<string, MemoryCategoryPolicy>;
  maxTotalEntries: number;
  /** Sprint 25: Optional vector similarity scores (entryId -> similarity 0-1) */
  vectorScores?: Map<string, number>;
}

/**
 * Run the v2/v3 retrieval pipeline on a set of candidate entries.
 *
 * Pipeline:
 * 1. Score each entry (vector + importance + recency + keyword match)
 * 2. Check category eligibility via categoryPolicy
 * 3. Build per-category pools (respecting maxCount per category)
 * 4. Always-inject categories fill first (up to maxCount)
 * 5. Remaining slots filled by highest-scoring relevance-gated entries
 * 6. Sort final result by score descending
 *
 * Returns entries with scores, sorted by relevance.
 */
export function runRetrievalPipeline(
  input: RetrievalPipelineInput
): MemoryRetrievalResult[] {
  const { entries, context, categoryPolicy, maxTotalEntries, vectorScores } = input;

  // Step 1: score all entries
  const scored = entries.map((entry) => {
    const vectorSim = vectorScores?.get(entry.id);
    const { score, reason } = scoreEntry(entry, context, vectorSim);
    const policy = categoryPolicy[entry.category];
    const { eligible, reason: eligReason } = policy
      ? isEligibleForInjection(entry, policy)
      : { eligible: true, reason: "no-policy" };

    return {
      entry,
      score: eligible ? score : 0,
      reason: eligible ? reason : `${reason} → ineligible(${eligReason})`,
      eligible,
      alwaysInject: policy?.alwaysInject ?? false,
    };
  });

  // Step 2: separate alwaysInject from relevance-gated
  const alwaysInjectPool = scored
    .filter((s) => s.alwaysInject && s.eligible)
    .sort((a, b) => b.score - a.score);

  const relevanceGatedPool = scored
    .filter((s) => !s.alwaysInject && s.eligible)
    .sort((a, b) => b.score - a.score);

  // Step 3: per-category maxCount enforcement for alwaysInject
  const categoryMaxCounts: Record<string, number> = {};
  const alwaysInjectSelected: MemoryRetrievalResult[] = [];

  for (const item of alwaysInjectPool) {
    const cat = item.entry.category;
    const policy = categoryPolicy[cat];
    const maxCount = policy?.maxCount ?? 2;
    const currentCount = categoryMaxCounts[cat] ?? 0;
    if (currentCount < maxCount) {
      alwaysInjectSelected.push({
        entry: item.entry,
        score: item.score,
        reason: `[${cat}] ${item.reason}`,
      });
      categoryMaxCounts[cat] = currentCount + 1;
    }
  }

  // Step 4: fill remaining slots with highest-scoring relevance-gated entries
  const remainingSlots = maxTotalEntries - alwaysInjectSelected.length;
  const relevanceSelected = relevanceGatedPool
    .slice(0, remainingSlots)
    .map((s) => ({
      entry: s.entry,
      score: s.score,
      reason: `[${s.entry.category}] ${s.reason}`,
    }));

  // Step 5: merge and sort by score
  const result = [...alwaysInjectSelected, ...relevanceSelected].sort(
    (a, b) => b.score - a.score
  );

  return result;
}

// ── Sprint 32: Intent-aware category boost ─────────────────────────────────

/**
 * Sprint 32 P2: 根据用户消息的语义意图，提升对应类别的相关性权重。
 *
 * 示例：
 * - 用户问"我偏好什么" → preference 类别权重 ×1.5
 * - 用户问事实性问题 → fact 类别权重 ×1.5
 * - 用户请求指令类 → instruction 类别权重 ×1.5
 */
export function getIntentAwareWeights(
  context: MemoryRetrievalContext
): Record<string, number> {
  const msg = context.userMessage.toLowerCase();
  const boostMap: Array<[string[], string]> = [
    [["偏好", "喜欢", "倾向", "不要", "prefer", "like", "dislike"], "preference"],
    [["我的", "事实", "记录", "之前", "历史", "fact", "history", "remember"], "fact"],
    [["指令", "要求", "怎么做", "应该", "按照", "instruction", "should", "must", "rule"], "instruction"],
    [["当前", "上下文", "情况", "现在", "context", "current"], "context"],
  ];

  const weights: Record<string, number> = {};
  for (const [keywords, category] of boostMap) {
    if (keywords.some((kw) => msg.includes(kw))) {
      weights[category] = 1.5;
    }
  }
  return weights;
}

/**
 * Sprint 32 P2: 将 intent-aware weights 应用到评分结果。
 * 在 runRetrievalPipeline 之后调用，对匹配意图的类别结果加分。
 */
export function applyIntentBoost(
  results: MemoryRetrievalResult[],
  intentWeights: Record<string, number>
): MemoryRetrievalResult[] {
  if (Object.keys(intentWeights).length === 0) return results;

  return results.map((r) => {
    const boost = intentWeights[r.entry.category];
    if (boost !== undefined) {
      return {
        ...r,
        score: r.score * boost,
        reason: `${r.reason} [intent_boost ×${boost}]`,
      };
    }
    return r;
  }).sort((a, b) => b.score - a.score);
}

// ── Sprint 32: Evidence 跨任务关联 ──────────────────────────────────────────

export interface EvidenceRetrievalOptions {
  userId: string;
  /** 任务相关的关键词（从 SlowModelCommand.query_keys 或 userMessage 提取） */
  queryKeys?: string[];
  /** 返回数量上限 */
  maxResults?: number;
}

/**
 * Sprint 32 P2: 检索与当前任务相关的 Evidence，供 Task Brief 的 relevant_facts 使用。
 *
 * Evidence 关联策略：
 * 1. 按 relevance_score 降序
 * 2. 过滤 relevance_score > 0.3 的条目
 * 3. 对 queryKeys 匹配的内容加分
 * 4. 返回格式化后的字符串数组
 */
export async function retrieveEvidenceForContext(
  options: EvidenceRetrievalOptions
): Promise<string[]> {
  const { userId, queryKeys = [], maxResults = 5 } = options;

  try {
    const evidence = await EvidenceRepo.getEvidenceForUser(userId, maxResults * 2);
    if (!evidence || evidence.length === 0) return [];

    // 过滤 relevance_score > 0.3
    const relevant = evidence.filter((e: { relevance_score: number | null }) => {
      if (typeof e.relevance_score === "number" && e.relevance_score > 0.3) return true;
      return false;
    });

    // 如果有 queryKeys，对匹配的证据额外加权
    let scored = relevant.map((e: { relevance_score: number | null; content: string; source_metadata: Record<string, unknown> | null; source: string }) => {
      let score = typeof e.relevance_score === "number" ? e.relevance_score : 0;
      if (queryKeys.length > 0) {
        const contentLower = e.content.toLowerCase();
        const matchedKeys = queryKeys.filter((kw: string) => contentLower.includes(kw.toLowerCase()));
        score += matchedKeys.length * 0.1;
      }
      return { evidence: e, score };
    });

    // 排序取 top N
    scored.sort((a: { score: number }, b: { score: number }) => b.score - a.score);
    const topEvidence = scored.slice(0, maxResults);

    return topEvidence.map(({ evidence: e }: { evidence: { content: string; source_metadata: Record<string, unknown> | null; source: string } }) => {
      const src = e.source_metadata ? JSON.stringify(e.source_metadata).substring(0, 60) : e.source;
      return `[来源: ${src}] ${e.content.substring(0, 200)}`;
    });
  } catch {
    // evidence 检索失败不阻塞主流程
    return [];
  }
}

// ── Sprint 25: Hybrid Retrieval Entry Point ─────────────────────────────────

export interface HybridRetrievalOptions {
  userId: string;
  context: MemoryRetrievalContext;
  categoryPolicy: Record<string, MemoryCategoryPolicy>;
  maxTotalEntries: number;
  category?: string;
}

/**
 * Sprint 25: Hybrid memory retrieval combining vector similarity and keyword matching.
 *
 * Flow:
 * 1. Generate embedding for query (if configured)
 * 2. Vector search -> candidate pool A
 * 3. Keyword search -> candidate pool B
 * 4. Merge pools, compute hybrid scores
 * 5. Run category-aware pipeline
 *
 * Graceful degradation: if embedding fails, falls back to keyword-only.
 */
export async function retrieveMemoriesHybrid(
  options: HybridRetrievalOptions
): Promise<MemoryRetrievalResult[]> {
  const { userId, context, categoryPolicy, maxTotalEntries, category } = options;

  // 1. Try to get query embedding
  const queryEmbedding = await getEmbedding(context.userMessage);

  // 2. Vector search (if embedding available)
  let vectorResults: Array<MemoryEntry & { similarity: number }> = [];
  if (queryEmbedding) {
    try {
      // Fetch 4x the limit to ensure good coverage for hybrid scoring
      vectorResults = await MemoryEntryRepo.searchByVector(
        userId,
        queryEmbedding,
        maxTotalEntries * 4,
        category
      );
    } catch {
      // Fail-safe: continue without vector results
    }
  }

  // 3. Keyword-based candidates (legacy fallback)
  const keywordCandidates = await MemoryEntryRepo.getTopForUser(
    userId,
    maxTotalEntries * 4
  );

  // 4. Merge candidate pools (deduplicate)
  const allIds = new Set<string>();
  const mergedEntries: MemoryEntry[] = [];

  for (const entry of [...vectorResults, ...keywordCandidates]) {
    if (!allIds.has(entry.id)) {
      allIds.add(entry.id);
      mergedEntries.push(entry);
    }
  }

  // 5. Build vector score map for hybrid scoring
  const vectorScores = new Map<string, number>();
  for (const r of vectorResults) {
    vectorScores.set(r.id, r.similarity);
  }

  // 6. Run pipeline with hybrid scores
  return runRetrievalPipeline({
    entries: mergedEntries,
    context,
    categoryPolicy,
    maxTotalEntries,
    vectorScores,
  });
}

// ── Category display labels ───────────────────────────────────────────────────

/** Human-readable section labels for each memory category in the injected prompt. */
const CATEGORY_LABELS: Record<string, string> = {
  instruction: "Instructions & Goals",
  preference: "Preferences",
  fact: "Facts",
  context: "Context",
};

/** Default label for unknown or unrecognised categories. */
function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

// ── Category-aware memory text assembly ─────────────────────────────────────

export interface CategoryAwareMemoryText {
  /** Single combined text ready for prompt injection. */
  combined: string;
  /** Breakdown by category, for logging / debugging. */
  breakdown: Record<string, string[]>;
}

/**
 * Build a structured, category-grouped memory text for prompt injection.
 *
 * Output format:
 * ```
 * User memories:
 *
 * Instructions & Goals:
 * - ...
 * - ...
 *
 * Preferences:
 * - ...
 *
 * Facts:
 * - ...
 * ```
 *
 * Only categories with at least one entry are included.
 * MR-002: Replaces the flat "[category] content" assembly with a grouped format.
 */
export function buildCategoryAwareMemoryText(
  results: MemoryRetrievalResult[]
): CategoryAwareMemoryText {
  // Group by category, preserving retrieval order within each group
  const groups: Record<string, string[]> = {};
  for (const r of results) {
    const cat = r.entry.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(r.entry.content);
  }

  // Build human-readable sections
  const sections: string[] = [];
  const breakdown: Record<string, string[]> = {};

  // Enforce consistent category ordering: instruction > preference > fact > context > others
  const categoryOrder = ["instruction", "preference", "fact", "context"];
  const orderedCats = [
    ...categoryOrder.filter((c) => groups[c]),
    ...Object.keys(groups).filter((c) => !categoryOrder.includes(c)),
  ];

  for (const cat of orderedCats) {
    const label = getCategoryLabel(cat);
    const items = groups[cat];
    breakdown[cat] = items;
    sections.push(`${label}:\n${items.map((item) => `- ${item}`).join("\n")}`);
  }

  return {
    combined: sections.join("\n\n"),
    breakdown,
  };
}

// ── Keyword extraction (MR-003) ─────────────────────────────────────────────

/** English + Chinese common stopwords. Excluded from relevance matching. */
const STOPWORDS = new Set([
  // English
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "up", "about", "into", "over", "after", "beneath", "under",
  "above", "below", "between", "and", "but", "or", "nor", "so", "yet",
  "both", "either", "neither", "not", "only", "own", "same", "than",
  "too", "very", "just", "also", "now", "here", "there", "when", "where",
  "why", "how", "all", "each", "every", "both", "few", "more", "most",
  "other", "some", "such", "no", "any", "as", "if", "then", "because",
  "while", "although", "though", "even", "it", "its", "this", "that",
  "these", "those", "i", "me", "my", "we", "our", "you", "your",
  "he", "him", "his", "she", "her", "they", "them", "their",
  "what", "which", "who", "whom", "whose",
  // Common Chinese particles and function words (high-frequency noise)
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都",
  "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
  "会", "着", "没有", "看", "好", "自己", "这", "那", "他",
]);

/**
 * Extract normalised tokens from a string (MR-003 upgrade).
 *
 * Improvements over v1:
 * - Strips punctuation, lowercases, splits on whitespace
 * - Filters out English and Chinese stopwords
 * - Applies lightweight stemming (simplified Porter suffix stripping)
 * - Minimum token length 2 (after stripping)
 */
function extractTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ") // keep letters + Chinese chars
    .split(/\s+/)
    .map(simpleStem)        // apply lightweight stemming
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Lightweight suffix stemmer — strips common English / Chinese suffixes.
 * Not a real Porter stemmer; intentionally simple to avoid over-stripping.
 */
function simpleStem(word: string): string {
  if (word.length < 3) return word;
  // English suffixes
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ed"))  return word.slice(0, -2);
  if (word.endsWith("es"))  return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  // Chinese common suffix
  if (word.endsWith("的")) return word.slice(0, -1);
  return word;
}

/**
 * MR-003: Compute keyword relevance between userMessage and a memory entry.
 *
 * Returns { score, matchedKeywords, unionSize } for detailed reason building.
 *
 * Scoring model:
 * - Extracts query keywords from userMessage (no external keywords needed)
 * - Compares against entry content + tags (all normalised + stopword-filtered)
 * - Score = Jaccard-normalised overlap to prevent long-text inflation
 * - Max 15 pts (5 matches × 3 pts each, capped at 15)
 * - reason field names exact matched tokens
 */
function computeKeywordRelevance(
  userMessage: string,
  entry: MemoryEntry
): { score: number; matchedKeywords: string[]; unionSize: number } {
  // Extract query tokens from the user message
  const queryTokens = extractTokens(userMessage);
  if (queryTokens.length === 0) {
    return { score: 0, matchedKeywords: [], unionSize: 0 };
  }

  // Build content + tag token set for the entry (deduplicated)
  const contentTokens = extractTokens(entry.content);
  const tagTokens = entry.tags.flatMap(extractTokens);
  const entryTokens = new Set([...contentTokens, ...tagTokens]);

  // Find matching query keywords
  const matchedKeywords = queryTokens.filter((qt) => entryTokens.has(qt));

  // Jaccard normalisation: |intersection| / |union|
  // Prevents long memories from always winning due to sheer token count
  const intersection = matchedKeywords.length;
  const union = new Set([...queryTokens, ...entryTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  // Score: Jaccard × max points, with a per-match floor
  const perMatchBonus = matchedKeywords.length > 0 ? Math.min(matchedKeywords.length * 3, 12) : 0;
  const score = Math.min(15, Math.round(perMatchBonus + jaccard * 3));

  return { score, matchedKeywords, unionSize: union };
}
