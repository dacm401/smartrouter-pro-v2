// SmartRouter Pro - 核心类型定义

export type IntentType =
  | "simple_qa"
  | "reasoning"
  | "creative"
  | "code"
  | "math"
  | "translation"
  | "summarization"
  | "chat"
  | "unknown";

export type CompressionLevel = "L0" | "L1" | "L2" | "L3";

export type ModelRole = "fast" | "slow" | "compressor";

export type FeedbackType =
  | "accepted"
  | "regenerated"
  | "edited"
  | "thumbs_up"
  | "thumbs_down"
  | "follow_up_doubt"
  | "follow_up_thanks";

export interface InputFeatures {
  raw_query: string;
  token_count: number;
  intent: IntentType;
  complexity_score: number;
  has_code: boolean;
  has_math: boolean;
  requires_reasoning: boolean;
  conversation_depth: number;
  context_token_count: number;
  language: string;
}

export interface RoutingDecision {
  router_version: string;
  scores: { fast: number; slow: number };
  confidence: number;
  selected_model: string;
  selected_role: ModelRole;
  selection_reason: string;
  fallback_model: string;
}

export interface CompressionDetail {
  turn_index: number;
  role: "user" | "assistant";
  action: "kept" | "summarized" | "structured" | "removed";
  original_tokens: number;
  compressed_tokens: number;
  summary?: string;
}

export interface ContextResult {
  original_tokens: number;
  compressed_tokens: number;
  compression_level: CompressionLevel;
  compression_ratio: number;
  memory_items_retrieved: number;
  final_messages: ChatMessage[];
  compression_details: CompressionDetail[];
}

export interface ExecutionResult {
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
  did_fallback: boolean;
  fallback_reason?: string;
  response_text: string;
  quality_score?: number;
}

