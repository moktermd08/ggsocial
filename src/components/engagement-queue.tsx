"use client";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowUpRight, Check, Clock, Loader2, Plus, Search, Send, Timer, UserRound,
} from "lucide-react";
import { Card, Field, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { relativeTime, truncate } from "@/lib/format";
import { tintedBorder, tintedInk, tintedSurface } from "@/lib/color";
import {
  INTERACTION_KINDS, INTERACTION_KIND_LABELS, INTERACTION_PRIORITIES, INTERACTION_STATUS_META,
  type InteractionKind, type InteractionPriority, type InteractionStatus,
} from "@/lib/db/engagement";
import {
  logInteractionAction, markRepliedAction, updateInteractionAction, bulkUpdateInteractionsAction,
} from "@/server/actions/engagement";

export type QueueItem = {
  id: string;
  brandId: string;
  brandName: string;
  brandColor: string;
  platform: string | null;
  handle: string | null;
  post: { id: string; title: string } | null;
  kind: InteractionKind;
  direction: "inbound" | "outbound";
  status: InteractionStatus;
  priority: InteractionPriority;
  authorName: string | null;
  authorHandle: string | null;
  authorUrl: string | null;
  authorReach: number | null;
  body: string;
  externalUrl: string | null;
  replyBody: string | null;
  /** ISO strings — server components cannot hand Date objects to the client. */
  receivedAt: string;
  dueAt: string | null;
  repliedAt: string | null;
  assigneeName: string | null;
};

export type QueueBrand = {
  id: string;
  name: string;
  color: string;
  replySlaMinutes: number;
  channels: { id: string; platform: string; handle: string }[];
};

const SNOOZE_OPTIONS = [
  { label: "1 hour", minutes: 60 },
  { label: "Tomorrow", minutes: 60 * 24 },
  { label: "Next week", minutes: 60 * 24 * 7 },
];

/**
 * The engagement queue: one list for every comment, message, review and
 * outreach task across every brand, worked worst-first.
 *
 * Deliberately usable without a single API connection. Most platforms will not
 * hand over comments or DMs without partner access, so the row is the unit of
 * work whether it arrived by API or someone pasted it in — and either way the
 * clock on it is the same.
 */
export function EngagementQueue({
  items, brands, canEdit, now,
}: {
  items: QueueItem[];
  brands: QueueBrand[];
  canEdit: boolean;
  /** Server clock, so client and server agree about what is late. */
  now: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showLog, setShowLog] = useState(false);

  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [brandId, setBrandId] = useState("all");
  const [lens, setLens] = useState<"open" | "overdue" | "all">("open");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (kind !== "all" && i.kind !== kind) return false;
      if (brandId !== "all" && i.brandId !== brandId) return false;
      if (lens === "open" && !["new", "in_progress", "snoozed"].includes(i.status)) return false;
      if (lens === "overdue" && !(i.dueAt && new Date(i.dueAt).getTime() < now && ["new", "in_progress", "snoozed"].includes(i.status))) return false;
      if (!q) return true;
      return [i.body, i.authorName, i.authorHandle, i.post?.title, i.brandName]
        .filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [items, query, kind, brandId, lens, now]);

  function run(work: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by person, text or post…"
            className="!w-full !py-1.5 !pl-8 !text-sm"
          />
        </label>

        <div className="flex rounded-lg border border-border p-0.5">
          {(["open", "overdue", "all"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLens(l)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize ${
                lens === l ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-2"
              }`}
            >
              {l}
            </button>
          ))}
        </div>

        <select value={kind} onChange={(e) => setKind(e.target.value)} className="!w-auto !py-1.5 !text-sm">
          <option value="all">Every kind</option>
          {INTERACTION_KINDS.map((k) => <option key={k} value={k}>{INTERACTION_KIND_LABELS[k]}</option>)}
        </select>

        {brands.length > 1 && (
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="!w-auto !py-1.5 !text-sm">
            <option value="all">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}

        {canEdit && (
          <button type="button" onClick={() => setShowLog((v) => !v)} className={buttonClass(showLog ? "primary" : "subtle", "sm")}>
            <Plus className="size-3.5" /> Log one
          </button>
        )}
        {pending && <Loader2 className="size-4 animate-spin text-muted" />}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
        </p>
      )}

      {showLog && canEdit && (
        <LogForm brands={brands} pending={pending} onDone={() => setShowLog(false)} onRun={run} />
      )}

      {selected.size > 0 && canEdit && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => {
              await bulkUpdateInteractionsAction([...selected], "replied");
              setSelected(new Set());
            })}
            className={buttonClass("primary", "sm")}
          >
            <Check className="size-3.5" /> Mark replied
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => {
              await bulkUpdateInteractionsAction([...selected], "ignored");
              setSelected(new Set());
            })}
            className={buttonClass("subtle", "sm")}
          >
            Ignore
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className={buttonClass("ghost", "sm")}>Clear</button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card>
          <p className="px-4 py-12 text-center text-sm text-muted">
            {items.length === 0
              ? "Nothing in the queue. Publishing a post opens the work to reply to it, and you can log anything else by hand."
              : "Nothing matches those filters."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              now={now}
              canEdit={canEdit}
              pending={pending}
              expanded={open === item.id}
              checked={selected.has(item.id)}
              onCheck={(on) => setSelected((s) => {
                const next = new Set(s);
                if (on) next.add(item.id); else next.delete(item.id);
                return next;
              })}
              onToggle={() => setOpen(open === item.id ? null : item.id)}
              onRun={run}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueRow({
  item, now, canEdit, pending, expanded, checked, onCheck, onToggle, onRun,
}: {
  item: QueueItem;
  now: number;
  canEdit: boolean;
  pending: boolean;
  expanded: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onToggle: () => void;
  onRun: (work: () => Promise<unknown>) => void;
}) {
  const [reply, setReply] = useState(item.replyBody ?? "");
  const status = INTERACTION_STATUS_META[item.status];
  const open = ["new", "in_progress", "snoozed"].includes(item.status);
  const due = item.dueAt ? new Date(item.dueAt).getTime() : null;
  const late = open && due !== null && due < now;

  return (
    <Card
      className={late ? "border-danger/50" : undefined}
      style={late ? { background: "color-mix(in oklab, var(--danger) 5%, var(--surface))" } : undefined}
    >
      <div className="flex items-start gap-2.5 p-3">
        {canEdit && (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheck(e.target.checked)}
            aria-label="Select this item"
            className="!mt-1 !w-auto"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {item.platform && <PlatformIcon platform={item.platform} size={16} />}
            <span
              className="rounded-full border px-1.5 py-0.5 font-medium"
              style={{ borderColor: tintedBorder(item.brandColor), background: tintedSurface(item.brandColor), color: tintedInk(item.brandColor) }}
            >
              {item.brandName}
            </span>
            <span className="rounded-full border border-border bg-surface-2 px-1.5 py-0.5 text-muted">
              {item.direction === "outbound" ? "You do" : INTERACTION_KIND_LABELS[item.kind]}
            </span>
            <span
              className="rounded-full border px-1.5 py-0.5 font-medium"
              style={{ borderColor: tintedBorder(status.color), background: tintedSurface(status.color), color: tintedInk(status.color) }}
            >
              {status.label}
            </span>
            {item.priority === "high" && (
              <span className="rounded-full border border-warn/40 bg-warn/10 px-1.5 py-0.5 font-medium text-warn">High</span>
            )}
            {item.handle && <span className="text-muted">{item.handle}</span>}
          </div>

          <button type="button" onClick={onToggle} className="mt-1.5 block w-full text-left">
            {(item.authorName || item.authorHandle) && (
              <span className="flex items-center gap-1 text-xs font-medium">
                <UserRound className="size-3 text-muted" />
                {item.authorName ?? item.authorHandle}
                {item.authorReach ? <span className="text-muted">· {item.authorReach.toLocaleString()} reach</span> : null}
              </span>
            )}
            <span className="mt-0.5 block whitespace-pre-wrap text-sm leading-snug">
              {expanded ? item.body : truncate(item.body, 220)}
            </span>
          </button>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <Clock className="size-3" /> {relativeTime(item.receivedAt, now)}
            </span>
            {due !== null && open && (
              <span className={`flex items-center gap-1 ${late ? "font-medium text-danger" : ""}`}>
                <Timer className="size-3" /> {late ? `late by ${relativeTime(item.dueAt, now).replace(" ago", "")}` : `due ${relativeTime(item.dueAt, now)}`}
              </span>
            )}
            {item.repliedAt && <span>replied {relativeTime(item.repliedAt, now)}</span>}
            {item.assigneeName && <span>· {item.assigneeName}</span>}
            {item.post && (
              <Link href={`/posts/${item.post.id}`} className="underline hover:text-text">
                {truncate(item.post.title || "the post", 40)}
              </Link>
            )}
            {item.externalUrl && (
              <a href={item.externalUrl} target="_blank" rel="noreferrer noopener" className="flex items-center gap-0.5 underline hover:text-text">
                open <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>

          {expanded && canEdit && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <Field
                label={item.direction === "outbound" ? "What you are going to say" : "Your reply"}
                hint="Written here, posted on the platform. Most of them will not let us post it for you."
              >
                <textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} className="!text-sm" />
              </Field>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => navigator.clipboard?.writeText(reply)}
                  className={buttonClass("subtle", "sm")}
                >
                  Copy
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRun(() => updateInteractionAction({ interactionId: item.id, replyBody: reply, status: "in_progress", assignToMe: true }))}
                  className={buttonClass("subtle", "sm")}
                >
                  Save draft
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRun(() => markRepliedAction({ interactionId: item.id, replyBody: reply }))}
                  className={buttonClass("primary", "sm")}
                >
                  <Send className="size-3.5" /> Mark replied
                </button>

                <span className="mx-1 h-5 w-px bg-border" />
                {SNOOZE_OPTIONS.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    disabled={pending}
                    onClick={() => onRun(() => updateInteractionAction({
                      interactionId: item.id,
                      snoozeUntil: new Date(Date.now() + s.minutes * 60_000).toISOString(),
                    }))}
                    className={buttonClass("ghost", "sm")}
                  >
                    {s.label}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onRun(() => updateInteractionAction({ interactionId: item.id, status: "ignored" }))}
                  className={`${buttonClass("ghost", "sm")} ml-auto text-muted`}
                >
                  Ignore
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Logging what the APIs will not give us: paste it in, it joins the queue. */
function LogForm({
  brands, pending, onDone, onRun,
}: {
  brands: QueueBrand[];
  pending: boolean;
  onDone: () => void;
  onRun: (work: () => Promise<unknown>) => void;
}) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [channelId, setChannelId] = useState("");
  const [kind, setKind] = useState<InteractionKind>("comment");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [priority, setPriority] = useState<InteractionPriority>("normal");
  const [author, setAuthor] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  const brand = brands.find((b) => b.id === brandId);

  return (
    <Card>
      <form
        className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          onRun(async () => {
            await logInteractionAction({
              brandId, channelId: channelId || null, kind, direction, priority,
              authorName: author || null, body, externalUrl: url || null,
            });
            setAuthor(""); setBody(""); setUrl("");
            onDone();
          });
        }}
      >
        <Field label="Brand">
          <select value={brandId} onChange={(e) => { setBrandId(e.target.value); setChannelId(""); }} className="!py-1 !text-sm">
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>

        <Field label="Channel" hint="Optional — cold outreach has no account yet.">
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="!py-1 !text-sm">
            <option value="">None</option>
            {brand?.channels.map((c) => <option key={c.id} value={c.id}>{c.handle}</option>)}
          </select>
        </Field>

        <Field label="Kind">
          <select value={kind} onChange={(e) => setKind(e.target.value as InteractionKind)} className="!py-1 !text-sm">
            {INTERACTION_KINDS.map((k) => <option key={k} value={k}>{INTERACTION_KIND_LABELS[k]}</option>)}
          </select>
        </Field>

        <Field label="Direction" hint="Outbound is work you go and do.">
          <select value={direction} onChange={(e) => setDirection(e.target.value as "inbound" | "outbound")} className="!py-1 !text-sm">
            <option value="inbound">Someone contacted us</option>
            <option value="outbound">We need to go there</option>
          </select>
        </Field>

        <Field label="Priority">
          <select value={priority} onChange={(e) => setPriority(e.target.value as InteractionPriority)} className="!py-1 !text-sm">
            {INTERACTION_PRIORITIES.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
        </Field>

        <Field label="Who" hint="Name or handle.">
          <input value={author} onChange={(e) => setAuthor(e.target.value)} className="!py-1 !text-sm" />
        </Field>

        <div className="sm:col-span-2 lg:col-span-3">
          <Field label="What was said, or what you mean to say">
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} className="!text-sm" />
          </Field>
        </div>

        <Field label="Link" hint="Straight to the comment or thread.">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="!py-1 !text-sm" />
        </Field>

        <div className="flex items-end gap-2 lg:col-span-2">
          <button type="submit" disabled={pending || !body.trim() || !brandId} className={buttonClass("primary", "sm")}>
            <Plus className="size-3.5" /> Add to queue
          </button>
          <span className="text-[11px] text-muted">
            Due {brand ? `in ${brand.replySlaMinutes} min` : "per the brand's SLA"}.
          </span>
        </div>
      </form>
    </Card>
  );
}
