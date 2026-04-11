"use client";
import { useState } from "react";
import { DecisionCard } from "./DecisionCard";
import { sendFeedback } from "@/lib/api";

interface MessageBubbleProps { role: "user" | "assistant"; content: string; decision?: any; userId?: string; }

export function MessageBubble({ role, content, decision, userId = "user-001" }: MessageBubbleProps) {
  const isUser = role === "user";
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);

  const handleFeedback = async (type: "thumbs_up" | "thumbs_down") => {
    if (decision?.id && !feedbackGiven) {
      await sendFeedback(decision.id, type, userId);
      setFeedbackGiven(type);
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`max-w-[80%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`flex items-center gap-1.5 mb-1 ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-base">{isUser ? "👤" : "🤖"}</span>
          <span className="text-xs text-gray-400">{isUser ? "你" : "SmartRouter Pro"}</span>
        </div>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${isUser ? "bg-blue-500 text-white rounded-tr-sm" : "bg-white border border-gray-200 rounded-tl-sm text-gray-800"}`}>
          {content}
        </div>
        {!isUser && decision && <div className="w-full mt-1"><DecisionCard decision={decision} /></div>}
        {!isUser && decision && (
          <div className="flex items-center gap-2 mt-1.5 ml-1">
            <button onClick={() => handleFeedback("thumbs_up")} className={`text-sm transition-all ${feedbackGiven === "thumbs_up" ? "opacity-100 scale-110" : feedbackGiven ? "opacity-30" : "opacity-50 hover:opacity-100"}`} title="有帮助">👍</button>
            <button onClick={() => handleFeedback("thumbs_down")} className={`text-sm transition-all ${feedbackGiven === "thumbs_down" ? "opacity-100 scale-110" : feedbackGiven ? "opacity-30" : "opacity-50 hover:opacity-100"}`} title="没帮助">👎</button>
            {feedbackGiven && <span className="text-xs text-gray-400">{feedbackGiven === "thumbs_up" ? "✓ 已记录" : "✓ 已记录，下次改进"}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
