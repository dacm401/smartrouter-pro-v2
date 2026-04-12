"use client";
import { useState, useEffect } from "react";
import { fetchTraces } from "@/lib/api";

interface TraceItem {
  trace_id: string;
  type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface TracePanelProps {
  taskId: string | null;
  userId: string;
}

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  planning: { icon: "🧠", color: "var(--accent-purple)" },
  classification: { icon: "🏷️", color: "var(--text-accent)" },
  routing: { icon: "🔀", color: "var(--accent-blue)" },
  response: { icon: "💬", color: "var(--accent-green)" },
  step: { icon: "⚙️", color: "var(--accent-amber)" },
  error: { icon: "❌", color: "var(--accent-red)" },
};

function formatDetail(type: string, detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  try {
    switch (type) {
      case "classification":
        return `intent: ${detail.intent ?? "?"} · complexity: ${detail.complexity_score ?? "?"}`;
      case "routing":
        return `${detail.selected_model ?? "?"} (${detail.selected_role ?? "?"}) · 置信 ${detail.confidence ?? "?"}`;
      case "response":
        return `tokens: ${detail.input_tokens ?? "?"}+${detail.output_tokens ?? "?"} · ${detail.latency_ms ?? "?"}ms`;
      case "planning":
        return `${detail.goal ?? ""} · ${detail.completed_steps ?? 0} steps done`;
      default:
        return JSON.stringify(detail).slice(0, 100);
    }
  } catch {
    return "";
  }
}

export function TracePanel({ taskId, userId }: TracePanelProps) {
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setTraces([]); return; }
    setLoading(true);
    setError(null);
    fetchTraces(taskId, userId)
      .then((data) => setTraces(data.traces ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  const renderContent = () => (
    <>
      <div
        className="px-3 py-2 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">⚡</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>轨迹</span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{traces.length} 条</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-center animate-pulse" style={{ color: "var(--text-muted)" }}>加载中…</div>}
        {error && (
          <div className="mx-3 my-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}
        {!loading && !error && traces.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-xl">⚡</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>此任务暂无执行轨迹</span>
          </div>
        )}
        {traces.map((trace) => {
          const cfg = TYPE_CONFIG[trace.type] ?? { icon: "📋", color: "var(--text-muted)" };
          return (
            <div
              key={trace.trace_id}
              className="px-3 py-2 transition-colors"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-sm" style={{ color: cfg.color }}>{cfg.icon}</span>
                <span className="text-xs font-medium" style={{ color: cfg.color }}>{trace.type}</span>
                <span className="ml-auto text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {new Date(trace.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {formatDetail(trace.type, trace.detail) || <span style={{ color: "var(--text-muted)" }}>无详情</span>}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-xs">⚡</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>轨迹</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <span className="text-xl">⚡</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>先选择一个任务</span>
        </div>
      </div>
    );
  }

  return <div className="flex flex-col h-full">{renderContent()}</div>;
}
