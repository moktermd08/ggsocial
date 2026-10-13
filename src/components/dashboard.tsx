import Link from "next/link";
import {
  AlertTriangle, Bot, CalendarClock, CheckCircle2, Goal as GoalIcon, Hand, MessageCircle, PlugZap, ShieldAlert, Sparkles, ThumbsUp, XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge, Card, CardHeader, LinkButton, buttonClass } from "@/components/ui";
import { InlineAction } from "@/components/dashboard-actions";
import { PlatformIcon } from "@/components/platform-icon";
import { PACE_META } from "@/lib/goals/meta";
import { inWords, waited, type AttentionItem, type AttentionKind, type Severity } from "@/lib/attention";
import { inZone } from "@/lib/format";
import type { Attention, BrandRow, ChannelHealth, ComingUp } from "@/server/attention";

type BrandLite = { id: string; name: string; color: string };

const SEV: Record<Severity, { label: string; color: string }> = {
  now: { label: "Now", color: "#b91c1c" },
  today: { label: "Today", color: "#b45309" },
  soon: { label: "Soon", color: "#64748b" },
};
const KIND_ICON: Record<AttentionKind, typeof Hand> = {
  reply: MessageCircle, review: ThumbsUp, channel: PlugZap, post_failed: XCircle, manual_post: Hand, goal: GoalIcon, plan: GoalIcon, agent: Bot,
};
/** Things that went wrong while the agents or platforms were working, as opposed to things simply waiting for a decision. */
const WENT_WRONG: AttentionKind[] = ["channel", "post_failed", "agent"];

function BrandDot({ brand }: { brand: BrandLite | undefined }) {
  if (!brand) return null;
  return <span className="inline-flex items-center gap-1.5 text-[11px] text-muted"><span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}</span>;
}

