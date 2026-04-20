import { Hono } from "hono";
import { MemoryEntryRepo } from "../db/repositories.js";
import type { MemoryEntryInput, MemoryEntryUpdate } from "../types/index.js";
import { getContextUserId } from "../middleware/identity.js";

export const memoryRouter = new Hono();

const VALID_CATEGORIES = ["preference", "fact", "context", "instruction"] as const;
const VALID_SOURCES = ["manual", "extracted", "feedback"] as const;

function errorResp(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

// POST /v1/memory — create
memoryRouter.post("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return errorResp(c, "Invalid JSON body", 400);
  }

  const { category, content, importance, tags, source } = body;

  if (!category || !VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
    return errorResp(c, `category is required and must be one of: ${VALID_CATEGORIES.join(" | ")}`, 400);
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return errorResp(c, "content is required and must be a non-empty string", 400);
  }
  if (content.length > 2000) {
    return errorResp(c, "content exceeds 2000 character limit", 400);
  }
  if (importance !== undefined) {
    const imp = Number(importance);
    if (!Number.isInteger(imp) || imp < 1 || imp > 5) {
      return errorResp(c, "importance must be an integer between 1 and 5", 400);
    }
  }
  if (tags !== undefined && !Array.isArray(tags)) {
    return errorResp(c, "tags must be an array of strings", 400);
  }
  if (Array.isArray(tags) && tags.length > 10) {
    return errorResp(c, "maximum 10 tags per entry", 400);
  }
  if (Array.isArray(tags) && tags.some((t) => typeof t !== "string" || t.length > 50)) {
    return errorResp(c, "each tag must be a string of at most 50 characters", 400);
  }
  if (source !== undefined && !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
    return errorResp(c, `source must be one of: ${VALID_SOURCES.join(" | ")}`, 400);
  }

  const input: MemoryEntryInput = {
    user_id: userId,
    category: category as MemoryEntryInput["category"],
    content: (content as string).trim(),
    importance: importance !== undefined ? Number(importance) : undefined,
    tags: tags !== undefined ? (tags as string[]) : undefined,
    source: source !== undefined ? (source as MemoryEntryInput["source"]) : undefined,
  };

  try {
    const entry = await MemoryEntryRepo.create(input);
    return c.json({ entry }, 201);
  } catch (err: any) {
    console.error("Memory create error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/memory — list
memoryRouter.get("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  const category = c.req.query("category") || undefined;
  const limitRaw = c.req.query("limit");
  let limit = 50;
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10);
    if (isNaN(parsed) || parsed < 1) {
      return errorResp(c, "limit must be a positive integer", 400);
    }
    limit = Math.min(parsed, 100);
  }

  try {
    const entries = await MemoryEntryRepo.list(userId, { category, limit });
    return c.json({ entries });
  } catch (err: any) {
    console.error("Memory list error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/memory/:id
// PUT  /v1/memory/:id
// DELETE /v1/memory/:id
memoryRouter
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    try {
      const entry = await MemoryEntryRepo.getById(id, userId);
      if (!entry) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.json({ entry });
    } catch (err: any) {
      console.error("Memory get error:", err);
      return errorResp(c, err.message, 500);
    }
  })
  .put("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return errorResp(c, "Invalid JSON body", 400);
    }

    const { content, importance, tags, category } = body;
    const update: MemoryEntryUpdate = {};

    if (content !== undefined) {
      if (typeof content !== "string" || content.trim().length === 0) {
        return errorResp(c, "content must be a non-empty string", 400);
      }
      if ((content as string).length > 2000) {
        return errorResp(c, "content exceeds 2000 character limit", 400);
      }
      update.content = (content as string).trim();
    }
    if (importance !== undefined) {
      const imp = Number(importance);
      if (!Number.isInteger(imp) || imp < 1 || imp > 5) {
        return errorResp(c, "importance must be an integer between 1 and 5", 400);
      }
      update.importance = imp;
    }
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        return errorResp(c, "tags must be an array of strings", 400);
      }
      if ((tags as string[]).length > 10) {
        return errorResp(c, "maximum 10 tags per entry", 400);
      }
      if ((tags as string[]).some((t) => typeof t !== "string" || t.length > 50)) {
        return errorResp(c, "each tag must be a string of at most 50 characters", 400);
      }
      update.tags = tags as string[];
    }
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
        return errorResp(c, `category must be one of: ${VALID_CATEGORIES.join(" | ")}`, 400);
      }
      update.category = category as MemoryEntryUpdate["category"];
    }

    try {
      const entry = await MemoryEntryRepo.update(id, userId, update);
      if (!entry) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.json({ entry });
    } catch (err: any) {
      console.error("Memory update error:", err);
      return errorResp(c, err.message, 500);
    }
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    // C3a: userId from middleware context
    const userId = getContextUserId(c)!;
    try {
      const deleted = await MemoryEntryRepo.delete(id, userId);
      if (!deleted) return errorResp(c, `Memory entry not found: ${id}`, 404);
      return c.body(null, 204);
    } catch (err: any) {
      console.error("Memory delete error:", err);
      return errorResp(c, err.message, 500);
    }
  });
