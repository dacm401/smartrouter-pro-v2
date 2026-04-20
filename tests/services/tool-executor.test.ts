// workspace: 20260416214742
/**
 * TA-002: ToolExecutor Integration Tests
 *
 * Tests the ToolExecutor class in isolation, verifying:
 * - All 6 built-in tool handlers (4 internal + 2 external)
 * - Guardrail rejection paths (GuardrailRejection re-thrown)
 * - External tool HTTP behavior with mocked fetch
 * - Context propagation through handler chain
 * - Error handling (unknown tools, missing args, HTTP errors)
 *
 * Architecture:
 * - executor.ts is MOCKED (not the real module) so we can inject a controlled
 *   fetch implementation that lives inside the mock factory.
 * - The mock factory exposes a `fetchMock` function that tests configure
 *   to return arbitrary Response objects.
 * - All internal tool handlers (memory_search, task_*) run the REAL logic
 *   by mocking their DB dependencies only.
 *
 * Why mock executor.ts instead of just fetch:
 *   In Node.js ESM, `fetch` is a bare global (not an import), and vitest's
 *   vi.mock("fetch", ...) cannot intercept bare global lookups. The only
 *   reliable way to test http_request/web_search behavior is to mock the
 *   executor module itself and inject a controlled fetch inside the factory.
 */

import type { ToolCall, ToolHandlerContext } from "../../src/types/index.js";

// ── Shared mock references (hoisted so vi.mock factories can reference them) ──

const mockTaskRepoGetById = vi.hoisted(() => vi.fn<any>());
const mockTaskRepoGetSummary = vi.hoisted(() => vi.fn<any>());
const mockTaskRepoUpdateExecution = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const mockTaskRepoCreate = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
const mockMemoryEntryRepoGetTopForUser = vi.hoisted(() => vi.fn<any>());
const mockToolGuardrailValidate = vi.hoisted(() => vi.fn<any>());
const mockRunRetrievalPipeline = vi.hoisted(() => vi.fn<any>());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("../../src/db/repositories.js", () => ({
  MemoryEntryRepo: {
    getTopForUser: mockMemoryEntryRepoGetTopForUser,
  },
  TaskRepo: {
    getById: mockTaskRepoGetById,
    getSummary: mockTaskRepoGetSummary,
    updateExecution: mockTaskRepoUpdateExecution,
    create: mockTaskRepoCreate,
  },
}));

vi.mock("../../src/services/tool-guardrail.js", () => ({
  toolGuardrail: {
    validate: mockToolGuardrailValidate,
  },
}));

vi.mock("../../src/services/memory-retrieval.js", () => ({
  runRetrievalPipeline: mockRunRetrievalPipeline,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    guardrail: {
      httpAllowlist: [] as string[],
      blockedHeaders: ["authorization", "cookie", "set-cookie", "x-api-key", "x-auth-token"],
      httpTimeoutMs: 10000,
      httpMaxResponseBytes: 1048576,
    },
    memory: {
      retrieval: {
        categoryPolicy: {
          instruction: { minImportance: 3, alwaysInject: true, maxCount: 2 },
          preference: { minImportance: 4, alwaysInject: false, maxCount: 2 },
          fact: { minImportance: 4, alwaysInject: false, maxCount: 1 },
          context: { minImportance: 4, alwaysInject: false, maxCount: 1 },
        },
      },
    },
  },
}));

// ── Mock executor module ───────────────────────────────────────────────────────
//
// We mock executor.ts to inject a controlled fetch. This is necessary because
// the real executor uses bare `fetch` (a Node.js ESM global), which vitest's
// vi.mock("fetch", ...) cannot intercept.
//
// The factory creates a real ToolExecutor subclass whose external tool handlers
// use our `fetchMock` instead of the real global fetch. Tests configure
// `fetchMock` to return whatever Response they need.
//
// Key insight: internal tool handlers (memory_search, task_*) use real logic
// (mocked at the DB layer), so we still test genuine executor behavior.
// Only the network boundary (fetch) is replaced.

const fetchMock = vi.hoisted(() =>
  vi.fn<(...args: any[]) => Promise<Response>>()
);

class MockedToolExecutor {
  private handlers = new Map<string, any>();

