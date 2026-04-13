// 获取API配置
export function getApiConfig() {
  const DEFAULT_API_BASE = "http://localhost:3001";
  if (typeof window !== "undefined") {
    // 强制纠正：不允许 api_url 指向外部 API，只能是本地后端
    const storedUrl = localStorage.getItem("api_url");
    if (storedUrl && storedUrl !== DEFAULT_API_BASE) {
      localStorage.setItem("api_url", DEFAULT_API_BASE);
    }
    return {
      apiBase: DEFAULT_API_BASE,
      apiKey: localStorage.getItem("api_key") || "",
      fastModel: localStorage.getItem("fast_model") || "Qwen/Qwen2.5-7B-Instruct",
      slowModel: localStorage.getItem("slow_model") || "deepseek-ai/DeepSeek-V3",
    };
  }
  return {
    apiBase: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE,
    apiKey: "",
    fastModel: "Qwen/Qwen2.5-7B-Instruct",
    slowModel: "deepseek-ai/DeepSeek-V3",
  };
}

/** Exported so components can build streaming fetch URLs directly */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function sendMessage(message: string, history: any[], userId: string, sessionId: string) {
  const { apiBase, apiKey, fastModel, slowModel } = getApiConfig();
  const body: Record<string, any> = { user_id: userId, session_id: sessionId, message, history };
  // 如果前端设置里有 Key / 模型，透传给后端覆盖环境变量
  if (apiKey) body.api_key = apiKey;
  if (fastModel) body.fast_model = fastModel;
  if (slowModel) body.slow_model = slowModel;

  const res = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `服务器错误 (${res.status})`);
  }
  return data;
}

export async function getDashboard(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/dashboard/${userId}`);
  return res.json();
}

export async function getGrowth(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/growth/${userId}`);
  return res.json();
}

export async function sendFeedback(decisionId: string, type: string, userId: string) {
  const { apiBase } = getApiConfig();
  await fetch(`${apiBase}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision_id: decisionId, feedback_type: type, user_id: userId }),
  });
}

// UI1: Workbench panels API helpers
// NOTE: tasks and evidence live under /v1/* (backend index.ts app.route("/v1/tasks/...", taskRouter))

export async function fetchTasks(userId: string, sessionId?: string) {
  const { apiBase } = getApiConfig();
  const url = sessionId
    ? `${apiBase}/v1/tasks/all?session_id=${encodeURIComponent(sessionId)}`
    : `${apiBase}/v1/tasks/all`;
  const res = await fetch(url, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskDetail(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务详情失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskSummary(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/summary`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务摘要失败 (${res.status})`);
  return res.json();
}

export async function fetchEvidence(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/evidence?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载证据列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTraces(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/traces`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载执行轨迹失败 (${res.status})`);
  return res.json();
}

// H1: Runtime Health Dashboard
export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime_seconds: number;
  version: string;
  services: {
    database: { status: "ok" | "error"; latency_ms: number | null };
    model_router: { status: "ok" | "error"; providers: string[] };
    web_search: { status: "configured" | "not_configured" };
  };
  stats: {
    tasks_total: number;
    tasks_active: number;
    memory_entries: number;
    evidence_total: number;
  } | null;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/health`);
  if (!res.ok) throw new Error(`加载健康状态失败 (${res.status})`);
  return res.json();
}

// Memory API helpers
export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  source: string | null;
  created_at: string;
  relevance_score?: number;
}

export async function fetchMemory(userId: string, category?: string): Promise<{ entries: MemoryEntry[] }> {
  const { apiBase } = getApiConfig();
  const url = category
    ? `${apiBase}/v1/memory?category=${encodeURIComponent(category)}`
    : `${apiBase}/v1/memory`;
  const res = await fetch(url, { headers: { "X-User-Id": userId } });
  if (!res.ok) throw new Error(`加载记忆列表失败 (${res.status})`);
  return res.json() as Promise<{ entries: MemoryEntry[] }>;
}

export async function deleteMemory(id: string, userId: string): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`删除记忆失败 (${res.status})`);
}

export async function createMemoryEntry(
  userId: string,
  category: string,
  content: string,
  source: string = "manual"
): Promise<MemoryEntry> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify({ category, content, source }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `添加记忆失败 (${res.status})`);
  }
  const data = await res.json();
  return data.entry as MemoryEntry;
}

export async function fetchDecision(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/decision`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载决策数据失败 (${res.status})`);
  return res.json();
}

export async function patchTask(taskId: string, userId: string, action: "resume" | "pause" | "cancel"): Promise<boolean> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify({ action }),
  });
  return res.ok;
}

export interface CostStats {
  total_spent_usd: number;
  baseline_spent_usd: number;
  saved_usd: number;
  saved_percent: number;
  task_count: number;
  period_days: number;
}

export async function fetchCostStats(userId: string): Promise<CostStats> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/cost-stats/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error(`加载成本统计失败 (${res.status})`);
  return res.json() as Promise<CostStats>;
}
