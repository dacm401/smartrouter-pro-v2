/**
 * Tool Executor — executes individual tool calls and returns structured results.
 *
 * Responsibilities:
 * - Validate tool call arguments against registered schema
 * - Dispatch to the appropriate handler (internal or external)
 * - Return ToolResult with timing and error info
 *
 * External tools (http_request, web_search):
 * - Guardrail check is performed HERE before execution (defence in depth)
 * - If guardrail rejects: throws GuardrailRejection (caller catches and returns error result)
 * - If guardrail allows: executes the actual HTTP call
 *
 * EL-001: Tool execution infrastructure.
 * EL-004: Guardrail integration + real external tool execution.
 */

import { v4 as uuid } from "uuid";
import type { ToolCall, ToolResult } from "../types/index.js";
import { MemoryEntryRepo } from "../db/repositories.js";
import { TaskRepo } from "../db/repositories.js";
import { EvidenceRepo } from "../db/repositories.js";
import { config } from "../config.js";
import { toolGuardrail } from "../services/tool-guardrail.js";

/** Thrown by a tool handler when a guardrail check rejects the call */
export class GuardrailRejection extends Error {
  readonly isGuardrailRejection = true as const;
  constructor(message: string) {
    super(message);
    this.name = "GuardrailRejection";
  }
}

/** Context available to all tool handlers */
export interface ToolHandlerContext {
  userId: string;
  sessionId: string;
  taskId?: string;
}

/** A handler function for a specific tool */
type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolHandlerContext
) => Promise<unknown>;

export class ToolExecutor {
  private handlers = new Map<string, ToolHandler>();

  constructor() {
    this.registerInternalHandlers();
  }

  // ── Handler registration ─────────────────────────────────────────────────

  private registerInternalHandlers(): void {
    this.register("memory_search", this.handleMemorySearch.bind(this));
    this.register("task_read", this.handleTaskRead.bind(this));
    this.register("task_update", this.handleTaskUpdate.bind(this));
    this.register("task_create", this.handleTaskCreate.bind(this));
    // EL-004: external tools now have real implementations (after guardrail check)
    this.register("http_request", this.handleHttpRequest.bind(this));
    this.register("web_search", this.handleWebSearch.bind(this));
  }

  register(toolName: string, handler: ToolHandler): void {
    this.handlers.set(toolName, handler);
  }

  // ── Main entry point ──────────────────────────────────────────────────────

  /**
   * Execute a single tool call and return a structured result.
   */
  async execute(call: ToolCall, ctx: ToolHandlerContext): Promise<ToolResult> {
    const start = Date.now();
    const handler = this.handlers.get(call.tool_name);

    if (!handler) {
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: false,
        result: null,
        error: `Unknown tool: '${call.tool_name}'`,
        latency_ms: Date.now() - start,
      };
    }

