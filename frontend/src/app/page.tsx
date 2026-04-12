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

const DEFAULT_USER_ID = "dev-user";

type WorkbenchTab = "evidence" | "trace" | "health" | "debug";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("evidence");
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [activeNav, setActiveNav] = useState("chat");

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
        <Sidebar activeNav={activeNav} onNavChange={setActiveNav} />

        {/* Center: Chat Area */}
        <main
          className="flex-1 overflow-hidden"
          style={{ maxWidth: sidebarOpen ? undefined : "100%" }}
        >
          <ChatInterface
            onTaskIdChange={setSelectedTaskId}
            userId={userId}
          />
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
