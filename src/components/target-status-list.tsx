"use client";
import { useState, useTransition } from "react";
import { tintedInk } from "@/lib/color";
import { ExternalLink, RefreshCw, SkipForward } from "lucide-react";
import { Card, CardHeader, buttonClass } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { TARGET_STATUS_META } from "@/lib/format";
import { markPostedAction, publishTargetNowAction, skipTargetAction } from "@/server/actions/posts";
import type { TargetStatus } from "@/lib/db";

export type TargetRow = {
  id: string;
  platform: string;
  handle: string;
  mode: string;
  status: TargetStatus;
  externalUrl: string | null;
  lastError: string | null;
  attempts: number;
};

export function TargetStatusList({ targets, canPublish }: { targets: TargetRow[]; canPublish: boolean }) {
  const [pending, start] = useTransition();
  const [urlFor, setUrlFor] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader title="Where it goes" subtitle={`${targets.length} channel(s)`} />
      <ul className="divide-y divide-border">
        {targets.map((t) => {
          const meta = TARGET_STATUS_META[t.status];
          return (
            <li key={t.id} className="space-y-2 px-3 py-2.5">
              <div className="flex items-center gap-2">
                <PlatformIcon platform={t.platform} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{t.handle}</p>
                  <p className="text-[11px]" style={{ color: tintedInk(meta.color) }}>
                    {meta.label}
                    {t.mode === "manual" && t.status !== "published" ? " · manual" : ""}
                    {t.attempts > 0 && t.status === "failed" ? ` · ${t.attempts} attempt(s)` : ""}
                  </p>
                </div>
                {t.externalUrl && (
                  <a href={t.externalUrl} target="_blank" rel="noreferrer" className="text-muted hover:text-accent" title="Open post">
                    <ExternalLink className="size-4" />
                  </a>
                )}
              </div>

              {t.lastError && <p className="rounded-md bg-danger/10 px-2 py-1 text-[11px] text-danger">{t.lastError}</p>}

              {canPublish && t.status !== "published" && t.status !== "skipped" && (
                <div className="space-y-1.5">
                  {t.mode === "manual" || t.status === "awaiting_manual" ? (
                    <>
                      <input
                        value={urlFor[t.id] ?? ""}
                        onChange={(e) => setUrlFor((p) => ({ ...p, [t.id]: e.target.value }))}
                        placeholder="Live post URL (optional)"
                        className="!py-1 !text-xs"
                      />
                      <button
                        disabled={pending}
                        onClick={() => start(() => { void markPostedAction(t.id, urlFor[t.id]); })}
                        className={`${buttonClass("primary", "sm")} w-full`}
                      >
                        Mark posted
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={pending}
                      onClick={() => start(() => { void publishTargetNowAction(t.id); })}
                      className={buttonClass("subtle", "sm")}
                    >
                      <RefreshCw className="size-3.5" /> {t.status === "failed" ? "Retry now" : "Publish now"}
                    </button>
                  )}
                  <button
                    disabled={pending}
                    onClick={() => start(() => { void skipTargetAction(t.id); })}
                    className={buttonClass("ghost", "sm")}
                    title="Skip this channel"
                  >
                    <SkipForward className="size-3.5" />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
