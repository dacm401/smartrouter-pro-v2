import { Hono } from "hono";
import { EvidenceRepo } from "../db/repositories.js";
import type { EvidenceInput } from "../types/index.js";
import { getContextUserId } from "../middleware/identity.js";

export const evidenceRouter = new Hono();

const VALID_SOURCES = ["web_search", "http_request", "manual"] as const;

function errorResp(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

// POST /v1/evidence — create evidence record
evidenceRouter.post("/", async (c) => {
  // C3a: userId from middleware context
  const userId = getContextUserId(c)!;
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return errorResp(c, "Invalid JSON body", 400);
  }

  const { task_id, source, content, source_metadata, relevance_score } = body;

  if (!task_id || typeof task_id !== "string") {
    return errorResp(c, "task_id is required and must be a non-empty string", 400);
  }
  if (!source || !VALID_SOURCES.includes(source as typeof VALID_SOURCES[number])) {
    return errorResp(c, `source is required and must be one of: ${VALID_SOURCES.join(" | ")}`, 400);
  }
  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return errorResp(c, "content is required and must be a non-empty string", 400);
  }
  if (source_metadata !== undefined && typeof source_metadata !== "object") {
    return errorResp(c, "source_metadata must be an object or omitted", 400);
  }
  if (relevance_score !== undefined) {
    const score = Number(relevance_score);
    if (isNaN(score) || score < 0 || score > 1) {
      return errorResp(c, "relevance_score must be a number between 0 and 1", 400);
    }
  }

  const input: EvidenceInput = {
    task_id: task_id as string,
    user_id: userId,
    source: source as EvidenceInput["source"],
    content: (content as string).trim(),
    source_metadata: source_metadata as Record<string, unknown> | undefined,
    relevance_score: relevance_score !== undefined ? Number(relevance_score) : undefined,
  };

  try {
    const evidence = await EvidenceRepo.create(input);
    return c.json({ evidence }, 201);
  } catch (err: any) {
    console.error("Evidence create error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/evidence?task_id=xxx — list by task
// GET /v1/evidence/:id — get by id
evidenceRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const evidence = await EvidenceRepo.getById(id);
    if (!evidence) return errorResp(c, `Evidence not found: ${id}`, 404);
    return c.json({ evidence });
  } catch (err: any) {
    console.error("Evidence get error:", err);
    return errorResp(c, err.message, 500);
  }
});

// GET /v1/evidence?task_id=xxx
evidenceRouter.get("/", async (c) => {
  const taskId = c.req.query("task_id");
  if (taskId) {
    try {
      const records = await EvidenceRepo.listByTask(taskId);
      return c.json({ evidence: records });
    } catch (err: any) {
      console.error("Evidence listByTask error:", err);
      return errorResp(c, err.message, 500);
    }
  }
  // If no filter, require userId context (middleware always provides it)
  const userId = getContextUserId(c)!;
  const limitRaw = c.req.query("limit");
  let limit = 100;
  if (limitRaw !== undefined) {
    const parsed = parseInt(limitRaw, 10);
    if (isNaN(parsed) || parsed < 1) {
      return errorResp(c, "limit must be a positive integer", 400);
    }
    limit = Math.min(parsed, 500);
  }
  try {
    const records = await EvidenceRepo.listByUser(userId, limit);
    return c.json({ evidence: records });
  } catch (err: any) {
    console.error("Evidence listByUser error:", err);
    return errorResp(c, err.message, 500);
  }
});
