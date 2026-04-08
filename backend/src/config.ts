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
