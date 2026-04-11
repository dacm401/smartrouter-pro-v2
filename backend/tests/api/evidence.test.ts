/**
 * R1 — E2E Regression Pack: POST /v1/evidence + GET /v1/evidence
 *
 * Tests evidence endpoint request/response contracts.
 * All DB calls are mocked via vi.mock — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { evidenceRouter } from "../../src/api/evidence.js";

vi.mock("../../src/db/repositories", () => ({
  EvidenceRepo: {
    create: vi.fn(),
    getById: vi.fn(),
    listByTask: vi.fn(),
    listByUser: vi.fn(),
  },
}));

function buildTestApp() {
  const app = new Hono();
  // Stub identity middleware: always set userId = "test-user"
  app.use("/v1/*", async (c, next) => {
    (c as unknown as { userId: string }).userId = "test-user";
    await next();
  });
  app.route("/v1/evidence", evidenceRouter);
  return app;
}

const MOCK_EVIDENCE = {
  evidence_id: "ev-001",
  task_id: "task-001",
  user_id: "test-user",
  source: "web_search",
  content: "Mock evidence content",
  source_metadata: { url: "https://example.com" },
  relevance_score: 0.95,
  created_at: new Date().toISOString(),
};

describe("POST /v1/evidence — R1 E2E Regression Pack", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildTestApp();
    vi.clearAllMocks();
  });

  it("POST /v1/evidence → 201 with created evidence", async () => {
    const { EvidenceRepo } = await import("../../src/db/repositories.js");
    vi.mocked(EvidenceRepo.create).mockResolvedValueOnce(MOCK_EVIDENCE);

    const res = await app.request("/v1/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({
        task_id: "task-001",
        source: "web_search",
        content: "Mock evidence content",
        source_metadata: { url: "https://example.com" },
        relevance_score: 0.95,
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body).toHaveProperty("evidence");
    expect(body.evidence.evidence_id).toBe("ev-001");
  });

  it("POST /v1/evidence — missing task_id → 400", async () => {
    const res = await app.request("/v1/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ source: "web_search", content: "content" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("task_id");
  });

  it("POST /v1/evidence — invalid source → 400", async () => {
    const res = await app.request("/v1/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ task_id: "task-001", source: "invalid_source", content: "content" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("source");
  });

  it("POST /v1/evidence — empty content → 400", async () => {
    const res = await app.request("/v1/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({ task_id: "task-001", source: "web_search", content: "  " }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("content");
  });

  it("POST /v1/evidence — invalid relevance_score (>1) → 400", async () => {
    const res = await app.request("/v1/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": "test-user" },
      body: JSON.stringify({
        task_id: "task-001",
        source: "web_search",
        content: "content",
        relevance_score: 1.5,
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain("relevance_score");
  });
});

describe("GET /v1/evidence — R1 E2E Regression Pack", () => {
  let app: Hono;

  beforeEach(() => {
    app = buildTestApp();
    vi.clearAllMocks();
  });

  it("GET /v1/evidence/:id（存在）→ 200", async () => {
    const { EvidenceRepo } = await import("../../src/db/repositories.js");
    vi.mocked(EvidenceRepo.getById).mockResolvedValueOnce(MOCK_EVIDENCE);

    const res = await app.request("/v1/evidence/ev-001", {
      method: "GET",
      headers: { "X-User-Id": "test-user" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.evidence.evidence_id).toBe("ev-001");
  });

  it("GET /v1/evidence/:id（不存在）→ 404", async () => {
    const { EvidenceRepo } = await import("../../src/db/repositories.js");
    vi.mocked(EvidenceRepo.getById).mockResolvedValueOnce(null);

    const res = await app.request("/v1/evidence/not-found", {
      method: "GET",
      headers: { "X-User-Id": "test-user" },
    });

    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toContain("not found");
  });

  it("GET /v1/evidence?task_id=xxx → 200 数组", async () => {
    const { EvidenceRepo } = await import("../../src/db/repositories.js");
    vi.mocked(EvidenceRepo.listByTask).mockResolvedValueOnce([MOCK_EVIDENCE]);

    const res = await app.request("/v1/evidence?task_id=task-001", {
      method: "GET",
      headers: { "X-User-Id": "test-user" },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.evidence)).toBe(true);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.evidence[0].evidence_id).toBe("ev-001");
  });
});
