// workspace: 20260416214742
/**
 * R1 — E2E Regression Pack: POST /api/chat
 *
 * Tests the chat endpoint request/response contract.
 * All DB/service calls are mocked — no real DB, no real LLM required.
 *
 * CRITICAL: All vi.mock() calls stay at module top level (vitest hoisting requirement).
 * Only the dynamic import of chatRouter lives in beforeAll (after hoisting).
 */


// ── Mocks (vitest HOISTS these to module top — must stay at top level) ────────

vi.mock("../../src/config.js", () => ({
  config: {
    identity: { allowDevFallback: true },
    fastModel: "gpt-4o-mini",
    slowModel: "gpt-4o",
    openaiApiKey: "mock-key",
    openaiBaseUrl: "",
    anthropicApiKey: "",
    routerConfidenceThreshold: 0.75,
    qualityGateEnabled: true,
    fallbackEnabled: true,
    memory: {
      enabled: false,
      maxEntriesToInject: 5,
      maxTokensPerEntry: 150,
      retrieval: { strategy: "v1" as const, categoryPolicy: {} },
    },
    executionResult: { enabled: false, maxResults: 3, maxTokensPerResult: 200, allowedReasons: ["completed"] },
    webSearch: { endpoint: "", apiKey: "", maxResults: 5 },
    guardrail: { enabled: true, httpAllowlist: [], blockedHeaders: [], httpTimeoutMs: 10000, httpMaxResponseBytes: 1048576 },
    databaseUrl: "postgresql://mock/mock",
    redisUrl: "redis://mock",
  },
  MODEL_PRICING: {},
  GROWTH_LEVELS: [],
}));

vi.mock("../../src/db/repositories", () => ({
  DecisionRepo: {
    getById: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    getRecent: vi.fn().mockResolvedValue([]),
    updateFeedback: vi.fn().mockResolvedValue(undefined),
    getTodayStats: vi.fn().mockResolvedValue({
      total_requests: 0, fast_count: 0, slow_count: 0, fallback_count: 0,
      total_tokens: 0, total_cost: 0, saved_cost: 0, avg_latency: 0, satisfaction_rate: 0,
    }),
    getRoutingAccuracyHistory: vi.fn().mockResolvedValue([]),
  },
  FeedbackEventRepo: {
    save: vi.fn().mockResolvedValue(undefined),
    getByDecisionIds: vi.fn().mockResolvedValue(new Map()),
  },
  MemoryRepo: {
    getIdentity: vi.fn().mockResolvedValue(null),
    upsertIdentity: vi.fn().mockResolvedValue(undefined),
    getBehavioralMemories: vi.fn().mockResolvedValue([]),
    saveBehavioralMemory: vi.fn().mockResolvedValue(undefined),
    reinforceMemory: vi.fn().mockResolvedValue(undefined),
    decayMemories: vi.fn().mockResolvedValue(undefined),
  },
  TaskRepo: {
    list: vi.fn().mockResolvedValue([]),
    getById: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(undefined),
    findActiveBySession: vi.fn().mockResolvedValue(null),
    setStatus: vi.fn().mockResolvedValue(undefined),
    updateExecution: vi.fn().mockResolvedValue(undefined),
    getSummary: vi.fn().mockResolvedValue(null),
    getTraces: vi.fn().mockResolvedValue([]),
    createTrace: vi.fn().mockResolvedValue(undefined),
  },
  GrowthRepo: {
    getProfile: vi.fn().mockResolvedValue({
      user_id: "test-user", level: 1, level_name: "初次见面",
      level_progress: 0, routing_accuracy: 0, satisfaction_history: [],
      cost_saving_rate: 0, total_saved_usd: 0, satisfaction_rate: 0,
      total_interactions: 0, behavioral_memories_count: 0,
      milestones: [], recent_learnings: [],
    }),
    addMilestone: vi.fn().mockResolvedValue(undefined),
  },
  EvidenceRepo: {
    create: vi.fn(), getById: vi.fn(),
    listByTask: vi.fn(), listByUser: vi.fn(),
  },
  MemoryEntryRepo: {
    add: vi.fn().mockResolvedValue(undefined),
    findRelevant: vi.fn().mockResolvedValue([]),
    listByCategory: vi.fn().mockResolvedValue([]),
  },
  ExecutionResultRepo: {
    add: vi.fn().mockResolvedValue(undefined),
    getByTask: vi.fn().mockResolvedValue([]),
  },
  DelegationArchiveRepo: {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    listActive: vi.fn().mockResolvedValue([]),
    markDone: vi.fn().mockResolvedValue(undefined),
    hasPending: vi.fn().mockResolvedValue(false),
  },
  TaskArchiveRepo: {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../src/router/router.js", () => ({
  analyzeAndRoute: vi.fn().mockResolvedValue({
    features: {
      raw_query: "hello world",
      token_count: 2,
      intent: "chat",
      complexity_score: 0.1,
      has_code: false,
      has_math: false,
      requires_reasoning: false,
      conversation_depth: 0,
      context_token_count: 0,
      language: "en",
    },
    routing: {
      router_version: "v1",
      scores: { fast: 0.9, slow: 0.3 },
      confidence: 0.9,
      selected_model: "gpt-4o-mini",
      selected_role: "fast",
      selection_reason: "test",
      fallback_model: "gpt-4o",
    },
  }),
  getDefaultRouting: vi.fn().mockReturnValue({
    router_version: "llm_native_v0.4",
    scores: { fast: 0, slow: 0 },
    confidence: 0,
    selected_model: "",
    selected_role: "fast",
    selection_reason: "llm_native_routing",
    fallback_model: "",
  }),
}));

vi.mock("../../src/services/context-manager.js", () => ({
  manageContext: vi.fn().mockResolvedValue({
    original_tokens: 10,
    compressed_tokens: 10,
    compression_level: "L0",
    compression_ratio: 1,
    memory_items_retrieved: 0,
    final_messages: [{ role: "user", content: "hello" }],
    compression_details: [],
  }),
}));

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull: vi.fn().mockResolvedValue({
    content: "Hello from mock model",
    inputTokens: 5,
    outputTokens: 6,
    costUsd: 0.00001,
    latencyMs: 50,
  }),
}));

