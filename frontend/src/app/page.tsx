"use client";
import { useState } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import { EvidencePanel } from "@/components/workbench/EvidencePanel";
import { TracePanel } from "@/components/workbench/TracePanel";
import { HealthPanel } from "@/components/workbench/HealthPanel";
import { DebugPanel } from "@/components/workbench/DebugPanel";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";

type NavView = "chat" | "tasks" | "memory" | "dashboard";

const DEFAULT_USER_ID = "dev-user";

type WorkbenchTab = "evidence" | "trace" | "health" | "debug";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("evidence");
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [activeNav, setActiveNav] = useState<NavView>("chat");

  const tabs: { id: WorkbenchTab; icon: string; label: string }[] = [
    { id: "evidence", icon: "🔍", label: "证据" },
    { id: "trace", icon: "⚡", label: "轨迹" },
    { id: "health", icon: "💚", label: "健康" },
    { id: "debug", icon: "🔧", label: "调试" },
  ];

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Header */}
      <Header
        userId={userId}
        onUserIdChange={setUserId}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {/* Body: Sidebar + Chat + optional Workbench */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Sidebar */}
        <Sidebar activeNav={activeNav} onNavChange={(id) => setActiveNav(id as NavView)} onSettingsClick={() => setShowSettings(true)} />

        {/* Center: View Area */}
        <main
          className="flex-1 overflow-hidden"
          style={{ maxWidth: sidebarOpen ? undefined : "100%" }}
        >
          {activeNav === "chat" && (
            <ChatInterface
              onTaskIdChange={setSelectedTaskId}
              userId={userId}
            />
          )}

          {activeNav === "tasks" && (
            <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
              <div className="text-center">
                <div className="text-4xl mb-4">📋</div>
                <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                  任务管理
                </div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  在右侧面板查看活跃任务列表
                </div>
                <div className="text-xs mt-3 px-4 py-2 rounded-lg inline-block" style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
                  发送消息 → 自动创建任务 → 右侧查看详情
                </div>
              </div>
            </div>
          )}

          {activeNav === "memory" && (
            <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
              <div className="text-center">
                <div className="text-4xl mb-4">🧠</div>
                <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                  记忆系统
                </div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  SmartRouter 的长期学习记忆
                </div>
                <div className="mt-3 space-y-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  <div className="flex items-center gap-2 justify-center">
                    <span style={{ color: "var(--accent-blue)" }}>●</span>
                    <span>决策偏好学习</span>
                  </div>
                  <div className="flex items-center gap-2 justify-center">
                    <span style={{ color: "var(--accent-green)" }}>●</span>
                    <span>模型性能统计</span>
                  </div>
                  <div className="flex items-center gap-2 justify-center">
                    <span style={{ color: "var(--accent-amber)" }}>●</span>
                    <span>信号质量追踪</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeNav === "dashboard" && (
            <div className="h-full flex flex-col items-center justify-center" style={{ backgroundColor: "var(--bg-base)" }}>
              <div className="text-center">
                <div className="text-4xl mb-4">📊</div>
                <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
                  数据看板
                </div>
                <div className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>
                  系统运行统计总览
                </div>
                <div className="grid grid-cols-3 gap-3 px-8">
                  {[
                    { label: "总决策数", value: "—", color: "var(--accent-blue)" },
                    { label: "成功率", value: "—", color: "var(--accent-green)" },
                    { label: "Token 节省", value: "—", color: "var(--accent-amber)" },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="px-4 py-3 rounded-xl text-center"
                      style={{ backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border-subtle)" }}
                    >
                      <div className="text-lg font-bold" style={{ color: card.color }}>{card.value}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>{card.label}</div>
                    </div>
                  ))}
                </div>
                <div className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
                  发送消息后统计数据将实时更新
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Right: Workbench Sidebar */}
        {sidebarOpen && (
          <aside
            className="w-96 flex-shrink-0 flex flex-col overflow-hidden"
            style={{
              backgroundColor: "var(--bg-surface)",
              borderLeft: "1px solid var(--border-subtle)",
            }}
          >
            {/* Task Panel: top fixed height */}
            <div
              className="flex-shrink-0 overflow-hidden"
              style={{ height: 220, borderBottom: "1px solid var(--border-subtle)" }}
            >
              <TaskPanel
                userId={userId}
                onTaskSelect={setSelectedTaskId}
                selectedTaskId={selectedTaskId}
              />
            </div>

            {/* Tab content area: flex-1 */}
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Tab bar */}
              <div
                className="flex flex-shrink-0"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setWorkbenchTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-all relative"
                    style={{
                      color: workbenchTab === tab.id ? "var(--text-accent)" : "var(--text-muted)",
                      backgroundColor: workbenchTab === tab.id ? "var(--bg-overlay)" : "transparent",
                    }}
                  >
                    <span className="text-[11px]">{tab.icon}</span>
                    <span className="hidden xl:inline">{tab.label}</span>
                    {/* Active underline */}
                    {workbenchTab === tab.id && (
                      <span
                        className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                        style={{ backgroundColor: "var(--accent-blue)" }}
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {workbenchTab === "evidence" && (
                  <EvidencePanel taskId={selectedTaskId} userId={userId} />
                )}
                {workbenchTab === "trace" && (
                  <TracePanel taskId={selectedTaskId} userId={userId} />
                )}
                {workbenchTab === "health" && <HealthPanel />}
                {workbenchTab === "debug" && (
                  <DebugPanel taskId={selectedTaskId} userId={userId} />
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
