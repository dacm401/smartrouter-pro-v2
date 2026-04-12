import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  fast: "bg-accent-green/10 text-accent-green border border-accent-green/20",
  slow: "bg-accent-purple/10 text-accent-purple border border-accent-purple/20",
  warn: "bg-accent-amber/10 text-accent-amber border border-accent-amber/20",
  default: "bg-bg-elevated text-text-secondary border border-border-default",
};

export function Badge({
  children,
  variant = "default",
  className,
}: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
