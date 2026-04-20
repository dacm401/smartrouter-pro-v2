// workspace: 20260416214742
/**
 * TA-004: Trace Formatter Tests
 *
 * Tests for trace-formatter.ts — verifies human-readable summary generation
 * for all trace types written by the execution system.
 */

import { formatTraceSummary, formatTraceSummaries } from "../../src/services/trace-formatter.js";
import type { TaskTrace } from "../../src/types/index.js";

const makeTrace = (overrides: Partial<TaskTrace> = {}): TaskTrace =>
  ({
    trace_id: "trace-001",
    task_id: "task-001",
    type: "classification",
    detail: null,
    created_at: "2026-04-08T17:00:00.000Z",
    ...overrides,
  } as TaskTrace);

// ── classification ────────────────────────────────────────────────────────────

describe("formatTraceSummary — classification", () => {
  it("TA-004.1: formats classification trace with full detail", () => {
    const trace = makeTrace({
      type: "classification",
      detail: { intent: "research", complexity_score: 3, mode: "research" },
    });

    const result = formatTraceSummary(trace);

    expect(result.trace_id).toBe("trace-001");
    expect(result.type).toBe("classification");
    expect(result.summary).toContain("research");
    expect(result.summary).toContain("complexity: 3");
    expect(result.summary).toContain("mode: research");
    expect(result.created_at).toBe("2026-04-08T17:00:00.000Z");
  });

  it("TA-004.2: formats classification trace with missing detail fields", () => {
    const trace = makeTrace({ type: "classification", detail: {} });
    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("unknown");
    expect(result.summary).toContain("complexity: ?");
  });
});

// ── routing ──────────────────────────────────────────────────────────────────

