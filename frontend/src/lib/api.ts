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

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
