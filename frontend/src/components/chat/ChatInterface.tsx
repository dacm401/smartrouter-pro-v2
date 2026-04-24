"use client";
import { useState, useRef, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { MessageBubble } from "./MessageBubble";
import { ModelSwitchAnim } from "./ModelSwitchAnim";
import { getApiConfig } from "@/lib/api";

/** Phase 3.0: SSE 委托生命周期状态项 */
export interface DelegationStatusItem {
  id: string;
  type: "manager_decision" | "clarifying_needed" | "archive_written" | "worker_started" | "command_issued" | "worker_completed" | "manager_synthesized";
  label: string;
  detail?: string;
  timestamp: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  decision?: any;
  streaming?: boolean;
  /** O-002: 委托状态，供轮询 + 展示使用 */
  delegation?: {
    status: "pending" | "completed" | "failed";
    slow_result?: string;
    error?: string;
    taskId?: string;
  };
  /** Phase 1.5: 澄清问题（Fast 模型请求用户确认） */
  clarifyQuestion?: {
    question_id: string;
    question_text: string;
    options?: string[];
  };
  /** Phase 2.0: 路由分层标识 */
  routing_layer?: "L0" | "L1" | "L2" | "L3";
}

interface ChatInterfaceProps {
  onTaskIdChange?: (taskId: string) => void;
  userId?: string;
  /** External sessionId — if provided, use it instead of generating one */
  sessionId?: string;
  /** Called when sessionId is first set/initialized */
  onSessionIdChange?: (sessionId: string) => void;
}

const QUICK_PROMPTS = [
  { label: "💡 解释量子计算", text: "解释量子计算的基本原理" },
  { label: "🔍 分析市场趋势", text: "分析一下当前AI行业的发展趋势" },
  { label: "💻 写一个排序算法", text: "用Python写一个快速排序算法" },
];

export function ChatInterface({ onTaskIdChange, userId: propUserId, sessionId: propSessionId, onSessionIdChange }: ChatInterfaceProps) {
  const userId = propUserId ?? "dev-user";
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // Phase 3.0: SSE 委托生命周期状态追踪
  const [delegationStatus, setDelegationStatus] = useState<DelegationStatusItem[]>([]);

  // Use external sessionId if provided, otherwise generate once
  const [sessionId, setSessionIdInternal] = useState<string>(() => propSessionId ?? uuid());

  // Notify parent when sessionId is first initialized
  useEffect(() => {
    if (sessionId && onSessionIdChange) {
      onSessionIdChange(sessionId);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [showFallbackAnim, setShowFallbackAnim] = useState<{ fromModel: string; toModel: string; reason: string } | null>(null);
  // Phase 1.5/2.0: 临时状态消息（status/clarifying 不写入 messages）
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [clarifyQuestion, setClarifyQuestion] = useState<{ question_id: string; question_text: string; options?: string[] } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, delegationStatus]);

  /** Phase 3.0: 添加 SSE 委托状态项（去重，防止重复事件） */
  const addDelegationStatus = (
    type: DelegationStatusItem["type"],
    label: string,
    detail?: string
  ) => {
    setDelegationStatus((prev) => {
      // 去重：同 type 只保留最新一条
      return [...prev.filter((i) => i.type !== type), { id: uuid(), type, label, detail, timestamp: new Date().toISOString() }];
    });
  };

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
            // 标准流式 chunk
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: m.content + (data.stream ?? ""), routing_layer: data.routing_layer ?? m.routing_layer }
                  : m
              )
            );
          } else if (data.type === "fast_reply") {
            // Phase 2.0: Fast 模型直接回复（带 routing_layer）
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: data.stream ?? "", routing_layer: data.routing_layer ?? m.routing_layer, streaming: false }
                  : m
              )
            );
          } else if (data.type === "clarifying") {
            // Phase 1.5: Fast 请求澄清 → 显示澄清问题
            setClarifyQuestion({
              question_id: data.question_id ?? uuid(),
              question_text: data.stream ?? "",
              options: data.options,
            });
            // 同时更新 placeholder 消息内容
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: data.stream ?? "", routing_layer: data.routing_layer ?? m.routing_layer, streaming: false }
                  : m
              )
            );
          } else if (data.type === "status") {
            // Phase 2.0: 慢模型处理中的安抚消息（临时状态，不写入消息列表）
            setStatusMsg(data.stream ?? null);
          } else if (data.type === "result") {
            // Phase 2.0: 慢模型完成 → 追加新消息显示结果
            const resultContent = data.stream ?? "";
            setStatusMsg(null);
            setMessages((prev) => [
              ...prev,
              {
                id: uuid(),
                role: "assistant",
                content: resultContent,
                routing_layer: data.routing_layer as "L0" | "L1" | "L2" | "L3" | undefined,
              },
            ]);
          } else if (data.type === "done") {
            setStatusMsg(null);
            setDelegationStatus([]); // Phase 3.0: 委托流程结束，清理状态
            if (data.task_id) onTaskIdChange?.(data.task_id);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, streaming: false, decision: data.decision, routing_layer: data.routing_layer ?? m.routing_layer }
                  : m
              )
            );
          } else if (data.type === "error") {
            setStatusMsg(null);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? { ...m, content: `⚠️ 流式错误：${data.stream ?? data.message ?? "Unknown error"}`, streaming: false }
                  : m
              )
            );
          // ── Phase 3.0 SSE 委托生命周期事件 ───────────────────────────────────
          } else if (data.type === "manager_decision") {
            // LLM-Native: Manager 做出路由决策，显示决策信息
            addDelegationStatus("manager_decision", `🔄 路由决策 [${data.routing_layer ?? "?"}]: ${data.decision_type ?? data.message ?? ""}`, data.message);
          } else if (data.type === "clarifying_needed") {
            // 请求澄清 → 同时触发 clarifyQuestion 弹窗
            setClarifyQuestion({
              question_id: data.question_id ?? uuid(),
              question_text: data.question_text ?? data.stream ?? "",
              options: data.options,
            });
            addDelegationStatus("clarifying_needed", `❓ 请求澄清: ${data.question_text ?? data.stream ?? ""}`);
          } else if (data.type === "archive_written") {
            // 委托存档已写入
            addDelegationStatus("archive_written", `📋 委托存档已写入 [${data.decision_type ?? ""}]`, `archive_id: ${data.archive_id ?? ""}`);
          } else if (data.type === "worker_started") {
            // Worker 开始执行
            addDelegationStatus("worker_started", `🚀 Worker 已启动 [${data.worker_role ?? "?"}]`, `task_id: ${data.task_id ?? ""}`);
          } else if (data.type === "command_issued") {
            // 命令已下发
            addDelegationStatus("command_issued", `📨 命令已下发 [${data.routing_layer ?? "?"}]`, `task_id: ${data.task_id ?? ""}`);
          } else if (data.type === "worker_completed") {
            // Worker 执行完成，显示摘要
            addDelegationStatus("worker_completed", `✅ Worker 执行完成 [${data.worker_type ?? "?"}]`, data.summary);
          } else if (data.type === "manager_synthesized") {
            // Manager 合成最终输出
            addDelegationStatus("manager_synthesized", `🧠 Manager 合成完成 [置信度 ${data.confidence != null ? Math.round(data.confidence * 100) : "?"}%]`, `长度: ${data.final_content?.length ?? 0} chars`);
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

  // O-002: 轮询委托任务，直到慢模型完成
  const pollDelegation = async (messageId: string, taskId: string) => {
    const { apiBase } = getApiConfig();
    const MAX_POLLS = 40; // 最多轮询40次（约2分钟）
    const POLL_INTERVAL = 3000; // 每3秒一次

    let pollCount = 0;

    const poll = async (): Promise<void> => {
      if (pollCount >= MAX_POLLS) {
        // 超时：标记为失败
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, delegation: { ...m.delegation, status: "failed" as const, error: "处理超时（约2分钟）" } }
              : m
          )
        );
        return;
      }

      pollCount++;

      try {
        const res = await fetch(`${apiBase}/api/chat-result/${taskId}`);
        if (!res.ok) {
          setTimeout(poll, POLL_INTERVAL);
          return;
        }

        const data = await res.json();

        if (data.status === "completed" && data.slowMessage) {
          // O-006: 慢模型完成：快模型已人格化包装，追加为新消息
          // 原快模型回复（人格化确认，如"好的，请稍候～"）保留在原位置
          // 新消息（人格化包装后的慢模型结果）追加在下方
          setMessages((prev) => [
            ...prev,
            {
              id: uuid(),
              role: "assistant" as const,
              content: data.slowMessage,
              delegation: { status: "completed" as const, taskId },
            },
          ]);
        } else if (data.status === "failed") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId
                ? { ...m, delegation: { ...m.delegation, status: "failed" as const, error: data.error || "处理失败" } }
                : m
            )
          );
        } else {
          // 还在处理中，继续轮询
          setTimeout(poll, POLL_INTERVAL);
        }
      } catch {
        setTimeout(poll, POLL_INTERVAL);
      }
    };

    // 开始首次轮询
    setTimeout(poll, POLL_INTERVAL);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Message = { id: uuid(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    // Phase 1.5/2.0: 发送前清除临时状态
    setClarifyQuestion(null);
    setStatusMsg(null);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content, decision_id: m.decision?.id }));

      const streamed = await sendStreaming(text, history);
      if (!streamed) {
        const data = await sendFallback(text, history);
        if (data.task_id) onTaskIdChange?.(data.task_id);
        const replyContent = data.message || "⚠️ 收到空响应，请检查后端日志。";
        const routingLayer = data.decision?.routing?.routing_layer;

        // O-002: 如果后端返回了 delegation，说明这是 orchestrator 路径
        if (data.delegation) {
          const assistantMsgId = uuid();
          const taskId = data.delegation.task_id;

          // 先显示快模型回复 + pending 状态
          setMessages((prev) => [
            ...prev,
            {
              id: assistantMsgId,
              role: "assistant",
              content: replyContent,
              decision: data.decision,
              delegation: { status: "pending", taskId },
              routing_layer: routingLayer,
            },
          ]);

          // 后台轮询慢模型结果
          pollDelegation(assistantMsgId, taskId);
        } else if (data.decision?.execution?.did_fallback) {
          setShowFallbackAnim({
            fromModel: data.decision.routing.selected_model,
            toModel: data.decision.execution.model_used,
            reason: data.decision.execution.fallback_reason || "质量不达标",
          });
          setTimeout(() => {
            setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision, routing_layer: routingLayer }]);
            setShowFallbackAnim(null);
          }, 3000);
        } else {
          setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision, routing_layer: routingLayer }]);
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

  // Phase 1.5: 处理澄清选项点击
  const handleClarifyOption = (option: string) => {
    if (!clarifyQuestion) return;
    // 将选项作为用户输入发送
    const selectedOption = option;
    setClarifyQuestion(null);
    setInput(selectedOption);
    // 自动发送
    setTimeout(() => {
      handleSendWithText(selectedOption);
    }, 50);
  };

  // 辅助函数：使用给定文本发送消息
  const handleSendWithText = (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: uuid(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setClarifyQuestion(null);
    setStatusMsg(null);
    setDelegationStatus([]); // Phase 3.0: 清空旧委托状态
    const history = messages.map((m) => ({ role: m.role, content: m.content, decision_id: m.decision?.id }));
    sendStreaming(text, history).then((ok) => {
      if (!ok) {
        sendFallback(text, history).then((data) => {
          if (data.task_id) onTaskIdChange?.(data.task_id);
          const replyContent = data.message || "⚠️ 收到空响应，请检查后端日志。";
          if (data.delegation) {
            const assistantMsgId = uuid();
            const taskId = data.delegation.task_id;
            setMessages((prev) => [
              ...prev,
              { id: assistantMsgId, role: "assistant", content: replyContent, decision: data.decision, delegation: { status: "pending", taskId }, routing_layer: data.decision?.routing?.routing_layer },
            ]);
            pollDelegation(assistantMsgId, taskId);
          } else {
            setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision, routing_layer: data.decision?.routing?.routing_layer }]);
          }
        }).catch((err: any) => {
          setMessages((prev) => [
            ...prev,
            { id: uuid(), role: "assistant", content: `⚠️ 请求失败：${err?.message || "请检查API配置"}` },
          ]);
        }).finally(() => {
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });
  };

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

        {/* Phase 3.0: SSE 委托生命周期状态指示器 */}
        {delegationStatus.length > 0 && (
          <div className="mb-3 flex flex-col gap-1.5 animate-fade-in-up">
            <div className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              ⚙️ 委托进度
            </div>
            {delegationStatus.map((item) => (
              <div key={item.id} className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
                style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}>
                <span className="flex-shrink-0 mt-0.5">{item.label.split(" ")[0]}</span>
                <div className="flex-1 min-w-0">
                  <div style={{ color: "var(--text-primary)" }} className="truncate">
                    {item.label.replace(/^[^\s]+\s/, "")}
                  </div>
                  {item.detail && (
                    <div className="truncate mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {item.detail}
                    </div>
                  )}
                </div>
                <span className="flex-shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(item.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
              </div>
            ))}
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
              delegation={msg.delegation}
              routingLayer={msg.routing_layer}
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

        {/* Phase 2.0: 路由分层 badge（最后一条 assistant 消息） */}
        {/* Phase 1.5: 澄清问题 UI */}
        {clarifyQuestion && (
          <div className="flex flex-col gap-2 mb-3 animate-fade-in-up">
            <div className="px-4 py-3 rounded-2xl max-w-md ml-4"
              style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <div className="text-xs mb-2" style={{ color: "var(--accent-amber)" }}>💬 需要确认一下</div>
              <div className="text-sm" style={{ color: "var(--text-primary)" }}>{clarifyQuestion.question_text}</div>
              {clarifyQuestion.options && clarifyQuestion.options.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {clarifyQuestion.options.map((opt, i) => (
                    <button
                      key={i}
                      onClick={() => handleClarifyOption(opt)}
                      className="px-3 py-1.5 rounded-lg text-xs transition-all hover:scale-105"
                      style={{
                        backgroundColor: "rgba(245,158,11,0.12)",
                        border: "1px solid rgba(245,158,11,0.4)",
                        color: "var(--accent-amber)",
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 2.0: 慢模型处理中状态消息（临时显示） */}
        {statusMsg && (
          <div className="flex items-center gap-2 mb-2 animate-fade-in-up">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: "var(--accent-blue)" }} />
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>{statusMsg}</div>
          </div>
        )}

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
