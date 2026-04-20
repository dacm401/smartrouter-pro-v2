// workspace: 20260416214742
/**
 * TA-001: ExecutionLoop Unit Tests
 *
 * Mock strategy (vitest v4 + ESM):
 * - vi.hoisted() with an object pattern: returns a stable object containing vi.fn()
 *   instances, which are passed into vi.mock() factories.
 * - Tests access the shared mock functions via the hoisted object reference.
 */

import type { ExecutionPlan, ExecutionStep } from "../../src/types/index.js";

// ── Shared mock references (hoisted so vi.mock factories can reference them) ─

const callModelWithTools = vi.hoisted(() => vi.fn<any>());
const callModelFull = vi.hoisted(() => vi.fn<any>());
const taskRepoCreateTrace = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));

// Returns an object so the execute fn can be accessed directly in tests
const toolExecutorExecute = vi.hoisted(() => vi.fn<any>());

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelWithTools,
  callModelFull,
}));

vi.mock("../../src/tools/registry.js", () => ({
  toolRegistry: {
    getFunctionCallingSchemas: vi.fn(() => []),
  },
}));

vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: {
    execute: (...args: Parameters<ReturnType<typeof toolExecutorExecute>>) =>
      toolExecutorExecute(...args),
  },
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: {
    createTrace: taskRepoCreateTrace,
  },
}));

// ── Import module under test ─────────────────────────────────────────────────

const { ExecutionLoop } = await import("../../src/services/execution-loop.js");

// ── Mock factory helpers ────────────────────────────────────────────────────

function makeMockModelResponse(content: string, toolCalls?: any[]): any {
  return { content, tool_calls: toolCalls ?? [] };
}

function makeToolCall(id: string, name: string, args: Record<string, unknown>) {
  return { id, function: { name, arguments: JSON.stringify(args) } };
}

// ── Test plan builders ───────────────────────────────────────────────────────

function makePlan(steps: Partial<ExecutionStep>[]): ExecutionPlan {
  return {
    task_id: "test-task-1",
    current_step_index: 0,
    steps: steps.map((s, i) => ({
      id: s.id ?? `step-${i}`,
      title: s.title ?? `Step ${i}`,
      type: s.type ?? "reasoning",
      tool_name: s.tool_name,
      tool_args: s.tool_args,
      depends_on: s.depends_on ?? [],
      status: "pending",
      ...s,
    })) as ExecutionStep[],
  };
}

