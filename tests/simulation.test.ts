/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
/**
 * End-to-end simulation of the plan -> write -> review -> post -> monitor -> learn loop.
 * Real DB (PGlite), real agents/workflows/reviewer/publisher. Only Claude and the platforms
 * are faked. The "human" is scripted below and logged as `HUMAN`. Findings print as `GAP`.
 * Run: npx vitest run tests/simulation.test.ts
 */
import { describe, expect, it, vi } from "vitest";
import { and, eq, inArray, ne } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

const sim = vi.hoisted(() => ({
  prompts: [] as { kind: string; system: string; task: string }[],
  published: [] as { platform: string; body: string; handle: string; media: number; options: Record<string, unknown> }[],
  publishCalls: {} as Record<string, number>,
  channelIds: [] as string[],
  brandOf: {} as Record<string, string>,
  failXOnce: true,
  inbound: [] as { channelHandle: string; items: unknown[] }[],
  replies: [] as string[],
  canvaCalls: [] as string[],
  postIds: [] as string[],
}));

const fakeClaude = vi.hoisted(() => async (args: any) => {
    const schema = JSON.stringify(args.output_config?.format?.schema ?? {});
    const system = args.system?.map((s: any) => s.text).join("\n") ?? "";
    const raw = args.messages.at(-1).content;
    const task = typeof raw === "string" ? raw : JSON.stringify(raw);
    const usage = { input_tokens: 1200, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    const base = { model: args.model, usage, stop_reason: "end_turn", content: [] as unknown[] };
    const first = typeof args.messages[0].content === "string" ? args.messages[0].content : "";
    let parsed: any;
    if (schema.includes('"flags"') && schema.includes('"score"')) {
      sim.prompts.push({ kind: "review", system, task });
      const risky = /refund|guarantee|\$\d/i.test(task);
      parsed = { score: risky ? 62 : 88, flags: risky ? ["price_or_offer"] : [], summary: risky ? "Mentions money." : "Fine.", fixes: risky ? ["Drop the price."] : [] };
    } else if (schema.includes('"hashtags"') && schema.includes('"channels"')) {
      sim.prompts.push({ kind: "draft", system, task: first });
      const ids = sim.channelIds.filter((id) => first.includes(id));
      const t = /Working title: ?(.*)/.exec(first)?.[1] ?? "Post";
      parsed = {
        title: "No-show fix",
        body: "Most clinics lose a day a week to no-shows. Here is the fix we use, in three steps. Try it Monday. #ops #tips #growth",
        channels: ids.map((channelId) => ({ channelId, body: "Most clinics lose a day a week to no-shows. Here is the fix in three steps. Try it Monday. #ops #tips #growth", firstComment: null })),
        hashtags: ["ops"], note: `angle for ${t}`,
      };
    } else if (schema.includes('"versions"')) {
      sim.prompts.push({ kind: "versions", system, task });
      const em = /enum: \[([^\]]+)\]/.exec(schema.replace(/\\"/g, '"'));
      const formats: string[] = em ? JSON.parse("[" + em[1] + "]") : [];
      parsed = {
        versions: [...formats].sort((x, y) => Number(y === "carousel") - Number(x === "carousel")).slice(0, 3).map((format) => ({ format, title: "T", body: `caption for ${format} #ops #tips #growth`, outline: ["No-shows cost a day a week", "Why reminders fail", "The 3-step fix", "Try it Monday"], script: format.includes("reel") || format === "video" ? "hook..." : "" })),
        note: "ok",
      };
    } else if (schema.includes('"ideas"')) {
      sim.prompts.push({ kind: "plan-ideas", system, task });
      const n = Number(/(\d+) (?:new )?ideas?/i.exec(task)?.[1] ?? 3);
      parsed = {
        ideas: Array.from({ length: Math.min(n, 4) }, (_, i) => ({
          title: `Idea ${Date.now() % 100000}-${i}`, pillar: "Ops", problem: "A real problem", action: "Do the thing", outcome: "It works",
          postType: "Hook", tone: "practical", needsMedia: false, hashtags: [], why: "serves the goal",
        })),
      };
    } else if (schema.includes('"replies"')) {
      sim.prompts.push({ kind: "community", system, task });
      const ids = [...task.matchAll(/- id: (\S+)/g)].map((m) => m[1]);
      parsed = { replies: ids.map((id) => ({ id, reply: "Thanks for the note, we are on it.", sentiment: "neutral", priority: "normal", handToPerson: false, note: "" })) };
    } else if (schema.includes('"standouts"')) {
      sim.prompts.push({ kind: "analyst", system, task });
      const hit = sim.postIds.find((id) => task.includes(id));
      parsed = { note: "Carousels beat text posts 3x. Post more carousels.", standouts: hit ? [{ postId: hit, learning: "LESSON-CAROUSELS-3X: the how-to carousel got 3x the saves." }] : [] };
    } else {
      sim.prompts.push({ kind: "unknown", system, task });
      parsed = {};
    }
    return { id: "msg_sim", type: "message", role: "assistant", ...base, content: [{ type: "text", text: JSON.stringify(parsed) }] };
});

const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (url.includes("api.anthropic.com")) {
    const out = await fakeClaude(JSON.parse(init.body));
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("api.canva.com")) {
    sim.canvaCalls.push(url.replace("https://api.canva.com/rest/v1", ""));
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/dataset")) return json({ dataset: { headline: { type: "text" }, subhead: { type: "text" } } });
    if (url.endsWith("/autofills")) return json({ job: { id: "j1", status: "success", result: { design: { id: "d" + sim.canvaCalls.length, title: "t", urls: { edit_url: "https://canva.test/e" } } } } });
    if (url.endsWith("/exports")) return json({ job: { id: "e1", status: "success", urls: ["https://files.test/a.png"] } });
  }
  if (url.startsWith("https://files.test/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  return realFetch(input, init);
});
vi.mock("@/lib/platforms", async () => {
  const actual = await vi.importActual<typeof import("@/lib/platforms")>("@/lib/platforms");
  const wrap = (id: string) => {
    const p = actual.getPlatform(id);
    return {
      ...p,
      publish: async (ctx: any) => {
        sim.publishCalls[ctx.channel.handle] = (sim.publishCalls[ctx.channel.handle] ?? 0) + 1;
        if (id === "x" && sim.failXOnce) { sim.failXOnce = false; throw new Error("429 Too Many Requests"); }
        sim.published.push({ platform: id, body: ctx.body, handle: ctx.channel.handle, media: ctx.media.length, options: ctx.options });
        return { externalId: `ext-${id}-${sim.published.length}`, externalUrl: `https://${id}.test/${sim.published.length}` };
      },
      fetchMetrics: async () => ({ impressions: 1000, reach: 800, likes: 40, commentCount: 5, shares: 3, saves: 2, clicks: 11 }),
      fetchInbound: async (ctx: any) => (sim.inbound.find((i) => i.channelHandle === ctx.channel.handle)?.items ?? []) as any,
      sendReply: async (ctx: any) => { sim.replies.push(ctx.body); return { externalId: "r1" }; },
    };
  };
  return { ...actual, getPlatform: wrap };
});
vi.mock("@/server/channel-auth", async () => {
  const actual = await vi.importActual<typeof import("@/server/channel-auth")>("@/server/channel-auth");
  return { ...actual, freshCredentials: async () => ({ token: "t" }) };
});
vi.mock("@/server/media", () => ({ publicUrl: (u: string) => u, storeBuffer: async () => ({ url: "https://img.test/gen.png", size: 3, kind: "image" }) }));
vi.mock("@/server/integrations/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/server/integrations/oauth")>("@/server/integrations/oauth");
  return { ...actual, getAccessToken: async () => "canva-token" };
});
vi.mock("@/server/alerts", () => ({ sendAlert: vi.fn(async () => {}) }));
vi.stubEnv("ANTHROPIC_API_KEY", "sim");
vi.stubEnv("ANTHROPIC_BASE_URL", "https://api.anthropic.com");