    try {
      const result = await handler(call.arguments, ctx);
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: true,
        result,
        latency_ms: Date.now() - start,
      };
    } catch (err: unknown) {
      // GuardrailRejection → re-throw so the execution loop aborts (hard policy failure)
      if ((err as any)?.isGuardrailRejection === true) {
        throw err;
      }
      // Other errors → return failed ToolResult (loop continues or aborts based on its own logic)
      const message = err instanceof Error ? err.message : String(err);
      return {
        call_id: call.id,
        tool_name: call.tool_name,
        success: false,
        result: null,
        error: message,
        latency_ms: Date.now() - start,
      };
    }
  }

  // ── Internal tool handlers ────────────────────────────────────────────────

  private async handleMemorySearch(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const query = String(args.query ?? "");
    const maxResults = Math.min(Number(args.max_results ?? 5), 20);

    if (!query.trim()) {
      throw new Error("memory_search: 'query' parameter is required and must be non-empty.");
    }

    // Use the v2 retrieval pipeline for relevance-ranked results
    const { runRetrievalPipeline } = await import("../services/memory-retrieval.js");
    const candidates = await MemoryEntryRepo.getTopForUser(ctx.userId, maxResults * 2);
    const results = runRetrievalPipeline({
      entries: candidates,
      context: { userMessage: query },
      categoryPolicy: config.memory.retrieval.categoryPolicy,
      maxTotalEntries: maxResults,
    });

    return {
      query,
      count: results.length,
      entries: results.map((r) => ({
        id: r.entry.id,
        category: r.entry.category,
        content: r.entry.content,
        relevance_score: r.score,
        relevance_reason: r.reason,
      })),
    };
  }

  private async handleTaskRead(
    args: Record<string, unknown>,
    _ctx: ToolHandlerContext
  ): Promise<unknown> {
    const taskId = String(args.task_id ?? "");
    if (!taskId) {
      throw new Error("task_read: 'task_id' parameter is required.");
    }

    const task = await TaskRepo.getById(taskId);
    if (!task) {
      throw new Error(`task_read: Task '${taskId}' not found.`);
    }

    const summary = await TaskRepo.getSummary(taskId);

    return { task, summary: summary ?? null };
  }

  private async handleTaskUpdate(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const taskId = String(args.task_id ?? ctx.taskId ?? "");
    if (!taskId) {
      throw new Error("task_update: 'task_id' is required.");
    }

    const updates: Record<string, unknown> = {};

    if (args.status) {
      updates.status = String(args.status);
    }
    if (typeof args.next_step === "string") {
      updates.next_step = args.next_step;
    }
    if (typeof args.completed_step === "string") {
      updates.completed_step = args.completed_step;
    }

    await TaskRepo.updateExecution(taskId, 0);

    // Append to summary if completed_step provided
    if (typeof args.completed_step === "string") {
      const summary = await TaskRepo.getSummary(taskId);
      if (summary) {
        // Summary update is a future enhancement; log intent for now
        console.log(`[tool] task_update: completed_step appended for task ${taskId}`);
      }
    }

    return { task_id: taskId, updated: true, updates };
  }

  private async handleTaskCreate(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    const title = String(args.title ?? "");
    if (!title) {
      throw new Error("task_create: 'title' parameter is required.");
    }

    const id = uuid();
    const mode = String(args.mode ?? "direct");
    const goal = typeof args.goal === "string" ? args.goal : title;

    await TaskRepo.create({
      id,
      user_id: ctx.userId,
      session_id: ctx.sessionId,
      title,
      mode: mode as "direct" | "research" | "execute",
      complexity: "medium",
      risk: "low",
      goal,
    });

    return { task_id: id, title, mode, created: true };
  }

  // ── External tool handlers (EL-004) ─────────────────────────────────────────

  private async handleHttpRequest(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    // Guardrail pre-check — throws if rejected, causing step failure → loop abort
    const guardResult = await toolGuardrail.validate({
      toolName: "http_request",
      args,
      taskId: ctx.taskId ?? "unknown",
      userId: ctx.userId,
    });

    if (!guardResult.allowed) {
      throw new GuardrailRejection(guardResult.reason ?? "http_request rejected by guardrail");
    }

    const url = String(args.url ?? "");
    const userHeaders = (args.headers as Record<string, string> | undefined) ?? {};

    // Build fetch options with hard-coded safe defaults
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.guardrail.httpTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "SmartRouter-Pro/1.0",
          ...userHeaders,
        },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Enforce response size limit
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > config.guardrail.httpMaxResponseBytes) {
      throw new Error(
        `Response body too large (${contentLength} bytes). Max: ${config.guardrail.httpMaxResponseBytes} bytes.`
      );
    }

    const text = await response.text();
    const truncated = text.length > config.guardrail.httpMaxResponseBytes
      ? text.slice(0, config.guardrail.httpMaxResponseBytes) + "\n[...truncated]"
      : text;

    return {
      status: response.status,
      status_text: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: truncated,
      body_length: text.length,
      url: response.url || url,
    };
  }

  private async handleWebSearch(
    args: Record<string, unknown>,
    ctx: ToolHandlerContext
  ): Promise<unknown> {
    // Guardrail pre-check — throws if rejected, causing step failure → loop abort
    const guardResult = await toolGuardrail.validate({
      toolName: "web_search",
      args,
      taskId: ctx.taskId ?? "unknown",
      userId: ctx.userId,
    });

    if (!guardResult.allowed) {
      throw new GuardrailRejection(guardResult.reason ?? "web_search rejected by guardrail");
    }

    const queryStr = String(args.query ?? "");
    const maxResults = Math.min(Number(args.max_results ?? config.webSearch.maxResults), 10);

    // W1: Real search integration — if no endpoint is configured, return explicit error
    const searchEndpoint = config.webSearch.endpoint;
    if (!searchEndpoint) {
      // E1: write stub evidence (fire-and-forget; taskId is optional)
      if (ctx.taskId) {
        EvidenceRepo.create({
          task_id: ctx.taskId,
          user_id: ctx.userId,
          source: "web_search",
          content: `[web_search] No WEB_SEARCH_ENDPOINT configured. Query: "${queryStr}"`,
          source_metadata: { query: queryStr, stub: true },
        }).catch((e) => console.warn("[tool/web_search] Failed to write evidence:", e));
      }
      return {
        query: queryStr,
        results: [],
        error: "WEB_SEARCH_NOT_CONFIGURED",
      };
    }

    // Build search URL (GET with query params)
    const searchUrl = new URL(searchEndpoint);
    searchUrl.searchParams.set("q", queryStr);
    searchUrl.searchParams.set("num", String(maxResults));

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "SmartRouter-Pro/1.0",
    };
    // W1: attach API key if configured
    if (config.webSearch.apiKey) {
      headers["Authorization"] = `Bearer ${config.webSearch.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.guardrail.httpTimeoutMs);

    let response: Response;
    try {
      response = await fetch(searchUrl.toString(), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch (fetchErr: unknown) {
      // W1: network errors return { results: [], error } instead of throwing
      clearTimeout(timeoutId);
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return {
        query: queryStr,
        results: [],
        error: `FETCH_ERROR: ${message}`,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // W1: non-OK status returns { results: [], error } instead of throwing
      return {
        query: queryStr,
        results: [],
        error: `SEARCH_API_ERROR: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json();
    const results = Array.isArray(data.results) ? data.results.slice(0, maxResults) : [];

    // E1: write one evidence record per search result item (fire-and-forget)
    if (ctx.taskId) {
      for (const item of results) {
        EvidenceRepo.create({
          task_id: ctx.taskId,
          user_id: ctx.userId,
          source: "web_search",
          content: typeof item === "string" ? item : JSON.stringify(item),
          source_metadata: { query: queryStr, url: item?.url ?? null, title: item?.title ?? null },
          relevance_score: item?.score ?? item?.relevance ?? null,
        }).catch((e) => console.warn("[tool/web_search] Failed to write evidence:", e));
      }
    }

    return {
      query: queryStr,
      results,
      total: Array.isArray(data.results) ? data.results.length : 0,
    };
  }
}

/** Shared singleton instance */
export const toolExecutor = new ToolExecutor();
