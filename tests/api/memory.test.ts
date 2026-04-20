// workspace: 20260416214742
/**
 * SI-001: Memory API Integration Tests
 *
 * Architecture:
 *   - Imports memoryRouter directly from src/api/memory.ts (NOT from src/index.ts,
 *     which starts a HTTP server via serve() and would conflict in tests).
 *   - Creates a minimal test Hono app that mounts only the memoryRouter.
 *   - Uses app.request() to invoke routes directly — no HTTP server needed.
 *   - Real MemoryEntryRepo + real PostgreSQL (smartrouter_test).
 *   - No external AI/provider mocks needed — the memory router only calls
 *     MemoryEntryRepo (DB), which is the target of these tests.
 *
 * Isolation strategy:
 *   - truncateTables() in beforeEach resets all tables.
 *   - Independent per-test UUIDs prevent cross-test data coupling.
 *   - Uses independent vitest process (vitest.api.config.ts) to avoid pool
 *     contamination from repo tests or mock suite.
 */

import { Hono } from "hono";
import { memoryRouter } from "../../src/api/memory.js";
import { truncateTables } from "../db/harness.js";

const TEST_USER_A = "si001-user-a";
const TEST_USER_B = "si001-user-b";

// ── Test app: mounts only memoryRouter, no HTTP server ────────────────────────

const testApp = new Hono();
testApp.route("/v1/memory", memoryRouter);

function makeReq(path: string, init: RequestInit = {}, userId = TEST_USER_A) {
  const url = path.includes("?")
    ? `${path}&user_id=${encodeURIComponent(userId)}`
    : `${path}?user_id=${encodeURIComponent(userId)}`;
  return testApp.request(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

async function parseJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return text; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createEntry(overrides: Record<string, unknown> = {}, userId = TEST_USER_A) {
  const body = {
    category: "preference",
    content: "Test memory content",
    ...overrides,
  };
  const res = await makeReq("/v1/memory", {
    method: "POST",
    body: JSON.stringify(body),
  }, userId);
  const json = await parseJson(res);
  return { res, json };
}

// ── POST /v1/memory ──────────────────────────────────────────────────────────

describe("POST /v1/memory", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  it("201 — creates entry with required fields only", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "fact", content: "Paris is the capital of France." }),
    });
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.entry).toBeDefined();
    expect(json.entry.id).toBeTruthy();
    expect(json.entry.user_id).toBe(TEST_USER_A);
    expect(json.entry.category).toBe("fact");
    expect(json.entry.content).toBe("Paris is the capital of France.");
    expect(json.entry.importance).toBe(3); // default
    expect(json.entry.tags).toEqual([]);
    expect(json.entry.source).toBe("manual"); // default
    expect(json.entry.created_at).toBeTruthy();
    expect(json.entry.updated_at).toBeTruthy();
  });

  it("201 — creates entry with all optional fields", async () => {
    const body = {
      category: "preference",
      content: "Prefers dark mode",
      importance: 5,
      tags: ["ui", "theme"],
      source: "feedback",
    };
    const res = await makeReq("/v1/memory", { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.entry.importance).toBe(5);
    expect(json.entry.tags).toEqual(["ui", "theme"]);
    expect(json.entry.source).toBe("feedback");
  });

  it("201 — content is trimmed", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "instruction", content: "  Leading and trailing spaces  " }),
    });
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.entry.content).toBe("Leading and trailing spaces");
  });

  it("400 — missing category", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ content: "Some content" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("category");
  });

  it("400 — invalid category", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "invalid_category", content: "Hello" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("category");
  });

  it("400 — missing content", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("content");
  });

  it("400 — empty string content", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "fact", content: "   " }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("content");
  });

  it("400 — content exceeds 2000 characters", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "fact", content: "x".repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("2000");
  });

  it("400 — importance out of range (0)", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference", content: "Test", importance: 0 }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("importance");
  });

  it("400 — importance out of range (6)", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference", content: "Test", importance: 6 }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("importance");
  });

  it("400 — tags is not an array", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference", content: "Test", tags: "not-an-array" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("tags");
  });

  it("400 — more than 10 tags", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({
        category: "preference",
        content: "Test",
        tags: Array.from({ length: 11 }, (_, i) => `tag${i}`),
      }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("10");
  });

  it("400 — tag longer than 50 characters", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({
        category: "preference",
        content: "Test",
        tags: ["a".repeat(51)],
      }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("50");
  });

  it("400 — invalid source", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference", content: "Test", source: "bad-source" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("source");
  });

  it("400 — invalid JSON body", async () => {
    const res = await testApp.request(
      `/v1/memory?user_id=${encodeURIComponent(TEST_USER_A)}`,
      { method: "POST", body: "not json" }
    );
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("Invalid JSON");
  });

  it("201 — user_id from query param is stored", async () => {
    const res = await makeReq("/v1/memory", {
      method: "POST",
      body: JSON.stringify({ category: "preference", content: "User-specific memory" }),
    }, TEST_USER_B);
    expect(res.status).toBe(201);
    const json = await parseJson(res);
    expect(json.entry.user_id).toBe(TEST_USER_B);
  });
});

