// workspace: 20260416214742
/**
 * TA-003: ToolGuardrail Policy Tests
 *
 * Tests for ToolGuardrail.validate() — pure unit tests covering all policy rules.
 *
 * Test structure:
 *   Section A: http_request validation (10 cases)
 *   Section B: web_search validation (6 cases)
 *   Section C: unknown tool — fail closed (1 case)
 *
 * Architecture:
 *   - Mocks TaskRepo.createTrace at module level (write is try/caught, must not fail tests)
 *   - Mocks config.guardrail via module-level overrides
 *   - No network, no DB, no orchestration — pure function assertions
 */


// ── Module-level mocks (hoisted — runs before imports) ────────────────────────

const mockCreateTrace = vi.hoisted(() => vi.fn<any>().mockResolvedValue(undefined));
vi.mock("../../src/db/repositories.js", () => ({
  TaskRepo: { createTrace: mockCreateTrace },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeParams = (overrides: Record<string, unknown> = {}) => ({
  toolName: "http_request",
  args: { url: "https://example.com" },
  taskId: "test-task-001",
  userId: "test-user-001",
  ...overrides,
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("ToolGuardrail", () => {
  // Re-import inside describe to get fresh class instances with mocked deps
  let ToolGuardrail: typeof import("../../src/services/tool-guardrail.js").ToolGuardrail;
  let toolGuardrail: import("../../src/services/tool-guardrail.js").ToolGuardrail;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import to reset singleton state per test
    const mod = await import("../../src/services/tool-guardrail.js");
    ToolGuardrail = mod.ToolGuardrail;
    toolGuardrail = new ToolGuardrail();
  });

  // ── TA-003.1–3: http_request — empty / invalid URL ─────────────────────────

  it("TA-003.1: http_request rejects missing url parameter", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: {} })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'url' parameter is required");
    expect(result.details?.tool_name).toBe("http_request");
    expect(mockCreateTrace).toHaveBeenCalledOnce();
    expect(mockCreateTrace.mock.calls[0][0].task_id).toBe("test-task-001");
  });

  it("TA-003.2: http_request rejects empty string url", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: { url: "" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'url' parameter is required");
  });

  it("TA-003.3: http_request rejects unparseable URL", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: { url: "not-a-valid-url" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("could not be parsed");
    expect(result.details?.tool_name).toBe("http_request");
  });

  // ── TA-003.4–5: http_request — protocol check ───────────────────────────────

  it("TA-003.4: http_request rejects HTTP (non-HTTPS) protocol", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: { url: "http://example.com/api" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("HTTPS");
    expect(result.details?.host).toBe("example.com");
    expect(result.details?.method).toBe("GET");
  });

  it("TA-003.5: http_request rejects FTP protocol", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: { url: "ftp://files.example.com/data" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("HTTPS");
    expect(result.details?.host).toBe("files.example.com");
  });

  // ── TA-003.6–7: http_request — host allowlist ────────────────────────────────

  it("TA-003.6: http_request allows host on non-empty allowlist", async () => {
    const mod = await import("../../src/config.js");
    const originalAllowlist = mod.config.guardrail.httpAllowlist;
    mod.config.guardrail.httpAllowlist = ["api.openai.com", "api.github.com"];

    try {
      const result = await toolGuardrail.validate(
        makeParams({ toolName: "http_request", args: { url: "https://api.openai.com/v1/models" } })
      );

      expect(result.allowed).toBe(true);
      expect(result.details?.host).toBe("api.openai.com");
      expect(result.reason).toBeUndefined();
    } finally {
      mod.config.guardrail.httpAllowlist = originalAllowlist;
    }
  });

  it("TA-003.7: http_request rejects host NOT on allowlist", async () => {
    const mod = await import("../../src/config.js");
    const originalAllowlist = mod.config.guardrail.httpAllowlist;
    mod.config.guardrail.httpAllowlist = ["api.openai.com", "api.github.com"];

    try {
      const result = await toolGuardrail.validate(
        makeParams({ toolName: "http_request", args: { url: "https://evil.example.com/data" } })
      );

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("evil.example.com");
      expect(result.reason).toContain("not on the allowlist");
      expect(result.details?.host).toBe("evil.example.com");
    } finally {
      mod.config.guardrail.httpAllowlist = originalAllowlist;
    }
  });

  // ── TA-003.8: http_request — blocked headers ─────────────────────────────────

  it("TA-003.8: http_request rejects blocked headers (authorization)", async () => {
    const result = await toolGuardrail.validate(
      makeParams({
        toolName: "http_request",
        args: { url: "https://example.com/api", headers: { Authorization: "Bearer token123" } },
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("authorization");
    expect(result.details?.rejected_headers).toContain("authorization");
  });

  it("TA-003.8b: http_request rejects blocked headers (x-api-key, case-insensitive key check)", async () => {
    const result = await toolGuardrail.validate(
      makeParams({
        toolName: "http_request",
        args: { url: "https://example.com/api", headers: { "X-Api-Key": "secret" } },
      })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("x-api-key");
    expect(result.details?.rejected_headers).toContain("x-api-key");
  });

  it("TA-003.8c: http_request allows headers that are not blocked", async () => {
    const result = await toolGuardrail.validate(
      makeParams({
        toolName: "http_request",
        args: { url: "https://example.com/api", headers: { "Content-Type": "application/json", Accept: "application/json" } },
      })
    );

    expect(result.allowed).toBe(true);
    expect(result.details?.rejected_headers).toBeUndefined();
  });

  // ── TA-003.9: http_request — happy path ─────────────────────────────────────

  it("TA-003.9: http_request allows valid HTTPS URL when allowlist is empty (fail-open)", async () => {
    const mod = await import("../../src/config.js");
    const originalAllowlist = mod.config.guardrail.httpAllowlist;
    mod.config.guardrail.httpAllowlist = [];

    try {
      const result = await toolGuardrail.validate(
        makeParams({ toolName: "http_request", args: { url: "https://example.com/api/data" } })
      );

      expect(result.allowed).toBe(true);
      expect(result.details?.host).toBe("example.com");
      expect(result.details?.path).toBe("/api/data");
      expect(result.details?.method).toBe("GET");
    } finally {
      mod.config.guardrail.httpAllowlist = originalAllowlist;
    }
  });

  // ── TA-003.10–14: web_search validation ──────────────────────────────────────

  it("TA-003.10: web_search rejects missing query parameter", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: {} })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'query' parameter is required");
    expect(result.details?.tool_name).toBe("web_search");
  });

  it("TA-003.11: web_search rejects empty string query", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: "" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'query' parameter is required");
  });

  it("TA-003.12: web_search rejects whitespace-only query", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: "   " } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("'query' parameter is required");
  });

  it("TA-003.13: web_search rejects query exceeding 500 characters", async () => {
    const longQuery = "a".repeat(501);
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: longQuery } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("500 characters");
    expect(result.details?.tool_name).toBe("web_search");
  });

  it("TA-003.14: web_search allows query at exactly 500 characters", async () => {
    const exactQuery = "a".repeat(500);
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: exactQuery } })
    );

    expect(result.allowed).toBe(true);
    expect(result.details?.query).toBe(exactQuery);
  });

  it("TA-003.15: web_search caps max_results at 10 without rejecting", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: "test search", max_results: 50 } })
    );

    expect(result.allowed).toBe(true);
    expect(result.details?.query).toBe("test search");
    // Should log the cap
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[guardrail] web_search max_results capped from 50 to 10.")
    );
    consoleSpy.mockRestore();
  });

  it("TA-003.16: web_search allows valid query with default max_results", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: "latest AI news" } })
    );

    expect(result.allowed).toBe(true);
    expect(result.details?.tool_name).toBe("web_search");
    expect(result.details?.query).toBe("latest AI news");
    expect(result.reason).toBeUndefined();
  });

  // ── TA-003.17: unknown tool — fail closed ───────────────────────────────────

  it("TA-003.17: unknown external tool is rejected (fail-closed)", async () => {
    const result = await toolGuardrail.validate(
      makeParams({ toolName: "some_new_tool", args: { url: "https://example.com" } })
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("some_new_tool");
    expect(result.reason).toContain("No guardrail policy found");
    expect(result.details?.tool_name).toBe("some_new_tool");
    expect(result.details?.guardrail_version).toBe("v1");
  });

  // ── TA-003.18: trace writes on every decision ────────────────────────────────

  it("TA-003.18: every decision (allowed + rejected) writes a trace", async () => {
    // Allowed case
    await toolGuardrail.validate(
      makeParams({ toolName: "web_search", args: { query: "hello" } })
    );
    expect(mockCreateTrace).toHaveBeenCalledTimes(1);
    expect(mockCreateTrace.mock.calls[0][0].type).toBe("guardrail");
    expect(mockCreateTrace.mock.calls[0][0].detail.allowed).toBe(true);
  });

  it("TA-003.18b: rejected decisions include reason and details in trace", async () => {
    await toolGuardrail.validate(
      makeParams({ toolName: "http_request", args: { url: "http://insecure.com" } })
    );

    expect(mockCreateTrace).toHaveBeenCalledTimes(1);
    const trace = mockCreateTrace.mock.calls[0][0];
    expect(trace.detail.allowed).toBe(false);
    expect(trace.detail.reason).toContain("HTTPS");
    expect(trace.detail.details.tool_name).toBe("http_request");
  });
});