describe("formatTraceSummary — routing", () => {
  it("TA-004.3: formats routing trace with fallback flag", () => {
    const trace = makeTrace({
      type: "routing",
      detail: { selected_model: "gpt-4o", selected_role: "fast", confidence: 0.92, did_fallback: true },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("gpt-4o");
    expect(result.summary).toContain("fast");
    expect(result.summary).toContain("confidence: 0.92");
    expect(result.summary).toContain("[FALLBACK]");
  });

  it("TA-004.4: formats routing trace without fallback", () => {
    const trace = makeTrace({
      type: "routing",
      detail: { selected_model: "gpt-4o-mini", selected_role: "fast", confidence: 0.78, did_fallback: false },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).not.toContain("[FALLBACK]");
    expect(result.summary).toContain("gpt-4o-mini");
  });
});

// ── response ─────────────────────────────────────────────────────────────────

describe("formatTraceSummary — response", () => {
  it("TA-004.5: formats response trace with token counts and cost", () => {
    const trace = makeTrace({
      type: "response",
      detail: { input_tokens: 1500, output_tokens: 320, latency_ms: 820, total_cost_usd: 0.00234 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("320 output tokens");
    expect(result.summary).toContain("1820 total tokens");
    expect(result.summary).toContain("820ms");
    expect(result.summary).toContain("$0.002340");
  });

  it("TA-004.6: formats response trace without cost", () => {
    const trace = makeTrace({
      type: "response",
      detail: { input_tokens: 100, output_tokens: 50, latency_ms: 200 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("50 output tokens");
    expect(result.summary).not.toContain("$");
  });
});

// ── planning ─────────────────────────────────────────────────────────────────

describe("formatTraceSummary — planning", () => {
  it("TA-004.7: formats planning trace with full execution stats", () => {
    const trace = makeTrace({
      type: "planning",
      detail: {
        model: "gpt-4o",
        loop_reason: "completed",
        completed_steps: 4,
        tool_calls_executed: 7,
      },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("gpt-4o");
    expect(result.summary).toContain("completed");
    expect(result.summary).toContain("4 steps");
    expect(result.summary).toContain("7 tool calls");
  });

  it("TA-004.8: formats planning trace with step_cap reason", () => {
    const trace = makeTrace({
      type: "planning",
      detail: { model: "gpt-4o-mini", loop_reason: "step_cap", completed_steps: 10, tool_calls_executed: 0 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("step_cap");
    expect(result.summary).toContain("10 steps");
  });
});

// ── guardrail ───────────────────────────────────────────────────────────────

describe("formatTraceSummary — guardrail", () => {
  it("TA-004.9: formats allowed guardrail trace", () => {
    const trace = makeTrace({
      type: "guardrail",
      detail: { allowed: true },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("ALLOWED");
  });

  it("TA-004.10: formats blocked guardrail trace with reason", () => {
    const trace = makeTrace({
      type: "guardrail",
      detail: { allowed: false, reason: "Host 'evil.com' is not on the allowlist." },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("BLOCKED");
    expect(result.summary).toContain("evil.com");
  });
});

// ── step traces ─────────────────────────────────────────────────────────────

describe("formatTraceSummary — step traces", () => {
  it("TA-004.11: formats step_start trace", () => {
    const trace = makeTrace({
      type: "step_start",
      detail: { step_id: "step-abc", step_type: "tool_call" },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("tool_call");
    expect(result.summary).toContain("step-abc");
    expect(result.summary).toContain("started");
  });

  it("TA-004.12: formats step_complete trace with duration", () => {
    const trace = makeTrace({
      type: "step_complete",
      detail: { step_id: "step-xyz", step_type: "synthesis", duration_ms: 1450 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("synthesis");
    expect(result.summary).toContain("1450ms");
    expect(result.summary).toContain("completed");
  });

  it("TA-004.13: formats step_failed trace with error message", () => {
    const trace = makeTrace({
      type: "step_failed",
      detail: { step_id: "step-err", step_type: "tool_call", error: "GuardrailRejection" },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("FAILED");
    expect(result.summary).toContain("tool_call");
    expect(result.summary).toContain("GuardrailRejection");
  });
});

// ── loop traces ─────────────────────────────────────────────────────────────

describe("formatTraceSummary — loop traces", () => {
  it("TA-004.14: formats loop_start trace", () => {
    const trace = makeTrace({
      type: "loop_start",
      detail: { max_steps: 10, max_tool_calls: 20 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("started");
    expect(result.summary).toContain("max steps: 10");
    expect(result.summary).toContain("max tool calls: 20");
  });

  it("TA-004.15: formats loop_end trace with reason and counts", () => {
    const trace = makeTrace({
      type: "loop_end",
      detail: { reason: "completed", steps_completed: 3, tool_calls_completed: 5 },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("completed");
    expect(result.summary).toContain("3 steps");
    expect(result.summary).toContain("5 tool calls");
  });
});

// ── error ───────────────────────────────────────────────────────────────────

describe("formatTraceSummary — error", () => {
  it("TA-004.16: formats error trace", () => {
    const trace = makeTrace({
      type: "error",
      detail: { message: "Connection timeout", source: "http_request" },
    });

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("Error");
    expect(result.summary).toContain("http_request");
    expect(result.summary).toContain("Connection timeout");
  });
});

// ── unknown type ────────────────────────────────────────────────────────────

describe("formatTraceSummary — unknown type", () => {
  it("TA-004.17: formats unknown trace type gracefully", () => {
    const trace = makeTrace({ type: "totally_new_type" } as any);

    const result = formatTraceSummary(trace);

    expect(result.summary).toContain("Unknown trace type");
    expect(result.summary).toContain("totally_new_type");
  });
});

// ── formatTraceSummaries (batch) ─────────────────────────────────────────────

describe("formatTraceSummaries — batch", () => {
  it("TA-004.18: formats multiple traces in order", () => {
    const traces: TaskTrace[] = [
      makeTrace({ trace_id: "t1", type: "classification", detail: { intent: "code" } }),
      makeTrace({ trace_id: "t2", type: "routing", detail: { selected_model: "gpt-4o" } }),
      makeTrace({ trace_id: "t3", type: "response", detail: { output_tokens: 100 } }),
    ];

    const results = formatTraceSummaries(traces);

    expect(results).toHaveLength(3);
    expect(results[0].trace_id).toBe("t1");
    expect(results[1].trace_id).toBe("t2");
    expect(results[2].trace_id).toBe("t3");
    expect(results[0].summary).toContain("code");
    expect(results[1].summary).toContain("gpt-4o");
    expect(results[2].summary).toContain("100");
  });

  it("TA-004.19: returns empty array for empty input", () => {
    expect(formatTraceSummaries([])).toEqual([]);
  });
});
