"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Loader2, Save, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, Field } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { METRIC_META, GOAL_METRICS, type GoalMetric } from "@/lib/goals/meta";
import { deleteSnapshotAction, logSnapshotsAction, pullStatsAction } from "@/server/actions/goals";

export type LoggerChannel = {
  id: string; platform: string; platformName: string; handle: string; live: boolean; canPull: boolean;
  last: { value: number; date: string; source: "manual" | "api" } | null;
};
export type LoggerBrand = {
  id: string; name: string; color: string; canEdit: boolean; channels: LoggerChannel[];
  brandLast: { value: number; date: string } | null;
};
export type LoggerReading = {
  brandId: string; brandName: string; channelId: string | null; where: string; metric: GoalMetric; date: string; value: number; source: "manual" | "api";
};

const FLOW_METRICS = GOAL_METRICS.filter((m) => METRIC_META[m].kind === "flow");

/**
 * Where the goals get the numbers the app cannot count for itself: follower
 * counts per channel (live channels are read daily), and extra counts —
 * visits from analytics, messages on a phone — added on top of what the app sees.
 */
export function SnapshotLogger({ brands, today, recent }: { brands: LoggerBrand[]; today: string; recent: LoggerReading[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [date, setDate] = useState(today);
  const [followers, setFollowers] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<Record<string, { metric: GoalMetric; value: string }>>({});

  const run = (fn: () => Promise<string>) => {
    setMessage(null);
    start(async () => {
      try {
        setMessage({ ok: true, text: await fn() });
        router.refresh();
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  function save() {
    const entries = [
      ...Object.entries(followers).filter(([, v]) => v.trim() !== "").map(([key, v]) => {
        const [brandId, channelId] = key.split(":");
        return { brandId, channelId: channelId === "brand" ? null : channelId, metric: "followers" as GoalMetric, date, value: Number(v.replace(/[, _]/g, "")) };
      }),
      ...Object.entries(extra).filter(([, e]) => e.value.trim() !== "").map(([brandId, e]) => ({
        brandId, channelId: null, metric: e.metric, date, value: Number(e.value.replace(/[, _]/g, "")),
      })),
    ];
    if (entries.some((e) => !Number.isFinite(e.value) || e.value < 0)) {
      setMessage({ ok: false, text: "Numbers only, zero or more." });
      return;
    }
    if (entries.length === 0) {
      setMessage({ ok: false, text: "Type at least one number first." });
      return;
    }
    run(async () => {
      const r = await logSnapshotsAction(entries);
      setFollowers({});
      setExtra({});
      return `Saved ${r.saved} reading${r.saved === 1 ? "" : "s"} for ${date}. Goals use them on their next look.`;
    });
  }

  const pullable = brands.filter((b) => b.canEdit && b.channels.some((c) => c.canPull));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Log today's numbers"
          subtitle="Follower counts per channel. Live channels on Instagram, Facebook, YouTube, X, Bluesky and Mastodon are read automatically every day; type the rest. A weekly reading is enough — the goal draws straight lines between readings."
          action={pullable.length > 0 && (
            <Button size="sm" disabled={pending} onClick={() => run(async () => {
              const r = await pullStatsAction(pullable.map((b) => b.id));
              return r.errors.length ? `Read ${r.pulled} of ${r.checked} live channels. ${r.errors.join(" · ")}` : `Read ${r.pulled} live channel${r.pulled === 1 ? "" : "s"}.`;
            })}>
              {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />} Read live channels now
            </Button>
          )}
        />
        <div className="space-y-4 p-4">
          <div className="max-w-44">
            <Field label="Date of these readings"><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          {brands.map((b) => (
            <div key={b.id} className="rounded-lg border border-border">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
                <span className="size-2.5 rounded-full" style={{ background: b.color }} /> {b.name}
                {!b.canEdit && <span className="text-xs font-normal text-muted">view only</span>}
              </div>
              <div className="divide-y divide-border">
                {(b.channels.length ? b.channels : [null]).map((c) => {
                  const key = `${b.id}:${c?.id ?? "brand"}`;
                  const last = c ? c.last : b.brandLast;
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        {c ? <PlatformIcon platform={c.platform} size={16} /> : null}
                        <span className="truncate">{c ? <>{c.handle} <span className="text-xs text-muted">{c.platformName}</span></> : "Whole brand (no channels yet)"}</span>
                        {c?.canPull && <Badge color="#15803d">read daily</Badge>}
                      </span>
                      <span className="w-40 text-right text-xs text-muted">
                        {last ? <>Last: <b className="font-medium text-text tabular-nums">{Math.round(last.value).toLocaleString()}</b> on {last.date}</> : "No readings yet"}
                      </span>
                      <input
                        inputMode="numeric" className="!w-32 !py-1 !text-right !text-sm" placeholder="followers" disabled={!b.canEdit}
                        value={followers[key] ?? ""} onChange={(e) => setFollowers((f) => ({ ...f, [key]: e.target.value }))}
                        aria-label={`Followers for ${c?.handle ?? b.name}`}
                      />
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface-2/40 px-3 py-2 text-sm">
                  <span className="flex-1 text-xs text-muted">Extra counts the app cannot see (e.g. visits from Google Analytics, WhatsApp messages) — added on top for that day.</span>
                  <select className="!w-auto !py-1 !text-xs" disabled={!b.canEdit} value={extra[b.id]?.metric ?? "site_visitors"}
                    onChange={(e) => setExtra((x) => ({ ...x, [b.id]: { metric: e.target.value as GoalMetric, value: x[b.id]?.value ?? "" } }))} aria-label="Metric">
                    {FLOW_METRICS.map((m) => <option key={m} value={m}>{METRIC_META[m].label}</option>)}
                  </select>
                  <input inputMode="numeric" className="!w-32 !py-1 !text-right !text-sm" placeholder="count" disabled={!b.canEdit}
                    value={extra[b.id]?.value ?? ""} onChange={(e) => setExtra((x) => ({ ...x, [b.id]: { metric: x[b.id]?.metric ?? "site_visitors", value: e.target.value } }))}
                    aria-label={`Extra count for ${b.name}`} />
                </div>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={pending} onClick={save}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save readings
            </Button>
            {message && <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="Recent readings" subtitle="Saving again for the same channel and day replaces the reading." />
        {recent.length === 0 ? <p className="p-4 text-sm text-muted">Nothing logged yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Brand</th>
                  <th className="px-3 py-2 font-medium">Where</th>
                  <th className="px-3 py-2 font-medium">Metric</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((r) => {
                  const canEdit = brands.find((b) => b.id === r.brandId)?.canEdit;
                  return (
                    <tr key={`${r.brandId}:${r.channelId}:${r.metric}:${r.date}`} className="hover:bg-surface-2">
                      <td className="whitespace-nowrap px-4 py-1.5 tabular-nums">{r.date}</td>
                      <td className="px-3 py-1.5">{r.brandName}</td>
                      <td className="px-3 py-1.5 text-muted">{r.where}</td>
                      <td className="px-3 py-1.5">{METRIC_META[r.metric].label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(r.value).toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-xs text-muted">{r.source === "api" ? "read from API" : "logged"}</td>
                      <td className="px-3 py-1.5 text-right">
                        {canEdit && (
                          <Button size="sm" variant="ghost" disabled={pending} aria-label="Delete reading"
                            onClick={() => run(async () => { await deleteSnapshotAction({ brandId: r.brandId, channelId: r.channelId, metric: r.metric, date: r.date }); return "Reading deleted."; })}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
