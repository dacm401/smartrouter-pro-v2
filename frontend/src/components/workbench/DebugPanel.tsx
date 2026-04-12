"use client";
import { useState, useEffect } from "react";
import { fetchTaskSummary } from "@/lib/api";

interface DecisionSummary {
  routing?: {
    selected_model?: string;
    selected_role?: string;
    scores?: { fast?: number; slow?: number };
    confidence?: number;
    selection_reason?: string;
  };
  execution?: {
    model_used?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_cost_usd?: number;
    latency_ms?: number;
    did_fallback?: boolean;
  };
  context?: {
    original_tokens?: number;
    compressed_tokens?: number;
    compression_ratio?: number;
  };
}

interface DebugPanelProps {
  taskId: string | null;
  userId: string;
}

export function DebugPanel({ taskId, userId }: DebugPanelProps) {
  const [summary, setSummary] = useState<{ decision?: DecisionSummary } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    fetchTaskSummary(taskId, userId)
      .then((data) => setSummary(data as { decision?: DecisionSummary }))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [taskId, userId]);

  const decision = summary?.decision;

  if (!taskId) {
    return (
      <div className="flex flex-col h-full">
        <div
          className="px-3 py-2 flex-shrink-0 flex items-center gap-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="text-xs">🔧</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            调试
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <span className="text-2xl">🔧</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            发送消息后查看调试信息
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div
        className="px-3 py-2 flex-shrink-0 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">🔧</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            调试
          </span>
        </div>
        {loading && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            更新中…
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {error && (
          <div className="text-xs px-2 py-1.5 rounded" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}

        {loading && !summary && (
          <div className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>
            加载中…
          </div>
        )}

        {summary && !error && !decision && (
          <div className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>
            暂无决策数据
          </div>
        )}

        {decision && (
          <>
            {/* Token consumption cards */}
            {decision.execution && (
              <>
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                    Token 消耗
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <div
                      className="rounded-lg px-2 py-2 text-center"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    >
                      <div className="text-base font-bold animate-count-up" style={{ color: "var(--text-accent)" }}>
                        {decision.execution.input_tokens ?? 0}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>Prompt</div>
                    </div>
                    <div
                      className="rounded-lg px-2 py-2 text-center"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    >
                      <div className="text-base font-bold animate-count-up" style={{ color: "var(--accent-purple)" }}>
                        {decision.execution.output_tokens ?? 0}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>Completion</div>
                    </div>
                    <div
                      className="rounded-lg px-2 py-2 text-center"
                      style={{ backgroundColor: "var(--bg-elevated)" }}
                    >
                      <div className="text-base font-bold animate-count-up" style={{ color: "var(--accent-green)" }}>
                        {(decision.execution.input_tokens ?? 0) + (decision.execution.output_tokens ?? 0)}
                      </div>
                      <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>Total</div>
                    </div>
                  </div>
                </div>

                {/* Budget / cost bar */}
                {decision.execution.total_cost_usd !== undefined && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                        费用
                      </div>
                      <div className="text-[10px] font-mono" style={{ color: "var(--accent-green)" }}>
                        ${(decision.execution.total_cost_usd ?? 0).toFixed(6)}
                      </div>
                    </div>
                    <div
                      className="h-1 rounded-full overflow-hidden"
                      style={{ backgroundColor: "var(--border-subtle)" }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          background: "linear-gradient(90deg, var(--accent-green) 0%, var(--accent-amber) 60%, var(--accent-red) 100%)",
                          width: `${Math.min(100, (decision.execution.total_cost_usd ?? 0) * 100000)}%`,
                          minWidth: decision.execution.total_cost_usd ? "2px" : "0",
                        }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Routing decision */}
            {decision.routing && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  路由决策
                </div>
                <div className="space-y-1.5">
                  {/* Model badge */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>模型</span>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                      style={{
                        backgroundColor: "var(--accent-blue-glow)",
                        color: "var(--text-accent)",
                      }}
                    >
                      {decision.routing.selected_model || "—"}
                    </span>
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: decision.routing.selected_role === "fast"
                          ? "rgba(16,185,129,0.15)"
                          : "rgba(99,102,241,0.15)",
                        color: decision.routing.selected_role === "fast"
                          ? "var(--accent-green)"
                          : "var(--accent-purple)",
                      }}
                    >
                      {decision.routing.selected_role === "fast" ? "⚡ 快" : "🧠 慢"}
                    </span>
                    {decision.execution?.did_fallback && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ backgroundColor: "rgba(245,158,11,0.15)", color: "var(--accent-amber)" }}
                      >
                        🔄 已升级
                      </span>
                    )}
                  </div>

                  {/* Confidence */}
                  {decision.routing.confidence !== undefined && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>置信度</span>
                      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border-subtle)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round(decision.routing.confidence * 100)}%`,
                            backgroundColor: "var(--accent-blue)",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
                        {Math.round(decision.routing.confidence * 100)}%
                      </span>
                    </div>
                  )}

                  {/* Selection reason */}
                  {decision.routing.selection_reason && (
                    <div
                      className="rounded px-2 py-1.5 text-[10px]"
                      style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}
                    >
                      {decision.routing.selection_reason}
                    </div>
                  )}

                  {/* Speed score vs Slow score */}
                  {decision.routing.scores && (
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="status-dot" style={{ backgroundColor: "var(--accent-green)" }} />
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>快</span>
                        <span className="text-[10px] font-mono ml-auto" style={{ color: "var(--accent-green)" }}>
                          {Math.round((decision.routing.scores.fast ?? 0) * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="status-dot" style={{ backgroundColor: "var(--accent-purple)" }} />
                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>慢</span>
                        <span className="text-[10px] font-mono ml-auto" style={{ color: "var(--accent-purple)" }}>
                          {Math.round((decision.routing.scores.slow ?? 0) * 100)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Context compression */}
            {decision.context && (decision.context.compression_ratio ?? 0) > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
                  上下文压缩
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                    {decision.context.original_tokens ?? 0}
                  </span>
                  <span style={{ color: "var(--text-muted)" }}>→</span>
                  <span className="text-xs font-mono font-bold" style={{ color: "var(--accent-green)" }}>
                    {decision.context.compressed_tokens ?? 0}
                  </span>
                  <span
                    className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "var(--accent-green)" }}
                  >
                    省 {Math.round((decision.context.compression_ratio ?? 0) * 100)}%
                  </span>
                </div>
              </div>
            )}

            {/* Latency */}
            {decision.execution?.latency_ms && (
              <div className="flex items-center justify-between">
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>延迟</span>
                <span
                  className="text-xs font-mono font-medium"
                  style={{
                    color: decision.execution.latency_ms > 500
                      ? "var(--accent-red)"
                      : decision.execution.latency_ms > 200
                      ? "var(--accent-amber)"
                      : "var(--accent-green)",
                  }}
                >
                  {decision.execution.latency_ms}ms
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
