"use client";
import { useState, useEffect, useCallback } from "react";
import { fetchMemory, deleteMemory, createMemoryEntry, type MemoryEntry } from "@/lib/api";

const CATEGORIES = [
  { id: "", label: "全部" },
  { id: "preference", label: "偏好" },
  { id: "fact", label: "事实" },
  { id: "context", label: "上下文" },
  { id: "instruction", label: "指令" },
  { id: "auto_learn", label: "自动学习" },
];

const ADD_FORM_CATEGORIES = [
  { id: "preference", label: "偏好" },
  { id: "fact", label: "事实" },
  { id: "context", label: "上下文" },
  { id: "instruction", label: "指令" },
];

const MAX_CONTENT_LENGTH = 500;

const CATEGORY_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  preference: { bg: "rgba(139,92,246,0.15)", text: "#c4b5fd", border: "rgba(139,92,246,0.4)" },
  fact: { bg: "rgba(59,130,246,0.15)", text: "#93c5fd", border: "rgba(59,130,246,0.4)" },
  context: { bg: "rgba(16,185,129,0.15)", text: "#6ee7b7", border: "rgba(16,185,129,0.4)" },
  instruction: { bg: "rgba(245,158,11,0.15)", text: "#fcd34d", border: "rgba(245,158,11,0.4)" },
  auto_learn: { bg: "rgba(6,182,212,0.15)", text: "#67e8f9", border: "rgba(6,182,212,0.4)" },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

interface MemoryCardProps {
  item: MemoryEntry;
  userId: string;
  onDelete: (id: string) => void;
}

function MemoryCard({ item, userId, onDelete }: MemoryCardProps) {
  const [hovered, setHovered] = useState(false);
  const style = CATEGORY_STYLES[item.category] ?? { bg: "rgba(148,163,184,0.15)", text: "#94a3b8", border: "rgba(148,163,184,0.4)" };

  const handleDelete = () => {
    if (!window.confirm("确定删除这条记忆？")) return;
    onDelete(item.id);
  };

  return (
    <div
      className="rounded-xl p-4 transition-all duration-150 relative group"
      style={{
        backgroundColor: hovered ? "var(--bg-elevated)" : "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header row */}
      <div className="flex items-start gap-2 mb-2">
        {/* Category badge */}
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium flex-shrink-0"
          style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}
        >
          {item.category}
        </span>
        {/* Delete button */}
        <button
          onClick={handleDelete}
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md"
          style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "var(--accent-red)" }}
          title="删除"
        >
          🗑️
        </button>
      </div>

      {/* Content */}
      <p
        className="text-sm leading-relaxed mb-2"
        style={{ color: "var(--text-primary)" }}
      >
        {item.content}
      </p>

      {/* Footer */}
      <div className="flex items-center gap-3">
        {item.source && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            来源: {item.source}
          </span>
        )}
        <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
          {relativeTime(item.created_at)}
        </span>
      </div>
    </div>
  );
}

interface MemoryViewProps {
  userId: string;
}

