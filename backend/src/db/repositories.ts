import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type { DecisionRecord, BehavioralMemory, IdentityMemory, GrowthProfile, Task, TaskListItem, TaskSummary, TaskTrace, MemoryEntry, MemoryEntryInput, MemoryEntryUpdate, ExecutionResultRecord, ExecutionResultInput, Evidence, EvidenceInput } from "../types/index.js";
import { GROWTH_LEVELS } from "../config.js";
import { getEmbedding } from "../services/embedding.js";

export const DecisionRepo = {
  async save(d: DecisionRecord): Promise<void> {
    await query(
      `INSERT INTO decision_logs (
        id, user_id, session_id, query_preview, intent, complexity_score,
        input_token_count, has_code, has_math,
        router_version, fast_score, slow_score, confidence,
        selected_model, selected_role, selection_reason,
        context_original_tokens, context_compressed_tokens,
        compression_level, compression_ratio,
        model_used, exec_input_tokens, exec_output_tokens,
        total_cost_usd, latency_ms, did_fallback, fallback_reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [
        d.id, d.user_id, d.session_id,
        d.input_features.raw_query.substring(0, 200),
        d.input_features.intent, d.input_features.complexity_score,
        d.input_features.token_count, d.input_features.has_code, d.input_features.has_math,
        d.routing.router_version, d.routing.scores.fast, d.routing.scores.slow,
        d.routing.confidence, d.routing.selected_model, d.routing.selected_role,
        d.routing.selection_reason, d.context.original_tokens, d.context.compressed_tokens,
        d.context.compression_level, d.context.compression_ratio,
        d.execution.model_used, d.execution.input_tokens, d.execution.output_tokens,
        d.execution.total_cost_usd, d.execution.latency_ms, d.execution.did_fallback,
        d.execution.fallback_reason || null,
      ]
    );
  },

  async updateFeedback(id: string, feedbackType: string, feedbackScore: number): Promise<void> {
    await query(`UPDATE decision_logs SET feedback_type=$1, feedback_score=$2 WHERE id=$3`, [feedbackType, feedbackScore, id]);
  },

  async getRecent(userId: string, limit = 20): Promise<any[]> {
    const result = await query(`SELECT * FROM decision_logs WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return result.rows;
  },

  async getById(id: string): Promise<{ id: string; user_id: string } | null> {
    const result = await query(`SELECT id, user_id FROM decision_logs WHERE id=$1`, [id]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  },

  /** Get the latest decision log for a task (ordered by created_at DESC) */
  async getByTaskId(taskId: string): Promise<any | null> {
    // First get session_id from the task
    const taskResult = await query(`SELECT session_id FROM tasks WHERE id=$1`, [taskId]);
    if (taskResult.rows.length === 0) return null;
    const sessionId = taskResult.rows[0].session_id;
    if (!sessionId) return null;
    const result = await query(
      `SELECT * FROM decision_logs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0];
  },

  async getTodayStats(userId: string): Promise<any> {
    const result = await query(
      `WITH base AS (
        SELECT
          d.id,
          d.selected_role,
          d.exec_input_tokens,
          d.exec_output_tokens,
          d.total_cost_usd,
          d.latency_ms,
          d.did_fallback,
          d.cost_saved_vs_slow,
          d.feedback_score,
          fe.signal_level,
          -- L1 signal: feedback_events.signal_level <= 1,
          -- OR legacy: no feedback_events record but decision_logs.feedback_score IS NOT NULL
          CASE
            WHEN fe.signal_level IS NOT NULL AND fe.signal_level <= 1 THEN true
            WHEN fe.signal_level IS NULL AND d.feedback_score IS NOT NULL THEN true
            ELSE false
          END as has_l1_signal
        FROM decision_logs d
        LEFT JOIN feedback_events fe ON fe.decision_id = d.id AND fe.user_id = d.user_id
        WHERE d.user_id = $1 AND d.created_at >= CURRENT_DATE
      )
      SELECT
        COUNT(*)::int as total_requests,
        COUNT(*) FILTER (WHERE selected_role = 'fast')::int as fast_count,
        COUNT(*) FILTER (WHERE selected_role = 'slow')::int as slow_count,
        COUNT(*) FILTER (WHERE did_fallback = true)::int as fallback_count,
        COALESCE(SUM(exec_input_tokens + exec_output_tokens), 0)::int as total_tokens,
        COALESCE(SUM(total_cost_usd), 0)::float as total_cost,
        COALESCE(SUM(cost_saved_vs_slow), 0)::float as saved_cost,
        COALESCE(AVG(latency_ms), 0)::int as avg_latency,
        CASE WHEN COUNT(*) FILTER (WHERE has_l1_signal = true) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE has_l1_signal = true AND base.feedback_score > 0)::float /
            COUNT(*) FILTER (WHERE has_l1_signal = true)::float * 100
          )
          ELSE 0 END as satisfaction_rate
      FROM base
      WHERE has_l1_signal = true OR has_l1_signal = false`,
      [userId]
    );
    return result.rows[0];
  },

  /**
   * Computes daily satisfaction rate — the fraction of decisions with positive
   * feedback among all decisions that received any feedback.
   * Replaces the old getRoutingAccuracyHistory which relied on routing_correct,
   * a field that was always NULL (always hardcoded to true at logDecision time).
   * We have no ground-truth correctness label; satisfaction_score is the
   * honest proxy for routing quality.
   */
  async getRoutingAccuracyHistory(userId: string, days = 30): Promise<{ date: string; value: number }[]> {
    const result = await query(
      `WITH base AS (
        SELECT
          d.id,
          d.created_at::date as date,
          d.feedback_score,
          CASE
            WHEN fe.signal_level IS NOT NULL AND fe.signal_level <= 1 THEN true
            WHEN fe.signal_level IS NULL AND d.feedback_score IS NOT NULL THEN true
            ELSE false
          END as has_l1_signal
        FROM decision_logs d
        LEFT JOIN feedback_events fe ON fe.decision_id = d.id AND fe.user_id = d.user_id
        WHERE d.user_id = $1 AND d.created_at >= CURRENT_DATE - $2::int
      )
      SELECT
        date,
        CASE WHEN COUNT(*) FILTER (WHERE has_l1_signal = true) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE has_l1_signal = true AND base.feedback_score > 0)::float /
            COUNT(*) FILTER (WHERE has_l1_signal = true)::float * 100
          )
          ELSE NULL END as value
      FROM base
      GROUP BY date
      ORDER BY date`,
      [userId, days]
    );
    return result.rows
      .filter((r: any) => r.value !== null)
      .map((r: any) => ({ date: r.date.toISOString().split("T")[0], value: Number(r.value) }));
  },

  /** Sprint 23: 30-day cost ROI stats for Dashboard */
  async getCostStats(userId: string): Promise<{
    total_spent_usd: number;
    baseline_spent_usd: number;
    saved_usd: number;
    saved_percent: number;
    task_count: number;
    period_days: number;
  }> {
    // Import pricing here to avoid circular dependency
    const { calcBaselineCost } = await import("../config/pricing.js");

    const result = await query(
      `SELECT
        COUNT(*)::int as task_count,
        COALESCE(SUM(exec_input_tokens), 0)::int as total_input_tokens,
        COALESCE(SUM(exec_output_tokens), 0)::int as total_output_tokens,
        COALESCE(SUM(total_cost_usd), 0)::float as total_spent_usd
      FROM decision_logs
      WHERE user_id = $1
        AND created_at >= NOW() - INTERVAL '30 days'
        AND exec_input_tokens IS NOT NULL`,
      [userId],
    );

    const row = result.rows[0] ?? {
      task_count: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_spent_usd: 0,
    };

    const baseline_spent_usd = calcBaselineCost(
      Number(row.total_input_tokens),
      Number(row.total_output_tokens),
    );
    const saved_usd = Math.max(0, baseline_spent_usd - Number(row.total_spent_usd));
    const saved_percent =
      baseline_spent_usd > 0
        ? Math.round((saved_usd / baseline_spent_usd) * 100)
        : 0;

    return {
      total_spent_usd: Number(row.total_spent_usd),
      baseline_spent_usd,
      saved_usd,
      saved_percent,
      task_count: row.task_count,
      period_days: 30,
    };
  },
};

// ── Feedback Events ───────────────────────────────────────────────────────────

export interface FeedbackEvent {
  id: string;
  decision_id: string;
  user_id: string;
  event_type: string;
  signal_level: number;
  source: "ui" | "auto_detect" | "system";
  raw_data: Record<string, unknown> | null;
  created_at: Date;
}

/** Maps FeedbackType → { signal_level, source } */
const SIGNAL_CONFIG: Record<string, { signal_level: number; source: "ui" | "auto_detect" | "system" }> = {
  thumbs_up:        { signal_level: 1, source: "ui" },
  thumbs_down:      { signal_level: 1, source: "ui" },
  follow_up_thanks: { signal_level: 2, source: "auto_detect" },
  follow_up_doubt:  { signal_level: 2, source: "auto_detect" },
  regenerated:      { signal_level: 3, source: "auto_detect" },
  edited:           { signal_level: 3, source: "system" },
  accepted:         { signal_level: 1, source: "system" },
};

export const FeedbackEventRepo = {
  async save(event: {
    decisionId: string;
    userId: string;
    eventType: string;
    rawData?: Record<string, unknown>;
  }): Promise<void> {
    const config = SIGNAL_CONFIG[event.eventType] ?? { signal_level: 3, source: "system" as const };
    await query(
      `INSERT INTO feedback_events (id, decision_id, user_id, event_type, signal_level, source, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuid(), event.decisionId, event.userId, event.eventType, config.signal_level, config.source, event.rawData ? JSON.stringify(event.rawData) : null]
    );
  },

  /**
   * Batch-retrieves feedback events for a set of decision IDs.
   * Returns a Map: decisionId → signal_level (the signal level of the event,
   * which is deterministic per decision since each event_type maps to one signal_level).
   *
   * Used by analyzeAndLearn() to implement P5 signal-level gating:
   *   L1 (signal_level=1) → enters truth stats + eligibility
   *   L2 (signal_level=2) → enters eligibility only
   *   L3 (signal_level=3) → excluded from all learning logic
   *
   * If no event exists for a decision_id → not present in the returned Map.
   * analyzeAndLearn falls back to feedback_score != null as the L1/legacy heuristic.
   */
  async getByDecisionIds(userId: string, decisionIds: string[]): Promise<Map<string, number>> {
    if (decisionIds.length === 0) return new Map();
    const result = await query(
      `SELECT decision_id, signal_level
       FROM feedback_events
       WHERE user_id = $1 AND decision_id = ANY($2)`,
      [userId, decisionIds]
    );
    const map = new Map<string, number>();
    for (const row of result.rows) {
      // For deterministic behaviour: if multiple events exist for the same decision_id
      // (should not happen in normal flow, but guard against it), use the LOWEST signal_level
      // (most trustworhy signal wins).  signal_level: 1=strongest, 3=weakest.
      const existing = map.get(row.decision_id);
      if (existing === undefined || row.signal_level < existing) {
        map.set(row.decision_id, Number(row.signal_level));
      }
    }
    return map;
  },
};

