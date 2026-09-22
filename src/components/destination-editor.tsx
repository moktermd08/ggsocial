"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Layers, Link2, Loader2 } from "lucide-react";
import { Card, CardHeader, Field, buttonClass } from "./ui";
import { LabelRow, MasterTag } from "./master-panels";
import { DEST_FIELD_LABELS, type DestField, type DestValues } from "@/lib/destinations";
import { archiveDestinationAction, saveDestinationAction } from "@/server/actions/destinations";
import { isFailure } from "@/lib/action-result";

const EMPTY: DestValues = { name: "", url: "", utmCampaign: "", utmContent: "" };

/**
 * A saved link destination: a master one every brand can issue from, a
 * brand's linked copy of one, or a brand's own.
 */
export function DestinationEditor({
  destination, master, where, defaultWhere, copyBrands, canEdit, sidebar,
}: {
  destination?: { id: string; brandId: string | null; values: DestValues; notes: string | null };
  master?: DestValues;
  where?: { value: string; label: string; color?: string }[];
  defaultWhere?: string;
  copyBrands?: { id: string; name: string; color: string }[];
  canEdit: boolean;
  sidebar?: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [values, setValues] = useState<DestValues>(destination?.values ?? EMPTY);
  const [notes, setNotes] = useState(destination?.notes ?? "");
  const [target, setTarget] = useState(defaultWhere ?? where?.[0]?.value ?? "master");
  const [copyIds, setCopyIds] = useState<string[]>([]);

  const set = (f: DestField, v: string) => setValues((prev) => ({ ...prev, [f]: v }));
  const label = (f: DestField, text: string) => (
    <LabelRow text={text} tag={master ? <MasterTag customised={values[f] !== master[f]} onReset={() => set(f, master[f])} /> : null} />
  );
  const isMaster = destination ? destination.brandId === null : target === "master";

  function save() {
    setError(null);
    setSaved(null);
    start(async () => {
      try {
        const res = await saveDestinationAction({
          id: destination?.id,
          brandId: destination ? undefined : target === "master" ? null : target,
          values, notes: notes || null,
          copyBrandIds: !destination && target === "master" ? copyIds : undefined,
        });
        if (!res.ok) { setError(res.error); return; }
        if (!destination) router.push(`/links/destinations/${res.id}`);
        else {
          setSaved("Saved. Every link issued from it now goes here.");
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save.");
      }
    });
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader
          icon={isMaster ? Layers : Link2}
          title="Destination"
          subtitle="Tracked links issued from this keep following it — change the URL here and every posted link lands in the new place."
        />
        <fieldset disabled={!canEdit} className="space-y-3 p-4">
          <Field label={label("name", DEST_FIELD_LABELS.name)}>
            <input value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Autumn launch landing page" />
          </Field>
          <Field label={label("url", DEST_FIELD_LABELS.url)} hint="The scheme is optional.">
            <input value={values.url} onChange={(e) => set("url", e.target.value)} placeholder="moksy.ai/autumn" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={label("utmCampaign", DEST_FIELD_LABELS.utmCampaign)} hint="Blank uses the post's campaign.">
              <input value={values.utmCampaign} onChange={(e) => set("utmCampaign", e.target.value)} placeholder="autumn-launch" />
            </Field>
            <Field label={label("utmContent", DEST_FIELD_LABELS.utmContent)} hint="Blank uses the channel handle.">
              <input value={values.utmContent} onChange={(e) => set("utmContent", e.target.value)} />
            </Field>
          </div>
          <Field label="Notes" hint={master ? "This brand's own notes." : undefined}>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </fieldset>
      </Card>

      <div className="space-y-5">
        {sidebar}

        {!destination && where && where.length > 1 && (
          <Card>
            <CardHeader title="Where" subtitle="A master destination, or one brand's own." />
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

        {!destination && target === "master" && copyBrands && copyBrands.length > 0 && (
          <Card>
            <CardHeader title="Brand copies" subtitle="Only for brands that need their own URL or campaign — every brand can use the master as it is." />
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
            <CardHeader title={destination ? "Save" : "Create"} />
            <div className="space-y-2 p-3">
              {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">{error}</p>}
              {saved && <p className="rounded-lg border border-ok/40 bg-ok/10 px-2.5 py-2 text-xs text-ok">{saved}</p>}
              <button onClick={save} disabled={pending || !values.name.trim() || !values.url.trim()} className={`${buttonClass("primary")} w-full`}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                {destination ? "Save destination" : "Create destination"}
              </button>
            </div>
          </Card>
        )}

        {destination && canEdit && (
          <button
            onClick={() => {
              if (!confirm("Archive this destination? Links already issued keep working.")) return;
              setError(null);
              start(async () => {
                const res = await archiveDestinationAction(destination.id);
                if (isFailure(res)) setError(res.error);
              });
            }}
            className={`${buttonClass("subtle")} w-full`}
          >
            <Archive className="size-4" /> Archive destination
          </button>
        )}
      </div>
    </div>
  );
}