// ── GET /v1/memory ────────────────────────────────────────────────────────────

describe("GET /v1/memory", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  it("200 — returns entries for the specified user", async () => {
    await createEntry({ category: "preference", content: "Prefers email" }, TEST_USER_A);
    await createEntry({ category: "fact", content: "Works remotely" }, TEST_USER_A);
    await createEntry({ category: "instruction", content: "Contact via Slack" }, TEST_USER_B);

    const res = await makeReq("/v1/memory", {}, TEST_USER_A);
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entries).toHaveLength(2);
    expect(json.entries.every((e: any) => e.user_id === TEST_USER_A)).toBe(true);
  });

  it("200 — returns [] for user with no entries", async () => {
    await createEntry({}, TEST_USER_A);
    const res = await makeReq("/v1/memory", {}, TEST_USER_B);
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entries).toEqual([]);
  });

  it("200 — filters by category", async () => {
    await createEntry({ category: "preference", content: "Like A" }, TEST_USER_A);
    await createEntry({ category: "fact", content: "Fact B" }, TEST_USER_A);
    await createEntry({ category: "preference", content: "Like C" }, TEST_USER_A);

    const res = await testApp.request(
      `/v1/memory?user_id=${TEST_USER_A}&category=preference`
    );
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entries).toHaveLength(2);
    expect(json.entries.every((e: any) => e.category === "preference")).toBe(true);
  });

  it("200 — respects limit (cap at 100)", async () => {
    for (let i = 0; i < 5; i++) {
      await createEntry({ category: "fact", content: `Fact ${i}` }, TEST_USER_A);
    }

    const res = await testApp.request(
      `/v1/memory?user_id=${TEST_USER_A}&limit=3`
    );
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entries).toHaveLength(3);
  });

  it("200 — limit capped at 100 even when requesting more", async () => {
    for (let i = 0; i < 5; i++) {
      await createEntry({ category: "fact", content: `Fact ${i}` }, TEST_USER_A);
    }
    const res = await testApp.request(
      `/v1/memory?user_id=${TEST_USER_A}&limit=999`
    );
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    // Cap is 100; should not error
    expect(Array.isArray(json.entries)).toBe(true);
  });

  it("400 — invalid limit (0)", async () => {
    const res = await testApp.request(
      `/v1/memory?user_id=${TEST_USER_A}&limit=0`
    );
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("limit");
  });

  it("400 — invalid limit (negative)", async () => {
    const res = await testApp.request(
      `/v1/memory?user_id=${TEST_USER_A}&limit=-1`
    );
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("limit");
  });

  it("200 — default-user when user_id not provided", async () => {
    // No user_id in query — falls back to "default-user"
    await createEntry({}, "default-user");
    const res = await testApp.request("/v1/memory");
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entries).toHaveLength(1);
    expect(json.entries[0].user_id).toBe("default-user");
  });
});

// ── GET /v1/memory/:id ───────────────────────────────────────────────────────

describe("GET /v1/memory/:id", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  it("200 — returns entry by id", async () => {
    const { json: created } = await createEntry({
      category: "fact",
      content: "Beijing is the capital",
    });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {});
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.id).toBe(created.entry.id);
    expect(json.entry.content).toBe("Beijing is the capital");
  });

  it("404 — entry not found", async () => {
    const res = await makeReq("/v1/memory/nonexistent-id-12345", {});
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });

  it("404 — entry belongs to different user", async () => {
    const { json: created } = await createEntry({}, TEST_USER_A);
    // Query as TEST_USER_B — cross-user access denied
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {}, TEST_USER_B);
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });
});