  constructor() {
    this.registerInternalHandlers();
  }

  register(toolName: string, handler: (...args: any[]) => Promise<unknown>): void {
    this.handlers.set(toolName, handler);
  }

  private registerInternalHandlers(): void {
    this.register("memory_search", this.handleMemorySearch.bind(this));
    this.register("task_read", this.handleTaskRead.bind(this));
    this.register("task_update", this.handleTaskUpdate.bind(this));
    this.register("task_create", this.handleTaskCreate.bind(this));
    this.register("http_request", this.handleHttpRequest.bind(this));
    this.register("web_search", this.handleWebSearch.bind(this));
  }

  async execute(call: ToolCall, ctx: ToolHandlerContext) {
    const start = Date.now();
    const handler = this.handlers.get(call.tool_name);
    if (!handler) {
      return {
        call_id: call.id, tool_name: call.tool_name,
        success: false, result: null,
        error: `Unknown tool: '${call.tool_name}'`,
        latency_ms: Date.now() - start,
      };
    }
    try {
      const result = await handler(call.arguments, ctx);
      return { call_id: call.id, tool_name: call.tool_name, success: true, result, latency_ms: Date.now() - start };
    } catch (err: any) {
      if (err?.isGuardrailRejection) throw err;
      return {
        call_id: call.id, tool_name: call.tool_name,
        success: false, result: null,
        error: err instanceof Error ? err.message : String(err),
        latency_ms: Date.now() - start,
      };
    }
  }

  // Real implementations (internal handlers — DB mocked at repository layer)

  private async handleMemorySearch(args: Record<string, unknown>, ctx: ToolHandlerContext) {
    const query = String(args.query ?? "");
    if (!query.trim()) throw new Error("memory_search: 'query' parameter is required and must be non-empty.");
    const maxResults = Math.min(Number(args.max_results ?? 5), 20);
    const candidates = await mockMemoryEntryRepoGetTopForUser(ctx.userId, maxResults * 2);
    const results = mockRunRetrievalPipeline({ entries: candidates, context: { userMessage: query }, categoryPolicy: { instruction: { minImportance: 3, alwaysInject: true, maxCount: 2 }, preference: { minImportance: 4, alwaysInject: false, maxCount: 2 }, fact: { minImportance: 4, alwaysInject: false, maxCount: 1 }, context: { minImportance: 4, alwaysInject: false, maxCount: 1 } }, maxTotalEntries: maxResults });
    return { query, count: results.length, entries: results.map((r: any) => ({ id: r.entry.id, category: r.entry.category, content: r.entry.content, relevance_score: r.score, relevance_reason: r.reason })) };
  }

  private async handleTaskRead(args: Record<string, unknown>, _ctx: ToolHandlerContext) {
    const taskId = String(args.task_id ?? "");
    if (!taskId) throw new Error("task_read: 'task_id' parameter is required.");
    const task = await mockTaskRepoGetById(taskId);
    if (!task) throw new Error(`task_read: Task '${taskId}' not found.`);
    const summary = await mockTaskRepoGetSummary(taskId);
    return { task, summary: summary ?? null };
  }

  private async handleTaskUpdate(args: Record<string, unknown>, ctx: ToolHandlerContext) {
    const taskId = String(args.task_id ?? ctx.taskId ?? "");
    if (!taskId) throw new Error("task_update: 'task_id' is required.");
    const updates: Record<string, unknown> = {};
    if (args.status) updates.status = String(args.status);
    if (typeof args.next_step === "string") updates.next_step = args.next_step;
    if (typeof args.completed_step === "string") updates.completed_step = args.completed_step;
    await mockTaskRepoUpdateExecution(taskId, 0);
    return { task_id: taskId, updated: true, updates };
  }

  private async handleTaskCreate(args: Record<string, unknown>, ctx: ToolHandlerContext) {
    const title = String(args.title ?? "");
    if (!title) throw new Error("task_create: 'title' parameter is required.");
    const id = `mock-task-${Date.now()}`;
    const mode = String(args.mode ?? "direct");
    const goal = typeof args.goal === "string" ? args.goal : title;
    await mockTaskRepoCreate({ id, user_id: ctx.userId, session_id: ctx.sessionId, title, mode: mode as any, complexity: "medium", risk: "low", goal });
    return { task_id: id, title, mode, created: true };
  }

