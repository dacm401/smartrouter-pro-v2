// workspace: 20260416214742
import { formatExecutionResultsForPlanner } from "../../src/services/execution-result-formatter.js";

const BASE_RESULT = {
  id: "test-id-1",
  task_id: "task-abc",
  user_id: "user-1",
  session_id: "sess-1",
  final_content: "The weather in Beijing is sunny with a high of 22°C.",
  steps_summary: null,
  memory_entries_used: [],
  model_used: "gpt-4o",
  tool_count: 2,
  duration_ms: 1500,
  reason: "completed",
  created_at: "2026-04-08T10:00:00.000Z",
};

describe("ExecutionResultFormatter", () => {
  // ── RR-002.1: Empty / null input ────────────────────────────────────────────

  it("RR-002.1a: returns empty string for empty array", () => {
    expect(formatExecutionResultsForPlanner([])).toBe("");
  });

  it("RR-002.1b: returns empty string when all results have empty final_content", () => {
    const input = [{ ...BASE_RESULT, final_content: "" }];
    expect(formatExecutionResultsForPlanner(input)).toBe("");
  });

  it("RR-002.1c: returns empty string when all results have whitespace-only final_content", () => {
    const input = [{ ...BASE_RESULT, final_content: "   \n\t  " }];
    expect(formatExecutionResultsForPlanner(input)).toBe("");
  });

  // ── RR-002.2: Single result ─────────────────────────────────────────────────

  it("RR-002.2a: renders single result with all fields", () => {
    const result = formatExecutionResultsForPlanner([BASE_RESULT], 600);
    expect(result).toContain("=== Recent Execution Results ===");
    expect(result).toContain("[1]");
    expect(result).toContain("Task: task-abc");
    expect(result).toContain("Reason: completed");
    expect(result).toContain("Tools: 2 tools");
    expect(result).toContain("sunny with a high of 22°C");
    expect(result).toContain("===");
  });

  it("RR-002.2b: handles result without task_id", () => {
    const input = [{ ...BASE_RESULT, task_id: null }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("Task: (no task_id)");
  });

  it("RR-002.2c: handles single tool_count correctly (singular)", () => {
    const input = [{ ...BASE_RESULT, tool_count: 1 }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("1 tool"); // no "s"
  });

  it("RR-002.2d: handles zero tool_count", () => {
    const input = [{ ...BASE_RESULT, tool_count: 0 }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("0 tools");
  });

  // ── RR-002.3: Token budget / truncation ────────────────────────────────────

  it("RR-002.3a: does not truncate when content is under budget", () => {
    const shortContent = "Short answer.";
    const input = [{ ...BASE_RESULT, final_content: shortContent }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain(shortContent);
    expect(result).not.toContain("[...truncated]");
  });

  it("RR-002.3b: truncates long content and appends [...truncated]", () => {
    const longContent = "A".repeat(300);
    const input = [{ ...BASE_RESULT, final_content: longContent }];
    const result = formatExecutionResultsForPlanner(input, 100);
    expect(result).toContain("[...truncated]");
    expect(result).not.toContain("A".repeat(300));
  });

  it("RR-002.3c: truncates at word boundary when possible", () => {
    const words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    const input = [{ ...BASE_RESULT, final_content: words }];
    const result = formatExecutionResultsForPlanner(input, 30);
    // Should not end mid-word if there's a space within 60% of budget
    expect(result).not.toMatch(/[a-z]…|[a-z]\.\.\.$/);
  });

  it("RR-002.3d: truncates raw char boundary when no word boundary exists near budget", () => {
    const noSpaces = "A".repeat(200);
    const input = [{ ...BASE_RESULT, final_content: noSpaces }];
    const result = formatExecutionResultsForPlanner(input, 50);
    expect(result).toContain("[...truncated]");
    expect(result).not.toContain(noSpaces);
  });

  // ── RR-002.4: Multiple results ───────────────────────────────────────────────

  it("RR-002.4a: renders multiple results with sequential [1] [2] labels", () => {
    const input = [
      { ...BASE_RESULT, id: "r1", task_id: "task-1", final_content: "First result." },
      { ...BASE_RESULT, id: "r2", task_id: "task-2", final_content: "Second result." },
    ];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("[1] Task: task-1");
    expect(result).toContain("[2] Task: task-2");
    expect(result).toContain("First result.");
    expect(result).toContain("Second result.");
  });

  it("RR-002.4b: skips results with empty final_content but still renders valid ones", () => {
    const input = [
      { ...BASE_RESULT, id: "r1", final_content: "" },
      { ...BASE_RESULT, id: "r2", final_content: "Valid second." },
    ];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("Valid second.");
    expect(result).not.toContain("first");
    // Only [2] since r1 was skipped
    expect(result).toContain("[1]"); // first valid gets [1]
  });

  it("RR-002.4c: returns empty string if all results are empty content", () => {
    const input = [
      { ...BASE_RESULT, id: "r1", final_content: "" },
      { ...BASE_RESULT, id: "r2", final_content: "   " },
    ];
    expect(formatExecutionResultsForPlanner(input, 600)).toBe("");
  });

  // ── RR-002.5: created_at formatting ────────────────────────────────────────

  it("RR-002.5: includes readable timestamp in output", () => {
    const input = [{ ...BASE_RESULT }];
    const result = formatExecutionResultsForPlanner(input, 600);
    // Should contain the date part (YYYY-MM-DD or locale format)
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // ── RR-002.6: reason field ─────────────────────────────────────────────────

  it("RR-002.6a: renders non-completed reasons", () => {
    const input = [{ ...BASE_RESULT, reason: "step_cap", tool_count: 5 }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("Reason: step_cap");
  });

  it("RR-002.6b: renders error reason (but caller should filter these out)", () => {
    const input = [{ ...BASE_RESULT, reason: "error" }];
    const result = formatExecutionResultsForPlanner(input, 600);
    expect(result).toContain("Reason: error");
  });
});
