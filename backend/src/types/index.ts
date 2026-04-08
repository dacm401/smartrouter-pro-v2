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
  role: "system" | "user" | "assistant";
  content: string;
  metadata?: { tokens?: number; compressed?: boolean; original_content?: string };
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
  routing_accuracy: number;
  routing_accuracy_history: { date: string; value: number }[];
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
    routing_accuracy: number;
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
  created_at: number;
  updated_at: number;
}

export interface TaskListItem {
  task_id: string;
  title: string;
  mode: TaskMode;
  status: TaskStatus;
  complexity: ComplexityLevel;
  risk: RiskLevel;
  updated_at: number;
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
  updated_at: number;
}

export type TraceType = "classification" | "routing" | "response" | "tool_call" | "error";

export interface TaskTrace {
  trace_id: string;
  task_id: string;
  type: TraceType;
  detail: Record<string, any> | null;
  created_at: number;
}