// ── PUT /v1/memory/:id ───────────────────────────────────────────────────────

describe("PUT /v1/memory/:id", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  it("200 — updates content", async () => {
    const { json: created } = await createEntry({ content: "Old content" });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "New content" }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.content).toBe("New content");
    expect(json.entry.id).toBe(created.entry.id);
  });

  it("200 — updates importance", async () => {
    const { json: created } = await createEntry({ importance: 2 });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ importance: 5 }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.importance).toBe(5);
  });

  it("200 — updates category", async () => {
    const { json: created } = await createEntry({ category: "preference" });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ category: "instruction" }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.category).toBe("instruction");
  });

  it("200 — updates tags", async () => {
    const { json: created } = await createEntry({ tags: ["old"] });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ tags: ["new", "tags"] }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.tags).toEqual(["new", "tags"]);
  });

  it("200 — partial update (only content)", async () => {
    const { json: created } = await createEntry({
      content: "Original",
      importance: 4,
      tags: ["keep"],
    });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "Updated only content" }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.content).toBe("Updated only content");
    expect(json.entry.importance).toBe(4); // unchanged
    expect(json.entry.tags).toEqual(["keep"]); // unchanged
  });

  it("200 — content is trimmed on update", async () => {
    const { json: created } = await createEntry({ content: "Trim me" });
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "  trimmed content  " }),
    });
    expect(res.status).toBe(200);
    const json = await parseJson(res);
    expect(json.entry.content).toBe("trimmed content");
  });

  it("400 — empty content on update", async () => {
    const { json: created } = await createEntry();
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "   " }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("content");
  });

  it("400 — content exceeds 2000 on update", async () => {
    const { json: created } = await createEntry();
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "x".repeat(2001) }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("2000");
  });

  it("400 — invalid importance on update", async () => {
    const { json: created } = await createEntry();
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ importance: 99 }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("importance");
  });

  it("400 — more than 10 tags on update", async () => {
    const { json: created } = await createEntry();
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("10");
  });

  it("400 — invalid category on update", async () => {
    const { json: created } = await createEntry();
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ category: "bad" }),
    });
    expect(res.status).toBe(400);
    const json = await parseJson(res);
    expect(json.error).toContain("category");
  });

  it("404 — update nonexistent entry", async () => {
    const res = await makeReq("/v1/memory/nonexistent-id-999", {
      method: "PUT",
      body: JSON.stringify({ content: "New content" }),
    });
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });

  it("404 — update entry belonging to different user", async () => {
    const { json: created } = await createEntry({}, TEST_USER_A);
    const res = await makeReq(`/v1/memory/${created.entry.id}`, {
      method: "PUT",
      body: JSON.stringify({ content: "Hijacked!" }),
    }, TEST_USER_B);
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });
});

// ── DELETE /v1/memory/:id ────────────────────────────────────────────────────

describe("DELETE /v1/memory/:id", () => {
  beforeEach(async () => {
    await truncateTables();
  });

  it("204 — deletes existing entry", async () => {
    const { json: created } = await createEntry();
    const id = created.entry.id;

    const delRes = await makeReq(`/v1/memory/${id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // Verify it's gone
    const getRes = await makeReq(`/v1/memory/${id}`, {});
    expect(getRes.status).toBe(404);
  });

  it("204 — empty body on 204", async () => {
    const { json: created } = await createEntry();
    const delRes = await makeReq(`/v1/memory/${created.entry.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);
    const text = await delRes.text();
    expect(text).toBe("");
  });

  it("404 — delete nonexistent entry", async () => {
    const res = await makeReq("/v1/memory/nonexistent-id-xyz", { method: "DELETE" });
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });

  it("404 — delete entry belonging to different user", async () => {
    const { json: created } = await createEntry({}, TEST_USER_A);
    const res = await makeReq(`/v1/memory/${created.entry.id}`, { method: "DELETE" }, TEST_USER_B);
    expect(res.status).toBe(404);
    const json = await parseJson(res);
    expect(json.error).toContain("not found");
  });
});