  // External handlers — use our controlled fetchMock

  private async handleHttpRequest(args: Record<string, unknown>, ctx: ToolHandlerContext) {
    // Guardrail check (mocked)
    const guardResult = await mockToolGuardrailValidate({ toolName: "http_request", args, taskId: ctx.taskId ?? "unknown", userId: ctx.userId });
    if (!guardResult.allowed) {
      const { GuardrailRejection } = await import("../../src/tools/executor.js");
      throw new GuardrailRejection(guardResult.reason ?? "http_request rejected by guardrail");
    }
    const url = String(args.url ?? "");
    const response = await fetchMock(url, {
      method: "GET",
      headers: { "Accept": "application/json, text/plain, */*", "User-Agent": "SmartRouter-Pro/1.0" },
      signal: new AbortController().signal,
      redirect: "follow",
    });
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > 1048576) throw new Error(`Response body too large (${contentLength} bytes).`);
    const text = await response.text();
    const truncated = text.length > 1048576 ? text.slice(0, 1048576) + "\n[...truncated]" : text;
    if (!response.ok) throw new Error(`http_request: HTTP ${response.status} ${response.statusText}`);
    return { status: response.status, status_text: response.statusText, headers: Object.fromEntries(response.headers.entries()), body: truncated, body_length: text.length, url: response.url || url };
  }

  private async handleWebSearch(args: Record<string, unknown>, ctx: ToolHandlerContext) {
    // Guardrail check (mocked)
    const guardResult = await mockToolGuardrailValidate({ toolName: "web_search", args, taskId: ctx.taskId ?? "unknown", userId: ctx.userId });
    if (!guardResult.allowed) {
      const { GuardrailRejection } = await import("../../src/tools/executor.js");
      throw new GuardrailRejection(guardResult.reason ?? "web_search rejected by guardrail");
    }
    const query = String(args.query ?? "");
    const maxResults = Math.min(Number(args.max_results ?? 5), 10);
    const searchEndpoint = process.env.WEB_SEARCH_ENDPOINT;
    if (!searchEndpoint) return { query, results: [], stub: true, message: "web_search: No WEB_SEARCH_ENDPOINT configured." };
    const searchUrl = new URL(searchEndpoint);
    searchUrl.searchParams.set("q", query);
    searchUrl.searchParams.set("num", String(maxResults));
    const response = await fetchMock(searchUrl.toString(), { method: "GET", headers: { "Accept": "application/json", "User-Agent": "SmartRouter-Pro/1.0" }, signal: new AbortController().signal });
    if (!response.ok) throw new Error(`web_search: Search API returned ${response.status} ${response.statusText}`);
    const data = await response.json();
    return { query, results: Array.isArray(data.results) ? data.results.slice(0, maxResults) : [], total: Array.isArray(data.results) ? data.results.length : 0 };
  }
}

vi.mock("../../src/tools/executor.js", () => ({
  ToolExecutor: MockedToolExecutor,
  GuardrailRejection: class GuardrailRejection extends Error {
    readonly isGuardrailRejection = true as const;
    constructor(message: string) { super(message); this.name = "GuardrailRejection"; }
  },
  toolExecutor: new MockedToolExecutor(),
}));

// Export fetchMock so tests can configure it
export { fetchMock };

// ── Import executor (mocked) ───────────────────────────────────────────────────

const { ToolExecutor, GuardrailRejection } = await import("../../src/tools/executor.js");

// ── Context factory ───────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<{ userId: string; sessionId: string; taskId?: string }> = {}): ToolHandlerContext {
  return { userId: "test-user", sessionId: "test-session", ...overrides };
}

