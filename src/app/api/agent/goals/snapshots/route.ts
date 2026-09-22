import { z } from "zod";
import { and, inArray, isNull } from "drizzle-orm";
import { can } from "@/lib/auth";
import { db, channels } from "@/lib/db";
import { GOAL_METRICS } from "@/lib/goals/meta";
import { isDateKey, todayIn } from "@/lib/activities/periods";
import { saveSnapshots, type SnapshotInput } from "@/server/goals";
import { AgentError, pickBrands, withAgent } from "@/server/agent-api";

const Snapshot = z.object({
  brand: z.string().min(1),
  /**
   * Which channel the reading is for: its id, its platform ("instagram") when
   * the brand has one channel there, or its handle. Leave out for a
   * whole-brand reading, e.g. visits from Google Analytics.
   */
  channel: z.string().min(1).nullish(),
  metric: z.enum(GOAL_METRICS),
  date: z.string().refine(isDateKey, "date must be YYYY-MM-DD").optional(),
  value: z.number().min(0).finite(),
});
const Many = z.object({ snapshots: z.array(Snapshot).min(1).max(500) });

/**
 * Log readings the goals steer on: a channel's follower count, or counts the
 * app cannot see for itself (visits, messages on a phone), which are added on
 * top of what it counts.
 *
 *   POST /api/agent/goals/snapshots
 *   { "brand": "acme", "channel": "linkedin", "metric": "followers", "value": 6644 }
 *
 * or `{ "snapshots": [ … ] }`. `date` defaults to today in the brand's
 * timezone; logging the same channel, metric and day again replaces the reading.
 */
export async function POST(req: Request) {
  return withAgent(req, async ({ agent, brands }) => {
    const json = await req.json().catch(() => null);
    const body = json && typeof json === "object" && "snapshots" in json ? Many.safeParse(json) : Snapshot.safeParse(json);
    if (!body.success) throw new AgentError(body.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    const items = "snapshots" in body.data ? body.data.snapshots : [body.data];

    const picked = items.map((s) => {
      const matches = pickBrands(brands, s.brand);
      if (matches.length !== 1) throw new AgentError(`Log readings one brand at a time; "${s.brand}" matched ${matches.length}.`);
      const b = matches[0];
      if (!can.edit(b.role)) throw new AgentError(`The token's owner is a ${b.role} on ${b.slug} and cannot log numbers there.`, 403);
      return { s, b };
    });
    const brandIds = [...new Set(picked.map((p) => p.b.id))];
    const channelRows = await db.select({ id: channels.id, brandId: channels.brandId, platform: channels.platform, handle: channels.handle })
      .from(channels).where(and(inArray(channels.brandId, brandIds), isNull(channels.archivedAt)));

    const entries: (SnapshotInput & { brand: string; where: string })[] = picked.map(({ s, b }) => {
      let channelId: string | null = null;
      let where = "whole brand";
      if (s.channel) {
        const ref = s.channel.trim().toLowerCase();
        const own = channelRows.filter((c) => c.brandId === b.id);
        const byId = own.find((c) => c.id.toLowerCase() === ref);
        const byPlatform = own.filter((c) => c.platform === ref);
        const byHandle = own.filter((c) => c.handle.toLowerCase().replace(/^@/, "") === ref.replace(/^@/, ""));
        const found = byId ?? (byPlatform.length === 1 ? byPlatform[0] : byHandle.length === 1 ? byHandle[0] : null);
        if (!found) {
          const list = own.map((c) => `${c.platform} ${c.handle} (${c.id})`).join(", ") || "none";
          throw new AgentError(`${b.slug} has no single channel matching "${s.channel}". Its channels: ${list}. Use the id when several match.`, 404);
        }
        channelId = found.id;
        where = `${found.platform} ${found.handle}`;
      }
      return { brand: b.slug, where, brandId: b.id, channelId, metric: s.metric, date: s.date ?? todayIn(b.timezone), value: s.value };
    });

    await saveSnapshots(entries, "manual", agent.userId);
    return { saved: entries.map((e) => ({ brand: e.brand, channel: e.where, metric: e.metric, date: e.date, value: e.value })) };
  });
}

export const dynamic = "force-dynamic";
