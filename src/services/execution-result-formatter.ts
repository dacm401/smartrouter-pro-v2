/**
 * Execution Result Formatter (RR-002)
 *
 * Transforms raw ExecutionResultRecord rows from the database into a
 * compact, readable text block suitable for injection into the planner's
 * context. The formatter is a pure transform — no I/O, no side-effects.
 *
 * Design decisions:
 * - Formats final_content with a token-budget guard (truncation boundary)
 * - Skips results with empty final_content
 * - Formats created_at as a readable relative/local string
 * - Returns an empty string when input is empty (caller handles gracefully)
 */

import type { ExecutionResultRecord } from "../types/index.js";

/** Token-budget guard: truncate string at the nearest word boundary near maxChars */
function truncateToTokenBudget(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  const lastSpace = truncated.lastIndexOf(" ");
  const boundary = lastSpace > maxChars * 0.6 ? lastSpace : maxChars;
  return truncated.slice(0, boundary) + "[...truncated]";
}

/** Format a single execution result as a readable block */
function formatSingleResult(result: ExecutionResultRecord, maxChars: number): string {
  const taskLabel = result.task_id ? `Task: ${result.task_id}` : "Task: (no task_id)";
  const toolsLabel = `${result.tool_count} tool${result.tool_count !== 1 ? "s" : ""}`;
  const timeLabel = new Date(result.created_at).toLocaleString("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const contentPreview = result.final_content
    ? truncateToTokenBudget(result.final_content, maxChars)
    : "(no output)";

  return `${taskLabel} | Reason: ${result.reason} | Tools: ${toolsLabel} | ${timeLabel}\n    Result: ${contentPreview}`;
}

/**
 * Format an array of execution result records into a planner-ready text block.
 *
 * @param results  Raw rows from ExecutionResultRepo.listByUser()
 * @param maxChars Per-entry character budget (≈ 150 tokens @ 4 chars/token)
 * @returns        Single text block, or "" if no results
 */
export function formatExecutionResultsForPlanner(
  results: ExecutionResultRecord[],
  maxChars: number = 600
): string {
  if (!results || results.length === 0) return "";

  const blocks = results
    .filter((r) => r.final_content && r.final_content.trim().length > 0)
    .map((r, i) => `[${i + 1}] ${formatSingleResult(r, maxChars)}`);

  if (blocks.length === 0) return "";

  return `=== Recent Execution Results ===\n\n${blocks.join("\n\n")}\n\n===`;
}
