import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import {
  db, agentRuns, brandAgents, channels, goalRevisions, interactions, posts, postTargets,
} from "@/lib/db";
import type { BrandWithRole } from "@/lib/auth";
import { platformOrNull } from "@/lib/platforms";
import { AGENTS } from "@/lib/agents/meta";
import { can } from "@/lib/auth";
import { isCleanVerdict, isVerdict } from "@/lib/workflows/review";
import {
  explainError, inWords, isSafetyStop, rankAttention, replySeverity, reviewSeverity, waited,
  type AttentionItem,
} from "@/lib/attention";
import { getEngagementQueue } from "./queries";
import { getOpenPauses } from "./workflows";
import { getGoalSummary, getGoalsForBrands, type GoalSummary } from "./goals";
import { weeklyVolume } from "./volume";

const H = 3_600_000;
const channelName = (c: { platform: string; handle: string }) => `${platformOrNull(c.platform)?.name ?? c.platform} · ${c.handle}`;

export type ChannelHealth = {
  id: string; platform: string; handle: string; mode: string;
  state: "ok" | "reconnect" | "error" | "manual";
  note: string | null;
  lastPublishedAt: Date | null; nextAt: Date | null; published7d: number;
};
export type AgentHealth = { code: string; name: string; enabled: boolean; state: "ok" | "failed" | "off" | "idle"; lastRunAt: Date | null; note: string | null };
export type BrandRow = {
  brand: { id: string; name: string; color: string };
  health: "bad" | "warn" | "ok";
  channels: ChannelHealth[];
  agents: AgentHealth[];
  booked7d: number; target7d: number | null; emptyAfter: Date | null;
  needsYou: number;
};
export type ComingUp = {
  id: string; postId: string; title: string; brandId: string; at: Date | null;
  channel: { platform: string; handle: string };
  state: "scheduled" | "manual" | "blocked" | "unapproved";
  why: string | null;
};
export type Autopilot = {
  published24h: number; written24h: number; replied24h: number; recovered72h: number; retrying: number;
  runs: Array<{ id: string; brandId: string; agent: string; status: string; summary: string | null; at: Date }>;
  failedRuns24h: number;
};
export type Attention = {
  now: Date;
  items: AttentionItem[];
  goals: Array<{ goal: GoalSummary["goal"]; brandId: string; summary: GoalSummary }>;
  brands: BrandRow[];
  coming: ComingUp[];
  autopilot: Autopilot;
};

