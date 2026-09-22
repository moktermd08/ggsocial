"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, CalendarDays, Lightbulb, PenSquare, Megaphone, ListChecks, MessagesSquare, Images, Plug, BarChart3, Link2, Building2,
} from "lucide-react";

const ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/ideas", label: "Content plan", short: "Plan", icon: Lightbulb },
  { href: "/posts", label: "Content", icon: PenSquare },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/queue", label: "Publish queue", short: "Queue", icon: ListChecks, badgeKey: "queue" as const },
  { href: "/engage", label: "Engagement", icon: MessagesSquare, badgeKey: "engage" as const },
  { href: "/library", label: "Media", icon: Images },
  { href: "/channels", label: "Channels", icon: Plug },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/links", label: "Traffic", icon: Link2 },
  { href: "/brands", label: "Brands & team", icon: Building2 },
];

export function Nav({ counts, variant = "sidebar" }: { counts: { queue: number; engage: number }; variant?: "sidebar" | "bar" }) {
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
