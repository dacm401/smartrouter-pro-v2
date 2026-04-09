/**
 * ET-001: TaskPlanner Unit Tests
 *
 * Coverage targets:
 *   1. executionResultContext injection into messages array
 *   2. Normal (happy-path) JSON plan parse — steps mapped correctly
 *   3. Invalid / malformed LLM response → synthesizeFallbackPlan
 *   4. Edge cases: empty steps, missing tool_name, non-array steps
 *   5. synthesizeFallbackPlan minimum contract
 *   6. Trace write failure is swallowed (non-fatal)
 *
 * Mock strategy (vitest ESM + vi.hoisted):
 *   - callModelWithTools  → controls LLM response
 *   - toolRegistry        → returns empty tool list (keeps test isolated)
 *   - TaskRepo            → stubs out DB writes (planning trace)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelResponse } from "../../src/models/providers/base-provider.js";

// ── Hoisted mock references ──────────────────────────────────────────────────

const callModelWithToolsMock = vi.hoisted(() => vi.fn<any>());
const taskRepoCreateTraceMock = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("../../src/models/model-gateway.js", () => ({
  callModelWithTools: callModelWithToolsMock,
}));

vi.mock("../../src/tools/registry.js", () => ({
  toolRegistry: {
    listTools: vi.fn(() => []),
    getFunctionCallingSchemas: vi.fn(() => []),
  },
}));

vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: {
    createTrace: taskRepoCreateTraceMock,
  },
}));

// ── Import module under test ─────────────────────────────────────────────────

const { TaskPlanner } = await import("../../src/services/task-planner.js");

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wrap a valid plan_task tool call into a ModelResponse */
function makePlanResponse(goalSummary: string, steps: unknown[]): ModelResponse {
  return {
    content: "",
    input_tokens: 10,
    output_tokens: 20,
    model: "gpt-4o",
    tool_calls: [
      {
        index: 0,
        id: "tc_plan_001",
        type: "function",
        function: {
          name: "plan_task",
          arguments: JSON.stringify({ goal_summary: goalSummary, steps }),
        },
      },
    ],
  };
}

/** ModelResponse with no tool calls (plain text response) */
function makeTextResponse(content = "I will help with that."): ModelResponse {
  return {
    content,
    input_tokens: 5,
    output_tokens: 10,
    model: "gpt-4o",
    tool_calls: [],
  };
}

/** ModelResponse where plan_task arguments are not valid JSON */
function makeMalformedJsonResponse(): ModelResponse {
  return {
    content: "",
    input_tokens: 5,
    output_tokens: 10,
    model: "gpt-4o",
    tool_calls: [
      {
        index: 0,
        id: "tc_malformed",
        type: "function",
        function: {
          name: "plan_task",
          arguments: "{ this is not valid json }",
        },
      },
    ],
  };
}

