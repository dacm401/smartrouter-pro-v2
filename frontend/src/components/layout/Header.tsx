"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchHealth } from "@/lib/api";
import type { HealthStatus } from "@/lib/api";

interface HeaderProps {
  userId: string;
  onUserIdChange: (id: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function Header({ userId, sidebarOpen, onToggleSidebar }: HeaderProps) {
  const router = useRouter();
  const [health, setHealth] = useState<HealthStatus | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => {/* silent */});
  }, []);

  const statusDot = health
    ? health.status === "ok"
      ? { color: "bg-accent-green animate-pulse-dot", label: "运行正常" }
      : health.status === "degraded"
      ? { color: "bg-accent-amber", label: "部分降级" }
      : { color: "bg-accent-red", label: "异常" }
    : { color: "bg-text-muted", label: "检测中…" };

  const handleLogout = () => {
    localStorage.removeItem("srp_jwt_token");
    localStorage.removeItem("srp_auth_user");
    router.push("/login");
  };

  return (
    <header
      className="h-12 flex-shrink-0 flex items-center justify-between px-4 border-b"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Left: Logo */}
      <div className="flex items-center gap-2">
        <span className="text-base" style={{ color: "var(--accent-blue)" }}>◈</span>
        <span className="font-semibold text-sm tracking-tight" style={{ color: "var(--text-primary)" }}>
          SmartRouter Pro
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: "var(--accent-blue-glow)",
            color: "var(--text-accent)",
          }}
        >
          v1.0
        </span>
      </div>

      {/* Center: Status badge */}
      <div className="flex items-center gap-2">
        <span className={`status-dot ${statusDot.color}`} />
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {statusDot.label}
        </span>
        {health?.version && (
          <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
            · {health.version}
          </span>
        )}
      </div>

      {/* Right: User badge + logout + Sidebar toggle */}
      <div className="flex items-center gap-2">
        {/* Sidebar toggle */}
        <button
          onClick={onToggleSidebar}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all"
          style={{
            backgroundColor: sidebarOpen ? "var(--bg-overlay)" : "transparent",
            color: sidebarOpen ? "var(--text-primary)" : "var(--text-muted)",
          }}
          title={sidebarOpen ? "隐藏工作台" : "显示工作台"}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="2" width="12" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="1" y="6.25" width="8" height="1.5" rx="0.75" fill="currentColor" />
            <rect x="1" y="10.5" width="10" height="1.5" rx="0.75" fill="currentColor" />
          </svg>
        </button>

        {/* User badge */}
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs"
          style={{ color: "var(--text-secondary)" }}
          title={`已登录: ${userId}`}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M2 12c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="max-w-[80px] truncate">{userId}</span>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs transition-all hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
          title="退出登录"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <path d="M5 2H3a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M9 10l3-3-3-3M12 7H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden sm:inline">退出</span>
        </button>
      </div>
    </header>
  );
}