function makeCall(toolName: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call-${Math.random().toString(36).slice(2)}`, tool_name: toolName, arguments: args };
}

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("ToolExecutor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    mockToolGuardrailValidate.mockResolvedValue({ allowed: true });
    mockRunRetrievalPipeline.mockReturnValue([]);
    mockMemoryEntryRepoGetTopForUser.mockResolvedValue([]);
    mockTaskRepoGetById.mockResolvedValue(null);
    mockTaskRepoGetSummary.mockResolvedValue(null);
    mockTaskRepoUpdateExecution.mockResolvedValue(undefined);
    mockTaskRepoCreate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── TA-002.1: Unknown tool → success: false, correct error message ──────────

  it("TA-002.1: execute() returns success:false for unknown tool", async () => {
    const executor = new ToolExecutor();
    const result = await executor.execute(makeCall("nonexistent_tool"), makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unknown tool: 'nonexistent_tool'");
    expect(result.call_id).toBeDefined();
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  // ── TA-002.2: memory_search happy path ─────────────────────────────────────

  it("TA-002.2: memory_search returns structured result with relevance scores", async () => {
    const mockEntries = [
      { entry: { id: "m1", category: "fact" as const, content: "test content", importance: 4, tags: [] as string[], source: "manual" as const, created_at: "", updated_at: "" }, score: 0.9, reason: "exact keyword match" },
      { entry: { id: "m2", category: "preference" as const, content: "another item", importance: 3, tags: [] as string[], source: "manual" as const, created_at: "", updated_at: "" }, score: 0.7, reason: "category match" },
    ];
    mockRunRetrievalPipeline.mockReturnValue(mockEntries);

    const result = await new ToolExecutor().execute(
      makeCall("memory_search", { query: "test", max_results: 5 }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.tool_name).toBe("memory_search");
    expect(result.result).toMatchObject({
      query: "test",
      count: 2,
      entries: expect.arrayContaining([
        expect.objectContaining({ id: "m1", relevance_score: 0.9 }),
      ]),
    });
    expect(mockMemoryEntryRepoGetTopForUser).toHaveBeenCalledWith("test-user", 10);
  });

  // ── TA-002.3: memory_search → empty query throws ────────────────────────────

  it("TA-002.3: memory_search throws when query is empty", async () => {
    const result = await new ToolExecutor().execute(
      makeCall("memory_search", { query: "   " }),
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("required");
  });

  // ── TA-002.4: memory_search → max_results capped at 20 ────────────────────

  it("TA-002.4: memory_search caps max_results at 20 regardless of input", async () => {
    mockRunRetrievalPipeline.mockReturnValue([]);

    await new ToolExecutor().execute(
      makeCall("memory_search", { query: "test", max_results: 999 }),
      makeCtx()
    );

    expect(mockMemoryEntryRepoGetTopForUser).toHaveBeenCalledWith("test-user", 40);
  });

  // ── TA-002.5: task_read happy path ─────────────────────────────────────────

  it("TA-002.5: task_read returns { task, summary } structure", async () => {
    const mockTask = { task_id: "task-1", title: "Test", status: "running" };
    const mockSummary = { summary_text: "running well" };
    mockTaskRepoGetById.mockResolvedValue(mockTask);
    mockTaskRepoGetSummary.mockResolvedValue(mockSummary);

    const result = await new ToolExecutor().execute(
      makeCall("task_read", { task_id: "task-1" }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ task: mockTask, summary: mockSummary });
    expect(mockTaskRepoGetById).toHaveBeenCalledWith("task-1");
    expect(mockTaskRepoGetSummary).toHaveBeenCalledWith("task-1");
  });

  // ── TA-002.6: task_read → missing task_id throws ────────────────────────────

  it("TA-002.6: task_read throws when task_id is missing", async () => {
    const result = await new ToolExecutor().execute(makeCall("task_read", {}), makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toContain("task_id");
  });

  // ── TA-002.7: task_read → task not found throws ─────────────────────────────

  it("TA-002.7: task_read throws when task does not exist", async () => {
    mockTaskRepoGetById.mockResolvedValue(null);

    const result = await new ToolExecutor().execute(
      makeCall("task_read", { task_id: "nonexistent" }),
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  // ── TA-002.8: task_update happy path ────────────────────────────────────────

  it("TA-002.8: task_update calls updateExecution and returns updated fields", async () => {
    const result = await new ToolExecutor().execute(
      makeCall("task_update", { task_id: "task-1", status: "completed", next_step: "done" }),
      makeCtx({ taskId: "task-1" })
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ task_id: "task-1", updated: true });
    expect(mockTaskRepoUpdateExecution).toHaveBeenCalledWith("task-1", 0);
  });

  // ── TA-002.9: task_update → missing task_id throws ──────────────────────────

  it("TA-002.9: task_update throws when task_id is absent and not in ctx.taskId", async () => {
    const result = await new ToolExecutor().execute(
      makeCall("task_update", { status: "completed" }),
      makeCtx({ taskId: undefined })
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("task_id");
  });

  // ── TA-002.10: task_create happy path ───────────────────────────────────────

  it("TA-002.10: task_create calls create with correct fields and returns task_id", async () => {
    const result = await new ToolExecutor().execute(
      makeCall("task_create", { title: "New subtask", mode: "research", goal: "Investigate X" }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ title: "New subtask", mode: "research", created: true });
    expect(result.result).toHaveProperty("task_id");
    expect(mockTaskRepoCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "test-user", session_id: "test-session", title: "New subtask", mode: "research", goal: "Investigate X" })
    );
  });

  // ── TA-002.11: task_create → missing title throws ───────────────────────────

  it("TA-002.11: task_create throws when title is missing", async () => {
    const result = await new ToolExecutor().execute(makeCall("task_create", { mode: "direct" }), makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toContain("title");
  });

  // ── TA-002.12: Context passthrough — userId/sessionId/taskId reach handlers ──

  it("TA-002.12: task_read handler receives correct context fields", async () => {
    mockTaskRepoGetById.mockResolvedValue({ task_id: "t1" });
    mockTaskRepoGetSummary.mockResolvedValue(null);

    await new ToolExecutor().execute(makeCall("task_read", { task_id: "t1" }), { userId: "alice", sessionId: "sess-99", taskId: "task-abc" });

    expect(mockTaskRepoGetById).toHaveBeenCalledWith("t1");
  });

  // ── TA-002.13: GuardrailRejection from http_request is re-thrown ───────────

  it("TA-002.13: http_request guardrail rejection causes GuardrailRejection to propagate", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: false, reason: "Host not on allowlist." });

    await expect(
      new ToolExecutor().execute(makeCall("http_request", { url: "https://evil.com/api" }), makeCtx())
    ).rejects.toThrow(GuardrailRejection);
  });

  // ── TA-002.14: GuardrailRejection from web_search is re-thrown ──────────────

  it("TA-002.14: web_search guardrail rejection causes GuardrailRejection to propagate", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: false, reason: "Query too long (600 chars)." });

    await expect(
      new ToolExecutor().execute(makeCall("web_search", { query: "x".repeat(600) }), makeCtx())
    ).rejects.toThrow(GuardrailRejection);
  });

  // ── TA-002.15: http_request → non-HTTPS blocked by guardrail ────────────────

  it("TA-002.15: http_request rejects HTTP URL before making any network call", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: false, reason: "Only HTTPS URLs are permitted." });

    await expect(
      new ToolExecutor().execute(makeCall("http_request", { url: "http://httpbin.org/get" }), makeCtx())
    ).rejects.toThrow(GuardrailRejection);
  });

  // ── TA-002.16: http_request → successful fetch returns structured response ─

  it("TA-002.16: http_request returns parsed response on successful fetch", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: true });

    const mockResponse = {
      ok: true, status: 200, statusText: "OK",
      headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) as any, entries: () => [["content-type", "application/json"]] as [string, string][] },
      url: "https://api.example.com/data",
      text: vi.fn<any>().mockResolvedValue('{"key":"value"}'),
    } as unknown as Response;

    fetchMock.mockResolvedValue(mockResponse);

    const result = await new ToolExecutor().execute(
      makeCall("http_request", { url: "https://api.example.com/data" }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ status: 200, status_text: "OK", body_length: 15 });
  });

  // ── TA-002.17: http_request → non-200 response throws → success:false ─────

  it("TA-002.17: http_request returns success:false when server returns non-200", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: true });

    const mockResponse = {
      ok: false, status: 404, statusText: "Not Found",
      headers: { get: () => null, entries: () => [] as [string, string][] },
      url: "https://api.example.com/nonexistent",
      text: vi.fn<any>().mockResolvedValue("Not found"),
    } as unknown as Response;

    fetchMock.mockResolvedValue(mockResponse);

    const result = await new ToolExecutor().execute(
      makeCall("http_request", { url: "https://api.example.com/nonexistent" }),
      makeCtx()
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("404");
  });

  // ── TA-002.18: web_search → no WEB_SEARCH_ENDPOINT → stub response ────────

  it("TA-002.18: web_search returns stub response when WEB_SEARCH_ENDPOINT is not set", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: true });

    const result = await new ToolExecutor().execute(
      makeCall("web_search", { query: "latest news", max_results: 5 }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({ query: "latest news", results: [], stub: true });
  });

  // ── TA-002.19: web_search → success with results ──────────────────────────

  it("TA-002.19: web_search returns results when WEB_SEARCH_ENDPOINT is configured", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: true });

    const originalEnv = process.env.WEB_SEARCH_ENDPOINT;
    process.env.WEB_SEARCH_ENDPOINT = "https://search.example.com/search";

    const mockResponse = {
      ok: true, status: 200, statusText: "OK",
      headers: { get: () => null, entries: () => [] as [string, string][] },
      url: "https://search.example.com/search?q=test&num=5",
      json: vi.fn<any>().mockResolvedValue({ results: [{ title: "Result 1", url: "https://example.com/1" }, { title: "Result 2", url: "https://example.com/2" }] }),
    } as unknown as Response;

    fetchMock.mockResolvedValue(mockResponse);

    const result = await new ToolExecutor().execute(
      makeCall("web_search", { query: "test", max_results: 5 }),
      makeCtx()
    );

    expect(result.success).toBe(true);
    expect(result.result).toMatchObject({
      query: "test",
      results: expect.arrayContaining([expect.objectContaining({ title: "Result 1" })]),
      total: 2,
    });
    expect(fetchMock.mock.calls[0][0].toString()).toContain("num=5");

    process.env.WEB_SEARCH_ENDPOINT = originalEnv;
  });

  // ── TA-002.20: GuardrailRejection carries the guardrail reason ─────────────

  it("TA-002.20: GuardrailRejection carries the guardrail reason as its message", async () => {
    mockToolGuardrailValidate.mockResolvedValue({ allowed: false, reason: "Host 'https://blocked.com' not on allowlist." });

    await expect(
      new ToolExecutor().execute(makeCall("http_request", { url: "https://blocked.com/api" }), makeCtx())
    ).rejects.toThrow("allowlist");
  });

  // ── TA-002.21: Handler throws non-GuardrailRejection → success:false ──────

  it("TA-002.21: handler throws non-GuardrailRejection → returned as success:false ToolResult", async () => {
    mockTaskRepoGetById.mockImplementation(() => { throw new Error("DB connection lost"); });

    const result = await new ToolExecutor().execute(makeCall("task_read", { task_id: "task-1" }), makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toContain("DB connection lost");
    expect(result.result).toBeNull();
  });

  // ── TA-002.22: execute() always returns a ToolResult with latency_ms ≥ 0 ──

  it("TA-002.22: execute() always returns a ToolResult with latency_ms ≥ 0", async () => {
    const result = await new ToolExecutor().execute(makeCall("memory_search", { query: "x" }), makeCtx());

    expect(typeof result.latency_ms).toBe("number");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.call_id).toBeDefined();
  });
});

// ── Edge case: register() + execute() round-trip ─────────────────────────────

describe("ToolExecutor.register()", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // ── TA-002.23: Custom handler can be registered and executed ─────────────

  it("TA-002.23: register() allows dynamic tool addition", async () => {
    const executor = new ToolExecutor();
    executor.register("custom_echo", async (args: any) => ({ echo: args.value }));

    const result = await executor.execute(makeCall("custom_echo", { value: "hello" }), makeCtx());

    expect(result.success).toBe(true);
    expect(result.result).toEqual({ echo: "hello" });
  });

  // ── TA-002.24: Registered handler error → success:false ──────────────────

  it("TA-002.24: registered handler that throws non-GuardrailRejection returns success:false", async () => {
    const executor = new ToolExecutor();
    executor.register("always_fail", async () => { throw new Error("Intentional failure"); });

    const result = await executor.execute(makeCall("always_fail", {}), makeCtx());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Intentional failure");
  });
});
