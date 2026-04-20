/**
 * Trace Formatter — converts raw TaskTrace objects into human-readable summaries.
 *
 * TA-004: Execution Trace API enhancement.
 *
 * Each trace type has a distinct detail shape. This module maps them to
 * a one-line human-readable string suitable for timelines, debug UIs, and logs.
 */

import type { TaskTrace, TraceSummary } from "../types/index.js";

/**
 * Format a single trace into a human-readable summary line.
 */
export function formatTraceSummary(trace: TaskTrace): TraceSummary {
  const { trace_id, type, detail, created_at } = trace;

  let summary: string;

  switch (type) {
    case "classification": {
      const { intent, complexity_score, mode } = (detail ?? {}) as {
        intent?: string;
        complexity_score?: number;
        mode?: string;
      };
      summary = `Classified as "${intent ?? "unknown"}" (complexity: ${complexity_score ?? "?"}, mode: ${mode ?? "?"})`;
      break;
    }

    case "routing": {
      const { selected_model, selected_role, confidence, did_fallback } = (detail ?? {}) as {
        selected_model?: string;
        selected_role?: string;
        confidence?: number;
        did_fallback?: boolean;
      };
      const fallback = did_fallback ? " [FALLBACK]" : "";
      summary = `Routed to ${selected_model ?? "?"} (${selected_role ?? "?"}, confidence: ${confidence ?? "?"})${fallback}`;
      break;
    }

    case "response": {
      const { input_tokens, output_tokens, latency_ms, total_cost_usd } = (detail ?? {}) as {
        input_tokens?: number;
        output_tokens?: number;
        latency_ms?: number;
        total_cost_usd?: number;
      };
      const tokens = (input_tokens ?? 0) + (output_tokens ?? 0);
      const cost = total_cost_usd != null ? `, $${total_cost_usd.toFixed(6)}` : "";
      summary = `Response generated: ${output_tokens ?? 0} output tokens, ${tokens} total tokens, ${latency_ms ?? "?"}ms${cost}`;
      break;
    }

    case "planning": {
      const { model, loop_reason, completed_steps, tool_calls_executed } = (detail ?? {}) as {
        model?: string;
        loop_reason?: string;
        completed_steps?: number;
        tool_calls_executed?: number;
      };
      summary = `Execution planned with ${model ?? "?"} — ${loop_reason ?? "?"}, ${completed_steps ?? 0} steps, ${tool_calls_executed ?? 0} tool calls`;
      break;
    }

    case "guardrail": {
      const { allowed, reason } = (detail ?? {}) as { allowed?: boolean; reason?: string };
      if (allowed) {
        summary = `Guardrail: ALLOWED`;
      } else {
        summary = `Guardrail: BLOCKED — ${reason ?? "no reason"}`;
      }
      break;
    }

    case "step_start": {
      const { step_id, step_type } = (detail ?? {}) as { step_id?: string; step_type?: string };
      summary = `Step started: ${step_type ?? "?"} (${step_id ?? "?"})`;
      break;
    }

    case "step_complete": {
      const { step_id, step_type, duration_ms } = (detail ?? {}) as {
        step_id?: string;
        step_type?: string;
        duration_ms?: number;
      };
      summary = `Step completed: ${step_type ?? "?"} (${step_id ?? "?"})${duration_ms != null ? ` in ${duration_ms}ms` : ""}`;
      break;
    }

    case "step_failed": {
      const { step_id, step_type, error } = (detail ?? {}) as {
        step_id?: string;
        step_type?: string;
        error?: string;
      };
      summary = `Step FAILED: ${step_type ?? "?"} (${step_id ?? "?"}) — ${error ?? "unknown error"}`;
      break;
    }

    case "loop_start": {
      const { max_steps, max_tool_calls } = (detail ?? {}) as {
        max_steps?: number;
        max_tool_calls?: number;
      };
      summary = `Execution loop started (max steps: ${max_steps ?? "?"}, max tool calls: ${max_tool_calls ?? "?"})`;
      break;
    }

    case "loop_end": {
      const { reason: loopReason, steps_completed, tool_calls_completed } = (detail ?? {}) as {
        reason?: string;
        steps_completed?: number;
        tool_calls_completed?: number;
      };
      summary = `Execution loop ended: ${loopReason ?? "?"} — ${steps_completed ?? 0} steps, ${tool_calls_completed ?? 0} tool calls`;
      break;
    }

    case "error": {
      const { message, source } = (detail ?? {}) as { message?: string; source?: string };
      summary = `Error [${source ?? "unknown"}]: ${message ?? "no message"}`;
      break;
    }

    default:
      summary = `Unknown trace type: ${type}`;
  }

  return { trace_id, type: type as TraceSummary["type"], summary, created_at };
}

/**
 * Format a list of traces into summaries.
 */
export function formatTraceSummaries(traces: TaskTrace[]): TraceSummary[] {
  return traces.map(formatTraceSummary);
}
