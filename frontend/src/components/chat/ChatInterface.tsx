"use client";
import { useState, useRef, useEffect } from "react";
import { v4 as uuid } from "uuid";
import { MessageBubble } from "./MessageBubble";
import { ModelSwitchAnim } from "./ModelSwitchAnim";
import { sendMessage } from "@/lib/api";

interface Message { id: string; role: "user" | "assistant"; content: string; decision?: any; }
const USER_ID = "user-001";

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => uuid());
  const [showFallbackAnim, setShowFallbackAnim] = useState<{ fromModel: string; toModel: string; reason: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: Message = { id: uuid(), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const data = await sendMessage(text, history, USER_ID, sessionId);
      const replyContent = data.message || "⚠️ 收到空响应，请检查后端日志。";
      if (data.decision?.execution?.did_fallback) {
        setShowFallbackAnim({ fromModel: data.decision.routing.selected_model, toModel: data.decision.execution.model_used, reason: data.decision.execution.fallback_reason || "质量不达标" });
        setTimeout(() => { setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision }]); setShowFallbackAnim(null); }, 3000);
      } else {
        setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: replyContent, decision: data.decision }]);
      }
    } catch (err: any) { setMessages((prev) => [...prev, { id: uuid(), role: "assistant", content: `⚠️ 请求失败：${err?.message || "请检查API配置或点击右上角设置。"}` }]); } finally { setLoading(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 space-y-3">
            <div className="text-5xl">🚀</div>
            <div className="text-lg font-medium text-gray-600">SmartRouter Pro</div>
            <div className="text-sm max-w-xs">透明的、会成长的AI智能运行时。<br />每次回答都能看到模型选择、Token消耗和决策理由。</div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
              {["今天天气怎么样？", "帮我分析代码性能", "用Python写快速排序", "解释量子纠缠原理"].map((q) => (<button key={q} onClick={() => setInput(q)} className="bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-2 text-left transition-colors">{q}</button>))}
            </div>
            <div className="mt-4 p-3 bg-yellow-50 rounded-lg border border-yellow-200 text-xs text-yellow-700 max-w-sm">
              💡 首次使用请点击右上角「设置」配置API地址
            </div>
          </div>
        )}
        {messages.map((msg) => (<MessageBubble key={msg.id} role={msg.role} content={msg.content} decision={msg.decision} userId={USER_ID} />))}
        {showFallbackAnim && <ModelSwitchAnim fromModel={showFallbackAnim.fromModel} toModel={showFallbackAnim.toModel} reason={showFallbackAnim.reason} onDone={() => {}} />}
        {loading && !showFallbackAnim && (
          <div className="flex justify-start mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className="border-t bg-white px-4 py-3">
        <div className="flex items-end gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder="输入消息... (Enter发送)" className="flex-1 bg-transparent resize-none outline-none text-sm max-h-32 min-h-[24px]" rows={1} />
          <button onClick={handleSend} disabled={!input.trim() || loading} className="bg-blue-500 hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors">发送</button>
        </div>
        <div className="text-xs text-gray-400 mt-1 text-center">系统自动选择最优模型 · 每次决策完全透明</div>
      </div>
    </div>
  );
}
