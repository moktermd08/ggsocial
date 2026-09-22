"use client";
import { useState, useTransition } from "react";
import { ExternalLink, Plug, Power, Settings2, SlidersHorizontal, Trash2 } from "lucide-react";
import { Card, CardHeader, Field, buttonClass, Badge } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { PlatformPicker } from "./platform-picker";
import type { PlatformMeta } from "@/lib/platforms/meta";
import {
  addChannelAction, connectChannelAction, disconnectChannelAction, setChannelModeAction, archiveChannelAction,
  setChannelSettingsAction,
} from "@/server/actions/channels";
import type { ActionResult } from "@/lib/action-result";

export type ChannelRow = {
  id: string; platform: string; handle: string; displayName: string | null;
  mode: string; status: string; hasCredentials: boolean; lastError: string | null; externalId: string | null;
  /** Saved option defaults, prefilled into every post for this channel. */
  settings: Record<string, unknown>;
};

export function ChannelManager({
  brandId, brandName, channels, platforms, canManage,
}: {
  brandId: string; brandName: string; channels: ChannelRow[]; platforms: PlatformMeta[]; canManage: boolean;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [tuning, setTuning] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError(null);
      try { const res = await fn(); if (!res.ok) setError(res.error); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    });

  return (
    <Card>
      <CardHeader
        title={brandName}
        subtitle={`${channels.length} channel${channels.length === 1 ? "" : "s"}`}
      />

      {error && <p className="mx-4 mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <ul className="divide-y divide-border">
        {channels.map((c) => {
          const meta = platforms.find((p) => p.id === c.platform);
          return (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformIcon platform={c.platform} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.handle}</p>
                  <p className="text-[11px] text-muted">{meta?.name ?? c.platform}{c.displayName ? ` · ${c.displayName}` : ""}</p>
                </div>
                <Badge color={c.mode === "live" ? "#15803d" : "#8b8b96"}>
                  {c.mode === "live" ? "auto-publishing" : meta?.manualOnly ? "manual only" : "manual"}
                </Badge>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {!meta?.manualOnly && (
                      <button
                        onClick={() => setConnecting(connecting === c.id ? null : c.id)}
                        className={buttonClass("subtle", "sm")}
                        title="API credentials"
                      >
                        <Plug className="size-3.5" /> {c.hasCredentials ? "Re-connect" : "Connect"}
                      </button>
                    )}
                    {(meta?.optionFields.length ?? 0) > 0 && (
                      <button
                        onClick={() => setTuning(tuning === c.id ? null : c.id)}
                        className={buttonClass("subtle", "sm")}
                        title="Values this channel should prefill on every post"
                      >
                        <SlidersHorizontal className="size-3.5" /> Defaults
                      </button>
                    )}
                    {c.hasCredentials && (
                      <button
                        disabled={pending}
                        onClick={() => run(() => setChannelModeAction(c.id, c.mode === "live" ? "manual" : "live"))}
                        className={buttonClass("subtle", "sm")}
                        title={c.mode === "live" ? "Switch back to manual" : "Switch to auto-publishing"}
                      >
                        <Power className="size-3.5" />
                      </button>
                    )}
                    <button
                      disabled={pending}
                      onClick={() => { if (confirm(`Remove ${c.handle}?`)) run(() => archiveChannelAction(c.id)); }}
                      className={buttonClass("ghost", "sm")}
                      title="Remove channel"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {c.lastError && <p className="mt-1.5 text-[11px] text-danger">{c.lastError}</p>}

              {meta?.manualOnly && (
                <p className="mt-1.5 text-[11px] text-muted">{meta.liveSetup.notes}</p>
              )}

              {tuning === c.id && meta && (
                <form
                  action={(fd) => run(async () => { const res = await setChannelSettingsAction(c.id, fd); if (res.ok) setTuning(null); return res; })}
                  className="mt-3 space-y-2 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <p className="text-xs text-muted">
                    Prefilled into every new post for {c.handle}. Leave one blank for no default — you can still
                    override any of them per post.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {meta.optionFields.map((f) => {
                      const saved = c.settings[f.key];
                      const label = f.required ? `${f.label} (required each send)` : f.label;
                      return (
                        <Field key={f.key} label={label} hint={f.help}>
                          {f.type === "boolean" ? (
                            <input type="checkbox" name={`opt_${f.key}`} defaultChecked={Boolean(saved)} className="!w-auto" />
                          ) : f.type === "select" ? (
                            <select name={`opt_${f.key}`} defaultValue={saved === undefined ? "" : String(saved)}>
                              <option value="">No default</option>
                              {f.choices?.map((ch) => <option key={ch.value} value={ch.value}>{ch.label}</option>)}
                            </select>
                          ) : (
                            <input
                              name={`opt_${f.key}`}
                              type={f.type === "number" ? "number" : "text"}
                              defaultValue={saved === undefined ? "" : String(saved)}
                              placeholder={f.placeholder}
                            />
                          )}
                        </Field>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <button className={buttonClass("primary", "sm")} disabled={pending}>Save defaults</button>
                    <button type="button" onClick={() => setTuning(null)} className={buttonClass("ghost", "sm")}>Cancel</button>
                  </div>
                </form>
              )}

              {connecting === c.id && meta && !meta.manualOnly && (
                <form
                  action={(fd) => run(async () => { const res = await connectChannelAction(c.id, fd); if (res.ok) setConnecting(null); return res; })}
                  className="mt-3 space-y-2 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <p className="text-xs text-muted">{meta.liveSetup.notes}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label={meta.liveSetup.tokenLabel ?? "Access token"}>
                      <input name="accessToken" required placeholder="Paste the OAuth access token" />
                    </Field>
                    <Field label="Account / page / channel ID">
                      <input name="externalId" defaultValue={c.externalId ?? ""} placeholder="e.g. 17841400000000000" />
                    </Field>
                    <Field label="Refresh token (optional)">
                      <input name="refreshToken" />
                    </Field>
                    <Field label="Expires in (seconds, optional)">
                      <input name="expiresIn" type="number" />
                    </Field>
                    {meta.credentialFields.map((f) => (
                      <Field key={f.key} label={f.required ? f.label : `${f.label} (optional)`} hint={f.help}>
                        <input name={`cred_${f.key}`} required={f.required} placeholder={f.placeholder} />
                      </Field>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button className={buttonClass("primary", "sm")} disabled={pending}>Save & go live</button>
                    <button type="button" onClick={() => setConnecting(null)} className={buttonClass("ghost", "sm")}>Cancel</button>
                    {c.hasCredentials && (
                      <button
                        type="button"
                        onClick={() => run(() => disconnectChannelAction(c.id))}
                        className={buttonClass("danger", "sm")}
                      >
                        Disconnect
                      </button>
                    )}
                    <a href={meta.liveSetup.docsUrl} target="_blank" rel="noreferrer" className={`${buttonClass("ghost", "sm")} ml-auto`}>
                      <ExternalLink className="size-3.5" /> Platform docs
                    </a>
                  </div>
                  <p className="text-[11px] text-muted">
                    Tokens are encrypted before they are stored and never sent back to the browser.
                    {meta.liveSetup.requiresAppReview && " This platform requires app review before it will accept posts from a new app."}
                  </p>
                </form>
              )}
            </li>
          );
        })}
        {channels.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No channels yet.</li>}
      </ul>

      {canManage && (
        <div className="border-t border-border p-3">
          {adding ? (
            <form
              action={(fd) => run(async () => { const res = await addChannelAction(brandId, fd); if (res.ok) setAdding(null); return res; })}
              className="space-y-2 rounded-lg border border-border bg-surface-2 p-3"
            >
              <input type="hidden" name="platform" value={adding} />
              <p className="text-xs text-muted">{platforms.find((p) => p.id === adding)?.blurb}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Handle / page name">
                  <input name="handle" required placeholder="@yourbrand" />
                </Field>
                <Field label="Display name (optional)">
                  <input name="displayName" placeholder="Your Brand Ltd" />
                </Field>
              </div>
              <div className="flex gap-2">
                <button className={buttonClass("primary", "sm")} disabled={pending}>Add channel</button>
                <button type="button" onClick={() => setAdding(null)} className={buttonClass("ghost", "sm")}>Cancel</button>
              </div>
              <p className="text-[11px] text-muted">
                {platforms.find((p) => p.id === adding)?.manualOnly
                  ? "This platform has no write API. ggsocial will compose, validate, schedule and queue the post with copy-ready blocks — someone clicks publish."
                  : "Starts in manual mode — usable straight away. Connect the API later to switch on auto-publishing."}
              </p>
            </form>
          ) : (
            picking ? (
              <PlatformPicker platforms={platforms} onPick={(id) => { setPicking(false); setAdding(id); }} onCancel={() => setPicking(false)} />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => setPicking(true)} className={buttonClass("subtle", "sm")}>
                  <Settings2 className="size-3.5" /> Add a channel
                </button>
                <span className="text-[11px] text-muted">
                  {platforms.length} platforms — {platforms.filter((p) => !p.manualOnly).length} publish automatically.
                </span>
              </div>
            )
          )}
        </div>
      )}
    </Card>
  );
}
