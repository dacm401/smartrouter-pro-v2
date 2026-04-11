"use client";
import { useState } from "react";
import Link from "next/link";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import { EvidencePanel } from "@/components/workbench/EvidencePanel";
import { TracePanel } from "@/components/workbench/TracePanel";
import { HealthPanel } from "@/components/workbench/HealthPanel";

const USER_ID = "user-001";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<"evidence" | "trace" | "health">("evidence");

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-4 py-3 flex items-center justify-between flex-shrink-0 relative">
        <div className="flex items-center gap-2">
          <span className="text-xl">🚀</span>
          <span className="font-bold text-gray-800">SmartRouter Pro</span>
          <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">v1.0</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">透明 · 可观测 · 会成长</span>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1 ${
              sidebarOpen ? "bg-blue-100 text-blue-700" : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            {sidebarOpen ? "◀ 隐藏工作台" : "▶ 显示工作台"}
          </button>
          <Link href="/dashboard" className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
            📊 仪表盘
          </Link>
          <button
            onClick={() => setShowSettings(true)}
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
          >
            ⚙️ 设置
          </button>
        </div>
      </header>

      {/* Body: Chat + optional Workbench Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chat */}
        <main className={`flex-1 overflow-hidden ${sidebarOpen ? "max-w-3xl" : ""} w-full mx-auto`}>
          <ChatInterface onTaskIdChange={setSelectedTaskId} />
        </main>

        {/* Right: Workbench Sidebar */}
        {sidebarOpen && (
          <aside className="w-96 flex-shrink-0 border-l bg-white flex flex-col overflow-hidden">
            {/* Task Panel: top half */}
            <div className="h-64 flex-shrink-0 border-b overflow-hidden">
              <TaskPanel
                userId={USER_ID}
                onTaskSelect={setSelectedTaskId}
                selectedTaskId={selectedTaskId}
              />
            </div>

            {/* Evidence / Trace tab switcher: bottom half */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Tab bar */}
              <div className="flex border-b bg-gray-50 flex-shrink-0">
                <button
                  onClick={() => setWorkbenchTab("evidence")}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    workbenchTab === "evidence"
                      ? "text-blue-600 border-b-2 border-blue-500 bg-white"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  🗂 证据
                </button>
                <button
                  onClick={() => setWorkbenchTab("trace")}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    workbenchTab === "trace"
                      ? "text-blue-600 border-b-2 border-blue-500 bg-white"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  📡 轨迹
                </button>
                <button
                  onClick={() => setWorkbenchTab("health")}
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    workbenchTab === "health"
                      ? "text-blue-600 border-b-2 border-blue-500 bg-white"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  💚 健康
                </button>
              </div>
              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {workbenchTab === "evidence" ? (
                  <EvidencePanel taskId={selectedTaskId} userId={USER_ID} />
                ) : workbenchTab === "trace" ? (
                  <TracePanel taskId={selectedTaskId} userId={USER_ID} />
                ) : (
                  <HealthPanel />
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
