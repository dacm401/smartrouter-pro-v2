/**
 * ET-002: chat.ts execute path integration tests
 *
 * Tests the orchestration logic in the `body.execute === true` branch of
 * chatRouter.post("/chat").  Target: the route layer — not planner internals,
 * not execution-loop internals, not the database.
 *
 * Mock strategy (same as execution-loop.test.ts):
 *   vi.hoisted() defines mutable refs at module level
 *   vi.mock() factory injects those refs as the module implementation
 *   Each test mutates the refs to control the mock's behaviour
 *
 * Modules mocked (all external collaborators):
 *   TaskRepo, MemoryEntryRepo, ExecutionResultRepo,
 *   taskPlanner, executionLoop, formatExecutionResultsForPlanner, config
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock factory refs (hoisted, populated before vi.mock) ───────────────────

// taskPlanner is exported as `new TaskPlanner()` — an instance, not a plain fn
const mockPlan = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    taskId: "mock-task-id",
    steps: [
      {
        id: "step-1",
        title: "Mock Step",
        type: "tool_call" as const,
        tool_name: "mock_tool",
        depends_on: [],
        status: "pending" as const,
      },
    ],
    currentStepIndex: 0,
  })
);

const mockTaskPlanner = vi.hoisted(() => ({
  plan: mockPlan,
}));

// executionLoop is exported as `new ExecutionLoop()` — an instance, not a plain fn
const mockLoopRun = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    finalContent: "✅ Mock execution completed.",
    reason: "completed" as const,
    completedSteps: 1,
    toolCallsExecuted: 2,
    messages: [{ role: "assistant", content: "✅ Mock execution completed." }],
  })
);

const mockExecutionLoop = vi.hoisted(() => ({
  run: mockLoopRun,
}));

const mockTaskRepo = vi.hoisted(() => ({
  create: vi.fn().mockResolvedValue(undefined),
  createTrace: vi.fn().mockResolvedValue(undefined),
  updateExecution: vi.fn().mockResolvedValue(undefined),
  findActiveBySession: vi.fn().mockResolvedValue(null),
  getById: vi.fn().mockResolvedValue(null),
  setStatus: vi.fn().mockResolvedValue(undefined),
  list: vi.fn().mockResolvedValue([]),
}));

const mockMemoryEntryRepo = vi.hoisted(() => ({
  getTopForUser: vi.fn().mockResolvedValue([
    { id: "mem-1", content: "User prefers dark mode." },
    { id: "mem-2", content: "Always start with memory retrieval." },
  ]),
}));

const mockExecutionResultRepo = vi.hoisted(() => ({
  listByUser: vi.fn().mockResolvedValue([]),
  save: vi.fn().mockResolvedValue(undefined),
}));

const mockFormatExecutionResultsForPlanner = vi.hoisted(() =>
  vi.fn().mockReturnValue("")
);

// ── ET-003: mutable executionResult config for per-test overrides ─────────────
// Placed here (hoisted = evaluated before any vi.mock) so the mock factory
// below can capture a live reference.  Tests call
//   vi.mocked(mockExecutionResultConfig).enabled = false
// to flip the kill switch for that test only; vi.fn().mockReset() in
// beforeEach ensures no cross-test pollution.
const mockExecutionResultConfig = {
  enabled: true,
  maxResults: 10,
  maxTokensPerResult: 200,
  allowedReasons: ["completed", "step_cap", "tool_cap", "no_progress"],
};

const mockConfig = {
  identity: { allowDevFallback: true },
  memory: { enabled: true, maxEntriesToInject: 5 },
  executionResult: mockExecutionResultConfig,
};

// ── Module under test ────────────────────────────────────────────────────────

// ── Additional mocks: prevent module-level side-effects from chat.ts imports ──
// chat.ts top-level imports include callOpenAIWithOptions (new OpenAI() at module
// scope), which throws before our vi.mock factories can apply.  Mocking these
// modules is safe because the execute path never calls them.

vi.mock("../../src/models/providers/openai.js", () => ({
  callOpenAIWithOptions: vi.fn(),
}));

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelFull: vi.fn(),
}));

vi.mock("../../src/router/router.js", () => ({
  analyzeAndRoute: vi.fn().mockResolvedValue({
    features: { intent: "unknown", complexity_score: 50 },
    routing: {
      selected_model: "gpt-4o",
      selected_role: "slow" as const,
      fallback_model: "gpt-4o",
      confidence: 0.8,
    },
  }),
}));

vi.mock("../../src/services/context-manager.js", () => ({
  manageContext: vi.fn().mockResolvedValue({ final_messages: [] }),
}));

vi.mock("../../src/router/quality-gate.js", () => ({
  checkQuality: vi.fn().mockReturnValue({ passed: true, issues: [] }),
}));

vi.mock("../../src/logging/decision-logger.js", () => ({
  logDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/learning-engine.js", () => ({
  learnFromInteraction: vi.fn().mockResolvedValue({
    new_memory: null,
    milestones: [],
    implicit_feedback: null,
  }),
}));

vi.mock("../../src/logging/decision-logger.js", () => ({
  logDecision: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/features/learning-engine.js", () => ({
  learnFromInteraction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/models/token-counter.js", () => ({
  estimateCost: vi.fn().mockReturnValue(0),
}));

vi.mock("../../src/services/prompt-assembler.js", () => ({
  assemblePrompt: vi.fn().mockReturnValue({
    systemPrompt: "You are a helpful assistant.",
    userMessage: "",
    format: { role: "user", content: "formatted" },
  }),
}));

vi.mock("../../src/services/prompt-assembler.js", () => ({
  assemblePrompt: vi.fn().mockReturnValue({
    systemPrompt: "You are a helpful assistant.",
    userMessage: "",
  }),
}));

vi.mock("../../src/services/memory-retrieval.js", () => ({
  runRetrievalPipeline: vi.fn().mockReturnValue([]),
  buildCategoryAwareMemoryText: vi.fn().mockReturnValue(""),
}));

// ── Core mocks ────────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories.js", () => ({
  DecisionRepo: {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
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
  GrowthRepo: {
    getProfile: vi.fn().mockResolvedValue({
      user_id: "user-1", level: 1, level_name: "初次见面",
      level_progress: 0, routing_accuracy: 0, satisfaction_history: [],
      cost_saving_rate: 0, total_saved_usd: 0, satisfaction_rate: 0,
      total_interactions: 0, behavioral_memories_count: 0,
      milestones: [], recent_learnings: [],
    }),
    addMilestone: vi.fn().mockResolvedValue(undefined),
  },
  TaskRepo: mockTaskRepo,
  MemoryEntryRepo: mockMemoryEntryRepo,
  ExecutionResultRepo: mockExecutionResultRepo,
  EvidenceRepo: {
    create: vi.fn(), getById: vi.fn(),
    listByTask: vi.fn().mockResolvedValue([]), listByUser: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../src/services/task-planner.js", () => ({
  taskPlanner: mockTaskPlanner,
}));

vi.mock("../../src/services/execution-loop.js", () => ({
  executionLoop: mockExecutionLoop,
}));

vi.mock("../../src/services/execution-result-formatter.js", () => ({
  formatExecutionResultsForPlanner: mockFormatExecutionResultsForPlanner,
}));

vi.mock("../../src/config.js", () => ({
  config: mockConfig,
}));

// Hono router test client
async function POSTChat(body: Record<string, unknown>) {
  const { chatRouter } = await import("../../src/api/chat.js");
  const app = new (await import("hono")).Hono().route("/api", chatRouter);
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/chat – execute mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("runs the full execute orchestration path", async () => {
    const res = await POSTChat({
      message: "帮我完成这个任务",
      execute: true,
      user_id: "user-1",
      session_id: "sess-1",
    });

    expect(res.status).toBe(200);
    const json = await res.json<{ message: string }>();
    expect(json.message).toBe("✅ Mock execution completed.");

    // Task record created
    expect(mockTaskRepo.create).toHaveBeenCalledOnce();
    expect(mockTaskRepo.create.mock.calls[0][0].mode).toBe("execute");

    // Memory retrieval called (config.memory.enabled === true)
    expect(mockMemoryEntryRepo.getTopForUser).toHaveBeenCalledWith("user-1", 5);

    // Execution result retrieval called (config.executionResult.enabled === true)
    expect(mockExecutionResultRepo.listByUser).toHaveBeenCalledWith("user-1", 10);

    // Planner called with goal and executionResultContext
    expect(mockPlan).toHaveBeenCalledOnce();
    const planCall = mockPlan.mock.calls[0][0];
    expect(planCall.goal).toBe("帮我完成这个任务");
    expect(typeof planCall.executionResultContext).toBe("string");

    // Execution loop called with the plan
    expect(mockLoopRun).toHaveBeenCalledOnce();

    // Execution result saved (reason = completed is in persistableReasons)
    expect(mockExecutionResultRepo.save).toHaveBeenCalledOnce();
    const saveCall = mockExecutionResultRepo.save.mock.calls[0][0];
    expect(saveCall.reason).toBe("completed");
    expect(saveCall.final_content).toBe("✅ Mock execution completed.");
    expect(saveCall.user_id).toBe("user-1");
  });

  // ── persistableReasons filter ────────────────────────────────────────────────

  const persistableCases: Array<{ reason: string; shouldSave: boolean }> = [
    { reason: "completed", shouldSave: true },
    { reason: "step_cap", shouldSave: true },
    { reason: "tool_cap", shouldSave: true },
    { reason: "no_progress", shouldSave: true },
  ];

  for (const { reason, shouldSave } of persistableCases) {
    it(`[${reason}] ${shouldSave ? "saves" : "does NOT save"} the execution result`, async () => {
      mockLoopRun.mockResolvedValueOnce({
        finalContent: "Result content",
        reason: reason as "completed" | "step_cap" | "tool_cap" | "no_progress",
        completedSteps: 1,
        toolCallsExecuted: 1,
        messages: [],
      });

      const res = await POSTChat({ message: "test", execute: true });
      expect(res.status).toBe(200);

      if (shouldSave) {
        expect(mockExecutionResultRepo.save).toHaveBeenCalledOnce();
      } else {
        expect(mockExecutionResultRepo.save).not.toHaveBeenCalled();
      }
    });
  }

  it("does NOT persist execution result when reason is error", async () => {
    mockLoopRun.mockResolvedValueOnce({
      finalContent: "Failed.",
      reason: "error" as const,
      completedSteps: 0,
      toolCallsExecuted: 0,
      messages: [],
    });

    const res = await POSTChat({ message: "test", execute: true });
    expect(res.status).toBe(200);

    expect(mockExecutionResultRepo.save).not.toHaveBeenCalled();
  });

  // ── Fire-and-forget ─────────────────────────────────────────────────────────

  it("returns 200 and propagates finalContent when ExecutionResultRepo.save() rejects", async () => {
    mockExecutionResultRepo.save.mockRejectedValueOnce(
      new Error("DB connection failed")
    );

    const res = await POSTChat({ message: "test", execute: true });
    expect(res.status).toBe(200);

    const json = await res.json<{ message: string }>();
    // The response must still contain the loop result even though save() threw.
    expect(json.message).toBe("✅ Mock execution completed.");
  });

  it("still calls executionLoop even when ExecutionResultRepo.save() rejects", async () => {
    mockExecutionResultRepo.save.mockRejectedValueOnce(
      new Error("DB down")
    );

    const res = await POSTChat({ message: "test", execute: true });
    expect(res.status).toBe(200);
    expect(mockLoopRun).toHaveBeenCalledOnce();
  });

  // ── Execution result injection ────────────────────────────────────────────

  it("injects execution result context into planner when enabled", async () => {
    const storedResult = {
      id: "er-1",
      task_id: "old-task",
      user_id: "user-1",
      session_id: "sess-old",
      reason: "completed" as const,
      final_content: "Previous successful run",
      created_at: new Date(),
    };
    mockExecutionResultRepo.listByUser.mockResolvedValueOnce([storedResult]);
    mockFormatExecutionResultsForPlanner.mockReturnValueOnce(
      "[Execution Result]\nPrevious successful run\n"
    );

    const res = await POSTChat({ message: "Continue the work", execute: true, user_id: "user-1" });
    expect(res.status).toBe(200);

    // Repository called
    expect(mockExecutionResultRepo.listByUser).toHaveBeenCalledWith("user-1", 10);

    // Formatter called with the stored result
    expect(mockFormatExecutionResultsForPlanner).toHaveBeenCalledOnce();
    expect(mockFormatExecutionResultsForPlanner.mock.calls[0][0]).toEqual([
      storedResult,
    ]);

    // Planner received the formatted context
    const planCall = mockPlan.mock.calls[0][0];
    expect(planCall.executionResultContext).toContain("Previous successful run");
  });

  // ── Response shape ───────────────────────────────────────────────────────────

  it("returns { message: string } and does not leak internal details", async () => {
    const res = await POSTChat({ message: "test", execute: true });
    expect(res.status).toBe(200);

    const json = await res.json<{ message?: string; error?: string }>();
    // Only message should be present; no internal error fields
    expect(json).toHaveProperty("message");
    expect(json).not.toHaveProperty("error");
  });

  it("uses default user_id and session_id when not provided", async () => {
    const res = await POSTChat({ message: "test", execute: true });
    expect(res.status).toBe(200);

    // Should have used "default-user" for user_id
    expect(mockMemoryEntryRepo.getTopForUser).toHaveBeenCalledWith("default-user", 5);
    expect(mockExecutionResultRepo.listByUser).toHaveBeenCalledWith("default-user", 10);

    // Planner should also receive the default user_id
    const planCall = mockPlan.mock.calls[0][0];
    expect(planCall.userId).toBe("default-user");
  });
});

// ── ET-003: Kill switch / config gating ─────────────────────────────────────
//
// Tests that the execution result retrieval + injection pathway is fully gated
// by config.executionResult.enabled — the kill switch that lets operators
// disable this entire feature without touching code.

describe("execute mode — executionResult kill switch", () => {
  beforeEach(() => {
    // vi.clearAllMocks() wipes call counts but keeps the base implementation.
    // We override the mocks that happy-path tests touch with mockResolvedValueOnce
    // so their queues are cleared and the hoisted default implementations apply.
    vi.clearAllMocks();
    mockExecutionResultConfig.enabled = true;

    // Re-assign the base implementation to clear any queued mockResolvedValueOnce
    // values from the happy-path tests; this forces the mock to return the
    // hoisted default again.
    mockPlan.mockImplementation(() =>
      Promise.resolve({
        taskId: "mock-task-id",
        steps: [
          {
            id: "step-1",
            title: "Mock Step",
            type: "tool_call" as const,
            tool_name: "mock_tool",
            depends_on: [],
            status: "pending" as const,
          },
        ],
        currentStepIndex: 0,
      })
    );
    mockLoopRun.mockImplementation(() =>
      Promise.resolve({
        finalContent: "✅ Mock execution completed.",
        reason: "completed" as const,
        completedSteps: 1,
        toolCallsExecuted: 2,
        messages: [{ role: "assistant", content: "✅ Mock execution completed." }],
      })
    );
    mockMemoryEntryRepo.getTopForUser.mockImplementation(() =>
      Promise.resolve([
        { id: "mem-1", content: "User prefers dark mode." },
        { id: "mem-2", content: "Always start with memory retrieval." },
      ])
    );
    mockTaskRepo.create.mockImplementation(() => Promise.resolve(undefined));
    mockTaskRepo.createTrace.mockImplementation(() => Promise.resolve(undefined));
    mockTaskRepo.updateExecution.mockImplementation(() => Promise.resolve(undefined));
  });

  it("skips retrieval and injection when config.executionResult.enabled is false", async () => {
    // Arrange: kill switch OFF — mutating the shared ref is safe because
    // beforeEach resets it before every test.
    mockExecutionResultConfig.enabled = false;

    // Act
    const res = await POSTChat({ message: "test", execute: true, user_id: "user-kill" });

    // Assert — happy path still works
    expect(res.status).toBe(200);
    const json = await res.json<{ message?: string }>();
    expect(json.message).toBe("✅ Mock execution completed.");

    // Retrieval layer NOT called
    expect(mockExecutionResultRepo.listByUser).not.toHaveBeenCalled();

    // Formatter NOT called
    expect(mockFormatExecutionResultsForPlanner).not.toHaveBeenCalled();

    // Planner still called (main chain intact)
    expect(mockPlan).toHaveBeenCalledOnce();

    // Planner received empty executionResultContext (disabled → "" stays empty)
    const planCall = mockPlan.mock.calls[0][0];
    expect(planCall.executionResultContext).toBe("");
  });

  it("returns 200 and does not block response when listByUser throws", async () => {
    // Arrange: listByUser throws — simulate DB failure during retrieval
    mockExecutionResultRepo.listByUser.mockRejectedValueOnce(
      new Error("Connection refused")
    );

    // Act
    const res = await POSTChat({ message: "test", execute: true });

    // Assert — main response is unaffected
    expect(res.status).toBe(200);
    const json = await res.json<{ message?: string }>();
    expect(json.message).toBe("✅ Mock execution completed.");

    // Execution loop still ran
    expect(mockLoopRun).toHaveBeenCalledOnce();

    // Planner received empty context (retrieval failed silently → stays "")
    const planCall = mockPlan.mock.calls[0][0];
    expect(planCall.executionResultContext).toBe("");
  });

  it("returns 200 and does not block response when formatter throws", async () => {
    // Arrange: formatter throws — should not propagate to user
    mockFormatExecutionResultsForPlanner.mockImplementationOnce(() => {
      throw new Error("Unexpected parse error");
    });

    // Act
    const res = await POSTChat({ message: "test", execute: true });

    // Assert — main response is unaffected
    expect(res.status).toBe(200);
    const json = await res.json<{ message?: string }>();
    expect(json.message).toBe("✅ Mock execution completed.");

    // Execution loop still ran
    expect(mockLoopRun).toHaveBeenCalledOnce();

    // Planner received empty context (formatter failed before injection)
    const planCall2 = mockPlan.mock.calls[0][0];
    expect(planCall2.executionResultContext).toBe("");
  });
});