function makeCtx(overrides: Partial<{
  taskId: string;
  userId: string;
  sessionId: string;
  maxSteps: number;
  maxToolCalls: number;
  model?: string;
}> = {}): {
  taskId: string;
  userId: string;
  sessionId: string;
  maxSteps: number;
  maxToolCalls: number;
  model?: string;
} {
  return {
    taskId: "test-task-1",
    userId: "test-user",
    sessionId: "test-session",
    maxSteps: 10,
    maxToolCalls: 20,
    model: "gpt-4o",
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ExecutionLoop", () => {
  beforeEach(() => {
    // DIAGNOSTIC: verify the mock function is a proper Vitest Mock
    const isMockFn = typeof toolExecutorExecute.mock === "object";
    if (!isMockFn) {
      console.warn("[beforeEach] toolExecutorExecute.mock is", toolExecutorExecute.mock);
    }

    callModelWithTools.mockClear();
    callModelFull.mockClear();
    toolExecutorExecute.mockClear();
    taskRepoCreateTrace.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── TA-001.1: Synthesis step completes with final content ──────────────────

  it("TA-001.1: single synthesis step returns final content", async () => {
    callModelFull.mockResolvedValueOnce(
      makeMockModelResponse("Final answer here.")
    );

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "s1", type: "synthesis" }]),
      makeCtx()
    );

    expect(result.finalContent).toBe("Final answer here.");
    expect(result.completedSteps).toBe(1);
    expect(result.totalSteps).toBe(1);
    expect(result.reason).toBe("completed");
    expect(result.toolCallsExecuted).toBe(0);
  });

  // ── TA-001.2: Reasoning step → synthesis completes in order ────────────────

  it("TA-001.2: reasoning + synthesis steps complete in correct order", async () => {
    callModelFull
      .mockResolvedValueOnce(makeMockModelResponse("Intermediate thought."))
      .mockResolvedValueOnce(makeMockModelResponse("Final synthesized answer."));

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "r1", type: "reasoning" }, { id: "s1", type: "synthesis" }]),
      makeCtx()
    );

    expect(result.completedSteps).toBe(2);
    expect(result.totalSteps).toBe(2);
    expect(result.finalContent).toBe("Final synthesized answer.");
    expect(result.reason).toBe("completed");
    expect(callModelFull).toHaveBeenCalledTimes(2);
  });

  // ── TA-001.3: Tool call step with no tool emissions completes ──────────────

  it("TA-001.3: tool_call step completes when model emits no tool_calls", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("No tools needed for this step.")
    );

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call" }]),
      makeCtx()
    );

    expect(result.completedSteps).toBe(1);
    expect(result.finalContent).toBe("No tools needed for this step.");
    expect(result.reason).toBe("completed");
  });

  // ── TA-001.4: Tool call step executes a tool and appends result ────────────

  it("TA-001.4: tool_call step executes a tool and appends result to messages", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-1", "memory_search", { query: "test" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-1",
      tool_name: "memory_search",
      success: true,
      result: { entries: [] },
      latency_ms: 5,
    });

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call", tool_name: "memory_search" }]),
      makeCtx()
    );

    expect(toolExecutorExecute).toHaveBeenCalledTimes(1);
    expect(toolExecutorExecute).toHaveBeenCalledWith(
      expect.objectContaining({ id: "tc-1", tool_name: "memory_search" }),
      expect.any(Object)
    );
    expect(result.toolCallsExecuted).toBe(1);
    expect(result.reason).toBe("completed");
  });

  // ── TA-001.5: Tool call step with multiple tool emissions ──────────────────

  it("TA-001.5: tool_call step executes multiple tool calls in order", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [
        makeToolCall("tc-1", "memory_search", { query: "first" }),
        makeToolCall("tc-2", "task_read", { task_id: "abc" }),
      ])
    );
    toolExecutorExecute
      .mockResolvedValueOnce({ call_id: "tc-1", tool_name: "memory_search", success: true, result: { entries: [] }, latency_ms: 5 })
      .mockResolvedValueOnce({ call_id: "tc-2", tool_name: "task_read", success: true, result: { task: {} }, latency_ms: 3 });

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call" }]),
      makeCtx()
    );

    expect(toolExecutorExecute).toHaveBeenCalledTimes(2);
    expect(result.toolCallsExecuted).toBe(2);
  });

  // ── TA-001.6: Full pipeline — tool_call → reasoning → synthesis ───────────

  it("TA-001.6: full pipeline runs all three step types in sequence", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-1", "memory_search", { query: "info" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-1", tool_name: "memory_search", success: true,
      result: { entries: [{ id: "1", content: "found" }] }, latency_ms: 5,
    });
    callModelFull
      .mockResolvedValueOnce(makeMockModelResponse("Based on the memory, I should now synthesize."))
      .mockResolvedValueOnce(makeMockModelResponse("Final conclusion based on retrieved memory."));

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "t1", type: "tool_call" },
        { id: "r1", type: "reasoning" },
        { id: "s1", type: "synthesis" },
      ]),
      makeCtx()
    );

    expect(result.completedSteps).toBe(3);
    expect(result.totalSteps).toBe(3);
    expect(result.finalContent).toBe("Final conclusion based on retrieved memory.");
    expect(result.reason).toBe("completed");
    expect(callModelWithTools).toHaveBeenCalledTimes(1);
    expect(callModelFull).toHaveBeenCalledTimes(2);
  });

  // ── TA-001.7: Step cap — loop stops at maxSteps ────────────────────────────

  it("TA-001.7: loop stops early when step count reaches maxSteps", async () => {
    callModelFull.mockResolvedValue(
      makeMockModelResponse("partial")
    );

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "s1", type: "synthesis" },
        { id: "s2", type: "synthesis" },
        { id: "s3", type: "synthesis" },
        { id: "s4", type: "synthesis" },
        { id: "s5", type: "synthesis" },
      ]),
      makeCtx({ maxSteps: 2 })
    );

    expect(result.completedSteps).toBe(2);
    expect(result.reason).toBe("step_cap");
    expect(callModelFull).toHaveBeenCalledTimes(2);
  });

  // ── TA-001.8: Tool cap — loop stops at maxToolCalls ───────────────────────

  it("TA-001.8: loop stops when total tool calls reach maxToolCalls", async () => {
    const plan = makePlan(
      Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, type: "tool_call" as const }))
    );

    callModelWithTools.mockResolvedValue(
      makeMockModelResponse("", [makeToolCall("tc-x", "memory_search", { query: "x" })])
    );
    toolExecutorExecute.mockResolvedValue({
      call_id: "tc-x", tool_name: "memory_search", success: true, result: {}, latency_ms: 5,
    });

    const result = await new ExecutionLoop().run(plan, makeCtx({ maxToolCalls: 3 }));

    // Steps 0, 1, 2 each emit 1 tool call (total=3).
    // After step 2 completes, tool_cap fires (3>=3), abort.
    expect(result.reason).toBe("tool_cap");
    expect(result.completedSteps).toBe(3);
    expect(result.toolCallsExecuted).toBe(3);
  });

  // ── TA-001.9: No-progress abort — 3 consecutive reasoning without tools ─────

  it("TA-001.9: loop aborts after 3 consecutive reasoning steps with no new tool calls", async () => {
    const plan = makePlan(
      Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, type: "reasoning" as const }))
    );
    callModelFull.mockResolvedValue(
      makeMockModelResponse("Just reasoning, no tools.")
    );

    const result = await new ExecutionLoop().run(plan, makeCtx());

    // r0: no_progress=1; r1: no_progress=2; r2: completes, no_progress=3 → fires → abort.
    expect(result.reason).toBe("no_progress");
    expect(result.completedSteps).toBe(3);
    expect(callModelFull).toHaveBeenCalledTimes(3);
  });

  // ── TA-001.9b: No-progress resets when tool_call step emits a tool ─────────

  it("TA-001.9b: no-progress counter resets when tool_call step emits a tool", async () => {
    // r0: no_progress=1; r1: no_progress=2;
    // t1 (tool_call): emits 1 tool → no_progress=0 (RESET);
    // r2: no_progress=1; → no 3-in-a-row → completed.
    callModelFull
      .mockResolvedValueOnce(makeMockModelResponse("thinking..."))
      .mockResolvedValueOnce(makeMockModelResponse("thinking more..."))
      .mockResolvedValueOnce(makeMockModelResponse("after tool reasoning..."));

    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-reset", "memory_search", { query: "reset" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-reset", tool_name: "memory_search", success: true, result: {}, latency_ms: 5,
    });

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "r0", type: "reasoning" },
        { id: "r1", type: "reasoning" },
        { id: "t1", type: "tool_call" },
        { id: "r2", type: "reasoning" },
      ]),
      makeCtx()
    );

    expect(result.reason).toBe("completed");
    expect(result.completedSteps).toBe(4);
  });

  // ── TA-001.10: Step error aborts loop, step status set to failed ──────────

  it("TA-001.10: loop aborts on step error, step status set to failed", async () => {
    const dbError = new Error("Database connection failed");
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-1", "memory_search", { query: "x" })])
    );
    toolExecutorExecute.mockRejectedValueOnce(dbError);

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "t1", type: "tool_call" },
        { id: "t2", type: "tool_call" },
      ]),
      makeCtx()
    );

    // Step t1 failed; loop aborts before reaching t2
    expect(result.reason).toBe("error");
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toContain("Database connection failed");
    expect(result.plan.steps[1].status).toBe("pending");
    expect(toolExecutorExecute).toHaveBeenCalledTimes(1);
  });

  // ── TA-001.11: GuardrailRejection propagates and aborts loop ─────────────

  it("TA-001.11: GuardrailRejection from tool causes loop abort via step catch", async () => {
    class GuardrailRejection extends Error {
      readonly isGuardrailRejection = true;
      constructor(msg: string) { super(msg); this.name = "GuardrailRejection"; }
    }

    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-reject", "http_request", { url: "http://evil.com" })])
    );
    toolExecutorExecute.mockImplementation(() =>
      Promise.reject(new GuardrailRejection("HTTP to non-allowlisted host blocked"))
    );

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "t1", type: "tool_call" },
        { id: "t2", type: "tool_call" },
      ]),
      makeCtx()
    );

    expect(result.reason).toBe("error");
    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toContain("HTTP to non-allowlisted host blocked");
    expect(result.plan.steps[1].status).toBe("pending");
  });

  // ── TA-001.12: Executor re-throws GuardrailRejection (hard policy signal) ─

  it("TA-001.12: toolExecutor re-throws GuardrailRejection so loop can abort", async () => {
    class GuardrailRejection extends Error {
      readonly isGuardrailRejection = true;
      constructor(msg: string) { super(msg); this.name = "GuardrailRejection"; }
    }

    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-gr", "http_request", { url: "ftp://blocked" })])
    );
    toolExecutorExecute.mockImplementation(() =>
      Promise.reject(new GuardrailRejection("FTP not allowed"))
    );

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call" }]),
      makeCtx()
    );

    expect(result.plan.steps[0].status).toBe("failed");
    expect(result.plan.steps[0].error).toContain("FTP not allowed");
  });

  // ── TA-001.13: Message accumulator grows correctly with each step ─────────

  it("TA-001.13: messages array grows with each step output", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("Let me search.", [makeToolCall("tc-1", "memory_search", { query: "x" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-1", tool_name: "memory_search", success: true, result: { entries: [] }, latency_ms: 5,
    });
    callModelFull.mockResolvedValueOnce(
      makeMockModelResponse("Synthesis complete.")
    );

    const result = await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call" }, { id: "s1", type: "synthesis" }]),
      makeCtx()
    );

    const assistants = result.messages.filter((m) => m.role === "assistant");
    const tools = result.messages.filter((m) => m.role === "tool");

    expect(assistants.length).toBeGreaterThanOrEqual(2);
    expect(tools.length).toBe(1);
    expect(assistants[assistants.length - 1].content).toBe("Synthesis complete.");
  });

  // ── TA-001.14: LoopContext fields passed through to toolExecutor ───────────

  it("TA-001.14: taskId/userId/sessionId from context reach toolExecutor", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-1", "memory_search", { query: "x" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-1", tool_name: "memory_search", success: true, result: {}, latency_ms: 5,
    });

    await new ExecutionLoop().run(
      makePlan([{ id: "t1", type: "tool_call" }]),
      makeCtx({ taskId: "my-task", userId: "my-user", sessionId: "my-session" })
    );

    expect(toolExecutorExecute).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ taskId: "my-task", userId: "my-user", sessionId: "my-session" })
    );
  });

  // ── TA-001.15: Trace writes on loop lifecycle events ───────────────────────

  it("TA-001.15: loop writes loop_start, step_start, step_complete, and loop_end traces", async () => {
    callModelFull.mockResolvedValueOnce(
      makeMockModelResponse("done.")
    );

    await new ExecutionLoop().run(
      makePlan([{ id: "s1", type: "synthesis" }]),
      makeCtx()
    );

    const traceTypes = taskRepoCreateTrace.mock.calls.map((c) => c[0].type);

    expect(traceTypes).toContain("loop_start");
    expect(traceTypes).toContain("step_start");
    expect(traceTypes).toContain("step_complete");
    expect(traceTypes).toContain("loop_end");
  });

  // ── TA-001.16: Reason completed when all steps finish within limits ─────────

  it("TA-001.16: reason is completed when all steps finish within all limits", async () => {
    callModelWithTools.mockResolvedValueOnce(
      makeMockModelResponse("", [makeToolCall("tc-1", "memory_search", { query: "x" })])
    );
    toolExecutorExecute.mockResolvedValueOnce({
      call_id: "tc-1", tool_name: "memory_search", success: true, result: {}, latency_ms: 5,
    });
    callModelFull
      .mockResolvedValueOnce(makeMockModelResponse("reasoning"))
      .mockResolvedValueOnce(makeMockModelResponse("final"));

    const result = await new ExecutionLoop().run(
      makePlan([
        { id: "t1", type: "tool_call" },
        { id: "r1", type: "reasoning" },
        { id: "s1", type: "synthesis" },
      ]),
      makeCtx({ maxSteps: 10, maxToolCalls: 20 })
    );

    expect(result.reason).toBe("completed");
    expect(result.completedSteps).toBe(3);
    expect(result.totalSteps).toBe(3);
  });

  // ── TA-001.17: Model defaults to gpt-4o when not specified ─────────────────

  it("TA-001.17: defaults to gpt-4o when model not specified in context", async () => {
    callModelFull.mockResolvedValueOnce(
      makeMockModelResponse("default model used.")
    );

    const ctxNoModel = { ...makeCtx(), model: undefined as any };
    await new ExecutionLoop().run(
      makePlan([{ id: "s1", type: "synthesis" }]),
      ctxNoModel
    );

    expect(callModelFull).toHaveBeenCalledWith(
      "gpt-4o",
      expect.any(Array)
    );
  });

  // ── TA-001.18: Original plan object is not mutated ─────────────────────────

  it("TA-001.18: original plan object is not mutated (returned plan is a copy)", async () => {
    const plan = makePlan([{ id: "s1", type: "synthesis" }]);
    callModelFull.mockResolvedValueOnce(
      makeMockModelResponse("done.")
    );

    const result = await new ExecutionLoop().run(plan, makeCtx());

    // result.plan is a copy; original plan object unchanged
    expect(result.plan.steps[0].status).toBe("completed");
    expect(plan.steps[0].status).toBe("pending"); // original intact
  });

  // ── TA-001.19: Loop end trace contains correct reason and stats ─────────────

  it("TA-001.19: loop_end trace detail reflects the actual end reason and stats", async () => {
    callModelFull.mockResolvedValue(
      makeMockModelResponse("partial")
    );

    await new ExecutionLoop().run(
      makePlan([{ id: "s1", type: "synthesis" }, { id: "s2", type: "synthesis" }]),
      makeCtx({ maxSteps: 1 })
    );

    const loopEndCall = taskRepoCreateTrace.mock.calls.find(
      (c) => c[0].type === "loop_end"
    );
    expect(loopEndCall).toBeDefined();
    const detail = loopEndCall![0].detail as Record<string, unknown>;
    expect(detail.reason).toBe("step_cap");
    expect(detail.completed_steps).toBe(1);
  });
});
