"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Layers, Loader2, Megaphone } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { LabelRow, MasterTag } from "./master-panels";
import {
  CAMPAIGN_FIELDS, CAMPAIGN_STATUS_LIST, CAMPAIGN_STATUS_META, parseHashtags, type CampaignField, type CampaignValues,
} from "@/lib/campaigns";
import type { CampaignStatus } from "@/lib/db/schema";
import { archiveCampaignAction, saveCampaignAction } from "@/server/actions/campaigns";
import { isFailure } from "@/lib/action-result";

export type CampaignEditorCampaign = {
  id: string;
  brandId: string | null;
  values: CampaignValues;
  status: CampaignStatus;
  guidelines: string | null;
  notes: string | null;
};
export type CampaignWhere = { value: string; label: string; color?: string };

const EMPTY = Object.fromEntries(CAMPAIGN_FIELDS.map((f) => [f, f === "hashtags" ? "[]" : ""])) as CampaignValues;

/**
 * One campaign brief. The same form serves a master campaign, a brand's
 * linked copy of one (with a Customised/From master marker per field) and a
 * campaign only one brand runs.
 */
export function CampaignEditor({
  campaign, master, where, defaultWhere, copyBrands, canEdit, sidebar,
}: {
  campaign?: CampaignEditorCampaign;
  /** Set on a brand copy: the master's values each field follows. */
  master?: CampaignValues;
  /** New campaigns: Master, or one of the brands this person writes for. */
  where?: CampaignWhere[];
  defaultWhere?: string;
  /** New master campaigns: brands a linked copy can be created in. */
  copyBrands?: { id: string; name: string; color: string }[];
  canEdit: boolean;
  sidebar?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [values, setValues] = useState<CampaignValues>(campaign?.values ?? EMPTY);
  const [hashtagText, setHashtagText] = useState((JSON.parse(values.hashtags) as string[]).join(" "));
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? "planning");
  const [guidelines, setGuidelines] = useState(campaign?.guidelines ?? "");
  const [notes, setNotes] = useState(campaign?.notes ?? "");
  const [target, setTarget] = useState(defaultWhere ?? where?.[0]?.value ?? "master");
  const [copyIds, setCopyIds] = useState<string[]>(copyBrands?.map((b) => b.id) ?? []);

  const isMaster = campaign ? campaign.brandId === null : target === "master";
  const set = (f: CampaignField, v: string) => setValues((prev) => ({ ...prev, [f]: v }));
  const current: CampaignValues = { ...values, hashtags: JSON.stringify(parseHashtags(hashtagText)) };

  const tag = (f: CampaignField) => master
    ? (
      <MasterTag
        customised={current[f] !== master[f]}
        onReset={() => {
          if (f === "hashtags") setHashtagText((JSON.parse(master.hashtags) as string[]).join(" "));
          else set(f, master[f]);
        }}
      />
    )
    : null;

  const text = (f: CampaignField, label: string, opts: { placeholder?: string; type?: string; rows?: number; hint?: string } = {}) => (
    <Field label={<LabelRow text={label} tag={tag(f)} />} hint={opts.hint}>
      {opts.rows ? (
        <textarea rows={opts.rows} value={values[f]} onChange={(e) => set(f, e.target.value)} placeholder={opts.placeholder} />
      ) : (
        <input type={opts.type ?? "text"} value={values[f]} onChange={(e) => set(f, e.target.value)} placeholder={opts.placeholder} />
      )}
    </Field>
  );

  function save() {
    setError(null);
    setSaved(null);
    start(async () => {
      try {
        const res = await saveCampaignAction({
          id: campaign?.id,
          brandId: campaign ? undefined : target === "master" ? null : target,
          values: current,
          status,
          guidelines: guidelines || null,
          notes: notes || null,
          copyBrandIds: !campaign && target === "master" ? copyIds : undefined,
        });
        if (!res.ok) { setError(res.error); return; }
        if (!campaign) {
          router.push(`/campaigns/${res.id}`);
        } else {
          setSaved(res.synced ? `Saved. ${res.synced} brand cop${res.synced === 1 ? "y" : "ies"} checked for updates.` : "Saved.");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader
            icon={isMaster ? Layers : Megaphone}
            title="The brief"
            subtitle={isMaster
              ? "Every brand's copy starts from this. Fields a brand has not changed keep following it."
              : master
                ? "This brand's version of the master campaign."
                : "What this campaign is for, what it says and where it sends people."}
          />
          <fieldset disabled={!canEdit} className="space-y-3 p-4">
            {text("name", "Name", { placeholder: "Q4 launch", hint: "Posts join the campaign by this name. It is also the utm_campaign on tracked links." })}
            {text("objective", "Objective", { rows: 2, placeholder: "Book 40 demo calls from agency owners before December." })}
            {text("keyMessage", "Key message", { rows: 3, placeholder: "The one thing every post in this campaign should land." })}
            {text("audience", "Audience", { placeholder: "Agency owners, 5–50 staff, UK" })}
            <div className="grid gap-3 sm:grid-cols-2">
              {text("cta", "Call to action", { placeholder: "Book a 15-minute demo" })}
              {text("landingUrl", "Landing page", { type: "url", placeholder: "https://…" })}
            </div>
            <Field label={<LabelRow text="Hashtags" tag={tag("hashtags")} />} hint="Separated by spaces or commas.">
              <input value={hashtagText} onChange={(e) => setHashtagText(e.target.value)} placeholder="#launch #ai" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {text("startDate", "Start date", { type: "date" })}
              {text("endDate", "End date", { type: "date" })}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {text("targetImpressions", "Impressions target", { type: "number" })}
              {text("targetClicks", "Clicks target", { type: "number" })}
              {text("targetLeads", "Leads target", { type: "number" })}
            </div>
            {isMaster && (
              <Field label="Guidelines for brands" hint="How each brand should run its version. Shown beside every copy.">
                <textarea
                  rows={3}
                  value={guidelines}
                  onChange={(e) => setGuidelines(e.target.value)}
                  placeholder="Keep the CTA and the dates. Each brand sets its own landing page and hashtags."
                />
              </Field>
            )}
            <Field
              label="Internal notes"
              hint={master ? "This brand's own notes. Never inherited, never published." : "Never published."}
            >
              <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </fieldset>
        </Card>
      </div>

      <div className="space-y-5">
        {sidebar}

        {!campaign && where && where.length > 1 && (
          <Card>
            <CardHeader title="Where" subtitle="A master campaign, or one brand's own." />
            <div className="space-y-1 p-3">
              {where.map((w) => (
                <button
                  key={w.value}
                  onClick={() => setTarget(w.value)}
                  className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
                    target === w.value ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-surface-2"
                  }`}
                >
                  {w.value === "master"
                    ? <span className="grid size-4 place-items-center rounded bg-text text-surface"><Layers className="size-2.5" /></span>
                    : <span className="size-4 rounded" style={{ background: w.color }} />}
                  <span className="flex-1">{w.label}</span>
                  {target === w.value && <Check className="size-3.5 text-accent" />}
                </button>
              ))}
            </div>
          </Card>
        )}

        {!campaign && target === "master" && copyBrands && copyBrands.length > 0 && (
          <Card>
            <CardHeader title="Create copies in" subtitle="One linked campaign per brand." />
            <div className="space-y-1 p-3">
              {copyBrands.map((b) => {
                const on = copyIds.includes(b.id);
                return (
                  <button
                    key={b.id}
                    onClick={() => setCopyIds((prev) => on ? prev.filter((x) => x !== b.id) : [...prev, b.id])}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2 py-1.5 text-left text-sm ${
                      on ? "border-accent/50 bg-accent-soft" : "border-border hover:bg-surface-2"
                    }`}
                  >
                    <span className="size-4 shrink-0 rounded" style={{ background: b.color }} />
                    <span className="min-w-0 flex-1 truncate">{b.name}</span>
                    {on && <Check className="size-3.5 text-accent" />}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {canEdit && (
          <Card>
            <CardHeader title={campaign ? "Save" : "Create"} />
            <div className="space-y-2 p-3">
              <Field label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)}>
                  {CAMPAIGN_STATUS_LIST.map((s) => <option key={s} value={s}>{CAMPAIGN_STATUS_META[s].label}</option>)}
                </select>
              </Field>
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
              {saved && <p className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-2 text-xs text-ok">{saved}</p>}
              <button onClick={save} disabled={pending || !values.name.trim()} className={`${buttonClass("primary")} w-full`}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {campaign
                  ? "Save campaign"
                  : target === "master"
                    ? `Create master${copyIds.length ? ` + ${copyIds.length} cop${copyIds.length === 1 ? "y" : "ies"}` : ""}`
                    : "Create campaign"}
              </button>
              {isMaster && (
                <p className="pt-1 text-[11px] leading-relaxed text-muted">
                  Brand copies pick up changes to fields they haven&apos;t customised. Customised fields are offered the change instead.
                </p>
              )}
            </div>
          </Card>
        )}

        {campaign && canEdit && (
          <button
            onClick={() => {
              if (!confirm("Archive this campaign? Its posts keep the label.")) return;
              setError(null);
              start(async () => {
                const res = await archiveCampaignAction(campaign.id);
                if (isFailure(res)) setError(res.error);
              });
            }}
            className={`${buttonClass("subtle")} w-full`}
          >
            <Archive className="size-4" /> Archive campaign
          </button>
        )}
      </div>
    </div>
  );
}
