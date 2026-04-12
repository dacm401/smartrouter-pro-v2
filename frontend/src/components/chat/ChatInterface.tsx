"use client";
import { useState, useRef, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { MessageBubble } from "./MessageBubble";
import { ModelSwitchAnim } from "./ModelSwitchAnim";
import { getApiConfig } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  decision?: any;
  streaming?: boolean;
}

interface ChatInterfaceProps {
  onTaskIdChange?: (taskId: string) => void;
  userId?: string;
}

const QUICK_PROMPTS = [
  { label: "💡 解释量子计算", text: "解释量子计算的基本原理" },
  { label: "🔍 分析市场趋势", text: "分析一下当前AI行业的发展趋势" },
  { label: "💻 写一个排序算法", text: "用Python写一个快速排序算法" },
];

export function ChatInterface({ onTaskIdChange, userId: propUserId }: ChatInterfaceProps) {
  const userId = propUserId ?? "dev-user";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => uuid());
  const [showFallbackAnim, setShowFallbackAnim] = useState<{ fromModel: string; toModel: string; reason: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendStreaming = async (text: string, history: any[]): Promise<boolean> => {
    const { apiBase, apiKey, fastModel, slowModel } = getApiConfig();
    const body: Record<string, any> = {
      user_id: userId,
      session_id: sessionId,
      message: text,
      history,
      stream: true,
    };
    if (apiKey) body.api_key = apiKey;
    if (fastModel) body.fast_model = fastModel;
    if (slowModel) body.slow_model = slowModel;

    let response: Response;
    try {
      response = await fetch(`${apiBase}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-User-Id": userId },
        body: JSON.stringify(body),
      });
    } catch {
      return false;
    }

    if (!response.ok || !response.body) return false;

    const placeholderId = uuid();
    setMessages((prev) => [...prev, { id: placeholderId, role: "assistant", content: "", streaming: true }]);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let data: any;
          try { data = JSON.parse(raw); } catch { continue; }

          if (data.type === "chunk") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, content: m.content + (data.content ?? "") } : m
              )
            );
          } else if (data.type === "done") {
            if (data.task_id) onTaskIdChange?.(data.task_id);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId ? { ...m, streaming: false, decision: data.decision } : m
              )
            );
          } else if (data.type === "error") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: `⚠️ 流式错误：${data.message}`, streaming: false }
                  : m
              )
            );
          }
        }
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === placeholderId ? { ...m, streaming: false } : m))
      );
      return false;
    }

    return true;
  };

  const sendFallback = async (text: string, history: any[]) => {
    const { apiBase, apiKey, fastModel, slowModel } = getApiConfig();
    const body: Record<string, any> = {
      user_id: userId,
      session_id: sessionId,
      message: text,
      history,
    };
    if (apiKey) body.api_key = apiKey;
    if (fastModel) body.fast_model = fastModel;
    if (slowModel) body.slow_model = slowModel;

    const res = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `服务器错误 (${res.status})`);
    return data;
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Message = { id: uuid(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content, decision_id: m.decision?.id }));

      const streamed = await sendStreaming(text, history);
      if (!streamed) {
        const data = await sendFallback(text, history);
        if (data.task_id) onTaskIdChange?.(data.task_id);
        const replyContent = data.message || "⚠️ 收到空响应，请检查后端日志。";
        if (data.decision?.execution?.did_fallback) {
          setShowFallbackAnim({
            fromModel: data.decision.routing.selected_model,
            toModel: data.decision.execution.model_used,
            reason: data.decision.execution.fallback_reason || "质量不达标",
          });
          setTimeout(() => {
            setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision }]);
            setShowFallbackAnim(null);
          }, 3000);
        } else {
          setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision }]);
        }
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: "assistant", content: `⚠️ 请求失败：${err?.message || "请检查API配置或点击右上角设置。"}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isStreaming = messages.some((m) => m.streaming);

  return (
    <div className="flex flex-col h-full">
      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center animate-fade-in">
            {/* Big logo */}
            <div
              className="text-5xl mb-4"
              style={{
                color: "var(--accent-blue)",
                textShadow: "0 0 40px rgba(59,130,246,0.4)",
              }}
            >
              ◈
            </div>
            <div className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>
              SmartRouter Pro
            </div>
            <div className="text-xs mb-6 max-w-xs" style={{ color: "var(--text-muted)" }}>
              你能看到它在思考，你能看到它在成长
            </div>

            {/* Quick prompt cards */}
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
              {QUICK_PROMPTS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q.text)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-left text-xs transition-all animate-fade-in-up"
                  style={{
                    backgroundColor: "var(--bg-elevated)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-secondary)",
                    animationDelay: `${i * 0.05}s`,
                  }}
                >
                  <span>{q.label.split(" ")[0]}</span>
                  <span>{q.label.split(" ").slice(1).join(" ")}</span>
                </button>
              ))}
            </div>

            {/* Hint */}
            <div
              className="mt-4 px-3 py-2 rounded-lg text-[11px] max-w-sm"
              style={{
                backgroundColor: "rgba(245,158,11,0.08)",
                border: "1px solid rgba(245,158,11,0.2)",
                color: "var(--accent-amber)",
              }}
            >
              💡 首次使用请点击右上角「Settings」配置 API 地址
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div key={msg.id} className="animate-fade-in-up">
            <MessageBubble
              role={msg.role}
              content={msg.content}
              decision={msg.decision}
              userId={userId}
            />
            {/* Streaming cursor — new design */}
            {msg.streaming && (
              <div className="flex justify-start mb-2 pl-4">
                <span
                  className="text-sm font-mono animate-blink"
                  style={{ color: "var(--accent-blue)" }}
                >
                  ▋
                </span>
              </div>
            )}
          </div>
        ))}

        {/* Model switch animation */}
        {showFallbackAnim && (
          <ModelSwitchAnim
            fromModel={showFallbackAnim.fromModel}
            toModel={showFallbackAnim.toModel}
            reason={showFallbackAnim.reason}
            onDone={() => {}}
          />
        )}

        {/* Loading dots (non-streaming) */}
        {loading && !isStreaming && !showFallbackAnim && (
          <div className="flex justify-start mb-4 animate-fade-in">
            <div
              className="px-4 py-3"
              style={{
                backgroundColor: "var(--bg-elevated)",
                borderRadius: "4px 18px 18px 18px",
              }}
            >
              <div className="flex items-center gap-1">
                <div
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ backgroundColor: "var(--text-muted)", animationDelay: "0ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ backgroundColor: "var(--text-muted)", animationDelay: "150ms" }}
                />
                <div
                  className="w-1.5 h-1.5 rounded-full animate-bounce"
                  style={{ backgroundColor: "var(--text-muted)", animationDelay: "300ms" }}
                />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-end gap-2">
          <div
            className="flex-1 flex items-end gap-2 px-3 py-2.5 rounded-xl transition-all"
            style={{
              backgroundColor: "var(--bg-elevated)",
              border: "1px solid var(--border-default)",
            }}
            onFocus={() => {
              const el = document.activeElement?.closest(".flex.items-end.gap-2 > div");
              if (el) {
                (el as HTMLElement).style.borderColor = "var(--accent-blue)";
                (el as HTMLElement).style.boxShadow = "var(--glow-blue)";
              }
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息... (Enter 发送)"
              className="flex-1 resize-none outline-none text-sm max-h-32 min-h-[24px] leading-relaxed"
              style={{
                backgroundColor: "transparent",
                color: "var(--text-primary)",
              }}
              rows={1}
            />
            {/* Character count */}
            <span className="text-[10px] flex-shrink-0 pb-0.5" style={{ color: "var(--text-muted)" }}>
              {input.length > 0 ? `${input.length}` : ""}
            </span>
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-glow-blue"
            style={{
              backgroundColor: "var(--accent-blue)",
              color: "white",
            }}
            title="发送"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7L12 2L7.5 12L6.5 7.5L2 7Z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Footer hint */}
        <div className="text-center mt-1.5">
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            系统自动选择最优模型 · 每次决策完全透明
          </span>
        </div>
      </div>
    </div>
  );
}