export function NeedsYou({ items, brands, now, showBrand, next }: {
  items: AttentionItem[]; brands: Map<string, BrandLite>; now: Date; showBrand: boolean; next: ComingUp | null;
}) {
  return (
    <Card>
      <CardHeader
        icon={ShieldAlert}
        title="Needs you"
        subtitle={items.length ? "Most urgent first. Everything else is already handled." : undefined}
      />
      {items.length === 0 ? (
        <div className="flex items-center gap-3 px-4 py-6 text-sm">
          <CheckCircle2 className="size-6 shrink-0 text-ok" />
          <p>
            <span className="font-medium">Nothing needs you.</span>{" "}
            <span className="text-muted">{next ? `Next post: “${next.title}” ${inWords(next.at, now)}.` : "Nothing is booked in the next 48 hours."}</span>
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const Icon = KIND_ICON[it.kind];
            const wrong = WENT_WRONG.includes(it.kind);
            return (
              <li key={it.key} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${SEV[it.severity].color} 14%, transparent)`, color: SEV[it.severity].color }}>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Badge color={SEV[it.severity].color}>{SEV[it.severity].label}</Badge>
                    {wrong && <Badge color="#b91c1c">Went wrong</Badge>}
                    {showBrand && <BrandDot brand={brands.get(it.brandId)} />}
                    {it.since && <span className="text-[11px] text-muted">{waited(it.since, now)}</span>}
                  </div>
                  <p className="mt-1 text-sm font-medium leading-snug">{it.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted">{it.detail}</p>
                </div>
                {it.inline
                  ? <InlineAction item={{ href: it.href, action: it.action, inline: it.inline }} primary={it.severity === "now"} />
                  : <Link href={it.href} className={`${buttonClass(it.severity === "now" ? "primary" : "subtle", "sm")} shrink-0`}>{it.action}</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const STATE_META: Record<ComingUp["state"], { label: string; color: string }> = {
  scheduled: { label: "Ready", color: "#15803d" },
  manual: { label: "You post", color: "#4f46e5" },
  unapproved: { label: "Not approved", color: "#b45309" },
  blocked: { label: "Will fail", color: "#b91c1c" },
};

export function ComingUpCard({ rows, brands, tz, showBrand }: { rows: ComingUp[]; brands: Map<string, BrandLite>; tz: string; showBrand: boolean }) {
  // Collapse a post going to several channels into one line.
  const byPost = new Map<string, ComingUp[]>();
  for (const r of rows) byPost.set(r.postId, [...(byPost.get(r.postId) ?? []), r]);
  const posts = [...byPost.values()];
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Going out in the next 48 hours" action={<LinkButton href="/calendar" size="sm">Calendar</LinkButton>} />
      {posts.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Nothing is booked. The writer fills the calendar when it is on; otherwise plan a week from Content.</p>
      ) : (
        <ul className="divide-y divide-border">
          {posts.map((group) => {
            const first = group[0];
            const worst = (["blocked", "unapproved", "manual", "scheduled"] as const).find((s) => group.some((g) => g.state === s))!;
            return (
              <li key={first.postId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-24 shrink-0 text-xs tabular-nums text-muted">{inZone(first.at, tz, { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <div className="min-w-0 flex-1">
                  <Link href={`/posts/${first.postId}`} className="block truncate text-sm font-medium hover:underline">{first.title}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    {showBrand && <BrandDot brand={brands.get(first.brandId)} />}
                    <span className="flex gap-1">{group.map((g) => <PlatformIcon key={g.id} platform={g.channel.platform} size={14} variant="glyph" />)}</span>
                    {first.why && worst !== "scheduled" && <span className="text-[11px] text-muted">{group.find((g) => g.state === worst)?.why}</span>}
                  </div>
                </div>
                <Badge color={STATE_META[worst].color}>{STATE_META[worst].label}</Badge>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const CH_DOT: Record<ChannelHealth["state"], string> = { ok: "#15803d", manual: "#8b8b96", reconnect: "#b91c1c", error: "#b91c1c" };

function ChannelPill({ c, now }: { c: ChannelHealth; now: Date }) {
  const quiet = c.state === "ok" && c.mode === "live" && c.published7d === 0 && !c.nextAt;
  const tip = [
    `${c.handle}`, c.note, c.lastPublishedAt ? `last post ${waited(c.lastPublishedAt, now)} ago` : "nothing posted in 3 days",
    c.nextAt ? `next ${inWords(c.nextAt, now)}` : "nothing booked",
  ].filter(Boolean).join(" · ");
  return (
    <span title={tip} className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] ${c.state === "reconnect" || c.state === "error" ? "border-danger/40 bg-danger/5" : quiet ? "border-warn/40" : "border-border"}`}>
      <PlatformIcon platform={c.platform} size={13} variant="glyph" />
      <span className="size-1.5 rounded-full" style={{ background: quiet ? "#b45309" : CH_DOT[c.state] }} />
      <span className="text-muted">{c.state === "reconnect" || c.state === "error" ? "reconnect" : quiet ? "quiet" : c.nextAt ? inWords(c.nextAt, now).replace("in ", "") : c.state === "manual" ? "manual" : "idle"}</span>
    </span>
  );
}

const HEALTH_COLOR = { bad: "#b91c1c", warn: "#b45309", ok: "#15803d" } as const;

export function BrandBoard({ rows, now }: { rows: BrandRow[]; now: Date }) {
  return (
    <Card>
      <CardHeader icon={Sparkles} title="Brands" subtitle="Channels and agents at a glance. Hover a channel for detail." action={<LinkButton href="/channels" size="sm">Channels</LinkButton>} />
      <ul className="divide-y divide-border">
        {rows.map((r) => {
          const behind = r.target7d !== null && r.booked7d < r.target7d;
          const failedAgents = r.agents.filter((a) => a.state === "failed");
          return (
            <li key={r.brand.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full" style={{ background: HEALTH_COLOR[r.health] }} title={r.health === "ok" ? "Healthy" : r.health === "warn" ? "Needs a look" : "Needs you now"} />
                <span className="size-2 rounded-sm" style={{ background: r.brand.color }} />
                <span className="text-sm font-medium">{r.brand.name}</span>
                {r.needsYou > 0 && <Badge color={HEALTH_COLOR[r.health]}>{r.needsYou} for you</Badge>}
                <span className={`ml-auto text-[11px] ${behind ? "font-medium text-warn" : "text-muted"}`}>
                  {r.booked7d}{r.target7d !== null ? ` of ${r.target7d}` : ""} posts booked this week
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">{r.channels.map((c) => <ChannelPill key={c.id} c={c} now={now} />)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                {r.agents.filter((a) => a.state !== "off").map((a) => (
                  <span key={a.code} title={a.note ?? (a.lastRunAt ? `last ran ${waited(a.lastRunAt, now)} ago` : "has not run yet")}
                    className={a.state === "failed" ? "font-medium text-danger" : "text-muted"}>
                    {a.state === "failed" ? <AlertTriangle className="mr-0.5 inline size-3" /> : <span className="mr-1 inline-block size-1.5 rounded-full bg-ok" />}
                    {a.name.split(" ")[0]} {a.state === "failed" ? "failing" : "on"}
                  </span>
                ))}
                {r.agents.every((a) => a.state === "off") && <span className="text-muted">No agents on. Everything is manual.</span>}
                {failedAgents.length === 0 && r.emptyAfter && <span className="text-warn">Calendar runs dry {inWords(r.emptyAfter, now).replace("in ", "in ")}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function GoalsCard({ goals, brands, showBrand }: { goals: Attention["goals"]; brands: Map<string, BrandLite>; showBrand: boolean }) {
  return (
    <Card>
      <CardHeader icon={GoalIcon} title="Goals" action={<LinkButton href="/goals" size="sm">All goals</LinkButton>} />
      {goals.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted">No goals yet. A goal turns into a weekly plan the agents follow.</p>
      ) : (
        <ul className="divide-y divide-border">
          {goals.map(({ goal, summary, brandId }) => {
            const meta = PACE_META[summary.pace];
            const pct = Math.min(100, Math.round(summary.progress * 100));
            const expected = Math.min(100, Math.round(summary.elapsedShare * 100));
            return (
              <li key={goal.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <Link href={`/goals/${goal.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{goal.name}</Link>
                  <Badge color={meta.color}>{meta.label}</Badge>
                </div>
                <div className="relative mt-2 h-1.5 rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: meta.color }} />
                  <div className="absolute top-[-2px] h-[10px] w-0.5 bg-text/60" style={{ left: `${expected}%` }} title={`Plan expects ${expected}% by now`} />
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  {showBrand && <>{brands.get(brandId)?.name} · </>}{pct}% there, plan expects {expected}% · {summary.daysLeft} days left
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function AutopilotCard({ a, brands, now, showBrand }: { a: Attention["autopilot"]; brands: Map<string, BrandLite>; now: Date; showBrand: boolean }) {
  const stats: Array<[number, string]> = [
    [a.published24h, "published"], [a.written24h, "posts written"], [a.replied24h, "replies sent"], [a.recovered72h, "recovered on retry"],
  ];
  return (
    <Card>
      <CardHeader icon={Bot} title="While you were away" subtitle="The last 24 hours, done without you" action={<LinkButton href="/agents" size="sm">Agents</LinkButton>} />
      <div className="grid grid-cols-4 gap-2 border-b border-border px-4 py-3">
        {stats.map(([n, label]) => (
          <div key={label}><p className="text-lg font-semibold tabular-nums">{n}</p><p className="text-[11px] leading-tight text-muted">{label}</p></div>
        ))}
      </div>
      {a.failedRuns24h > 0 && (
        <p className="border-b border-border bg-danger/5 px-4 py-2 text-xs text-danger"><AlertTriangle className="mr-1 inline size-3" />{a.failedRuns24h} agent run{a.failedRuns24h === 1 ? "" : "s"} failed in the last 24 hours.</p>
      )}
      <ul className="divide-y divide-border">
        {a.runs.length === 0 ? <li className="px-4 py-4 text-sm text-muted">No agent has worked yet.</li> : a.runs.map((r) => (
          <li key={r.id} className="flex items-start gap-2 px-4 py-2 text-xs">
            <span className={`mt-1 size-1.5 shrink-0 rounded-full ${r.status === "failed" ? "bg-danger" : "bg-ok"}`} />
            <p className="min-w-0 flex-1 leading-snug">
              <span className="font-medium capitalize">{r.agent}</span>{showBrand && <span className="text-muted"> · {brands.get(r.brandId)?.name}</span>}
              <span className="text-muted"> — {r.summary ?? "worked"}</span>
            </p>
            <span className="shrink-0 text-muted">{waited(r.at, now)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function Headline({ text, tone, action }: { text: string; tone: "bad" | "warn" | "ok"; action?: ReactNode }) {
  const color = tone === "bad" ? "text-danger" : tone === "warn" ? "text-warn" : "text-ok";
  return (
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <p className={`min-w-0 flex-1 text-base font-medium ${color}`}>{text}</p>
      {action}
    </div>
  );
}
