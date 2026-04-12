"use client";
import { useState } from "react";
import { DecisionCard } from "./DecisionCard";
import { sendFeedback } from "@/lib/api";

interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  decision?: any;
  userId?: string;
}

function initials(name: string): string {
  return name.substring(0, 2).toUpperCase();
}

export function MessageBubble({ role, content, decision, userId = "dev-user" }: MessageBubbleProps) {
  const isUser = role === "user";
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);

  const handleFeedback = async (type: "thumbs_up" | "thumbs_down") => {
    if (decision?.id && !feedbackGiven) {
      await sendFeedback(decision.id, type, userId);
      setFeedbackGiven(type);
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`max-w-[72%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {/* Avatar row */}
        <div className={`flex items-center gap-1.5 mb-1.5 ${isUser ? "flex-row-reverse" : ""}`}>
          {isUser ? (
            <>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  backgroundColor: "var(--accent-blue)",
                  color: "white",
                }}
              >
                {initials(userId)}
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>你</span>
            </>
          ) : (
            <>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                style={{
                  backgroundColor: "var(--bg-overlay)",
                  color: "var(--accent-blue)",
                }}
              >
                ◈
              </div>
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>SmartRouter Pro</span>
            </>
          )}
        </div>

        {/* Message bubble */}
        <div
          className="px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap animate-fade-in-up"
          style={
            isUser
              ? {
                  backgroundColor: "var(--accent-blue)",
                  color: "white",
                  borderRadius: "18px 4px 18px 18px",
                }
              : {
                  backgroundColor: "var(--bg-elevated)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-primary)",
                  borderRadius: "4px 18px 18px 18px",
                }
          }
        >
          {content}
        </div>

        {/* AI: Decision card + metadata */}
        {!isUser && decision && (
          <>
            <DecisionCard decision={decision} />
            {/* AI metadata: model + tokens + latency */}
            {decision.execution && (
              <div
                className="flex items-center gap-3 mt-1 px-1"
                style={{ color: "var(--text-muted)" }}
              >
                <span className="text-[10px] font-mono">
                  {decision.execution.model_used ?? "—"}
                </span>
                <span className="text-[10px]">
                  {(decision.execution.input_tokens ?? 0) + (decision.execution.output_tokens ?? 0)} tokens
                </span>
                {decision.execution.latency_ms && (
                  <span className="text-[10px]">{decision.execution.latency_ms}ms</span>
                )}
                {decision.execution.total_cost_usd !== undefined && (
                  <span className="text-[10px]" style={{ color: "var(--accent-green)" }}>
                    ${decision.execution.total_cost_usd.toFixed(4)}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {/* AI: Feedback buttons */}
        {!isUser && decision && (
          <div className={`flex items-center gap-2 mt-1.5 ${isUser ? "" : "ml-1"}`}>
            <button
              onClick={() => handleFeedback("thumbs_up")}
              className="text-sm transition-all rounded p-1"
              style={{
                opacity:
                  feedbackGiven === "thumbs_up"
                    ? 1
                    : feedbackGiven
                    ? 0.25
                    : 0.45,
                transform: feedbackGiven === "thumbs_up" ? "scale(1.15)" : "scale(1)",
                color: feedbackGiven === "thumbs_up" ? "var(--accent-green)" : "var(--text-muted)",
              }}
              title="有帮助"
            >
              👍
            </button>
            <button
              onClick={() => handleFeedback("thumbs_down")}
              className="text-sm transition-all rounded p-1"
              style={{
                opacity:
                  feedbackGiven === "thumbs_down"
                    ? 1
                    : feedbackGiven
                    ? 0.25
                    : 0.45,
                transform: feedbackGiven === "thumbs_down" ? "scale(1.15)" : "scale(1)",
                color: feedbackGiven === "thumbs_down" ? "var(--accent-red)" : "var(--text-muted)",
              }}
              title="没帮助"
            >
              👎
            </button>
            {feedbackGiven && (
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                {feedbackGiven === "thumbs_up" ? "✓ 已记录" : "✓ 已记录，下次改进"}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
