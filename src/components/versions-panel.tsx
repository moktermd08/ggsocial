"use client";
import { useMemo, useState, useTransition } from "react";
import { Check, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Badge, Card, CardHeader, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { FormatPreview } from "./format-preview";
import {
  CONTENT_FORMATS, FORMAT_META, VERSION_STATUS_META, pickFormat, type ContentFormat, type VersionStatus,
} from "@/lib/formats";
import {
  addVersionAction, assignTargetVersionAction, autoAssignVersionsAction, deleteVersionAction,
  generateVersionsAction, saveVersionAction, setVersionStatusAction,
} from "@/server/actions/versions";
import type { ActionResult } from "@/lib/action-result";

export type PanelVersion = {
  id: string; format: ContentFormat; title: string; body: string; outline: string[]; script: string;
  status: VersionStatus; byAgent: boolean; media: { url: string; kind: string }[];
};
export type PanelChannel = {
  id: string; platform: string; handle: string; category: string | null; avatarUrl: string | null; textMax: number;
};
export type PanelTarget = { id: string; channelId: string; versionId: string | null; published: boolean };

/** Entries are separated by a blank line, so one slide or thread post can run over several lines. */
const toText = (list: string[]) => list.join("\n\n");
const fromText = (text: string) => text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);

export function VersionsPanel({
  postId, brandName, brandColor, versions, channels, targets, postMedia, canEdit, aiReady,
}: {
  postId: string; brandName: string; brandColor: string; versions: PanelVersion[];
  channels: PanelChannel[]; targets: PanelTarget[]; postMedia: { url: string; kind: string }[];
  canEdit: boolean; aiReady: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(versions[0]?.id ?? null);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0] ?? null;

  const run = (fn: () => Promise<ActionResult<Record<string, unknown>>>, done?: (r: Record<string, unknown>) => string | null) =>
    start(async () => {
      setMessage(null);
      try {
        const res = await fn();
        if (!res.ok) setMessage({ tone: "error", text: res.error });
        else if (done) { const t = done(res); if (t) setMessage({ tone: "ok", text: t }); }
      } catch (e) {
        setMessage({ tone: "error", text: e instanceof Error ? e.message : "Something went wrong." });
      }
    });

  const missing = CONTENT_FORMATS.filter((f) => !versions.some((v) => v.format === f));
  const targetChannelIds = new Set(targets.map((t) => t.channelId));

  return (
    <Card className="mt-5">
      <CardHeader
        title="Formats & previews"
        subtitle={versions.length
          ? `${versions.filter((v) => v.status === "ready").length} of ${versions.length} ready · each channel posts the format that suits it`
          : "The same post as a text post, carousel, thread, reel, short and more, so every channel has the right one ready."}
        action={canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            {missing.length > 0 && (
              <select
                aria-label="Add a format"
                className="!w-auto !py-1 !text-xs"
                value=""
                disabled={pending}
                onChange={(e) => { const f = e.target.value; if (f) run(() => addVersionAction(postId, f)); }}
              >
                <option value="">Add format…</option>
                {missing.map((f) => <option key={f} value={f}>{FORMAT_META[f].label}</option>)}
              </select>
            )}
            <button
              className={buttonClass("primary", "sm")}
              disabled={pending || !aiReady}
              title={aiReady ? "Claude writes every format this post's channels can carry" : "Add ANTHROPIC_API_KEY to the server's .env"}
              onClick={() => run(() => generateVersionsAction(postId), (r) => {
                const made = (r.made as string[]) ?? [];
                const issues = (r.issues as string[]) ?? [];
                if (issues.length) setMessage({ tone: "warn", text: `Wrote ${made.length} format(s). Check: ${issues.join(" ")}` });
                return issues.length ? null : made.length ? `Wrote ${made.length} format(s). ${String(r.note ?? "")}` : String(r.note ?? "Nothing to write.");
              })}
            >
              <Sparkles className="size-3.5" /> {pending ? "Writing…" : versions.length ? "Write missing formats" : "Write all formats"}
            </button>
          </div>
        )}
      />

      {message && (
        <p className={`mx-4 mt-3 rounded-lg border px-3 py-2 text-xs ${
          message.tone === "error" ? "border-danger/40 bg-danger/10 text-danger"
          : message.tone === "warn" ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-border bg-surface-2 text-muted"
        }`}>{message.text}</p>
      )}

      {versions.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No formats yet. Write them all with Claude, or add one to outline by hand.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-border px-4 py-3" role="tablist">
            {versions.map((v) => {
              const meta = VERSION_STATUS_META[v.status];
              const active = v.id === selected?.id;
              const usedBy = targets.filter((t) => t.versionId === v.id).length;
              return (
                <button
                  key={v.id} role="tab" aria-selected={active} onClick={() => setSelectedId(v.id)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${active ? "border-accent bg-accent-soft" : "border-border bg-surface hover:bg-surface-2"}`}
                >
                  <span className="size-2 rounded-full" style={{ background: meta.color }} />
                  <span className="font-medium">{FORMAT_META[v.format].label}</span>
                  <span className="text-muted">{meta.label}{usedBy ? ` · ${usedBy} channel${usedBy === 1 ? "" : "s"}` : ""}</span>
                </button>
              );
            })}
          </div>

          {selected && (
            <VersionEditor
              key={selected.id + selected.status + selected.body.length + selected.outline.length}
              version={selected} brandName={brandName} brandColor={brandColor} channels={channels}
              targets={targets} targetChannelIds={targetChannelIds} postMedia={postMedia}
              canEdit={canEdit} pending={pending} run={run}
            />
          )}

          <ChannelAssignments
            versions={versions} channels={channels} targets={targets} canEdit={canEdit} pending={pending}
            onAssign={(targetId, versionId) => run(() => assignTargetVersionAction(targetId, versionId))}
            onAuto={() => run(() => autoAssignVersionsAction(postId), (r) => `Pointed ${String(r.changed)} channel(s) at their best format.`)}
          />
        </>
      )}
    </Card>
  );
}

function VersionEditor({
  version: v, brandName, brandColor, channels, targets, targetChannelIds, postMedia, canEdit, pending, run,
}: {
  version: PanelVersion; brandName: string; brandColor: string; channels: PanelChannel[];
  targets: PanelTarget[]; targetChannelIds: Set<string>; postMedia: { url: string; kind: string }[];
  canEdit: boolean; pending: boolean;
  run: (fn: () => Promise<ActionResult<Record<string, unknown>>>, done?: (r: Record<string, unknown>) => string | null) => void;
}) {
  const meta = FORMAT_META[v.format];
  const [title, setTitle] = useState(v.title);
  const [body, setBody] = useState(v.body);
  const [outline, setOutline] = useState(toText(v.outline));
  const [script, setScript] = useState(v.script);
  const dirty = title !== v.title || body !== v.body || outline !== toText(v.outline) || script !== v.script;

  // Preview on a channel that carries this format first; any channel otherwise.
  const candidates = useMemo(() => {
    const assigned = channels.filter((c) => targets.some((t) => t.channelId === c.id && t.versionId === v.id));
    const fits = channels.filter((c) => pickFormat(c.platform, c.category, [v.format]) === v.format && !assigned.includes(c));
    const rest = channels.filter((c) => !assigned.includes(c) && !fits.includes(c));
    return [...assigned, ...fits, ...rest];
  }, [channels, targets, v.format, v.id]);
  const [channelId, setChannelId] = useState(candidates[0]?.id ?? "");
  const channel = candidates.find((c) => c.id === channelId) ?? candidates[0] ?? null;

  const draft = { title, body, outline: fromText(outline), script };
  const media = v.media.length ? v.media : postMedia;

  return (
    <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted">{meta.blurb}</p>
          {v.byAgent && <Badge color="#6366f1">written by an agent</Badge>}
        </div>

        <Field label={meta.shape === "long" ? (v.format === "newsletter" ? "Subject line" : "Headline") : "Title"}>
          <input value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label={meta.shape === "long" ? "Body" : "Caption"} hint={`${body.length} characters`}>
          <textarea rows={meta.shape === "long" ? 10 : 5} value={body} disabled={!canEdit} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {meta.outlineLabel && (
          <Field label={meta.outlineLabel} hint="Separate each with a blank line">
            <textarea rows={Math.min(14, Math.max(5, draft.outline.length * 2 + 1))} value={outline} disabled={!canEdit} onChange={(e) => setOutline(e.target.value)} />
          </Field>
        )}
        {meta.shape === "video" && (
          <Field label="Script" hint="The words spoken, hook first">
            <textarea rows={6} value={script} disabled={!canEdit} onChange={(e) => setScript(e.target.value)} />
          </Field>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={buttonClass("primary", "sm")} disabled={pending || !dirty}
              onClick={() => run(() => saveVersionAction(v.id, { title, body, outline: fromText(outline), script }))}
            ><Check className="size-3.5" /> Save changes</button>
            {v.status !== "ready" ? (
              <button className={buttonClass("subtle", "sm")} disabled={pending || dirty}
                title={dirty ? "Save your changes first" : "Mark this format ready to post"}
                onClick={() => run(() => setVersionStatusAction(v.id, "ready"))}
              ><Wand2 className="size-3.5" /> Mark ready</button>
            ) : (
              <button className={buttonClass("subtle", "sm")} disabled={pending} onClick={() => run(() => setVersionStatusAction(v.id, "drafted"))}>Back to drafted</button>
            )}
            <button
              className={buttonClass("ghost", "sm")} disabled={pending}
              onClick={() => { if (confirm(`Delete the ${meta.label.toLowerCase()} version?`)) run(() => deleteVersionAction(v.id)); }}
            ><Trash2 className="size-3.5" /> Delete</button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium">Preview on</p>
          <select className="!w-auto min-w-0 flex-1 !py-1 !text-xs" value={channel?.id ?? ""} onChange={(e) => setChannelId(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.handle}{targetChannelIds.has(c.id) ? "" : " (not on this post)"}
              </option>
            ))}
          </select>
        </div>
        {channel ? (
          <FormatPreview
            platform={channel.platform} format={v.format} brandName={brandName} handle={channel.handle}
            avatarUrl={channel.avatarUrl} brandColor={brandColor} textMax={channel.textMax}
            title={draft.title} body={draft.body} outline={draft.outline} script={draft.script} media={media}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">Add a channel to this brand to see how it will look.</p>
        )}
      </div>
    </div>
  );
}

function ChannelAssignments({
  versions, channels, targets, canEdit, pending, onAssign, onAuto,
}: {
  versions: PanelVersion[]; channels: PanelChannel[]; targets: PanelTarget[]; canEdit: boolean; pending: boolean;
  onAssign: (targetId: string, versionId: string | null) => void; onAuto: () => void;
}) {
  if (targets.length === 0) {
    return <p className="border-t border-border px-4 py-3 text-xs text-muted">Pick channels for this post in the editor above to choose which format each one posts.</p>;
  }
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Which format each channel posts</p>
        {canEdit && <button className={buttonClass("subtle", "sm")} disabled={pending} onClick={onAuto}><Wand2 className="size-3.5" /> Pick the best for each</button>}
      </div>
      <ul className="divide-y divide-border">
        {targets.map((t) => {
          const ch = channels.find((c) => c.id === t.channelId);
          if (!ch) return null;
          const best = pickFormat(ch.platform, ch.category, versions.map((v) => v.format));
          const current = versions.find((v) => v.id === t.versionId);
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <PlatformIcon platform={ch.platform} size={18} />
              <span className="min-w-0 flex-1 truncate text-sm">{ch.handle}</span>
              {current && current.status !== "ready" && <Badge color="#f59e0b">{VERSION_STATUS_META[current.status].label}</Badge>}
              <select
                aria-label={`Format for ${ch.handle}`}
                className="!w-auto !py-1 !text-xs"
                disabled={!canEdit || pending || t.published}
                value={t.versionId ?? ""}
                onChange={(e) => onAssign(t.id, e.target.value || null)}
              >
                <option value="">Post as written</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>{FORMAT_META[v.format].label}{v.format === best ? " — best here" : ""}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
