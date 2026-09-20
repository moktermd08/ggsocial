import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";

export function Card({ children, className = "", ...rest }: ComponentProps<"div">) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export type ButtonVariant = "primary" | "ghost" | "danger" | "subtle";
type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" };

export function Button({ variant = "subtle", size = "md", className = "", ...rest }: ButtonProps) {
  return <button className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

export function buttonClass(variant: ButtonVariant = "subtle", size: "sm" | "md" = "md") {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const sizes = { sm: "px-2.5 py-1 text-xs", md: "px-3.5 py-2 text-sm" }[size];
  const variants = {
    // text-accent-fg, never text-white: --accent is a light violet in dark mode,
    // where white on it only reaches 3:1.
    primary: "bg-accent text-accent-fg hover:opacity-90",
    subtle: "border border-border bg-surface text-text hover:bg-surface-2",
    ghost: "text-text hover:bg-surface-2",
    danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
  }[variant];
  return `${base} ${sizes} ${variants}`;
}

export function LinkButton({ href, variant = "subtle", size = "md", children, className = "" }: {
  href: string; variant?: ButtonVariant; size?: "sm" | "md"; children: ReactNode; className?: string;
}) {
  return <Link href={href} className={`${buttonClass(variant, size)} ${className}`}>{children}</Link>;
}

/**
 * `color` is an arbitrary brand/status hex, so the label is blended toward the
 * theme's text colour rather than painted in the raw hex — a #15803d chip is
 * unreadable on a dark surface, and a pale one is unreadable on a light surface.
 */
export function Badge({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        color ? "" : "border-border bg-surface-2 text-text"
      } ${className}`}
      style={
        color
          ? { borderColor: tintedBorder(color), background: tintedSurface(color), color: tintedInk(color) }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

/** A labelled divider inside a long settings form. */
export function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
