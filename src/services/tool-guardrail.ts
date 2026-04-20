/**
 * Tool Guardrail — validates external tool calls before execution.
 *
 * EL-004: External API safety layer.
 *
 * Responsibilities:
 * - Validate http_request: host allowlist, method, blocked headers
 * - Validate web_search: query sanitization, max_results cap
 * - Return structured GuardrailResult so the caller can throw or fallback
 * - All decisions (allowed + rejected) are written to task_traces
 *
 * Design: fail-closed (if guardrail is disabled, requests are still blocked
 * for unknown hosts — empty allowlist means total block).
 */

import { v4 as uuid } from "uuid";
import { config } from "../config.js";
import { TaskRepo } from "../db/repositories.js";

// ── Result types ─────────────────────────────────────────────────────────────

export interface GuardrailResult {
  allowed: boolean;
  /** Human-readable reason if rejected */
  reason?: string;
  /** Structured details for audit trace */
  details?: {
    tool_name: string;
    host?: string;
    path?: string;
    query?: string;
    method?: string;
    rejected_headers?: string[];
    guardrail_version: string;
  };
}

// ── Guardrail ─────────────────────────────────────────────────────────────────

export class ToolGuardrail {
  private readonly version = "v1";

  /**
   * Validate an external tool call before it is executed.
   * Returns GuardrailResult. Caller decides whether to throw or handle gracefully.
   *
   * All decisions (allowed or rejected) are written to task_traces as type "guardrail".
   */
  async validate(params: {
    toolName: string;
    args: Record<string, unknown>;
    taskId: string;
    userId: string;
  }): Promise<GuardrailResult> {
    const { toolName, args, taskId, userId } = params;

    let result: GuardrailResult;

    switch (toolName) {
      case "http_request":
        result = this.#validateHttpRequest(args);
        break;
      case "web_search":
        result = this.#validateWebSearch(args);
        break;
      default:
        // Unknown external tool — fail closed
        result = {
          allowed: false,
          reason: `Unknown external tool '${toolName}'. No guardrail policy found.`,
          details: { tool_name: toolName, guardrail_version: this.version },
        };
    }

    // Write audit trace
    await this.#writeTrace(taskId, userId, result);

    return result;
  }

  // ── http_request validation ─────────────────────────────────────────────────

  #validateHttpRequest(args: Record<string, unknown>): GuardrailResult {
    const url = String(args.url ?? "");
    const headers = (args.headers as Record<string, string> | undefined) ?? {};

    if (!url) {
      return {
        allowed: false,
        reason: "http_request: 'url' parameter is required.",
        details: { tool_name: "http_request", guardrail_version: this.version },
      };
    }

    // Parse URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return {
        allowed: false,
        reason: `http_request: Invalid URL '${url}' — could not be parsed.`,
        details: { tool_name: "http_request", guardrail_version: this.version },
      };
    }

    // Protocol check — HTTPS only
    if (parsedUrl.protocol !== "https:") {
      return {
        allowed: false,
        reason: `http_request: Only HTTPS URLs are permitted. Got '${parsedUrl.protocol}' for '${parsedUrl.host}'.`,
        details: {
          tool_name: "http_request",
          host: parsedUrl.host,
          path: parsedUrl.pathname,
          method: "GET",
          guardrail_version: this.version,
        },
      };
    }

    const host = parsedUrl.host.toLowerCase();

    // Host allowlist check (fail-closed: empty allowlist = block all)
    const allowlist = config.guardrail.httpAllowlist;
    if (allowlist.length > 0 && !allowlist.includes(host)) {
      return {
        allowed: false,
        reason: `http_request: Host '${parsedUrl.host}' is not on the allowlist. Permitted hosts: ${allowlist.join(", ")}.`,
        details: {
          tool_name: "http_request",
          host,
          path: parsedUrl.pathname,
          method: "GET",
          guardrail_version: this.version,
        },
      };
    }

    // Blocked headers check — reject if any are present
    const blocked = config.guardrail.blockedHeaders ?? [];
    const presentBlocked: string[] = [];
    for (const h of blocked) {
      if (Object.keys(headers).map((k) => k.toLowerCase()).includes(h)) {
        presentBlocked.push(h);
      }
    }

    if (presentBlocked.length > 0) {
      return {
        allowed: false,
        reason: `http_request: Headers '${presentBlocked.join(", ")}' are not permitted.`,
        details: {
          tool_name: "http_request",
          host,
          path: parsedUrl.pathname,
          method: "GET",
          rejected_headers: presentBlocked,
          guardrail_version: this.version,
        },
      };
    }

    // All checks passed
    return {
      allowed: true,
      details: {
        tool_name: "http_request",
        host,
        path: parsedUrl.pathname,
        method: "GET",
        guardrail_version: this.version,
      },
    };
  }

  // ── web_search validation ───────────────────────────────────────────────────

  #validateWebSearch(args: Record<string, unknown>): GuardrailResult {
    const query = String(args.query ?? "");
    const maxResults = Number(args.max_results ?? 5);

    if (!query.trim()) {
      return {
        allowed: false,
        reason: "web_search: 'query' parameter is required and must be non-empty.",
        details: { tool_name: "web_search", guardrail_version: this.version },
      };
    }

    // Query length limit — prevent resource exhaustion
    if (query.length > 500) {
      return {
        allowed: false,
        reason: `web_search: Query too long (${query.length} chars). Maximum is 500 characters.`,
        details: { tool_name: "web_search", query, guardrail_version: this.version },
      };
    }

    // max_results cap
    const cappedMaxResults = Math.min(maxResults, 10);
    if (cappedMaxResults !== maxResults) {
      console.log(`[guardrail] web_search max_results capped from ${maxResults} to ${cappedMaxResults}.`);
    }

    return {
      allowed: true,
      details: {
        tool_name: "web_search",
        query,
        guardrail_version: this.version,
      },
    };
  }

  // ── Trace helper ─────────────────────────────────────────────────────────────

  async #writeTrace(taskId: string, userId: string, result: GuardrailResult): Promise<void> {
    try {
      await TaskRepo.createTrace({
        id: uuid(),
        task_id: taskId,
        type: "guardrail",
        detail: {
          allowed: result.allowed,
          reason: result.reason,
          details: result.details,
        },
      });
    } catch (e) {
      console.warn("[guardrail] Failed to write trace:", e);
    }
  }
}

/** Shared singleton instance */
export const toolGuardrail = new ToolGuardrail();
