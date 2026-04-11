import { v4 as uuid } from "uuid";
import { query } from "./connection.js";
import type { DecisionRecord, BehavioralMemory, IdentityMemory, GrowthProfile, Task, TaskListItem, TaskSummary, TaskTrace, MemoryEntry, MemoryEntryInput, MemoryEntryUpdate, ExecutionResultRecord, ExecutionResultInput } from "../types/index.js";
import { GROWTH_LEVELS } from "../config.js";

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

  async getTodayStats(userId: string): Promise<any> {
    const result = await query(
      `SELECT
        COUNT(*)::int as total_requests,
        COUNT(*) FILTER (WHERE selected_role='fast')::int as fast_count,
        COUNT(*) FILTER (WHERE selected_role='slow')::int as slow_count,
        COUNT(*) FILTER (WHERE did_fallback=true)::int as fallback_count,
        COALESCE(SUM(exec_input_tokens + exec_output_tokens), 0)::int as total_tokens,
        COALESCE(SUM(total_cost_usd), 0)::float as total_cost,
        COALESCE(SUM(cost_saved_vs_slow), 0)::float as saved_cost,
        COALESCE(AVG(latency_ms), 0)::int as avg_latency,
        CASE WHEN COUNT(*) FILTER (WHERE feedback_score IS NOT NULL) > 0
          THEN ROUND(COUNT(*) FILTER (WHERE feedback_score > 0)::float / COUNT(*) FILTER (WHERE feedback_score IS NOT NULL)::float * 100)
          ELSE 0 END as satisfaction_rate
      FROM decision_logs WHERE user_id=$1 AND created_at >= CURRENT_DATE`,
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
      `SELECT created_at::date as date,
        CASE WHEN COUNT(*) FILTER (WHERE feedback_score IS NOT NULL) > 0
          THEN ROUND(
            COUNT(*) FILTER (WHERE feedback_score > 0)::float /
            COUNT(*) FILTER (WHERE feedback_score IS NOT NULL)::float * 100
          )
          ELSE NULL END as value
      FROM decision_logs
      WHERE user_id=$1 AND created_at >= CURRENT_DATE - $2::int
      GROUP BY created_at::date
      ORDER BY date`,
      [userId, days]
    );
    return result.rows
      .filter((r: any) => r.value !== null)
      .map((r: any) => ({ date: r.date.toISOString().split("T")[0], value: Number(r.value) }));
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
  }): Promise<void> {
    await query(
      `INSERT INTO tasks (id, user_id, session_id, title, mode, complexity, risk, goal, tokens_used, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed')`,
      [data.id, data.user_id, data.session_id, data.title, data.mode, data.complexity, data.risk, data.goal || null, data.tokens_used || 0]
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
      routing_accuracy_history: history,  // kept for backward compat (deprecated)
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
    const result = await query(
      `INSERT INTO memory_entries (id, user_id, category, content, importance, tags, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        data.user_id,
        data.category,
        data.content,
        data.importance ?? 3,
        data.tags ?? [],
        data.source ?? "manual",
      ]
    );
    return mapMemoryRow(result.rows[0]);
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
    created_at: new Date(r.created_at).toISOString(),
    updated_at: new Date(r.updated_at).toISOString(),
  };
}