/** Everything the dashboard needs, in the order a manager reads it: act, then check, then trust. */
export async function getAttention(brandList: BrandWithRole[], now = new Date()): Promise<Attention> {
  const ids = brandList.map((b) => b.id);
  const empty: Attention = {
    now, items: [], goals: [], brands: [], coming: [],
    autopilot: { published24h: 0, written24h: 0, replied24h: 0, recovered72h: 0, retrying: 0, runs: [], failedRuns24h: 0 },
  };
  if (ids.length === 0) return empty;

  const day = new Date(now.getTime() - 24 * H);
  const days3 = new Date(now.getTime() - 72 * H);
  const week = new Date(now.getTime() + 7 * 24 * H);
  const next48 = new Date(now.getTime() + 48 * H);

  const [chans, pauses, inbox, failedTargets, upcomingTargets, publishedTargets, crew, runs, proposed] = await Promise.all([
    db.select().from(channels).where(and(inArray(channels.brandId, ids), isNull(channels.archivedAt))).orderBy(asc(channels.platform)),
    getOpenPauses(ids),
    getEngagementQueue({ brandIds: ids, statuses: ["new", "in_progress"], direction: "inbound", limit: 60 }),
    db.select({ t: postTargets, p: posts }).from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId))
      .where(and(inArray(posts.brandId, ids), eq(postTargets.status, "failed"))),
    db.select({ t: postTargets, p: posts }).from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId))
      .where(and(inArray(posts.brandId, ids), inArray(postTargets.status, ["scheduled", "awaiting_manual", "pending"]),
        gte(postTargets.scheduledAt, new Date(now.getTime() - 6 * H)), lte(postTargets.scheduledAt, week))),
    db.select({ t: postTargets, p: posts }).from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId))
      .where(and(inArray(posts.brandId, ids), eq(postTargets.status, "published"), gte(postTargets.publishedAt, days3))),
    db.select().from(brandAgents).where(inArray(brandAgents.brandId, ids)),
    db.select().from(agentRuns).where(and(inArray(agentRuns.brandId, ids), gte(agentRuns.startedAt, days3))).orderBy(desc(agentRuns.startedAt)).limit(200),
    db.select({ goalId: goalRevisions.goalId, n: sql<number>`count(*)::int` }).from(goalRevisions)
      .where(eq(goalRevisions.status, "proposed")).groupBy(goalRevisions.goalId),
  ]);

  const brandOf = new Map(brandList.map((b) => [b.id, b]));
  const chanById = new Map(chans.map((c) => [c.id, c]));
  const items: AttentionItem[] = [];

  /* -- people waiting on us -------------------------------------------------- */
  for (const r of inbox) {
    const i = r.interaction;
    const sev = replySeverity({ dueAt: i.dueAt, priority: i.priority, reach: i.authorReach, sentiment: i.sentiment, kind: i.kind }, now);
    if (!sev) continue;
    const who = i.authorName || i.authorHandle || "Someone";
    const reach = (i.authorReach ?? 0) >= 1000 ? ` (${i.authorReach!.toLocaleString("en")} followers)` : "";
    items.push({
      key: `reply:${i.id}`, kind: "reply", severity: sev, brandId: i.brandId,
      title: `${who}${reach}: “${i.body.slice(0, 80)}${i.body.length > 80 ? "…" : ""}”`,
      detail: `${r.channel ? channelName(r.channel) : "Inbox"}${i.dueAt && i.dueAt <= now ? `, reply was due ${waited(i.dueAt, now)} ago` : ""}${i.replyBody ? ", a draft is ready" : ""}`,
      since: i.receivedAt, href: `/engage#i-${i.id}`, action: i.replyBody ? "Review reply" : "Reply",
      inline: brandOf.get(i.brandId) && can.edit(brandOf.get(i.brandId)!.role)
        ? { type: "reply", id: i.id, said: i.body, draft: i.replyBody, url: i.externalUrl } : undefined,
    });
  }

  /* -- work held for review -------------------------------------------------- */
  const postIds = [...new Set(pauses.map((p) => p.run.subjectId).filter((x): x is string => !!x))];
  const pausePosts = postIds.length ? await db.select().from(posts).where(inArray(posts.id, postIds)) : [];
  const postById = new Map(pausePosts.map((p) => [p.id, p]));
  for (const { step, run } of pauses) {
    const post = run.subjectId ? postById.get(run.subjectId) : null;
    const reasons = step.pause?.reasons ?? [];
    const safety = isSafetyStop(reasons);
    const brand = brandOf.get(step.brandId);
    const sev = reviewSeverity({ safety, waitingSince: step.createdAt, slotAt: post?.scheduledAt ?? null }, now);
    items.push({
      key: `review:${step.id}`, kind: "review", severity: sev, brandId: step.brandId,
      title: post ? `Approve “${post.title || post.body.slice(0, 50)}”` : step.pause?.question ?? "Approve this step",
      detail: safety ? `Held for safety: ${reasons.filter((r) => isSafetyStop([r])).join("; ")}`
        : post?.scheduledAt ? `Goes out ${inWords(post.scheduledAt, now)} once approved` : `Waiting ${waited(step.createdAt, now)}`,
      since: step.createdAt, href: `/review#s-${step.id}`, action: "Review",
      inline: post && !safety && step.pause?.kind === "review" && brand && can.approve(brand.role) && isCleanVerdict(step.output?.review, brand.reviewThreshold)
        ? { type: "approve", stepId: step.id, preview: post.body.slice(0, 280), score: isVerdict(step.output?.review) ? step.output.review.score : null } : undefined,
    });
  }

  /* -- channels that cannot post -------------------------------------------- */
  const failedByChannel = new Map<string, typeof failedTargets>();
  for (const f of failedTargets) failedByChannel.set(f.t.channelId, [...(failedByChannel.get(f.t.channelId) ?? []), f]);
  const brokenChannels = new Set<string>();
  for (const c of chans) {
    const expiring = c.status === "connected" && c.mode === "live" && c.tokenExpiresAt && c.tokenExpiresAt.getTime() - now.getTime() < 72 * H;
    const broken = c.status === "expired" || c.status === "error" || expiring;
    if (!broken) continue;
    brokenChannels.add(c.id);
    const failed = failedByChannel.get(c.id) ?? [];
    const atRisk = upcomingTargets.filter((u) => u.t.channelId === c.id && u.t.status === "scheduled");
    const why = expiring && c.status === "connected" ? `The sign-in expires ${inWords(c.tokenExpiresAt, now)}.` : explainError(c.lastError || "expired").text;
    const effect = [
      failed.length ? `${failed.length} post${failed.length === 1 ? "" : "s"} failed` : "",
      atRisk.length ? `${atRisk.length} scheduled ${atRisk.length === 1 ? "post" : "posts"} will fail (next ${inWords(atRisk.map((a) => a.t.scheduledAt!).sort((a, b) => +a - +b)[0], now)})` : "",
    ].filter(Boolean).join(", ");
    items.push({
      key: `channel:${c.id}`, kind: "channel",
      severity: failed.length || atRisk.length ? "now" : "today", brandId: c.brandId,
      title: `Reconnect ${channelName(c)}`,
      detail: `${why}${effect ? ` ${effect}.` : ""}`,
      since: c.tokenExpiresAt && c.tokenExpiresAt < now ? c.tokenExpiresAt : failed[0]?.t.scheduledAt ?? null,
      href: "/channels", action: "Reconnect",
    });
  }

  /* -- failed posts whose channel is fine ------------------------------------ */
  for (const f of failedTargets) {
    if (brokenChannels.has(f.t.channelId)) continue;
    const ch = chanById.get(f.t.channelId);
    const why = explainError(f.t.lastError);
    if (why.fix === "wait") continue;
    items.push({
      key: `failed:${f.t.id}`, kind: "post_failed", severity: "now", brandId: f.p.brandId,
      title: `“${f.p.title || f.p.body.slice(0, 50)}” failed on ${ch ? channelName(ch) : "a channel"}`,
      detail: why.text, since: f.t.scheduledAt, href: `/posts/${f.p.id}`, action: "Fix and retry",
    });
  }

  /* -- manual posts due ------------------------------------------------------ */
  const manualDue = upcomingTargets.filter((u) => u.t.status === "awaiting_manual" && u.t.scheduledAt && u.t.scheduledAt.getTime() <= now.getTime() + 2 * H);
  for (const [brandId, rows] of groupBy(manualDue, (u) => u.p.brandId)) {
    const first = rows.map((r) => r.t.scheduledAt!).sort((a, b) => +a - +b)[0];
    items.push({
      key: `manual:${brandId}`, kind: "manual_post", severity: first <= now ? "now" : "today", brandId,
      title: `Post ${rows.length} thing${rows.length === 1 ? "" : "s"} by hand`,
      detail: `${[...new Set(rows.map((r) => channelName(chanById.get(r.t.channelId) ?? { platform: "", handle: "" })))].join(", ")}, ${inWords(first, now)}. Copy and media are ready.`,
      since: first, href: "/queue", action: "Open queue",
    });
  }

  /* -- agents that stopped working ------------------------------------------- */
  const latestRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!latestRun.has(`${r.brandId}:${r.agentCode}`)) latestRun.set(`${r.brandId}:${r.agentCode}`, r);
  for (const [k, r] of latestRun) {
    if (r.status !== "failed") continue;
    const streak = runs.filter((x) => x.brandId === r.brandId && x.agentCode === r.agentCode && x.status === "failed").length;
    const e = explainError(r.error);
    if (e.fix === "wait") continue;
    // A lapsed sign-in is fixed by the Reconnect item above; a second card for the same cause is noise.
    if (e.cause === "auth" && chans.some((c) => c.brandId === r.brandId && brokenChannels.has(c.id))) continue;
    const agent = AGENTS.find((a) => a.code === r.agentCode);
    items.push({
      key: `agent:${k}`, kind: "agent", severity: agent?.code === "writer" || agent?.code === "community" ? "now" : "today", brandId: r.brandId,
      title: `${agent?.name ?? r.agentCode} has failed ${streak} time${streak === 1 ? "" : "s"} in a row`,
      detail: `${e.text}${r.agentCode === "writer" ? " Until it works, no new posts get booked." : ""}`,
      since: r.startedAt, href: "/agents", action: e.fix === "owner" ? "See details" : "Open agent",
    });
  }

  /* -- goals ----------------------------------------------------------------- */
  const goalRows = (await getGoalsForBrands(ids)).filter((g) => g.status === "active");
  const goalSummaries: Attention["goals"] = [];
  for (const g of goalRows) {
    const b = brandOf.get(g.brandId);
    if (!b) continue;
    try {
      const summary = await getGoalSummary(g, b);
      goalSummaries.push({ goal: g, brandId: g.brandId, summary });
      if (summary.pace === "at_risk" || summary.pace === "behind") {
        items.push({
          key: `goal:${g.id}`, kind: "goal", severity: summary.pace === "at_risk" ? "today" : "soon", brandId: g.brandId,
          title: `${g.name} is ${summary.pace === "at_risk" ? "at risk" : "behind"}`,
          detail: summary.headline?.text ?? `${Math.round(summary.progress * 100)}% done, plan expects ${Math.round(summary.elapsedShare * 100)}%.`,
          since: null, href: `/goals/${g.id}`, action: "See the plan",
        });
      }
    } catch (err) {
      console.error("Dashboard: goal summary failed", g.id, err);
    }
  }
  for (const p of proposed) {
    const g = goalRows.find((x) => x.id === p.goalId);
    if (!g) continue;
    items.push({
      key: `plan:${g.id}`, kind: "plan", severity: "today", brandId: g.brandId,
      title: `Approve a bigger plan for “${g.name}”`, detail: "The weekly plan changed by more than the goal's limit, so it waits for you.",
      since: null, href: `/goals/${g.id}`, action: "Review plan",
    });
  }

  /* -- what is going out ----------------------------------------------------- */
  const reviewPostIds = new Set(postIds);
  const coming: ComingUp[] = upcomingTargets
    .filter((u) => u.t.scheduledAt && u.t.scheduledAt <= next48 && u.t.scheduledAt >= now)
    .sort((a, b) => +a.t.scheduledAt! - +b.t.scheduledAt!)
    .map((u) => {
      const c = chanById.get(u.t.channelId)!;
      const blocked = brokenChannels.has(u.t.channelId);
      const unapproved = u.p.status === "in_review" || u.p.status === "changes_requested" || u.t.status === "pending" || reviewPostIds.has(u.p.id);
      return {
        id: u.t.id, postId: u.p.id, title: u.p.title || u.p.body.slice(0, 60), brandId: u.p.brandId, at: u.t.scheduledAt,
        channel: { platform: c.platform, handle: c.handle },
        state: blocked ? "blocked" : unapproved ? "unapproved" : u.t.status === "awaiting_manual" ? "manual" : "scheduled",
        why: blocked ? "Channel needs reconnecting, this will fail" : unapproved ? "Not approved yet" : u.t.status === "awaiting_manual" ? "You post this one" : null,
      } satisfies ComingUp;
    });

  /* -- brand board ----------------------------------------------------------- */
  const crewBy = new Map(crew.map((c) => [`${c.brandId}:${c.agentCode}`, c]));
  const volumes = new Map<string, number | null>();
  await Promise.all(brandList.map(async (b) => {
    try { volumes.set(b.id, (await weeklyVolume(b.id, now)).perWeek); } catch { volumes.set(b.id, null); }
  }));
  const needsBy = new Map<string, number>();
  for (const i of items) needsBy.set(i.brandId, (needsBy.get(i.brandId) ?? 0) + 1);

  const brandRows: BrandRow[] = brandList.map((b) => {
    const mine = chans.filter((c) => c.brandId === b.id);
    const chHealth: ChannelHealth[] = mine.map((c) => {
      const lastPub = publishedTargets.filter((t) => t.t.channelId === c.id).map((t) => t.t.publishedAt!).sort((x, y) => +y - +x)[0] ?? null;
      const booked = upcomingTargets.filter((u) => u.t.channelId === c.id && u.t.scheduledAt && u.t.scheduledAt >= now).map((u) => u.t.scheduledAt!).sort((x, y) => +x - +y);
      const broken = brokenChannels.has(c.id);
      return {
        id: c.id, platform: c.platform, handle: c.handle, mode: c.mode,
        state: broken ? (c.status === "error" ? "error" : "reconnect") : c.mode === "manual" ? "manual" : "ok",
        note: broken ? (c.status === "connected" ? "sign-in expires soon" : c.status === "expired" ? "needs reconnecting" : "has errors") : null,
        lastPublishedAt: lastPub, nextAt: booked[0] ?? null,
        published7d: publishedTargets.filter((t) => t.t.channelId === c.id && t.t.publishedAt! >= new Date(now.getTime() - 7 * 24 * H)).length,
      };
    });
    const agentHealth: AgentHealth[] = AGENTS.map((a) => {
      const cfg = crewBy.get(`${b.id}:${a.code}`);
      const last = latestRun.get(`${b.id}:${a.code}`);
      const state: AgentHealth["state"] = !cfg?.enabled ? "off" : last?.status === "failed" ? "failed" : last ? "ok" : "idle";
      return { code: a.code, name: a.name, enabled: !!cfg?.enabled, state, lastRunAt: cfg?.lastRunAt ?? null, note: state === "failed" ? explainError(last?.error).text : null };
    });
    const bookedDates = upcomingTargets.filter((u) => u.p.brandId === b.id && u.t.scheduledAt && u.t.scheduledAt >= now).map((u) => u.t.scheduledAt!);
    const postsBooked = new Set(upcomingTargets.filter((u) => u.p.brandId === b.id && u.t.scheduledAt && u.t.scheduledAt >= now).map((u) => u.p.id)).size;
    const lastBooked = bookedDates.sort((x, y) => +y - +x)[0] ?? null;
    const mineItems = items.filter((i) => i.brandId === b.id);
    const worst = mineItems.some((i) => i.severity === "now") ? "bad" : mineItems.length || agentHealth.some((a) => a.state === "failed") ? "warn" : "ok";
    return {
      brand: { id: b.id, name: b.name, color: b.color }, health: worst, channels: chHealth, agents: agentHealth,
      booked7d: postsBooked, target7d: volumes.get(b.id) ?? null, emptyAfter: lastBooked && lastBooked.getTime() < now.getTime() + 5 * 24 * H ? lastBooked : null,
      needsYou: needsBy.get(b.id) ?? 0,
    };
  });

  /* -- the autopilot's record ------------------------------------------------ */
  const [[written], [replied]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(posts).where(and(inArray(posts.brandId, ids), ne(posts.agentCode, ""), gte(posts.createdAt, day))),
    db.select({ n: sql<number>`count(*)::int` }).from(interactions).where(and(inArray(interactions.brandId, ids), gte(interactions.repliedAt, day))),
  ]);
  const autopilot: Autopilot = {
    published24h: publishedTargets.filter((t) => t.t.publishedAt! >= day).length,
    written24h: written?.n ?? 0,
    replied24h: replied?.n ?? 0,
    recovered72h: publishedTargets.filter((t) => t.t.attempts > 1).length,
    retrying: upcomingTargets.filter((u) => u.t.status === "scheduled" && u.t.attempts > 0).length,
    failedRuns24h: runs.filter((r) => r.status === "failed" && r.startedAt >= day).length,
    runs: runs.filter((r) => r.status !== "idle").slice(0, 8).map((r) => ({
      id: r.id, brandId: r.brandId, agent: r.agentCode, status: r.status, at: r.startedAt,
      summary: r.status === "failed" ? explainError(r.error).text : r.summary,
    })),
  };

  return { now, items: rankAttention(items), goals: goalSummaries, brands: brandRows, coming, autopilot };
}

function groupBy<T, K>(rows: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

