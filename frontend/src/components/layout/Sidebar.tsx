"use client";

type NavItem = {
  id: string;
  icon: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "chat", icon: "💬", label: "Chat" },
  { id: "tasks", icon: "📋", label: "Tasks" },
  { id: "memory", icon: "🧠", label: "Memory" },
  { id: "dashboard", icon: "📊", label: "Dashboard" },
];

interface SidebarProps {
  activeNav: string;
  onNavChange: (id: string) => void;
}

export function Sidebar({ activeNav, onNavChange }: SidebarProps) {
  return (
    <aside
      className="w-[52px] flex-shrink-0 flex flex-col items-center py-3 border-r"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Nav items */}
      <div className="flex flex-col items-center gap-1 flex-1 w-full px-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavChange(item.id)}
              title={item.label}
              className="relative w-full flex flex-col items-center justify-center py-2 rounded-lg text-xs transition-all"
              style={{
                backgroundColor: isActive ? "var(--bg-overlay)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {/* Active left border */}
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                  style={{ backgroundColor: "var(--accent-blue)" }}
                />
              )}
              <span className="text-sm leading-none mb-0.5">{item.icon}</span>
              <span
                className="text-[9px] leading-none"
                style={{ color: isActive ? "var(--text-accent)" : "var(--text-muted)" }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom: Settings */}
      <div className="w-full px-1">
        <button
          title="Settings"
          className="w-full flex flex-col items-center justify-center py-2 rounded-lg text-xs transition-all"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="text-sm leading-none mb-0.5">⚙️</span>
          <span className="text-[9px] leading-none" style={{ color: "var(--text-muted)" }}>Settings</span>
        </button>
      </div>
    </aside>
  );
}