import { WORKFLOWS } from "@/lib/workflows/meta";
import { attachments, brandAgents, integrations, media, db, users, brands, memberships, channels, contentIdeas, goals, posts, postTargets, interactions, workflowRuns, workflowRunSteps, agentRuns, metrics } from "@/lib/db";
import { ensureBrandAgent, runDueAgents } from "@/server/agents";
import { approveCleanPauses, decide, getOpenPauses, runDueWorkflows, setStepAutoApprove } from "@/server/workflows";
import { remindReviews } from "@/server/review-reminders";
import { runDuePublishes } from "@/server/publish";
import { pullInbound } from "@/server/inbox";
import { sendAlert } from "@/server/alerts";

const log: string[] = [];
const say = (s: string) => { log.push(s); };
const gaps: string[] = [];
const gap = (s: string) => { gaps.push(s); log.push("   GAP: " + s); };
const human = (s: string) => log.push("   HUMAN: " + s);
let protectedPost: string | null = null;
const retryWaits: number[] = [];
const clicks = { decisions: 0, manualTasks: 0, bulk: 0 };

/** The reviewer works the inbox. Options say how much of the manual work they do. */
async function humanPass(userId: string, label: string, opts: { sendBackFirstPost?: boolean; rejectOne?: boolean; doMediaTasks?: boolean; bulk?: boolean } = {}) {
  const pauses = await getOpenPauses((await db.select({ id: brands.id }).from(brands)).map((b) => b.id));
  say(label + ": inbox has " + pauses.length + " item(s)");
  if (opts.bulk) {
    const r = await approveCleanPauses((await db.select({ id: brands.id }).from(brands)).map((b) => b.id), userId);
    if (r.approved) { human("pressed 'Approve all clean': " + r.approved + " approved in ONE click, " + r.left + " left to look at"); clicks.bulk++; }
  }
  const open = opts.bulk ? await getOpenPauses((await db.select({ id: brands.id }).from(brands)).map((b) => b.id)) : pauses;
  let sentBack = false, rejected = false, approved = 0, tasks = 0;
  for (const p of open) {
    const step = p.step;
    const run = p.run;
    const code = run.workflowCode;
    const kind = step.pause?.kind;
    const reasons = (step.pause?.reasons ?? []).join(" | ");
    try {
      if (kind === "human") {
        if (opts.doMediaTasks && code === "publish-post" && step.stepKey === "media" && run.subjectId) {
          const [m] = await db.insert(media).values({ brandId: run.brandId, kind: "image", url: "https://img.test/a.png", originalName: "a.png", mimeType: "image/png", size: 1000, width: 1080, height: 1350, source: "canva", altText: "x" } as any).returning();
          await db.insert(attachments).values({ postId: run.subjectId, mediaId: m.id, position: 0 });
          await decide({ stepId: step.id, decision: "done", note: null, userId });
          human("designed an image in Canva by hand, filed it"); tasks++; clicks.manualTasks++;
        } else human(code + "/" + step.stepKey + " task for a person: " + (step.pause?.question ?? "").slice(0, 90));
        continue;
      }
      if (opts.sendBackFirstPost && !sentBack && code === "publish-post" && step.pause?.sendBackTo && run.subjectId !== protectedPost) {
        await decide({ stepId: step.id, decision: "send_back", note: "Hook is weak. Open with a specific number.", userId });
        human("sent back " + code + ": weak hook"); sentBack = true; clicks.decisions++; continue;
      }
      if (opts.rejectOne && !rejected && code === "publish-post" && run.subjectId !== protectedPost) {
        await decide({ stepId: step.id, decision: "reject", note: "Off-strategy this week.", userId });
        human("rejected " + code); rejected = true; clicks.decisions++; continue;
      }
      if (kind === "safety") human("SAFETY stop on " + code + "/" + step.stepKey + ": " + reasons.slice(0, 110));
      await decide({ stepId: step.id, decision: "approve", note: null, userId });
      approved++; clicks.decisions++;
    } catch (e) { human("could not decide " + code + "/" + step.stepKey + ": " + (e as Error).message); }
  }
  human("approved " + approved + " one by one, did " + tasks + " manual task(s)");
}

