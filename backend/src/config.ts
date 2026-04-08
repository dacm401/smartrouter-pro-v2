import type { ModelPricing } from "./types/index.js";

export const config = {
  port: parseInt(process.env.BACKEND_PORT || "3001"),
  fastModel: process.env.FAST_MODEL || "gpt-4o-mini",
  slowModel: process.env.SLOW_MODEL || "gpt-4o",
  compressorModel: process.env.COMPRESSOR_MODEL || "gpt-4o-mini",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  routerConfidenceThreshold: parseFloat(process.env.ROUTER_CONFIDENCE_THRESHOLD || "0.75"),
  qualityGateEnabled: process.env.QUALITY_GATE_ENABLED !== "false",
  fallbackEnabled: process.env.FALLBACK_ENABLED !== "false",
  tokenBudget: {
    systemPromptRatio: 0.15,
    memoryRatio: 0.10,
    historyRatio: 0.45,
    inputRatio: 0.15,
    outputReserveRatio: 0.15,
  },
  databaseUrl: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/smartrouter",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  memory: {
    maxEntriesToInject: 5,
    maxTokensPerEntry: 150,
    enabled: process.env.MEMORY_INJECTION_ENABLED !== "false",
    // MR-001: retrieval policy
    retrieval: {
      // "v1": use importance+recency only (legacy behavior, feature-flag safe)
      // "v2": use category-aware scoring pipeline
      strategy: (process.env.MEMORY_RETRIEVAL_STRATEGY as "v1" | "v2") || "v1",
      // Per-category injection policies (only used in v2)
      categoryPolicy: {
        // goal / constraint: always inject high-importance entries
        instruction: { minImportance: 3, alwaysInject: true, maxCount: 2 },
        // preference: inject if keyword relevance is sufficient
        preference: { minImportance: 4, alwaysInject: false, maxCount: 2 },
        // fact / context: only inject in high-relevance situations
        fact: { minImportance: 4, alwaysInject: false, maxCount: 1 },
        context: { minImportance: 4, alwaysInject: false, maxCount: 1 },
      },
    },
  },

  // RR-001: Execution Result Retrieval and Injection
  executionResult: {
    enabled: process.env.EXECUTION_RESULT_INJECTION_ENABLED !== "false",
    maxResults: parseInt(process.env.EXECUTION_RESULT_MAX_RESULTS || "3"),
    maxTokensPerResult: parseInt(process.env.EXECUTION_RESULT_MAX_TOKENS || "200"),
    // Only inject results that terminated in these reasons (completed / step_cap / tool_cap / no_progress)
    allowedReasons: (process.env.EXECUTION_RESULT_ALLOWED_REASONS
      ? process.env.EXECUTION_RESULT_ALLOWED_REASONS.split(",")
      : ["completed"]),
  },

  // EL-004: External tool guardrail
  guardrail: {
    // Hosts permitted for http_request tool. Empty = all hosts blocked (fail-safe).
    httpAllowlist: (() => {
      const env = process.env.HTTP_ALLOWLIST || "";
      return env ? env.split(",").map((h) => h.trim().toLowerCase()) : [];
    })(),
    // Headers that must not be forwarded in http_request calls
    blockedHeaders: ["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"],
    // Whether external tool guardrail is enabled (kill switch)
    enabled: process.env.GUARDRAIL_ENABLED !== "false",
    // Timeout for http_request calls in ms
    httpTimeoutMs: parseInt(process.env.HTTP_TIMEOUT_MS || "10000"),
    // Max response size for http_request in bytes
    httpMaxResponseBytes: parseInt(process.env.HTTP_MAX_RESPONSE_BYTES || "1048576"), // 1 MB
  },
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI 官方
  "gpt-4o-mini": { model: "gpt-4o-mini", input_per_1k: 0.00015, output_per_1k: 0.0006 },
  "gpt-4o": { model: "gpt-4o", input_per_1k: 0.0025, output_per_1k: 0.01 },
  "claude-3-5-sonnet-20241022": { model: "claude-3-5-sonnet-20241022", input_per_1k: 0.003, output_per_1k: 0.015 },
  "claude-3-5-haiku-20241022": { model: "claude-3-5-haiku-20241022", input_per_1k: 0.0008, output_per_1k: 0.004 },
  // 硅基流动 (SiliconFlow) - 价格单位 USD/1k tokens（按官网 CNY 折算约 7.2）
  "Qwen/Qwen2.5-7B-Instruct": { model: "Qwen/Qwen2.5-7B-Instruct", input_per_1k: 0.0000972, output_per_1k: 0.0000972 },
  "Qwen/Qwen2.5-72B-Instruct": { model: "Qwen/Qwen2.5-72B-Instruct", input_per_1k: 0.000972, output_per_1k: 0.000972 },
  "deepseek-ai/DeepSeek-V3": { model: "deepseek-ai/DeepSeek-V3", input_per_1k: 0.000194, output_per_1k: 0.000972 },
  "deepseek-ai/DeepSeek-R1": { model: "deepseek-ai/DeepSeek-R1", input_per_1k: 0.000556, output_per_1k: 0.00222 },
  "deepseek-ai/DeepSeek-V2.5": { model: "deepseek-ai/DeepSeek-V2.5", input_per_1k: 0.000194, output_per_1k: 0.000972 },
};

export const GROWTH_LEVELS = [
  { level: 1, name: "初次见面", min_interactions: 0 },
  { level: 2, name: "开始了解", min_interactions: 20 },
  { level: 3, name: "逐渐熟悉", min_interactions: 50 },
  { level: 4, name: "有点默契", min_interactions: 100 },
  { level: 5, name: "配合顺畅", min_interactions: 200 },
  { level: 6, name: "默契搭档", min_interactions: 500 },
  { level: 7, name: "深度理解", min_interactions: 1000 },
  { level: 8, name: "心有灵犀", min_interactions: 2000 },
  { level: 9, name: "如臂使指", min_interactions: 5000 },
  { level: 10, name: "天人合一", min_interactions: 10000 },
];
