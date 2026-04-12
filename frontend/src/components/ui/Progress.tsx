import { cn } from "@/lib/utils";

export function Progress({
  value,
  max = 100,
  color = "bg-accent-blue",
  className,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
}) {
  const percent = Math.min(100, (value / max) * 100);
  return (
    <div
      className={cn("w-full rounded-full h-1.5 overflow-hidden", className)}
      style={{ backgroundColor: "var(--border-subtle)" }}
    >
      <div
        className={cn("h-1.5 rounded-full transition-all duration-500", color)}
        style={{ width: `${percent}%`, minWidth: percent > 0 ? "2px" : "0" }}
      />
    </div>
  );
}