async function snapshot(label: string, brandIds: string[]) {
  const [p, t, r] = await Promise.all([
    db.select({ s: posts.status }).from(posts).where(inArray(posts.brandId, brandIds)),
    db.select({ s: postTargets.status }).from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId)).where(inArray(posts.brandId, brandIds)),
    db.select({ s: workflowRuns.status }).from(workflowRuns).where(inArray(workflowRuns.brandId, brandIds)),
  ]);
  const tally = (a: { s: string }[]) => Object.entries(a.reduce<Record<string, number>>((m, x) => ((m[x.s] = (m[x.s] ?? 0) + 1), m), {})).map(([k, v]) => k + ":" + v).join(" ") || "-";
  say("[" + label + "] posts{" + tally(p) + "} targets{" + tally(t) + "} runs{" + tally(r) + "}");
}

type World = { tag: string; autoApprove: boolean; bulk: boolean; canva: boolean; doMediaTasks: boolean };

async function runWorld(w: World) {
  log.length = 0; gaps.length = 0; clicks.decisions = 0; clicks.manualTasks = 0; clicks.bulk = 0;
  sim.published.length = 0; sim.publishCalls = {}; sim.failXOnce = true; sim.replies.length = 0; sim.inbound.length = 0; sim.canvaCalls.length = 0;
  (sendAlert as any).mockClear();
  // Earlier worlds stop working: nothing of theirs ticks in this one.
  await db.update(brandAgents).set({ enabled: false });
  await db.update(workflowRuns).set({ status: "cancelled" }).where(inArray(workflowRuns.status, ["running", "waiting", "waiting_review", "waiting_human"]));

  const t = w.tag;
  const [owner] = await db.insert(users).values({ email: t + "@sim.test", name: "Reviewer", passwordHash: "x" }).returning();
  const [rich] = await db.insert(brands).values({
    name: t + " Rich Co", slug: t + "-rich", timezone: "UTC", description: "We make scheduling software for clinics.", tagline: "Fewer no-shows",
    industry: "Health software", proofPoints: ["Used by 120 clinics"], aiDailyBudget: 5,
    canvaTemplateId: w.canva ? "TEMPLATE12345" : null,
  } as any).returning();
  const [bare] = await db.insert(brands).values({ name: t + " Bare Co", slug: t + "-bare", timezone: "UTC" }).returning();
  await db.insert(memberships).values([{ userId: owner.id, brandId: rich.id, role: "owner" }, { userId: owner.id, brandId: bare.id, role: "owner" }]);
  if (w.canva) await db.insert(integrations).values({ userId: owner.id, provider: "canva", credentials: "x" });
  const mk = async (brandId: string, platform: string, handle: string) => {
    const [c] = await db.insert(channels).values({ brandId, platform, handle: t + "." + handle, mode: "live", status: "connected", settings: {} }).returning();
    sim.channelIds.push(c.id); return c;
  };
  await mk(rich.id, "bluesky", "rich.bsky"); await mk(rich.id, "x", "rich_x"); await mk(rich.id, "linkedin", "rich-li"); const rIg = await mk(rich.id, "instagram", "rich_ig");
  await mk(bare.id, "bluesky", "bare.bsky");
  await db.insert(goals).values({ brandId: rich.id, status: "active", name: "Grow reach", metric: "post_reach", targetValue: 50000, startValue: 0, startDate: "2026-10-01", deadline: "2026-12-31", plan: { units: { "D-01": 5 } } } as any);
  for (const b of [rich, bare]) for (const code of ["writer", "strategist", "community", "analyst"] as const) {
    const a = await ensureBrandAgent(b.id, code);
    await db.update(brandAgents).set({ enabled: true }).where(eq(brandAgents.id, a.id));
  }
  if (w.autoApprove) {
    for (const b of [rich, bare]) for (const wf of WORKFLOWS) for (const st of wf.steps) {
      if (st.reviewable && st.performer === "agent") await setStepAutoApprove({ brandId: b.id, code: wf.code, stepKey: st.key, autoApprove: true, reason: "sim", userId: owner.id });
    }
  }
  await db.insert(contentIdeas).values([
    { ownerId: owner.id, sequence: 1, title: t + " seed 1", problem: "p1", status: "planned" },
    { ownerId: owner.id, sequence: 2, title: t + " seed 2", problem: "p2", status: "planned", postType: "Carousel" },
  ]);

  let now = new Date(Date.now() + 60_000);
  const tick = async (label: string) => {
    sim.postIds = (await db.select({ id: posts.id }).from(posts)).map((r) => r.id);
    const inbound = await pullInbound(now, 5_000);
    const wf = await runDueWorkflows(now, 20_000);
    const ag = await runDueAgents(now, 60_000);
    const rem = await remindReviews(now);
    say("TICK " + label + " @ " + now.toISOString().slice(0, 16) + " wf=" + wf.moved.length + " agents=" + (ag as any).ran?.length + " reminders=" + JSON.stringify(rem));
  };

  /* ---- day 1: plan + write; the reviewer is away for 4 hours ---- */
  await tick("1");
  await snapshot("after tick 1", [rich.id, bare.id]);
  const waiting1 = await getOpenPauses([rich.id, bare.id]);
  say("Waiting on a person right after the agents' first pass: " + waiting1.length);
  now = new Date(now.getTime() + 4 * 3600_000);
  await tick("2 (reviewer still away 4h later)");
  const reminded = (sendAlert as any).mock.calls.filter((c: any[]) => c[0].kind === "review_waiting");
  say("Review-waiting emails sent: " + reminded.length + (reminded[0] ? "  SUBJECT: " + reminded[0][0].subject + "\n        " + reminded[0][0].lines.join("\n        ") : ""));
  if (waiting1.length && reminded.length === 0) gap("Items waited 4 hours and nobody was told.");

  /* ---- a late approval: one post's slot passes while it waits ---- */
  const late = (await db.select().from(posts).where(and(eq(posts.brandId, rich.id), eq(posts.status, "in_review"))))
    .find((x) => x.postType !== "Carousel");
  protectedPost = late?.id ?? null;
  if (late) {
    const past = new Date(Date.now() - 5 * 3600_000);
    await db.update(posts).set({ scheduledAt: past }).where(eq(posts.id, late.id));
    await db.update(postTargets).set({ scheduledAt: past }).where(eq(postTargets.postId, late.id));
  }

  /* ---- human rounds ---- */
  await humanPass(owner.id, "human pass 1", { sendBackFirstPost: true, rejectOne: true, doMediaTasks: w.doMediaTasks, bulk: w.bulk });
  if (late) {
    const after = await db.query.posts.findFirst({ where: eq(posts.id, late.id) });
    say("Late post (slot passed 5h before approval) now: status=" + after?.status + " scheduledAt=" + after?.scheduledAt?.toISOString().slice(0, 16) + (after?.scheduledAt && after.scheduledAt > new Date() ? "  -> moved to the next slot, no extra human step" : ""));
  }
  for (let r = 2; r <= 5; r++) {
    now = new Date(now.getTime() + 65 * 60_000);
    await tick(String(r));
    await humanPass(owner.id, "human pass " + r, { doMediaTasks: w.doMediaTasks, bulk: w.bulk });
  }
  if (late) {
    const end = await db.query.posts.findFirst({ where: eq(posts.id, late.id) });
    say("Late post at the end: status=" + end?.status + " slot=" + end?.scheduledAt?.toISOString().slice(0, 16) + (end?.scheduledAt && end.scheduledAt.getTime() > Date.now() - 3600_000 ? "  (re-slotted automatically)" : "  (still on the old slot)"));
  }
  await snapshot("after human rounds", [rich.id, bare.id]);

  /* ---- publish ---- */
  const real = new Date();
  const hhmm = new Date(real.getTime() - 60_000).toISOString().slice(11, 16);
  await db.update(channels).set({ settings: { postTimes: hhmm, postDays: "sun-sat" } });
  await db.update(postTargets).set({ scheduledAt: new Date(real.getTime() - 60_000) }).where(eq(postTargets.status, "scheduled"));
  const pub1 = await runDuePublishes();
  // X rate-limits the first post once: it must wait, not come back on the very next tick.
  const limited = await db.select().from(postTargets).where(and(eq(postTargets.status, "scheduled"), ne(postTargets.attempts, 0)));
  const waits = limited.map((x) => Math.round(((x.scheduledAt?.getTime() ?? 0) - Date.now()) / 60_000));
  say("Rate-limited targets: " + limited.length + ", waiting " + waits.join(",") + " min");
  const pub2 = await runDuePublishes();
  say("Next tick resent " + pub2.length + " (backoff holds them)");
  if (limited.length) {
    await db.update(postTargets).set({ scheduledAt: new Date(Date.now() - 60_000) }).where(inArray(postTargets.id, limited.map((x) => x.id)));
    const pub3 = await runDuePublishes();
    say("After the wait: " + pub3.filter((r) => r.ok).length + " of them went out");
  }
  retryWaits.push(...waits);
  say("PUBLISH: " + (pub1.length + pub2.length) + " sends; platforms: " + sim.published.map((x) => x.platform).join(","));
  const igs = await db.select().from(postTargets).where(eq(postTargets.channelId, rIg.id));
  const byKind = (pl: string) => sim.published.filter((x) => x.platform === pl).map((x) => (pl === "instagram" ? x.media + " img" + (x.options.format ? "/" + x.options.format : "") : pl === "x" ? (x.options.thread ? "thread" : "post") : "post")).join(" ");
  say("WENT OUT AS  instagram: [" + byKind("instagram") + "]  x: [" + byKind("x") + "]  bluesky: [" + byKind("bluesky") + "]");
  say("Instagram targets: " + igs.map((x) => x.status).join(",") + "   Canva calls: " + sim.canvaCalls.length);
  now = new Date(Math.max(now.getTime(), real.getTime()) + 60_000);
  await tick("workflows notice the publish");
  await snapshot("after publish", [rich.id, bare.id]);
  const openNow = await getOpenPauses([rich.id, bare.id]);
  for (const o of openNow.filter((x) => x.step.pause?.kind === "human")) say("Still waiting on hands: " + (o.step.pause?.question ?? "").slice(0, 120));
  const nonIgPublished = sim.published.filter((x) => x.platform !== "instagram").length;
  if (!w.canva && !w.doMediaTasks) {
    if (nonIgPublished === 0) gap("Text channels did not publish while Instagram waited for an image.");
    else say("CHECK: " + nonIgPublished + " text-channel posts went out while Instagram still waits for an image.");
  }

  /* ---- monitor ---- */
  const pubTargets = await db.select().from(postTargets).where(eq(postTargets.status, "published"));
  const bsky = pubTargets.find((x) => x.externalPostId?.includes("bluesky"));
  if (bsky) {
    sim.inbound.push({ channelHandle: t + ".rich.bsky", items: [
      { externalId: t + "c1", kind: "comment", body: "Love this! Do you integrate with Epic?", authorName: "Sam", receivedAt: new Date(now.getTime() - 60_000), externalPostId: bsky.externalPostId },
      { externalId: t + "c2", kind: "comment", body: "I want a refund, your tool double booked me. This is unacceptable.", authorName: "Angry", receivedAt: new Date(now.getTime() - 30_000), externalPostId: bsky.externalPostId },
    ] });
  }
  now = new Date(now.getTime() + 12 * 60_000);
  await tick("inbound pulled");
  now = new Date(now.getTime() + 12 * 60_000);
  await tick("community drafts replies");
  await humanPass(owner.id, "human pass replies", { doMediaTasks: w.doMediaTasks, bulk: w.bulk });
  say("Replies sent via API: " + sim.replies.length);

  const pubCount = (await db.select({ id: postTargets.id }).from(postTargets).innerJoin(posts, eq(posts.id, postTargets.postId)).where(and(inArray(posts.brandId, [rich.id, bare.id]), eq(postTargets.status, "published")))).length;
  const left = await getOpenPauses([rich.id, bare.id]);
  say("HUMAN WORKLOAD: " + clicks.decisions + " one-by-one clicks, " + clicks.bulk + " bulk click(s), " + clicks.manualTasks + " manual tasks -> " + pubCount + " channel posts published, " + sim.replies.length + " replies sent. Still waiting on a person: " + left.length);
  return { sent: [...sim.published], retryWaits: [...retryWaits], log: [...log], gaps: [...gaps], workload: { ...clicks }, pubCount, nonIgPublished, canvaCalls: sim.canvaCalls.length, left: left.length };
}

