"use client";
import { useState, useEffect } from "react";
import { fetchEvidence } from "@/lib/api";

interface EvidenceItem {
  evidence_id: string;
  source: string;
  content: string;
  source_metadata: Record<string, unknown> | null;
  relevance_score: number | null;
  created_at: string;
}

interface EvidencePanelProps {
  taskId: string | null;
  userId: string;
}

const SOURCE_CONFIG: Record<string, { icon: string; label: string; bg: string; color: string }> = {
  web_search: { icon: "🔍", label: "搜索", bg: "rgba(59,130,246,0.1)", color: "var(--text-accent)" },
  http_request: { icon: "🌐", label: "HTTP", bg: "rgba(139,92,246,0.1)", color: "var(--accent-purple)" },
  manual: { icon: "✍️", label: "手动", bg: "rgba(16,185,129,0.1)", color: "var(--accent-green)" },
};

export function EvidencePanel({ taskId, userId }: EvidencePanelProps) {
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) { setEvidences([]); return; }
    setLoading(true);
    setError(null);
    fetchEvidence(taskId, userId)
      .then((data) => setEvidences(data.evidences ?? []))
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
          <span className="text-xs">🔍</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>证据</span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>{evidences.length} 条</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="p-4 text-xs text-center animate-pulse" style={{ color: "var(--text-muted)" }}>加载中…</div>}
        {error && (
          <div className="mx-3 my-2 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}
        {!loading && !error && evidences.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-xl">🔍</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>此任务暂无证据记录</span>
          </div>
        )}
        {evidences.map((ev) => {
          const cfg = SOURCE_CONFIG[ev.source] ?? SOURCE_CONFIG.manual;
          return (
            <div
              key={ev.evidence_id}
              className="px-3 py-2.5 transition-colors"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                  style={{ backgroundColor: cfg.bg, color: cfg.color }}
                >
                  {cfg.icon} {cfg.label}
                </span>
                {ev.relevance_score !== null && (
                  <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                    相关度: {(ev.relevance_score * 100).toFixed(0)}%
                  </span>
                )}
                <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                  {new Date(ev.created_at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p
                className="text-xs line-clamp-4 leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {ev.content.length > 200 ? ev.content.slice(0, 200) + "…" : ev.content}
              </p>
              {ev.source_metadata && Boolean(ev.source_metadata.url) && (
                <a
                  href={String(ev.source_metadata.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] mt-1.5 block truncate"
                  style={{ color: "var(--text-accent)" }}
                >
                  {String(ev.source_metadata.url)}
                </a>
              )}
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
          <span className="text-xs">🔍</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>证据</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <span className="text-xl">🔍</span>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>先选择一个任务</span>
        </div>
      </div>
    );
  }

  return <div className="flex flex-col h-full">{renderContent()}</div>;
}
