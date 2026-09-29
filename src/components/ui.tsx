/**
 * ggsocial's primitives. The page vocabulary — PageHeader, StatTile, Badge,
 * IconChip, EmptyState, SectionTitle — comes from @gg/ui, the kit GGLeads
 * uses too, so the two apps read as one family; these wrappers keep
 * ggsocial's prop names so no page had to change. Card, Button and Field are
 * still this app's own Tailwind.
 */
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import * as Kit from "@gg/ui";

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
 * A pill. `color` is an arbitrary brand or status hex; the kit blends it
 * toward the theme so the label stays readable in both themes.
 */
export function Badge({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return <Kit.Badge color={color} className={className}>{children}</Kit.Badge>;
}

/** A soft tinted square holding an icon — the visual anchor for tiles and headers. */
export function IconChip({ icon, tone = "#4f46e5", size = "md" }: { icon: LucideIcon; tone?: string; size?: "sm" | "md" | "lg" }) {
  return <Kit.IconChip icon={icon} color={tone} size={size} />;
}

/** Always drawn inside a Card here, so the kit's own dashed frame is dropped. */
export function EmptyState({ title, body, action, icon }: { title: string; body?: string; action?: ReactNode; icon?: LucideIcon }) {
  return <Kit.EmptyState bare title={title} body={body} action={action} icon={icon} />;
}

/**
 * A headline number with its icon, an optional trend line and an optional
 * change vs the previous period. `tone` is a hex that tints the icon.
 */
export function StatTile({ label, value, icon, tone = "#4f46e5", href, trend, delta, hint }: {
  label: string; value: ReactNode; icon: LucideIcon; tone?: string; href?: string;
  trend?: number[]; delta?: { value: number; goodWhenUp?: boolean }; hint?: string;
}) {
  return <Kit.StatTile label={label} value={value} icon={icon} color={tone} href={href} trend={trend} delta={delta} hint={hint} />;
}

export function PageHeader({ title, subtitle, action, icon }: { title: string; subtitle?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return <Kit.PageHeader title={title} subtitle={subtitle} action={action} icon={icon} />;
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
  return <Kit.SectionTitle title={title} hint={hint} />;
}
