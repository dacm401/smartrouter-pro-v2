"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchHealth, type HealthStatus } from "@/lib/api";

const STATUS_BADGE: Record<string, { bg: string; text: string; dot: string }> = {
  ok: { bg: "bg-green-50", text: "text-green-700", dot: "bg-green-500" },
  degraded: { bg: "bg-yellow-50", text: "text-yellow-700", dot: "bg-yellow-500" },
  error: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
};

function ServiceRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-gray-600">{name}</span>
      <span className="text-xs font-medium text-gray-800">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-3 pb-1">
      {children}
    </div>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export function HealthPanel() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchHealth();
      setHealth(data);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const badge = health ? STATUS_BADGE[health.status] ?? STATUS_BADGE.degraded : null;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-gray-50 flex-shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">💚 健康</span>
        {health && (
          <span className="text-[10px] text-gray-400">
            {formatUptime(health.uptime_seconds)} uptime
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && !health && (
          <div className="text-xs text-gray-400 text-center py-4">加载中...</div>
        )}
        {error && !health && (
          <div className="text-xs text-red-500 py-2">⚠️ {error}</div>
        )}

        {health && (
          <>
            {/* Overall status badge */}
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-2 ${badge.bg}`}>
              <span className={`w-2 h-2 rounded-full ${badge.dot} animate-pulse`} />
              <span className={`text-sm font-semibold ${badge.text}`}>
                {health.status === "ok" ? "运行正常" : health.status === "degraded" ? "部分降级" : "异常"}
              </span>
              <span className="ml-auto text-xs text-gray-400">v{health.version}</span>
            </div>

            {/* Services */}
            <SectionLabel>服务状态</SectionLabel>
            <div className="bg-gray-50 rounded-lg px-3 py-1">
              <ServiceRow
                name="数据库"
                value={
                  health.services.database.status === "ok"
                    ? health.services.database.latency_ms !== null
                      ? `${health.services.database.latency_ms}ms`
                      : "正常"
                    : "❌ 异常"
                }
              />
              <ServiceRow
                name="模型路由"
                value={
                  health.services.model_router.providers.length > 0
                    ? health.services.model_router.providers.join(", ")
                    : "未配置"
                }
              />
              <ServiceRow
                name="网络搜索"
                value={
                  health.services.web_search.status === "configured" ? "已配置" : "未配置"
                }
              />
            </div>

            {/* Stats */}
            {health.stats && (
              <>
                <SectionLabel>统计数据</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: "总任务", value: health.stats.tasks_total },
                    { label: "活跃任务", value: health.stats.tasks_active },
                    { label: "记忆条目", value: health.stats.memory_entries },
                    { label: "证据记录", value: health.stats.evidence_total },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-gray-50 rounded-lg px-3 py-2 text-center">
                      <div className="text-lg font-bold text-gray-800">{value ?? "—"}</div>
                      <div className="text-[10px] text-gray-400">{label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!health.stats && (
              <div className="text-xs text-gray-400 mt-2">统计数据暂不可用（数据库未连接）</div>
            )}

            {/* Timestamp */}
            <div className="text-[10px] text-gray-300 mt-3 text-center">
              {new Date(health.timestamp).toLocaleTimeString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