export default function MemoryView({ userId }: MemoryViewProps) {
  const [activeCategory, setActiveCategory] = useState("");
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCategory, setNewCategory] = useState<string>("preference");
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMemory(userId, activeCategory || undefined);
      setMemories(data.entries ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [userId, activeCategory]);

  useEffect(() => { load(); }, [load]);

  const handleAddMemory = async () => {
    if (!newContent.trim()) return;
    if (newContent.length > MAX_CONTENT_LENGTH) return;
    setAdding(true);
    try {
      const entry = await createMemoryEntry(userId, newCategory, newContent.trim(), "manual");
      // Optimistic insert to top
      setMemories((prev) => [entry, ...prev]);
      // Reset form
      setNewContent("");
      setNewCategory("preference");
      setShowAddForm(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto" style={{ backgroundColor: "var(--bg-base)" }}>
      <div className="p-6 max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              🧠 记忆库
            </h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
              共 {memories.length} 条记忆
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Category tabs */}
            <div className="flex items-center gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className="px-2.5 py-1 rounded-lg text-[11px] transition-all"
                  style={{
                    backgroundColor: activeCategory === cat.id ? "var(--bg-overlay)" : "transparent",
                    color: activeCategory === cat.id ? "var(--text-accent)" : "var(--text-muted)",
                    border: activeCategory === cat.id ? "1px solid var(--border-default)" : "1px solid transparent",
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            {/* Refresh */}
            <button
              onClick={load}
              className="w-8 h-8 flex items-center justify-center rounded-lg transition-opacity"
              style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
              title="刷新"
            >
              🔄
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}

        {/* Add Memory Form */}
        <div className="mb-5">
          <button
            onClick={() => setShowAddForm((s) => !s)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: showAddForm ? "var(--bg-overlay)" : "var(--bg-surface)",
              border: "1px solid var(--border-subtle)",
              color: showAddForm ? "var(--text-accent)" : "var(--text-primary)",
            }}
          >
            <span>{showAddForm ? "▲" : "＋"}</span>
            {showAddForm ? "收起" : "添加记忆"}
          </button>

          {showAddForm && (
            <div
              className="mt-3 rounded-xl p-4"
              style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
            >
              {/* Category select */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>分类：</span>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="text-xs px-2 py-1 rounded-md bg-transparent"
                  style={{ border: "1px solid var(--border-subtle)", color: "var(--text-primary)" }}
                >
                  {ADD_FORM_CATEGORIES.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>

              {/* Content textarea */}
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="在这里输入记忆内容..."
                maxLength={MAX_CONTENT_LENGTH + 100}
                className="w-full rounded-lg p-3 text-sm resize-none"
                style={{
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-subtle)",
                  color: "var(--text-primary)",
                  minHeight: "80px",
                }}
              />
              <div className="flex items-center justify-between mt-2">
                <span
                  className="text-[10px]"
                  style={{
                    color: newContent.length > MAX_CONTENT_LENGTH ? "var(--accent-red)" : "var(--text-muted)",
                  }}
                >
                  {newContent.length}/{MAX_CONTENT_LENGTH} 字符
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowAddForm(false); setNewContent(""); }}
                    className="px-3 py-1.5 rounded-md text-xs transition-colors"
                    style={{ color: "var(--text-muted)" }}
                    disabled={adding}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleAddMemory}
                    disabled={!newContent.trim() || newContent.length > MAX_CONTENT_LENGTH || adding}
                    className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: !newContent.trim() || newContent.length > MAX_CONTENT_LENGTH || adding
                        ? "var(--border-subtle)"
                        : "var(--accent-green)",
                      color: !newContent.trim() || newContent.length > MAX_CONTENT_LENGTH || adding
                        ? "var(--text-muted)"
                        : "#fff",
                    }}
                  >
                    {adding ? "保存中..." : "✓ 保存记忆"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl p-4 animate-pulse"
                style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-4 w-16 rounded" style={{ backgroundColor: "var(--border-default)" }} />
                </div>
                <div className="h-3 w-full rounded mb-1.5" style={{ backgroundColor: "var(--border-subtle)" }} />
                <div className="h-3 w-3/4 rounded mb-1.5" style={{ backgroundColor: "var(--border-subtle)" }} />
                <div className="h-3 w-1/2 rounded" style={{ backgroundColor: "var(--border-subtle)" }} />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && memories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">🧠</div>
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
              记忆库为空
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              与 AI 对话后，系统会自动学习你的偏好
            </div>
          </div>
        )}

        {/* Memory list */}
        {!loading && memories.length > 0 && (
          <div className="space-y-3">
            {memories.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                userId={userId}
                onDelete={(id) => {
                  setMemories((prev) => prev.filter((m) => m.id !== id));
                  deleteMemory(id, userId).catch(() => {
                    // optimistic update failed, reload
                    load();
                  });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
