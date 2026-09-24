"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Play, Save } from "lucide-react";
import { Button, Field } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { AGENT_BY_CODE, type AgentCode } from "@/lib/agents/meta";
import { runAgentNowAction, saveBrandAgentAction } from "@/server/actions/agents";

export type CrewChannel = { id: string; platform: string; handle: string };

export type CrewAgentState = {
  brandId: string;
  code: AgentCode;
  enabled: boolean;
  guidelines: string;
  settings: Record<string, unknown>;
};

const input = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none";

/**
 * One agent's controls on one brand: the switch, "Run now", and the
 * guidelines and settings behind a disclosure. Admins change; everyone sees.
 */
export function AgentControls({ state, channels, canManage, canRun }: {
  state: CrewAgentState; channels: CrewChannel[]; canManage: boolean; canRun: boolean;
}) {
  const def = AGENT_BY_CODE[state.code];
  const router = useRouter();
  const [pending, start] = useTransition();
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [guidelines, setGuidelines] = useState(state.guidelines);
  const [settings, setSettings] = useState<Record<string, unknown>>(state.settings);

  const call = (work: () => Promise<{ ok: true; summary?: string } | { ok: false; error: string }>, done?: string) => {
    setMessage(null);
    start(async () => {
      try {
        const r = await work();
        if (!r.ok) { setMessage({ ok: false, text: r.error }); return; }
        setMessage({ ok: true, text: ("summary" in r && r.summary) || done || "Saved." });
        router.refresh();
      } catch (e) {
        setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
      } finally {
        setRunning(false);
      }
    });
  };

  const toggle = () => call(() => saveBrandAgentAction({ brandId: state.brandId, agentCode: state.code, enabled: !state.enabled }),
    state.enabled ? "Switched off." : `Switched on. It works ${def.cadence.toLowerCase()}.`);
  const save = () => call(() => saveBrandAgentAction({ brandId: state.brandId, agentCode: state.code, guidelines, settings }), "Guidelines saved. The next run follows them.");
  const runNow = () => { setRunning(true); call(() => runAgentNowAction(state.brandId, state.code)); };

  const picked = Array.isArray(settings.channelIds) ? (settings.channelIds as string[]) : [];

  // "contents": the controls take the row's second column and the panel spans both.
  return (
    <div className="contents">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button" role="switch" aria-checked={state.enabled} aria-label={`${def.name} ${state.enabled ? "on" : "off"}`}
            disabled={!canManage || pending} onClick={toggle}
            className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${state.enabled ? "bg-accent" : "bg-border"}`}
          >
            <span className={`absolute top-0.5 size-4 rounded-full bg-surface shadow transition-all ${state.enabled ? "left-[18px]" : "left-0.5"}`} />
          </button>
          <span className="text-xs text-muted">{state.enabled ? `On · ${def.cadence}` : "Off"}</span>
          <span className="flex-1" />
          {canRun && (
            <Button size="sm" disabled={pending} onClick={runNow} title="One run now, one item at most. The schedule carries on as normal.">
              {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Run now
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Guidelines <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </Button>
        </div>
        {message && <p className={`text-xs ${message.ok ? "text-ok" : "text-danger"}`}>{message.text}</p>}
      </div>

      {open && (
        <div className="space-y-3 rounded-lg border border-border bg-surface-2 p-3 md:col-span-2">
          <div className="grid gap-3 text-xs sm:grid-cols-2">
            <div>
              <p className="mb-1 font-medium text-text">Each run it</p>
              <ol className="list-decimal space-y-0.5 pl-4 text-muted">{def.does.map((d) => <li key={d}>{d}</li>)}</ol>
            </div>
            <div>
              <p className="mb-1 font-medium text-text">Where you come in</p>
              <ul className="list-disc space-y-0.5 pl-4 text-muted">{def.handsOff.map((d) => <li key={d}>{d}</li>)}</ul>
              <p className="mt-2 text-muted">It also follows the brand book and this brand&apos;s playbook. Covers activities {def.activityCodes.join(", ")}.</p>
            </div>
          </div>

          <Field label="Guidelines for this brand" hint="Read on every run, after the brand book and the playbook.">
            <textarea className={`${input} min-h-24`} value={guidelines} disabled={!canManage}
              placeholder={def.guidelineHint} onChange={(e) => setGuidelines(e.target.value)} />
          </Field>

          {def.settings.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {def.settings.map((f) => f.type === "number" ? (
                <Field key={f.key} label={f.label} hint={f.hint}>
                  <input type="number" className={input} min={f.min} max={f.max} disabled={!canManage}
                    value={settings[f.key] === undefined || settings[f.key] === null ? "" : String(settings[f.key])}
                    onChange={(e) => setSettings((s) => ({ ...s, [f.key]: e.target.value === "" ? null : Number(e.target.value) }))} />
                </Field>
              ) : (
                <div key={f.key} className="sm:col-span-3">
                  <p className="mb-1 text-xs font-medium text-muted">{f.label}</p>
                  {channels.length === 0 ? <p className="text-xs text-muted">This brand has no channels yet.</p> : (
                    <div className="flex flex-wrap gap-1.5">
                      {channels.map((c) => {
                        const on = picked.includes(c.id);
                        return (
                          <button key={c.id} type="button" disabled={!canManage}
                            onClick={() => setSettings((s) => ({ ...s, [f.key]: on ? picked.filter((x) => x !== c.id) : [...picked, c.id] }))}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-text"}`}>
                            <PlatformIcon platform={c.platform} size={14} /> {c.handle}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {f.hint && <p className="mt-1 text-[11px] text-muted">{f.hint}</p>}
                </div>
              ))}
            </div>
          )}

          {canManage ? (
            <Button size="sm" variant="primary" disabled={pending} onClick={save}>
              {pending && !running ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save guidelines
            </Button>
          ) : <p className="text-xs text-muted">Only brand admins can change an agent&apos;s guidelines.</p>}
        </div>
      )}
    </div>
  );
}