describe("simulation", () => {
  it("runs the whole loop twice: baseline, then with auto-approve + Canva images", async () => {
    const a = await runWorld({ tag: "A", autoApprove: false, bulk: false, canva: false, doMediaTasks: false });
    const b = await runWorld({ tag: "B", autoApprove: true, bulk: false, canva: true, doMediaTasks: false });
    const c = await runWorld({ tag: "C", autoApprove: false, bulk: true, canva: false, doMediaTasks: false });
    const out = "==== WORLD A: no automation, nobody makes images ====\n" + a.log.join("\n") + "\n\n==== WORLD B: auto-approve clean work + Canva template ====\n" + b.log.join("\n") + "\n\n==== WORLD C: only the bulk Approve-all-clean button ====\n" + c.log.join("\n")
      + "\n\n==== GAPS ====\nA: " + (a.gaps.join(" | ") || "none") + "\nB: " + (b.gaps.join(" | ") || "none") + "\nC: " + (c.gaps.join(" | ") || "none");
    (await import("node:fs")).writeFileSync(process.env.SIM_OUT ?? "/dev/null", out);

    // Gap 5: each channel gets the format that suits it, in that format's own text and media.
    expect(b.sent.some((x) => x.platform === "instagram" && x.media >= 2)).toBe(true);
    expect(b.sent.filter((x) => x.platform === "x").every((x) => x.options.thread === true && x.body.split("\n\n").length >= 2)).toBe(true);
    expect(a.sent.filter((x) => x.platform === "bluesky").every((x) => !x.options.thread)).toBe(true);
    // Gap 4: a rate-limited post waits at least ten minutes.
    expect(Math.min(...a.retryWaits)).toBeGreaterThanOrEqual(9);
    // Gap 1: one channel's missing image does not hold up the others.
    expect(a.nonIgPublished).toBeGreaterThan(0);
    // Gap 1: with a Canva template the agent makes the images itself.
    expect(b.canvaCalls).toBeGreaterThan(0);
    expect(b.workload.manualTasks).toBe(0);
    // Gap 2: far fewer one-by-one clicks.
    expect(b.workload.decisions).toBeLessThan(a.workload.decisions);
    // Gap 2: the bulk button alone also cuts the clicks.
    expect(c.workload.bulk).toBeGreaterThan(0);
    expect(c.workload.decisions).toBeLessThan(a.workload.decisions);
    // Gap 3: the reviewer who was away got an email.
    expect(a.gaps.join()).not.toContain("nobody was told");
  }, 240_000);
});