export const MemoryRepo = {
  async getIdentity(userId: string): Promise<IdentityMemory | null> {
    const result = await query(`SELECT * FROM identity_memories WHERE user_id=$1`, [userId]);
    if (result.rows.length === 0) return null;
    const r = result.rows[0];
    return {
      user_id: r.user_id, response_style: r.response_style, expertise_level: r.expertise_level,
      domains: r.domains || [], quality_sensitivity: r.quality_sensitivity, cost_sensitivity: r.cost_sensitivity,
      preferred_fast_model: r.preferred_fast_model, preferred_slow_model: r.preferred_slow_model,
      updated_at: new Date(r.updated_at).getTime(),
    };
  },

  async upsertIdentity(mem: Partial<IdentityMemory> & { user_id: string }): Promise<void> {
    await query(
      `INSERT INTO identity_memories (user_id, response_style, expertise_level, domains, quality_sensitivity, cost_sensitivity)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         response_style = COALESCE($2, identity_memories.response_style),
         expertise_level = COALESCE($3, identity_memories.expertise_level),
         domains = COALESCE($4, identity_memories.domains),
         quality_sensitivity = COALESCE($5, identity_memories.quality_sensitivity),
         cost_sensitivity = COALESCE($6, identity_memories.cost_sensitivity),
         updated_at = NOW()`,
      [mem.user_id, mem.response_style || "balanced", mem.expertise_level || "intermediate", mem.domains || [], mem.quality_sensitivity ?? 0.5, mem.cost_sensitivity ?? 0.5]
    );
  },

  async getBehavioralMemories(userId: string): Promise<BehavioralMemory[]> {
    const result = await query(`SELECT * FROM behavioral_memories WHERE user_id=$1 AND strength > 0.1 ORDER BY strength DESC LIMIT 50`, [userId]);
    return result.rows.map((r: any) => ({
      id: r.id, user_id: r.user_id, trigger_pattern: r.trigger_pattern, observation: r.observation,
      learned_action: r.learned_action, strength: r.strength, reinforcement_count: r.reinforcement_count,
      last_activated: new Date(r.last_activated || r.created_at).getTime(),
      source_decision_ids: r.source_decision_ids || [], created_at: new Date(r.created_at).getTime(),
    }));
  },

  async saveBehavioralMemory(mem: BehavioralMemory): Promise<void> {
    await query(
      `INSERT INTO behavioral_memories (id, user_id, trigger_pattern, observation, learned_action, strength, reinforcement_count, last_activated, source_decision_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [mem.id, mem.user_id, mem.trigger_pattern, mem.observation, mem.learned_action, mem.strength, mem.reinforcement_count, new Date(mem.last_activated).toISOString(), mem.source_decision_ids]
    );
  },

  async reinforceMemory(id: string, delta: number): Promise<void> {
    await query(
      `UPDATE behavioral_memories SET strength = LEAST(1.0, GREATEST(0.0, strength + $1)), reinforcement_count = reinforcement_count + 1, last_activated = NOW(), updated_at = NOW() WHERE id = $2`,
      [delta, id]
    );
  },

  async decayMemories(): Promise<void> {
    await query(`UPDATE behavioral_memories SET strength = strength * 0.98 WHERE last_activated < NOW() - INTERVAL '7 days'`);
  },
};

export const TaskRepo = {
  async list(userId: string, sessionId?: string): Promise<TaskListItem[]> {
    let sql = `SELECT id as task_id, title, mode, status, complexity, risk, updated_at, session_id
      FROM tasks WHERE user_id=$1`;
    const params: any[] = [userId];
    if (sessionId) {
      sql += ` AND session_id=$2`;
      params.push(sessionId);
    }
    sql += ` ORDER BY updated_at DESC LIMIT 100`;
    const result = await query(sql, params);
    return result.rows.map((r: any) => ({
      task_id: r.task_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      updated_at: new Date(r.updated_at).toISOString(),
      session_id: r.session_id,
    }));
  },

  async getById(taskId: string): Promise<Task | null> {
    const result = await query(`SELECT * FROM tasks WHERE id=$1`, [taskId]);
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.id,
      user_id: r.user_id,
      session_id: r.session_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      goal: r.goal || null,
      budget_profile: typeof r.budget_profile === "object" ? r.budget_profile : {},
      tokens_used: r.tokens_used || 0,
      tool_calls_used: r.tool_calls_used || 0,
      steps_used: r.steps_used || 0,
      summary_ref: r.summary_ref || null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async create(data: {
    id: string;
    user_id: string;
    session_id: string;
    title: string;
    mode: string;
    complexity: string;
    risk: string;
    goal?: string;
    tokens_used?: number;
    status?: string;
  }): Promise<void> {
    await query(
      `INSERT INTO tasks (id, user_id, session_id, title, mode, complexity, risk, goal, tokens_used, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [data.id, data.user_id, data.session_id, data.title, data.mode, data.complexity, data.risk, data.goal || null, data.tokens_used || 0, data.status || "completed"]
    );
  },

  /** T1: Find the most recently active (non-terminal) task for a session+user pair. */
  async findActiveBySession(sessionId: string, userId: string): Promise<Task | null> {
    const result = await query(
      `SELECT * FROM tasks
       WHERE session_id=$1 AND user_id=$2 AND status NOT IN ('completed','failed','cancelled')
       ORDER BY updated_at DESC LIMIT 1`,
      [sessionId, userId]
    );
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.id,
      user_id: r.user_id,
      session_id: r.session_id,
      title: r.title || "",
      mode: r.mode,
      status: r.status,
      complexity: r.complexity,
      risk: r.risk,
      goal: r.goal || null,
      budget_profile: typeof r.budget_profile === "object" ? r.budget_profile : {},
      tokens_used: r.tokens_used || 0,
      tool_calls_used: r.tool_calls_used || 0,
      steps_used: r.steps_used || 0,
      summary_ref: r.summary_ref || null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  /** T1: Set task status directly (used by PATCH /v1/tasks/:id with action) */
  async setStatus(taskId: string, status: string): Promise<void> {
    await query(
      `UPDATE tasks SET status=$2, updated_at=NOW() WHERE id=$1`,
      [taskId, status]
    );
  },

  async updateExecution(taskId: string, tokensUsed: number): Promise<void> {
    await query(
      `UPDATE tasks SET tokens_used=$2, steps_used=steps_used+1, updated_at=NOW() WHERE id=$1`,
      [taskId, tokensUsed]
    );
  },

  async getSummary(taskId: string): Promise<TaskSummary | null> {
    const result = await query(`SELECT * FROM task_summaries WHERE task_id=$1`, [taskId]);
    if (result.rows.length === 0) return null;
    const r: any = result.rows[0];
    return {
      task_id: r.task_id,
      summary_id: r.id,
      goal: r.goal || null,
      confirmed_facts: r.confirmed_facts || [],
      completed_steps: r.completed_steps || [],
      blocked_by: r.blocked_by || [],
      next_step: r.next_step || null,
      summary_text: r.summary_text || null,
      version: r.version || 1,
      updated_at: new Date(r.updated_at).toISOString(),
    };
  },

  async getTraces(taskId: string, options?: { type?: string; limit?: number }): Promise<TaskTrace[]> {
    const typeFilter = options?.type;
    const limit = options?.limit ?? 100;

    let sql = `SELECT * FROM task_traces WHERE task_id=$1`;
    const params: any[] = [taskId];

    if (typeFilter) {
      sql += ` AND type=$2`;
      params.push(typeFilter);
    }
    sql += ` ORDER BY created_at ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    return result.rows.map((r: any) => {
      let detail: Record<string, any> | null = null;
      if (r.detail) {
        try {
          detail = typeof r.detail === "string" ? JSON.parse(r.detail) : r.detail;
        } catch {
          detail = { raw: r.detail };
        }
      }
      return {
        trace_id: r.id,
        task_id: r.task_id,
        type: r.type as import("../types/index.js").TraceType,
        detail,
        created_at: new Date(r.created_at).toISOString(),
      };
    });
  },

  async createTrace(data: { id: string; task_id: string; type: string; detail?: Record<string, any> | null }): Promise<void> {
    await query(
      `INSERT INTO task_traces (id, task_id, type, detail) VALUES ($1, $2, $3, $4)`,
      [data.id, data.task_id, data.type, data.detail ? JSON.stringify(data.detail) : null]
    );
  },
};

export const GrowthRepo = {
  async getProfile(userId: string): Promise<GrowthProfile> {
    const stats = await DecisionRepo.getTodayStats(userId);
    const history = await DecisionRepo.getRoutingAccuracyHistory(userId);
    const memories = await MemoryRepo.getBehavioralMemories(userId);

    const totalResult = await query(`SELECT COUNT(*)::int as total FROM decision_logs WHERE user_id=$1`, [userId]);
    const totalInteractions = totalResult.rows[0]?.total || 0;

    let currentLevel = GROWTH_LEVELS[0];
    for (const lvl of GROWTH_LEVELS) {
      if (totalInteractions >= lvl.min_interactions) currentLevel = lvl;
    }
    const nextLevel = GROWTH_LEVELS.find((l) => l.level === currentLevel.level + 1) || currentLevel;
    const progress = nextLevel === currentLevel ? 100 : Math.round(((totalInteractions - currentLevel.min_interactions) / (nextLevel.min_interactions - currentLevel.min_interactions)) * 100);

    const savedResult = await query(`SELECT COALESCE(SUM(cost_saved_vs_slow), 0)::float as total_saved FROM decision_logs WHERE user_id=$1`, [userId]);
    const milestonesResult = await query(`SELECT title, created_at FROM growth_milestones WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`, [userId]);

    const recentMemories = memories.sort((a, b) => b.created_at - a.created_at).slice(0, 5);

    return {
      user_id: userId, level: currentLevel.level, level_name: currentLevel.name, level_progress: progress,
      routing_accuracy: stats.satisfaction_rate || 0,  // was pulled from fake routing_correct history; now honest satisfaction proxy
      satisfaction_history: history,  // honest proxy: daily satisfaction rate (positive feedback / all feedback)
      cost_saving_rate: stats.total_cost > 0 ? Math.round((stats.saved_cost / (stats.total_cost + stats.saved_cost)) * 100) : 0,
      total_saved_usd: savedResult.rows[0]?.total_saved || 0,
      satisfaction_rate: stats.satisfaction_rate || 0, total_interactions: totalInteractions,
      behavioral_memories_count: memories.length,
      milestones: milestonesResult.rows.map((r: any) => ({ date: new Date(r.created_at).toISOString().split("T")[0], event: r.title })),
      recent_learnings: recentMemories.map((m) => ({ date: new Date(m.created_at).toISOString().split("T")[0], learning: m.observation })),
    };
  },

  async addMilestone(userId: string, type: string, title: string, value?: number): Promise<void> {
    await query(`INSERT INTO growth_milestones (id, user_id, milestone_type, title, metric_value) VALUES ($1, $2, $3, $4, $5)`,
      [uuid(), userId, type, title, value || null]);
  },
};

// ── Memory entries (MC-001) ────────────────────────────────────────────────────

export const MemoryEntryRepo = {
  async create(data: MemoryEntryInput): Promise<MemoryEntry> {
    const id = uuid();
    // M2: default relevance_score based on source (manual=0.5, auto_learn=0.3)
    const relevanceScore = data.relevance_score ?? (data.source === "auto_learn" ? 0.3 : 0.5);
    const result = await query(
      `INSERT INTO memory_entries (id, user_id, category, content, importance, tags, source, relevance_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        id,
        data.user_id,
        data.category,
        data.content,
        data.importance ?? 3,
        data.tags ?? [],
        data.source ?? "manual",
        relevanceScore,
      ]
    );
    const entry = mapMemoryRow(result.rows[0]);

    // Sprint 25: Async fire-and-forget embedding generation
    setImmediate(async () => {
      try {
        const embedding = await getEmbedding(data.content);
        if (embedding) {
          const vectorStr = `[${embedding.join(",")}]`;
          await query(
            `UPDATE memory_entries SET embedding = $1::vector WHERE id = $2`,
            [vectorStr, id]
          );
        }
      } catch {
        // Silent fail: embedding is optional
      }
    });

    return entry;
  },

  /**
   * M2: Boost relevance_score for recent auto_learn entries when positive feedback received.
   * Increases score by 0.3 (capped at 1.0) for entries within the time window.
   */
  async boostRecentAutoLearn(userId: string, windowMs: number = 300_000): Promise<void> {
    const since = new Date(Date.now() - windowMs).toISOString();
    await query(
      `UPDATE memory_entries
       SET relevance_score = LEAST(relevance_score + 0.3, 1.0)
       WHERE user_id = $1
         AND source = 'auto_learn'
         AND created_at > $2`,
      [userId, since]
    );
  },

  /**
   * Sprint 25: Vector similarity search using pgvector.
   * Returns entries ordered by cosine similarity (highest first).
   */
  async searchByVector(
    userId: string,
    queryEmbedding: number[],
    limit: number = 20,
    category?: string
  ): Promise<Array<MemoryEntry & { similarity: number }>> {
    const vectorStr = `[${queryEmbedding.join(",")}]`;
    const params: unknown[] = [userId, vectorStr, limit];
    let categoryClause = "";

    if (category) {
      params.push(category);
      categoryClause = `AND category = $${params.length}`;
    }

    const result = await query(
      `SELECT *,
              1 - (embedding <=> $2::vector) AS similarity
       FROM memory_entries
       WHERE user_id = $1
         AND embedding IS NOT NULL
         ${categoryClause}
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      params
    );

    return result.rows.map((r: any) => ({
      ...mapMemoryRow(r),
      similarity: parseFloat(r.similarity),
    }));
  },

  async getById(id: string, userId: string): Promise<MemoryEntry | null> {
    const result = await query(
      `SELECT * FROM memory_entries WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    if (result.rows.length === 0) return null;
    return mapMemoryRow(result.rows[0]);
  },

  async list(
    userId: string,
    opts?: { category?: string; limit?: number }
  ): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM memory_entries WHERE user_id=$1`;
    const params: any[] = [userId];
    if (opts?.category) {
      sql += ` AND category=$2`;
      params.push(opts.category);
    }
    sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(opts?.limit ?? 100);
    const result = await query(sql, params);
    return result.rows.map(mapMemoryRow);
  },

  async update(
    id: string,
    userId: string,
    data: MemoryEntryUpdate
  ): Promise<MemoryEntry | null> {
    const sets: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (data.content !== undefined) {
      sets.push(`content=$${idx++}`);
      params.push(data.content);
    }
    if (data.importance !== undefined) {
      sets.push(`importance=$${idx++}`);
      params.push(data.importance);
    }
    if (data.tags !== undefined) {
      sets.push(`tags=$${idx++}`);
      params.push(data.tags);
    }
    if (data.category !== undefined) {
      sets.push(`category=$${idx++}`);
      params.push(data.category);
    }
    if (sets.length === 0) return this.getById(id, userId);
    sets.push(`updated_at=NOW()`);
    params.push(id, userId);
    const result = await query(
      `UPDATE memory_entries SET ${sets.join(", ")} WHERE id=$${idx++} AND user_id=$${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return null;
    return mapMemoryRow(result.rows[0]);
  },

  async delete(id: string, userId: string): Promise<boolean> {
    const result = await query(
      `DELETE FROM memory_entries WHERE id=$1 AND user_id=$2`,
      [id, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getTopForUser(userId: string, limit: number): Promise<MemoryEntry[]> {
    const result = await query(
      `SELECT * FROM memory_entries
       WHERE user_id=$1
       ORDER BY importance DESC, updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapMemoryRow);
  },

  /**
   * Fetch recent memory entries for a given user + category within the past N days.
   * Used by analyzeAndLearn() for deduplication: avoids writing the same auto_learn
   * observation twice within the time window.
   */
  async findRecent(userId: string, category: string, days: number): Promise<MemoryEntry[]> {
    const result = await query(
      `SELECT * FROM memory_entries
       WHERE user_id=$1 AND category=$2
         AND created_at > NOW() - ($3 || ' days')::INTERVAL
       ORDER BY created_at DESC`,
      [userId, category, days]
    );
    return result.rows.map(mapMemoryRow);
  },
};

export const ExecutionResultRepo = {
  async save(r: ExecutionResultInput): Promise<ExecutionResultRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO execution_results (
        id, task_id, user_id, session_id,
        final_content, steps_summary, memory_entries_used,
        model_used, tool_count, duration_ms, reason
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        id,
        r.task_id,
        r.user_id,
        r.session_id,
        r.final_content,
        JSON.stringify(r.steps_summary),
        r.memory_entries_used ?? [],
        r.model_used ?? null,
        r.tool_count,
        r.duration_ms ?? null,
        r.reason,
      ]
    );
    return mapExecutionResultRow(result.rows[0]);
  },

  async getByTaskId(taskId: string): Promise<ExecutionResultRecord | null> {
    const result = await query(
      `SELECT * FROM execution_results WHERE task_id=$1 LIMIT 1`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    return mapExecutionResultRow(result.rows[0]);
  },

  async listByUser(
    userId: string,
    limit = 20
  ): Promise<ExecutionResultRecord[]> {
    const result = await query(
      `SELECT * FROM execution_results
       WHERE user_id=$1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapExecutionResultRow);
  },
};

function mapExecutionResultRow(r: any): ExecutionResultRecord {
  return {
    id: r.id,
    task_id: r.task_id,
    user_id: r.user_id,
    session_id: r.session_id,
    final_content: r.final_content,
    steps_summary: r.steps_summary ?? null,
    memory_entries_used: r.memory_entries_used ?? [],
    model_used: r.model_used,
    tool_count: r.tool_count ?? 0,
    duration_ms: r.duration_ms ?? null,
    reason: r.reason,
    created_at: new Date(r.created_at).toISOString(),
  };
}

function mapMemoryRow(r: any): MemoryEntry {
  return {
    id: r.id,
    user_id: r.user_id,
    category: r.category,
    content: r.content,
    importance: r.importance,
    tags: r.tags ?? [],
    source: r.source,
    relevance_score: r.relevance_score ?? 0.5,
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

// ── Evidence Repository (Layer 6 / E1) ──────────────────────────────────────

function mapEvidenceRow(r: any): Evidence {
  return {
    evidence_id: r.evidence_id,
    task_id: r.task_id,
    user_id: r.user_id,
    source: r.source,
    content: r.content,
    source_metadata: r.source_metadata ?? null,
    relevance_score: r.relevance_score ?? null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

// ── Delegation Archive (O-005) ───────────────────────────────────────────────
// 慢模型任务档案：每个委托任务的完整记录
// 慢模型每个任务独立对话，共享知识靠档案，不靠上下文累积
// 档案查询用于新任务启动时获取相关历史上下文

export interface DelegationArchiveEntry {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  original_message: string;
  delegation_prompt: string;
  slow_result: string | null;
  related_task_ids: string[];
  status: "pending" | "completed" | "failed";
  processing_ms: number | null;
  created_at: string;
  completed_at: string | null;
}

export const DelegationArchiveRepo = {
  /**
   * 档案创建（O-006：慢模型在后台完成后再写档案，所以直接写 completed）
   * 也可以先写 pending 再 complete，但 O-006 场景下慢模型完成后一起写更简单
   */
  async create(data: {
    task_id: string;
    user_id: string;
    session_id: string;
    original_message: string;
    delegation_prompt: string;
    slow_result?: string;
    processing_ms?: number;
  }): Promise<DelegationArchiveEntry> {
    const id = uuid();
    const status = data.slow_result !== undefined ? "completed" : "pending";
    const result = await query(
      `INSERT INTO delegation_archive
        (id, task_id, user_id, session_id, original_message, delegation_prompt, slow_result, status, processing_ms, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id, data.task_id, data.user_id, data.session_id,
        data.original_message, data.delegation_prompt,
        data.slow_result ?? null, status,
        data.processing_ms ?? null,
        status === "completed" ? new Date() : null,
      ]
    );
    return mapDelegationArchiveRow(result.rows[0]);
  },

  /**
   * 档案完成：慢模型执行完毕后写入结果
   * 注意：不再在慢模型对话中累积历史，任务间共享靠档案库
   */
  async complete(data: {
    task_id: string;
    slow_result: string;
    processing_ms: number;
  }): Promise<void> {
    await query(
      `UPDATE delegation_archive
       SET slow_result=$1, status='completed', processing_ms=$2, completed_at=NOW()
       WHERE task_id=$3`,
      [data.slow_result, data.processing_ms, data.task_id]
    );
  },

  /**
   * 档案失败
   */
  async fail(task_id: string, error: string): Promise<void> {
    await query(
      `UPDATE delegation_archive SET status='failed', completed_at=NOW() WHERE task_id=$1`,
      [task_id]
    );
  },

  /**
   * 查询用户最近的已完成档案（用于新任务启动时获取上下文）
   * 返回最近 N 条，不传历史对话，靠档案共享知识
   */
  async getRecentByUser(userId: string, limit = 5): Promise<DelegationArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM delegation_archive
       WHERE user_id=$1 AND status='completed'
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapDelegationArchiveRow);
  },

  /**
   * 查询单个档案
   */
  async getById(taskId: string): Promise<DelegationArchiveEntry | null> {
    const result = await query(
      `SELECT * FROM delegation_archive WHERE task_id=$1`,
      [taskId]
    );
    if (result.rows.length === 0) return null;
    return mapDelegationArchiveRow(result.rows[0]);
  },

  /**
   * 按 session 列出所有档案
   */
  async listBySession(userId: string, sessionId: string): Promise<DelegationArchiveEntry[]> {
    const result = await query(
      `SELECT * FROM delegation_archive
       WHERE user_id=$1 AND session_id=$2
       ORDER BY created_at ASC`,
      [userId, sessionId]
    );
    return result.rows.map(mapDelegationArchiveRow);
  },
};

function mapDelegationArchiveRow(r: any): DelegationArchiveEntry {
  return {
    id: r.id,
    task_id: r.task_id,
    user_id: r.user_id,
    session_id: r.session_id,
    original_message: r.original_message,
    delegation_prompt: r.delegation_prompt,
    slow_result: r.slow_result,
    related_task_ids: r.related_task_ids ?? [],
    status: r.status,
    processing_ms: r.processing_ms,
    created_at: new Date(r.created_at).toISOString(),
    completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
  };
}

export const EvidenceRepo = {
  async create(input: EvidenceInput): Promise<Evidence> {
    const id = uuid();
    const result = await query(
      `INSERT INTO evidence (evidence_id, task_id, user_id, source, content, source_metadata, relevance_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        input.task_id,
        input.user_id,
        input.source,
        input.content,
        input.source_metadata ? JSON.stringify(input.source_metadata) : null,
        input.relevance_score ?? null,
      ]
    );
    return mapEvidenceRow(result.rows[0]);
  },

  async getById(evidenceId: string): Promise<Evidence | null> {
    const result = await query(
      `SELECT * FROM evidence WHERE evidence_id=$1`,
      [evidenceId]
    );
    if (result.rows.length === 0) return null;
    return mapEvidenceRow(result.rows[0]);
  },

  async listByTask(taskId: string): Promise<Evidence[]> {
    const result = await query(
      `SELECT * FROM evidence WHERE task_id=$1 ORDER BY created_at ASC`,
      [taskId]
    );
    return result.rows.map(mapEvidenceRow);
  },

  async listByUser(userId: string, limit = 100): Promise<Evidence[]> {
    const result = await query(
      `SELECT * FROM evidence WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map(mapEvidenceRow);
  },
};