export interface DecisionRecord {
  id: string;
  user_id: string;
  session_id: string;
  timestamp: number;
  input_features: InputFeatures;
  routing: RoutingDecision;
  context: ContextResult;
  execution: ExecutionResult;
  feedback?: { type: FeedbackType; score: number; timestamp: number };
  learning_signal?: {
    routing_correct: boolean;
    cost_saved_vs_always_slow: number;
    quality_delta: number;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  metadata?: { tokens?: number; compressed?: boolean; original_content?: string };
  /** Tool calls emitted by the model (assistant messages with Function Calling) */
  tool_calls?: ToolCall[];
  /** ID of the tool call this message is responding to (tool messages only) */
  tool_call_id?: string;
  /** P4: ID of the routing DecisionRecord this message is responding to, used for implicit feedback detection */
  decision_id?: string;
}

export interface ChatRequest {
  user_id: string;
  session_id: string;
  message: string;
  history: ChatMessage[];
  preferences?: { mode: "quality" | "balanced" | "cost"; compression_level?: CompressionLevel };
  /** 前端设置透传：可覆盖后端环境变量 */
  api_key?: string;
  fast_model?: string;
  slow_model?: string;
  /** EL-003: If true, route this request through TaskPlanner + ExecutionLoop (multi-step execution). */
  execute?: boolean;
}

export interface ChatResponse {
  message: string;
  decision: DecisionRecord;
}

export interface IdentityMemory {
  user_id: string;
  response_style: "concise" | "detailed" | "balanced";
  expertise_level: "beginner" | "intermediate" | "expert";
  domains: string[];
  quality_sensitivity: number;
  cost_sensitivity: number;
  preferred_fast_model: string;
  preferred_slow_model: string;
  updated_at: number;
}

export interface BehavioralMemory {
  id: string;
  user_id: string;
  trigger_pattern: string;
  observation: string;
  learned_action: string;
  strength: number;
  reinforcement_count: number;
  last_activated: number;
  source_decision_ids: string[];
  created_at: number;
}

export interface GrowthProfile {
  user_id: string;
  level: number;
  level_name: string;
  level_progress: number;
  /** @deprecated Use satisfaction_rate. This field previously reflected fake routing_correct data. */
  routing_accuracy: number;
  /**
   * Daily satisfaction rate history (positive feedback / all feedback).
   * Renamed from routing_accuracy_history which was based on routing_correct = always-null.
   */
  satisfaction_history: { date: string; value: number }[];
  cost_saving_rate: number;
  total_saved_usd: number;
  satisfaction_rate: number;
  total_interactions: number;
  behavioral_memories_count: number;
  milestones: { date: string; event: string }[];
  recent_learnings: { date: string; learning: string }[];
}

export interface DashboardData {
  today: {
    total_requests: number;
    fast_count: number;
    slow_count: number;
    fallback_count: number;
    total_tokens: number;
    total_cost: number;
    saved_cost: number;
    saving_rate: number;
    avg_latency_ms: number;
    /**
     * Proxy metric for routing quality: satisfaction rate (positive feedback / all feedback).
     * Renamed from routing_accuracy which was a pseudo-metric backed by always-null routing_correct.
     */
    satisfaction_proxy: number;
  };
  token_flow: { fast_tokens: number; slow_tokens: number; compressed_tokens: number; fallback_tokens: number };
  recent_decisions: DecisionRecord[];
  growth: GrowthProfile;
}

export interface ModelPricing {
  model: string;
  input_per_1k: number;
  output_per_1k: number;
}

// ── Task entities ───────────────────────────────────────────────────────────

export type TaskMode = "direct" | "research" | "execute";
export type TaskStatus = "pending" | "running" | "waiting_subagent" | "completed" | "failed" | "blocked";
export type ComplexityLevel = "low" | "medium" | "high";
export type RiskLevel = "low" | "medium" | "high";

export interface Task {
  task_id: string;
  user_id: string;
  session_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  goal: string | null;
  budget_profile: Record<string, any>;
  tokens_used: number;
  tool_calls_used: number;
  steps_used: number;
  summary_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskListItem {
  task_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  updated_at: string;
  session_id: string;
}

export interface TaskDetail extends Task {}

export interface TaskSummary {
  task_id: string;
  summary_id: string;
  goal: string | null;
  confirmed_facts: string[];
  completed_steps: string[];
  blocked_by: string[];
  next_step: string | null;
  summary_text: string | null;
  version: number;
  updated_at: string;
}

export type TraceType =
  | "classification"
  | "routing"
  | "response"
  | "planning"
  | "guardrail"
  | "step_start"
  | "step_complete"
  | "step_failed"
  | "loop_start"
  | "loop_end"
  | "error";

export interface TaskTrace {
  trace_id: string;
  task_id: string;
  type: TraceType;
  detail: Record<string, any> | null;
  created_at: string;
}

export interface GetTracesOptions {
  /** Filter by trace type */
  type?: TraceType;
  /** Maximum number of traces to return (default: 100) */
  limit?: number;
}

/** Human-readable summary of a trace */
export interface TraceSummary {
  trace_id: string;
  type: TraceType;
  summary: string;
  created_at: string;
}

// ── Memory entries (MC-001) ──────────────────────────────────────────────────

export type MemoryCategory = "preference" | "fact" | "context" | "instruction";
export type MemorySource = "manual" | "extracted" | "feedback";

export interface MemoryEntry {
  id: string;
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance: number;   // 1–5
  tags: string[];
  source: MemorySource;
  created_at: string;   // ISO 8601 string (outward API)
  updated_at: string;
}

export interface MemoryEntryInput {
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance?: number;   // defaults to 3
  tags?: string[];
  source?: MemorySource;
}

export interface MemoryEntryUpdate {
  content?: string;
  importance?: number;
  tags?: string[];
  category?: MemoryCategory;
}

// ── Memory Retrieval (MR-001) ────────────────────────────────────────────────

/**
 * Context signal passed into the retrieval pipeline.
 * Currently lightweight: userMessage for keyword extraction,
 * with room to extend to embeddings or topic signals in MR-003.
 */
export interface MemoryRetrievalContext {
  /** The raw user message from the chat request */
  userMessage: string;
  /** Optional explicit keyword signals for retrieval (MR-003 may auto-extract) */
  keywords?: string[];
}

/**
 * A memory entry with a computed retrieval score and human-readable reason.
 * Used by the v2 retrieval pipeline.
 */
export interface MemoryRetrievalResult {
  entry: MemoryEntry;
  /** Composite score (higher = more relevant). Range not normalized. */
  score: number;
  /** Plain-language reason for the score, useful for debugging */
  reason: string;
}

/**
 * Per-category injection policy for the retrieval pipeline.
 * Controls which memories are eligible for injection based on category.
 */
export interface MemoryCategoryPolicy {
  /** Minimum importance level required for this category to be injected (1–5) */
  minImportance: number;
  /** If true, inject up to `maxCount` memories from this category regardless of score */
  alwaysInject: boolean;
  /** Max number of entries to inject from this category (default: 2) */
  maxCount?: number;
}

// ── Tool System (EL-001) ────────────────────────────────────────────────────

export type ToolScope = "internal" | "external";

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

/**
 * Tool definition — the contract between the model and the execution layer.
 * Used for both Function Calling schema injection and lightweight parse validation.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  scope: ToolScope;
}

/**
 * A tool invocation issued by the model.
 */
export interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

/**
 * Result of executing a single tool call.
 */
export interface ToolResult {
  call_id: string;
  tool_name: string;
  success: boolean;
  result: unknown;
  error?: string;
  latency_ms: number;
}

// ── Execution Plan (EL-002 / EL-003) ──────────────────────────────────────

export type StepType = "reasoning" | "tool_call" | "synthesis" | "unknown";
export type StepStatus = "pending" | "running" | "completed" | "failed" | "blocked";

export interface ExecutionStep {
  id: string;
  title: string;
  type: StepType;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  depends_on: string[];
  status: StepStatus;
  result?: unknown;
  error?: string;
}

/**
 * A full execution plan produced by the planner.
 */
export interface ExecutionPlan {
  task_id: string;
  steps: ExecutionStep[];
  current_step_index: number;
}

// ── Execution Result Persistence (ER-002) ────────────────────────────────────

/** Lightweight summary of one execution step (written to execution_results.steps_summary) */
export interface ExecutionStepSummary {
  index: number;
  title: string;
  type: StepType;
  status: "pending" | "in_progress" | "completed" | "failed";
  tool_name?: string;
  error?: string;
}

/** steps_summary JSONB shape stored in execution_results */
export interface ExecutionStepsSummary {
  totalSteps: number;
  completedSteps: number;
  toolCallsExecuted: number;
  steps: ExecutionStepSummary[];
}

/** A completed execution result record */
export interface ExecutionResultRecord {
  id: string;
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string | null;
  steps_summary: ExecutionStepsSummary | null;
  memory_entries_used: string[];
  model_used: string | null;
  tool_count: number;
  duration_ms: number | null;
  reason: string | null;
  created_at: string;
}

/** Input for saving a new execution result */
export interface ExecutionResultInput {
  task_id: string | null;
  user_id: string;
  session_id: string;
  final_content: string;
  steps_summary: ExecutionStepsSummary;
  memory_entries_used?: string[];
  model_used?: string;
  tool_count: number;
  duration_ms?: number;
  reason: string;
}
