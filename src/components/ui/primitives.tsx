"use client";

import { forwardRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ExternalLink } from "lucide-react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: "sm" | "md" };

/** Square icon button with an accessible label and tooltip. Min 36px hit area for touch. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = "md", className, children, ...rest },
  ref,
) {
  return (
    <Tooltip.Root delayDuration={400}>
      <Tooltip.Trigger asChild>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={cx(
            "inline-flex shrink-0 items-center justify-center rounded-[10px] text-ink-2 transition-colors",
            "hover:bg-hover active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
            // 44px targets on touch screens (iPad, phones)
            size === "md" ? "h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11" : "h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10",
            active && "bg-accent-soft text-accent hover:bg-accent-soft",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="z-50 rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-bg shadow-panel animate-in"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

export function Chip({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "in" | "out" | "route" | "warn";
  className?: string;
  title?: string;
}) {
  const tones = {
    neutral: "bg-hover text-ink-2",
    accent: "bg-accent-soft text-accent",
    in: "bg-in-soft text-in",
    out: "bg-out-soft text-out",
    route: "bg-route-soft text-route",
    warn: "bg-warn-soft text-warn",
  } as const;
  return (
    <span
      title={title}
      className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}
    >
      {children}
    </span>
  );
}

export function Section({
  title,
  count,
  children,
  action,
  accent,
}: {
  title: string;
  count?: number;
  children: ReactNode;
  action?: ReactNode;
  accent?: "in" | "out";
}) {
  return (
    <section className="border-t border-line px-5 py-4 first:border-t-0">
      <div className="mb-2.5 flex items-center gap-2">
        {accent && <span className={cx("h-2 w-2 rounded-full", accent === "in" ? "bg-in" : "bg-out")} />}
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">{title}</h3>
        {count !== undefined && <span className="tabular text-[11px] text-faint">{count}</span>}
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

export function ExtLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cx("inline-flex items-center gap-1 text-accent hover:underline", className)}
    >
      {children}
      <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
    </a>
  );
}

/** Hides content in self-check mode until the user reveals it. */
export function Reveal({ hidden, children, placeholder = "Показать" }: { hidden: boolean; children: ReactNode; placeholder?: string }) {
  const [shown, setShown] = useState(false);
  if (!hidden || shown) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setShown(true);
      }}
      className="rounded-md border border-dashed border-line-strong px-2 py-0.5 text-[12px] text-muted hover:border-accent hover:text-accent"
    >
      {placeholder}
    </button>
  );
}

export function TextButton({
  className,
  children,
  tone = "neutral",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "neutral" | "accent" | "primary" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex min-h-9 pointer-coarse:min-h-11 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium transition-colors active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none",
        tone === "primary" && "bg-accent text-white hover:opacity-90",
        tone === "accent" && "bg-accent-soft text-accent hover:opacity-90",
        tone === "neutral" && "bg-hover text-ink hover:bg-line",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
