"use client";
import { useState } from "react";
import { Badge } from "../ui/Badge";
import { Progress } from "../ui/Progress";
import { formatCost, formatTokens } from "@/lib/utils";

interface DecisionCardProps { decision: any; }

// Sprint 23 P0-B: 用户语言化决策解释
function buildExplanation(
  selectedRole: string,
  complexityScore: number,
  intent: string,
  didFallback: boolean,
): string {
  if (didFallback) {
    return "⚠️ 快速模式质量不达标，已自动切换至深度模式补充回答。";
  }
  if (selectedRole === "fast") {
    if (complexityScore < 30) {
      return `✅ 选择快速模式：问题复杂度低（${complexityScore}/100），快速模型回答质量与最强模型相当，速度快 4 倍，成本低约 20 倍。`;
    } else {
      return `✅ 选择快速模式：复杂度中等（${complexityScore}/100），在保证质量的前提下节省成本。`;
    }
  }
  if (selectedRole === "slow") {
    if (complexityScore >= 70) {
      return `🧠 选择深度模式：问题复杂度高（${complexityScore}/100），启用最强模型确保回答质量。`;
    } else {
      return `🧠 选择深度模式：意图为「${intent}」，需要深度推理能力。`;
    }
  }
  return `已根据问题特征（意图：${intent}，复杂度：${complexityScore}/100）选择最优处理方式。`;
}

export function DecisionCard({ decision }: DecisionCardProps) {
  const [expanded, setExpanded] = useState(false);
  if (!decision) return null;
  const { routing, context, execution } = decision;
  const isFast = routing?.selected_role === "fast";

  return (
    <div
      className="mt-2 rounded-xl overflow-hidden text-xs transition-all"
      style={{
        border: "1px solid var(--border-default)",
        backgroundColor: "var(--bg-surface)",
      }}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 transition-colors"
        style={{ backgroundColor: "var(--bg-elevated)" }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ color: "var(--text-muted)" }}>🔍</span>
          <Badge variant={isFast ? "fast" : "slow"}>
            {isFast ? "⚡ 快模型" : "🧠 慢模型"}
          </Badge>
          <span style={{ color: "var(--text-secondary)" }}>
            {formatTokens((execution?.input_tokens || 0) + (execution?.output_tokens || 0))} tokens
          </span>
          <span style={{ color: "var(--accent-green)" }}>
            {formatCost(execution?.total_cost_usd || 0)}
          </span>
          {execution?.did_fallback && <Badge variant="warn">🔄 已升级</Badge>}
        </div>
        <span className="text-xs flex-shrink-0 ml-2" style={{ color: "var(--text-muted)" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 py-3 space-y-3" style={{ backgroundColor: "var(--bg-surface)" }}>
          {/* Routing scores */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
              📊 路由决策
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="flex justify-between mb-0.5" style={{ color: "var(--text-secondary)" }}>
                  <span className="text-[10px]">快模型</span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--accent-green)" }}>
                    {Math.round((routing?.scores?.fast || 0) * 100)}%
                  </span>
                </div>
                <Progress value={(routing?.scores?.fast || 0) * 100} color="bg-accent-green" />
              </div>
              <div>
                <div className="flex justify-between mb-0.5" style={{ color: "var(--text-secondary)" }}>
                  <span className="text-[10px]">慢模型</span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--accent-purple)" }}>
                    {Math.round((routing?.scores?.slow || 0) * 100)}%
                  </span>
                </div>
                <Progress value={(routing?.scores?.slow || 0) * 100} color="bg-accent-purple" />
              </div>
            </div>
            <div className="mt-1 text-[10px]" style={{ color: "var(--text-muted)" }}>
              置信度: <span className="font-mono" style={{ color: "var(--text-accent)" }}>{Math.round((routing?.confidence || 0) * 100)}%</span>
              {routing?.selection_reason && (
                <span className="ml-2">{routing.selection_reason}</span>
              )}
            </div>
          </div>

          {/* Token usage */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-muted)" }}>
              📦 Token 使用
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center">
              {[
                { label: "输入", value: formatTokens(execution?.input_tokens || 0), color: "var(--text-accent)" },
                { label: "输出", value: formatTokens(execution?.output_tokens || 0), color: "var(--accent-purple)" },
                { label: "费用", value: formatCost(execution?.total_cost_usd || 0), color: "var(--accent-green)" },
              ].map(({ label, value, color }) => (
                <div
                  key={label}
                  className="rounded-lg px-2 py-1.5"
                  style={{ backgroundColor: "var(--bg-elevated)" }}
                >
                  <div className="text-[9px] mb-0.5" style={{ color: "var(--text-muted)" }}>{label}</div>
                  <div className="font-mono font-bold text-xs" style={{ color }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Context compression */}
          {context?.compression_ratio > 0 && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--text-muted)" }}>
                🗜️ 上下文压缩
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                  {formatTokens(context.original_tokens)}
                </span>
                <span style={{ color: "var(--text-muted)" }}>→</span>
                <span className="text-xs font-mono font-bold" style={{ color: "var(--accent-green)" }}>
                  {formatTokens(context.compressed_tokens)}
                </span>
                <Badge variant="fast">
                  省 {Math.round(context.compression_ratio * 100)}%
                </Badge>
              </div>
            </div>
          )}

          {/* Footer metadata */}
          <div
            className="flex items-center gap-3 text-[10px] pt-0.5"
            style={{ color: "var(--text-muted)", borderTop: "1px solid var(--border-subtle)" }}
          >
            <span>⏱️ {execution?.latency_ms}ms</span>
            <span className="font-mono truncate max-w-[120px]">{execution?.model_used}</span>
          </div>

          {/* Sprint 23 P0-B: 用户语言化决策解释 */}
          <div
            className="mt-2 pt-2"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              {buildExplanation(
                routing?.selected_role ?? "",
                (routing?.scores?.slow ?? 0) * 100,
                routing?.intent ?? "",
                execution?.did_fallback ?? false,
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
