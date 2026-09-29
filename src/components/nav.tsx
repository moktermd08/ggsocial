"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, Workflow, CalendarDays, Lightbulb, PenSquare, Megaphone, FileText, ListChecks, MessagesSquare, ClipboardCheck, BookCheck, Goal, Bot, Images, Plug, BarChart3, Link2, Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SideNav } from "@gg/ui";

type Item = { href: string; label: string; short?: string; icon: LucideIcon; badgeKey?: "review" | "queue" | "engage" };

/**
 * The same five groups as GGLeads — Work, Content, Plan, Measure, Setup — so
 * someone who knows one GG app finds their way round the other.
 */
export const GROUPS: Array<{ label: string; items: Item[] }> = [
  { label: "Work", items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/review", label: "Review", icon: Inbox, badgeKey: "review" },
    { href: "/queue", label: "Publish queue", short: "Queue", icon: ListChecks, badgeKey: "queue" },
    { href: "/engage", label: "Engagement", icon: MessagesSquare, badgeKey: "engage" },
    { href: "/activities", label: "Activities", short: "Tasks", icon: ClipboardCheck },
  ] },
  { label: "Content", items: [
    { href: "/ideas", label: "Content plan", short: "Plan", icon: Lightbulb },
    { href: "/posts", label: "Content", icon: PenSquare },
    { href: "/campaigns", label: "Campaigns", icon: Megaphone },
    { href: "/templates", label: "Templates", icon: FileText },
    { href: "/calendar", label: "Calendar", icon: CalendarDays },
    { href: "/library", label: "Media", icon: Images },
  ] },
  { label: "Plan", items: [
    { href: "/goals", label: "Goals", icon: Goal },
    { href: "/playbook", label: "Playbook", icon: BookCheck },
    { href: "/workflows", label: "Workflows", short: "Flows", icon: Workflow },
  ] },
  { label: "Measure", items: [
    { href: "/analytics", label: "Analytics", icon: BarChart3 },
    { href: "/links", label: "Traffic", icon: Link2 },
    { href: "/agents", label: "Agents", icon: Bot },
  ] },
  { label: "Setup", items: [
    { href: "/brands", label: "Brands & team", icon: Building2 },
    { href: "/channels", label: "Channels", icon: Plug },
  ] },
];
const ITEMS = GROUPS.flatMap((g) => g.items);

export function Nav({ counts, variant = "sidebar" }: { counts: { queue: number; engage: number; review: number }; variant?: "sidebar" | "bar" }) {
  const pathname = usePathname();
  const bar = variant === "bar";
  return (
    <nav className={bar ? "flex gap-1 overflow-x-auto" : "space-y-0.5"}>
      {ITEMS.map(({ href, label, short, icon: Icon, badgeKey }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const badge = badgeKey ? counts[badgeKey] : 0;
        return (
          <Link
            key={href}
            href={href}
            className={`relative flex items-center rounded-lg transition-colors ${
              bar ? "shrink-0 flex-col gap-0.5 px-2.5 py-1.5 text-[10px]" : "gap-2.5 px-2.5 py-2 text-sm"
            } ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-text"}`}
          >
            <Icon className="size-4 shrink-0" />
            <span className={bar ? "whitespace-nowrap" : "flex-1"}>{bar ? short ?? label.split(" ")[0] : label}</span>
            {badge > 0 && (
              <span className={`rounded-full bg-accent text-[10px] font-semibold text-accent-fg ${
                bar ? "absolute right-1 top-0.5 px-1" : "px-1.5 py-0.5"
              }`}>{badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/** The desktop sidebar: the GG app frame from @gg/ui, with ggsocial's links and counts. */
export function GGSideNav({ counts, top, footer }: {
  counts: { queue: number; engage: number; review: number }; top?: ReactNode; footer?: ReactNode;
}) {
  const path = usePathname();
  return (
    <SideNav
      app={{ name: "ggsocial", tagline: "every brand, one desk", icon: Megaphone }}
      path={path}
      hotAt={0}
      groups={GROUPS.map((g) => ({
        label: g.label,
        items: g.items.map((i) => ({ href: i.href, label: i.label, icon: i.icon, count: i.badgeKey ? counts[i.badgeKey] : undefined })),
      }))}
      top={top}
      footer={footer}
    />
  );
}
