import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import { Sparkline } from "./charts";

export function Card({ children, className = "", ...rest }: ComponentProps<"div">) {
  return (
    <div className={`rounded-xl border border-border bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action, subtitle, icon: Icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
          {Icon && <Icon className="size-4 text-muted" />}
          {title}
        </h2>
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

/** A soft tinted square holding an icon — the visual anchor for tiles and headers. */
export function IconChip({ icon: Icon, tone = "#4f46e5", size = "md" }: { icon: LucideIcon; tone?: string; size?: "sm" | "md" | "lg" }) {
  const box = { sm: "size-7 rounded-lg", md: "size-9 rounded-xl", lg: "size-14 rounded-2xl" }[size];
  const glyph = { sm: "size-3.5", md: "size-4.5", lg: "size-7" }[size];
  return (
    <span className={`grid shrink-0 place-items-center ${box}`} style={{ background: tintedSurface(tone, 16), color: tintedInk(tone, 80) }}>
      <Icon className={glyph} strokeWidth={size === "lg" ? 1.75 : 2} />
    </span>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && (
        <div className="relative mb-2">
          <span className="absolute -inset-3 rounded-full bg-accent-soft opacity-60" />
          <span className="absolute -inset-6 rounded-full border border-dashed border-border" />
          <span className="relative"><IconChip icon={icon} size="lg" /></span>
        </div>
      )}
      <p className="text-sm font-medium text-text">{title}</p>
      {body && <p className="max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * A headline number with its icon, an optional trend line and an optional
 * change vs the previous period. The number is the data; the sparkline is context.
 */
export function StatTile({ label, value, icon, tone = "#4f46e5", href, trend, delta, hint }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: string; href?: string;
  trend?: number[]; delta?: { value: number; goodWhenUp?: boolean }; hint?: string;
}) {
  const up = delta && delta.value > 0;
  const good = delta && (delta.goodWhenUp ?? true) === up;
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <IconChip icon={icon} tone={tone} size="sm" />
        {trend && trend.some((v) => v > 0) && <Sparkline values={trend} color={tintedInk(tone, 85)} className="h-7 w-20" />}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{value}</p>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{label}</span>
        {delta && delta.value !== 0 && (
          <span className={`inline-flex items-center font-medium ${good ? "text-ok" : "text-danger"}`}>
            {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
            {Math.abs(delta.value)}%
          </span>
        )}
      </div>
      {hint && <p className="mt-0.5 truncate text-[11px] text-muted">{hint}</p>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-surface p-4 transition-colors";
  return href ? <Link href={href} className={`${cls} hover:border-accent/40 hover:bg-surface-2`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function PageHeader({ title, subtitle, action, icon }: { title: string; subtitle?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <IconChip icon={icon} />}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
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