const BASE_PARAMS = {
  taskId: "task-123",
  goal: "Search the web and summarize results",
  userId: "user-abc",
  sessionId: "sess-xyz",
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TaskPlanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    taskRepoCreateTraceMock.mockResolvedValue(undefined);
  });

  // ── 1. messages array construction ────────────────────────────────────────

  describe("messages construction", () => {
    it("calls model with system prompt + user goal when no executionResultContext", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      // First message is system prompt
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("task planner");
      // Last message is user goal
      const lastMsg = messages[messages.length - 1];
      expect(lastMsg.role).toBe("user");
      expect(lastMsg.content).toContain(BASE_PARAMS.goal);
    });

    it("injects executionResultContext as second system message when provided", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const context = "## Past Executions\n- Task X completed with result Y";
      await planner.plan({ ...BASE_PARAMS, executionResultContext: context });

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      // Three messages: system prompt, context, user goal
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe("system");
      expect(messages[1].role).toBe("system");
      expect(messages[1].content).toBe(context);
      expect(messages[2].role).toBe("user");
    });

    it("does NOT inject executionResultContext message when omitted", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      // Only two messages: system prompt + user goal
      expect(messages).toHaveLength(2);
    });

    it("does NOT inject executionResultContext message when empty string", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan({ ...BASE_PARAMS, executionResultContext: "" });

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      expect(messages).toHaveLength(2);
    });

    it("uses default model gpt-4o when model not specified", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      const [model] = callModelWithToolsMock.mock.calls[0];
      expect(model).toBe("gpt-4o");
    });

    it("uses the model specified in params", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan({ ...BASE_PARAMS, model: "gpt-4-turbo" });

      const [model] = callModelWithToolsMock.mock.calls[0];
      expect(model).toBe("gpt-4-turbo");
    });
  });

  // ── 2. Happy-path plan parsing ────────────────────────────────────────────

  describe("parsePlanFromResponse — valid plan", () => {
    it("returns a plan with the correct task_id", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Search and summarize", [
          { title: "Search", description: "Do web search", kind: "tool_call", tool_name: "web_search", expected_output: "results" },
          { title: "Summarize", description: "Summarize findings", kind: "reasoning", expected_output: "summary" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.task_id).toBe("task-123");
    });

    it("returns the correct number of steps", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Two step plan", [
          { title: "Step A", description: "First", kind: "tool_call", tool_name: "web_search", expected_output: "data" },
          { title: "Step B", description: "Second", kind: "reasoning", expected_output: "answer" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(2);
    });

    it("maps kind=tool_call to type=tool_call", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Tool plan", [
          { title: "Fetch data", description: "Call API", kind: "tool_call", tool_name: "http_request", expected_output: "JSON" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].type).toBe("tool_call");
    });

    it("maps kind=reasoning to type=reasoning", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Reasoning plan", [
          { title: "Think", description: "Analyze", kind: "reasoning", expected_output: "analysis" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].type).toBe("reasoning");
    });

    it("sets tool_name for tool_call steps", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Search plan", [
          { title: "Search", description: "Web search", kind: "tool_call", tool_name: "web_search", expected_output: "links" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].tool_name).toBe("web_search");
    });

    it("sets tool_name=undefined for reasoning steps", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Reasoning plan", [
          { title: "Reason", description: "Think hard", kind: "reasoning", expected_output: "conclusion" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].tool_name).toBeUndefined();
    });

    it("first step has empty depends_on array", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Multi step", [
          { title: "Step 1", description: "First", kind: "reasoning", expected_output: "a" },
          { title: "Step 2", description: "Second", kind: "reasoning", expected_output: "b" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].depends_on).toEqual([]);
    });

    it("subsequent steps depend on the previous step id", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Chained steps", [
          { title: "Step 1", description: "First", kind: "reasoning", expected_output: "a" },
          { title: "Step 2", description: "Second", kind: "reasoning", expected_output: "b" },
          { title: "Step 3", description: "Third", kind: "reasoning", expected_output: "c" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[1].depends_on).toEqual([plan.steps[0].id]);
      expect(plan.steps[2].depends_on).toEqual([plan.steps[1].id]);
    });

    it("all steps start with status=pending", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Status test", [
          { title: "A", description: "AA", kind: "reasoning", expected_output: "x" },
          { title: "B", description: "BB", kind: "tool_call", tool_name: "web_search", expected_output: "y" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      for (const step of plan.steps) {
        expect(step.status).toBe("pending");
      }
    });

    it("sets current_step_index to 0", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Index test", [
          { title: "Only step", description: "Do it", kind: "reasoning", expected_output: "done" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.current_step_index).toBe(0);
    });

    it("uses fallback title 'Step N' when title is missing", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("No title plan", [
          { description: "Do something", kind: "reasoning", expected_output: "result" },
        ])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].title).toBe("Step 1");
    });
  });

  // ── 3. Fallback: model returns no tool call ────────────────────────────────

  describe("synthesizeFallbackPlan — model returns plain text", () => {
    it("returns a plan when model produces no tool calls", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse("I cannot plan this."));
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan).toBeDefined();
      expect(plan.task_id).toBe("task-123");
    });

    it("fallback plan has exactly one step", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
    });

    it("fallback step type is reasoning", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].type).toBe("reasoning");
    });

    it("fallback step status is pending", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].status).toBe("pending");
    });

    it("fallback step has empty depends_on", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps[0].depends_on).toEqual([]);
    });

    it("fallback current_step_index is 0", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.current_step_index).toBe(0);
    });
  });

  // ── 4. Fallback: malformed LLM response ───────────────────────────────────

  describe("synthesizeFallbackPlan — malformed responses", () => {
    it("falls back when plan_task arguments are invalid JSON", async () => {
      callModelWithToolsMock.mockResolvedValue(makeMalformedJsonResponse());
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      // Should not throw — fall back gracefully
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe("reasoning");
    });

    it("falls back when steps is an empty array", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Empty steps", [])
      );
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].type).toBe("reasoning");
    });

    it("falls back when steps key is missing", async () => {
      callModelWithToolsMock.mockResolvedValue({
        content: "",
        input_tokens: 5,
        output_tokens: 5,
        model: "gpt-4o",
        tool_calls: [
          {
            index: 0,
            id: "tc_no_steps",
            type: "function",
            function: {
              name: "plan_task",
              arguments: JSON.stringify({ goal_summary: "no steps key" }),
            },
          },
        ],
      });
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
    });

    it("falls back when steps is not an array (object instead)", async () => {
      callModelWithToolsMock.mockResolvedValue({
        content: "",
        input_tokens: 5,
        output_tokens: 5,
        model: "gpt-4o",
        tool_calls: [
          {
            index: 0,
            id: "tc_obj_steps",
            type: "function",
            function: {
              name: "plan_task",
              arguments: JSON.stringify({ goal_summary: "bad steps", steps: { step: "wrong" } }),
            },
          },
        ],
      });
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
    });

    it("falls back when plan_task is called but tool_calls array is empty", async () => {
      callModelWithToolsMock.mockResolvedValue({
        content: "fallback text",
        input_tokens: 5,
        output_tokens: 5,
        model: "gpt-4o",
        tool_calls: [],
      });
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
    });

    it("falls back when tool_calls is undefined", async () => {
      callModelWithToolsMock.mockResolvedValue({
        content: "no tool calls at all",
        input_tokens: 5,
        output_tokens: 5,
        model: "gpt-4o",
      });
      const planner = new TaskPlanner();
      const plan = await planner.plan(BASE_PARAMS);

      expect(plan.steps).toHaveLength(1);
    });
  });

  // ── 5. Trace write behavior ───────────────────────────────────────────────

  describe("planning trace", () => {
    it("writes planning trace after successful plan parse", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Trace test", [
          { title: "Search", description: "Do search", kind: "tool_call", tool_name: "web_search", expected_output: "results" },
        ])
      );
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      expect(taskRepoCreateTraceMock).toHaveBeenCalledOnce();
      const traceArg = taskRepoCreateTraceMock.mock.calls[0][0];
      expect(traceArg.type).toBe("planning");
      expect(traceArg.task_id).toBe("task-123");
    });

    it("writes planning trace even when fallback plan is used", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      expect(taskRepoCreateTraceMock).toHaveBeenCalledOnce();
    });

    it("does NOT throw when trace write fails", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Trace fail test", [
          { title: "Step", description: "Do it", kind: "reasoning", expected_output: "done" },
        ])
      );
      taskRepoCreateTraceMock.mockRejectedValueOnce(new Error("DB down"));

      const planner = new TaskPlanner();
      // Must not throw
      await expect(planner.plan(BASE_PARAMS)).resolves.toBeDefined();
    });

    it("trace detail includes step count", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Multi trace", [
          { title: "A", description: "first", kind: "tool_call", tool_name: "web_search", expected_output: "x" },
          { title: "B", description: "second", kind: "reasoning", expected_output: "y" },
          { title: "C", description: "third", kind: "reasoning", expected_output: "z" },
        ])
      );
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      const traceArg = taskRepoCreateTraceMock.mock.calls[0][0];
      expect(traceArg.detail.steps).toHaveLength(3);
    });

    it("trace detail tool_calls_in_plan counts only tool_call steps", async () => {
      callModelWithToolsMock.mockResolvedValue(
        makePlanResponse("Count tools", [
          { title: "T1", description: "tool step", kind: "tool_call", tool_name: "web_search", expected_output: "x" },
          { title: "R1", description: "reason step", kind: "reasoning", expected_output: "y" },
          { title: "T2", description: "another tool", kind: "tool_call", tool_name: "http_request", expected_output: "z" },
        ])
      );
      const planner = new TaskPlanner();
      await planner.plan(BASE_PARAMS);

      const traceArg = taskRepoCreateTraceMock.mock.calls[0][0];
      expect(traceArg.detail.tool_calls_in_plan).toBe(2);
    });
  });

  // ── 6. executionResultContext injection — content verification ────────────

  describe("executionResultContext — content propagation", () => {
    it("goal is included in user message even with executionResultContext", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const goal = "Analyze sales data from Q4";
      await planner.plan({
        ...BASE_PARAMS,
        goal,
        executionResultContext: "## Previous\n- Something was done",
      });

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      const userMsg = messages.find((m: any) => m.role === "user");
      expect(userMsg.content).toContain(goal);
    });

    it("executionResultContext content is preserved verbatim", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const planner = new TaskPlanner();
      const ctx = "## Execution History\n- Task 1: completed\n- Task 2: failed";
      await planner.plan({ ...BASE_PARAMS, executionResultContext: ctx });

      const [_model, messages] = callModelWithToolsMock.mock.calls[0];
      const ctxMsg = messages.find((m: any) => m.content === ctx);
      expect(ctxMsg).toBeDefined();
      expect(ctxMsg.role).toBe("system");
    });

    it("multiple calls are independent — no context leakage between instances", async () => {
      callModelWithToolsMock.mockResolvedValue(makeTextResponse());
      const p1 = new TaskPlanner();
      const p2 = new TaskPlanner();

      await p1.plan({ ...BASE_PARAMS, executionResultContext: "context-for-p1" });
      await p2.plan({ ...BASE_PARAMS });

      const [, msgs1] = callModelWithToolsMock.mock.calls[0];
      const [, msgs2] = callModelWithToolsMock.mock.calls[1];

      expect(msgs1).toHaveLength(3); // system + context + user
      expect(msgs2).toHaveLength(2); // system + user only
    });
  });
});
