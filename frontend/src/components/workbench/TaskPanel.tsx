"use client";
import { useState, useEffect } from "react";
import { fetchTasks } from "@/lib/api";

interface TaskItem {
  task_id: string;
  title: string;
  mode: string;
  status: string;
  updated_at: string;
}

interface TaskPanelProps {
  userId: string;
  sessionId?: string;
  onTaskSelect?: (taskId: string) => void;
  selectedTaskId?: string | null;
}

const STATUS_DOT: Record<string, { color: string; label: string }> = {
  responding: { color: "var(--accent-green)", label: "活跃" },
  completed: { color: "var(--accent-blue)", label: "完成" },
  failed: { color: "var(--accent-red)", label: "失败" },
  paused: { color: "var(--accent-amber)", label: "暂停" },
  cancelled: { color: "var(--text-muted)", label: "取消" },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "刚刚";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m 前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h 前`;
  return `${Math.floor(hrs / 24)}d 前`;
}

export function TaskPanel({ userId, sessionId, onTaskSelect, selectedTaskId }: TaskPanelProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchTasks(userId, sessionId)
      .then((data) => setTasks(data.tasks ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [userId, sessionId]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-3 py-2 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs">📋</span>
          <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
            任务
          </span>
        </div>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {tasks.length} 个
        </span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-xs text-center animate-pulse" style={{ color: "var(--text-muted)" }}>
            加载中…
          </div>
        )}
        {error && (
          <div
            className="mx-3 my-2 px-3 py-2 rounded-lg text-xs"
            style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}
          >
            ⚠️ {error}
          </div>
        )}
        {!loading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-1">
            <span className="text-xl">📋</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>暂无任务</span>
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
              发送消息后会出现在这里
            </span>
          </div>
        )}
        {tasks.map((task) => {
          const status = STATUS_DOT[task.status] ?? { color: "var(--text-muted)", label: task.status };
          const isSelected = selectedTaskId === task.task_id;
          return (
            <button
              key={task.task_id}
              onClick={() => onTaskSelect?.(task.task_id)}
              className="w-full text-left px-3 py-2.5 transition-all group"
              style={{
                backgroundColor: isSelected ? "var(--bg-overlay)" : "transparent",
                borderBottom: "1px solid var(--border-subtle)",
                borderLeft: isSelected ? "2px solid var(--accent-blue)" : "2px solid transparent",
              }}
            >
              <div className="flex items-center gap-2 mb-0.5">
                {/* Status dot */}
                <span
                  className="status-dot flex-shrink-0"
                  style={{ backgroundColor: status.color }}
                />
                {/* Title */}
                <span
                  className="text-xs font-medium truncate flex-1"
                  style={{ color: isSelected ? "var(--text-primary)" : "var(--text-secondary)" }}
                >
                  {task.title || "(无标题)"}
                </span>
                {/* Time */}
                <span
                  className="text-[10px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: "var(--text-muted)" }}
                >
                  {relativeTime(task.updated_at)}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-2">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    backgroundColor: isSelected
                      ? "var(--accent-blue-glow)"
                      : "var(--bg-elevated)",
                    color: isSelected ? "var(--text-accent)" : "var(--text-muted)",
                  }}
                >
                  {status.label}
                </span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {task.mode}
                </span>
                <span className="text-[10px] ml-auto" style={{ color: "var(--text-muted)" }}>
                  {relativeTime(task.updated_at)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
