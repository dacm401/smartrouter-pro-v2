"use client";
import { useState, useEffect } from "react";
import { getDashboard, getGrowth, fetchCostStats } from "@/lib/api";
import type { CostStats } from "@/lib/api";

interface DashboardData {
  total_chats: number;
  satisfaction_rate: number;
  token_savings_rate: number;
  fast_route_rate: number;
  intent_distribution: Array<{ intent: string; count: number }>;
  model_distribution: Array<{ model: string; count: number }>;
  top_intents?: Array<{ intent: string; count: number }>;
}

interface GrowthData {
  behavioral_memories_count: number;
  milestones: Array<{ id: string; event: string; created_at: string }>;
  recent_learnings: Array<{ id: string; content: string; created_at: string }>;
}

function KpiCard({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color: string }) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col"
      style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
    >
      <div className="text-3xl font-bold" style={{ color }}>{value}{unit && <span className="text-lg">{unit}</span>}</div>
      <div className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 mb-2">
      <div className="w-20 text-xs flex-shrink-0 truncate" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border-subtle)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="text-xs w-10 text-right flex-shrink-0" style={{ color: "var(--text-muted)" }}>{value}</div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl p-5 animate-pulse" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
      <div className="h-8 w-20 rounded mb-2" style={{ backgroundColor: "var(--border-default)" }} />
      <div className="h-3 w-16 rounded" style={{ backgroundColor: "var(--border-subtle)" }} />
    </div>
  );
}

interface DashboardViewProps {
  userId: string;
}

