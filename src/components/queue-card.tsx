"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Copy, Download, RefreshCw } from "lucide-react";
import { Card, buttonClass, Badge } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { markPostedAction, publishTargetNowAction, skipTargetAction } from "@/server/actions/posts";
import { TARGET_STATUS_META } from "@/lib/format";
import type { TargetStatus } from "@/lib/db";

export type QueueItem = {
  targetId: string;
  postId: string;
  title: string;
  brandName: string;
  brandColor: string;
  platform: string;
  handle: string;
  mode: string;
  status: TargetStatus;
  scheduledLabel: string;
  body: string;
  firstComment: string | null;
  lastError: string | null;
  steps: { label: string; detail?: string; copy?: string }[];
  media: { id: string; url: string; kind: string; originalName: string }[];
  canPublish: boolean;
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          setDone(false);
        }
      }}
      className={buttonClass("subtle", "sm")}
    >
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />} {done ? "Copied" : label}
    </button>
  );
}

export function QueueCard({ item }: { item: QueueItem }) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState("");
  const meta = TARGET_STATUS_META[item.status];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <PlatformIcon platform={item.platform} />
        <div className="min-w-0 flex-1">
          <Link href={`/posts/${item.postId}`} className="truncate text-sm font-medium hover:underline">
            {item.title}
          </Link>
          <p className="text-[11px] text-muted">{item.handle} · {item.scheduledLabel}</p>
        </div>
        <Badge color={item.brandColor}>{item.brandName}</Badge>
        <Badge color={meta.color}>{meta.label}</Badge>
      </div>

      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="space-y-3">
          {item.lastError && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{item.lastError}</p>
          )}

          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">Copy</span>
              <CopyButton text={item.body} />
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.body}</p>
          </div>

          {item.firstComment && (
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted">First comment</span>
                <CopyButton text={item.firstComment} />
              </div>
              <p className="whitespace-pre-wrap text-sm">{item.firstComment}</p>
            </div>
          )}

          {item.steps.length > 0 && (
            <ol className="space-y-1.5">
              {item.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="grid size-4 shrink-0 place-items-center rounded-full bg-surface-2 text-[10px] text-muted">{i + 1}</span>
                  <span className="flex-1">
                    {s.label}
                    {s.detail && <span className="text-muted"> — {s.detail}</span>}
                  </span>
                  {s.copy && <CopyButton text={s.copy} label="" />}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="space-y-3">
          {item.media.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">Files</p>
              <div className="flex flex-wrap gap-2">
                {item.media.map((m) => (
                  <a
                    key={m.id}
                    href={m.url}
                    download={m.originalName}
                    className="group relative size-16 overflow-hidden rounded-lg border border-border"
                    title={`Download ${m.originalName}`}
                  >
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center bg-surface-2 text-[10px]">{m.kind}</span>
                    )}
                    <span className="absolute inset-0 grid place-items-center bg-black/50 opacity-0 group-hover:opacity-100">
                      <Download className="size-4 text-white" />
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {item.canPublish && (
            <div className="space-y-2">
              {item.mode === "live" && item.status !== "awaiting_manual" ? (
                <button
                  disabled={pending}
                  onClick={() => start(() => { void publishTargetNowAction(item.targetId); })}
                  className={`${buttonClass("primary", "sm")} w-full`}
                >
                  <RefreshCw className="size-3.5" /> {item.status === "failed" ? "Retry now" : "Publish now"}
                </button>
              ) : null}

              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Live post URL (optional)"
                className="!py-1 !text-xs"
              />
              <button
                disabled={pending}
                onClick={() => start(() => { void markPostedAction(item.targetId, url); })}
                className={`${buttonClass("primary", "sm")} w-full`}
              >
                <Check className="size-3.5" /> Mark as posted
              </button>
              <button
                disabled={pending}
                onClick={() => start(() => { void skipTargetAction(item.targetId); })}
                className={`${buttonClass("ghost", "sm")} w-full`}
              >
                Skip this one
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