vi.mock("../../src/models/providers/openai.js", () => ({
  callOpenAIWithOptions: vi.fn().mockResolvedValue({
    content: "Hello from mock model",
    inputTokens: 5,
    outputTokens: 6,
    costUsd: 0.00001,
    latencyMs: 50,
  }),
}));

vi.mock("../../src/router/quality-gate.js", () => ({
  checkQuality: vi.fn().mockReturnValue({ passed: true, score: 0.9, issues: [] }),
}));

vi.mock("../../src/logging/decision-logger.js", () => ({
  logDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/learning-engine.js", () => ({
  learnFromInteraction: vi.fn().mockResolvedValue({
    new_memory: null, milestones: [], implicit_feedback: null,
  }),
}));

vi.mock("../../src/services/prompt-assembler.js", () => ({
  assemblePrompt: vi.fn().mockReturnValue({
    systemPrompt: "mock system prompt",
    userMessage: "",
    format: { role: "user", content: "mock formatted content" },
  }),
}));

vi.mock("../../src/services/memory-retrieval.js", () => ({
  runRetrievalPipeline: vi.fn().mockResolvedValue([]),
  buildCategoryAwareMemoryText: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/services/execution-result-formatter.js", () => ({
  formatExecutionResultsForPlanner: vi.fn().mockReturnValue(""),
}));

vi.mock("../../src/services/task-planner.js", () => ({ taskPlanner: {} }));
vi.mock("../../src/services/execution-loop.js", () => ({ executionLoop: {} }));

// O-001 / Phase 2.0: orchestrator — 必须 mock，否则 chat.ts 加载时 orchestrator.ts
// 导入 DelegationArchiveRepo/TaskArchiveRepo/toolExecutor/FAST_MODEL_TOOLS 全部失败
vi.mock("../../src/services/orchestrator.js", () => ({
  orchestrator: vi.fn().mockResolvedValue({
    fast_reply: "Hello from mock orchestrator",
    routing_info: { delegated: false },
  }),
  getDelegationResult: vi.fn().mockResolvedValue(null),
  pollArchiveAndYield: vi.fn(),
  evaluateRouting: vi.fn().mockReturnValue({
    routing_intent: "chat",
    selected_role: "fast",
    confidence: 0.9,
  }),
  inferRoutingLayer: vi.fn().mockReturnValue("L0"),
}));

// O-008: weather-search — 必须 mock，否则 weather-search.ts 导入失败
vi.mock("../../src/services/weather-search.js", () => ({
  detectWeatherQuery: vi.fn().mockReturnValue(false),
  fetchRealTimeWeather: vi.fn().mockRejectedValue(new Error("weather not mocked")),
  formatWeatherPrompt: vi.fn().mockReturnValue(""),
}));

// Phase 2.0: fast-model-tools — orchestrator 依赖
vi.mock("../../src/services/fast-model-tools.js", () => ({
  FAST_MODEL_TOOLS: [],
}));

// EL-001: tool executor — orchestrator 依赖
vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: vi.fn().mockResolvedValue({ success: true, result: {} }),
}));

// ── Test app builder (dynamic import AFTER mocks are hoisted) ─────────────────

let _chatRouter: any = null;

beforeAll(async () => {
  // Dynamic import ensures chatRouter is loaded with all vi.mock factories already active
  const { chatRouter } = await import("../../src/api/chat.js");
  _chatRouter = chatRouter;
});

async function buildApp() {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    c.set("userId", "test-user");
    await next();
  });
  app.route("/api", _chatRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/chat — R1 E2E Regression Pack", () => {

  it("正常请求 → 200，响应含 message / task_id / routing", async () => {
    const app = await buildApp();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ user_id: "test-user", session_id: "s1", message: "hello", history: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("message");
    expect(typeof body.message).toBe("string");
    expect(body).toHaveProperty("decision");
    expect(body).toHaveProperty("task_id");
    expect(typeof body.task_id).toBe("string");
    expect(body.decision).toHaveProperty("routing");
  });

  it("缺少 message 字段 → 200（下游 analyzeAndRoute 有默认值）", async () => {
    const app = await buildApp();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ user_id: "test-user", session_id: "s1", history: [] }),
    });
    expect(res.status).toBe(200);
  });

  it("无身份（无 X-User-Id）→ dev fallback body.user_id 被接受 → 200", async () => {
    const app = await buildApp();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: "fallback-user", session_id: "s1", message: "hello", history: [] }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("message");
  });

  it("task_id 归属校验失败（task 属于别的用户）→ 403", async () => {
    const { TaskRepo } = await import("../../src/db/repositories");
    vi.mocked(TaskRepo.getById).mockResolvedValueOnce({
      task_id: "task-999",
      user_id: "other-user",
      session_id: "s1",
      title: "Other task",
      mode: "direct" as const,
      status: "running" as const,
      complexity: "low" as const,
      risk: "low" as const,
      goal: null,
      budget_profile: {},
      tokens_used: 0,
      tool_calls_used: 0,
      steps_used: 0,
      summary_ref: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const app = await buildApp();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({
        user_id: "test-user",
        session_id: "s1",
        message: "hello",
        history: [],
        task_id: "task-999",
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body).toHaveProperty("error");
    expect(body.error).toContain("Forbidden");
  });
});