export default function DashboardView({ userId }: DashboardViewProps) {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.allSettled([
      getDashboard(userId),
      getGrowth(userId),
      fetchCostStats(userId),
    ])
      .then(([dashResult, growthResult, costResult]) => {
        if (dashResult.status === "fulfilled") setDashboard(dashResult.value);
        if (growthResult.status === "fulfilled") setGrowth(growthResult.value);
        if (costResult.status === "fulfilled") setCostStats(costResult.value);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId]);

  const reload = () => {
    setLoading(true);
    setError(null);
    Promise.allSettled([getDashboard(userId), getGrowth(userId), fetchCostStats(userId)])
      .then(([dashResult, growthResult, costResult]) => {
        if (dashResult.status === "fulfilled") setDashboard(dashResult.value);
        if (growthResult.status === "fulfilled") setGrowth(growthResult.value);
        if (costResult.status === "fulfilled") setCostStats(costResult.value);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              📊 数据看板
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              系统运行统计总览
            </p>
          </div>
          <button
            onClick={reload}
            className="w-8 h-8 flex items-center justify-center rounded-lg"
            style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
            title="刷新"
          >
            🔄
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs flex items-center gap-2" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ 数据加载失败
            <button onClick={reload} className="underline ml-auto">重试</button>
          </div>
        )}

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 mb-3">
            <KpiCard label="今日对话" value={dashboard?.total_chats ?? 0} color="var(--accent-blue)" />
            <KpiCard label="满意率" value={dashboard?.satisfaction_rate ?? 0} unit="%" color="var(--accent-green)" />
            <KpiCard label="快速路由" value={dashboard?.fast_route_rate ?? 0} unit="%" color="var(--accent-purple)" />
          </div>
        )}

        {/* Sprint 23 P0-A: ROI 成本节省卡片（全宽，突出显示） */}
        {loading ? (
          <div className="rounded-xl p-5 mb-5 animate-pulse" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
            <div className="h-6 w-48 rounded mb-2" style={{ backgroundColor: "var(--border-default)" }} />
            <div className="h-4 w-72 rounded" style={{ backgroundColor: "var(--border-subtle)" }} />
          </div>
        ) : (
          (() => {
            const pct = costStats?.saved_percent ?? 0;
            const roiColor = pct >= 50
              ? "var(--accent-green)"
              : pct >= 20
              ? "var(--accent-blue)"
              : "var(--text-muted)";
            const borderColor = pct >= 50
              ? "rgba(16,185,129,0.3)"
              : pct >= 20
              ? "rgba(59,130,246,0.3)"
              : "var(--border-subtle)";
            return (
              <div
                className="rounded-xl p-5 mb-5"
                style={{ backgroundColor: "var(--bg-surface)", border: `1px solid ${borderColor}` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">💰</span>
                  <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                    成本节省（近 30 天）
                  </span>
                </div>
                <div className="flex items-center gap-6 flex-wrap">
                  <div>
                    <div className="text-3xl font-bold" style={{ color: roiColor }}>
                      {pct}%
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      相比直打 GPT-4o
                    </div>
                  </div>
                  <div style={{ width: "1px", height: "40px", backgroundColor: "var(--border-subtle)" }} />
                  <div>
                    <div className="text-lg font-semibold" style={{ color: "var(--accent-green)" }}>
                      ${(costStats?.saved_usd ?? 0).toFixed(2)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      节省金额
                    </div>
                  </div>
                  <div>
                    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                      实际 ${(costStats?.total_spent_usd ?? 0).toFixed(4)}
                    </div>
                    <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                      理论 ${(costStats?.baseline_spent_usd ?? 0).toFixed(4)}
                    </div>
                  </div>
                  <div className="ml-auto">
                    <div className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                      {costStats?.task_count ?? 0} 次对话
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        )}

        {/* Two-column: Intent + Model Distribution */}
        <div className="grid grid-cols-2 gap-4 mb-5">
          {/* Intent Distribution */}
          <div className="rounded-xl p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
            <div className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>意图分布</div>
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-3 rounded animate-pulse" style={{ backgroundColor: "var(--border-subtle)" }} />
                ))}
              </div>
            ) : (
              (() => {
                const intents = dashboard?.top_intents ?? dashboard?.intent_distribution ?? [];
                const max = Math.max(...intents.map((i) => i.count), 1);
                return intents.length > 0 ? (
                  intents.slice(0, 6).map((item) => (
                    <BarRow key={item.intent} label={item.intent} value={item.count} max={max} color="var(--accent-blue)" />
                  ))
                ) : (
                  <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>暂无数据</div>
                );
              })()
            )}
          </div>

          {/* Model Distribution */}
          <div className="rounded-xl p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
            <div className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>模型使用</div>
            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-3 rounded animate-pulse" style={{ backgroundColor: "var(--border-subtle)" }} />
                ))}
              </div>
            ) : (
              (() => {
                const models = dashboard?.model_distribution ?? [];
                const max = Math.max(...models.map((m) => m.count), 1);
                const colors = ["var(--accent-purple)", "var(--accent-blue)", "var(--accent-green)"];
                return models.length > 0 ? (
                  models.slice(0, 5).map((item, idx) => (
                    <BarRow key={item.model} label={item.model.split("/").pop() ?? item.model} value={item.count} max={max} color={colors[idx % colors.length]} />
                  ))
                ) : (
                  <div className="text-xs py-4 text-center" style={{ color: "var(--text-muted)" }}>暂无数据</div>
                );
              })()
            )}
          </div>
        </div>

        {/* Growth Profile */}
        <div className="rounded-xl p-4" style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>🧠 成长档案</div>
            {growth && (
              <span className="text-[10px] px-2 py-0.5 rounded-md" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-muted)" }}>
                {growth.behavioral_memories_count} 条行为记忆
              </span>
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-3 rounded animate-pulse" style={{ backgroundColor: "var(--border-subtle)" }} />)}
            </div>
          ) : (
            <div className="space-y-4">
              {/* Milestones */}
              {growth && growth.milestones && growth.milestones.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>里程碑</div>
                  <div className="space-y-2">
                    {growth.milestones.slice(0, 5).map((m) => (
                      <div key={m.id} className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: "var(--accent-blue)" }} />
                        <div className="flex-1">
                          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{m.event}</div>
                          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                            {new Date(m.created_at).toLocaleDateString("zh-CN")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent learnings */}
              {growth && growth.recent_learnings && growth.recent_learnings.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--text-muted)" }}>最近学习</div>
                  <div className="space-y-2">
                    {growth.recent_learnings.slice(0, 3).map((l) => (
                      <div key={l.id} className="flex items-start gap-2 rounded-lg p-2" style={{ backgroundColor: "var(--bg-elevated)" }}>
                        <span className="text-xs flex-shrink-0">🧠</span>
                        <div className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{l.content}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* All empty */}
              {(!growth || (growth.milestones?.length === 0 && growth.recent_learnings?.length === 0)) && (
                <div className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>
                  暂无成长记录
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
