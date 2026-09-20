"use client";
import { useRef, useState, useTransition } from "react";
import Image from "next/image";
import { Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { Button, Field, buttonClass } from "./ui";
import { readableOn } from "@/lib/color";
import type { BrandColor, BrandLink } from "@/lib/db/schema";
import { uploadBrandLogoAction, clearBrandLogoAction } from "@/server/actions/brands";

let nextRowId = 0;
const withIds = <T,>(rows: T[]) => rows.map((row) => ({ key: `r${nextRowId++}`, row }));

/**
 * Palette rows post as parallel `palette.name` / `palette.hex` lists, so the
 * server can zip them back together without any JSON in a hidden input.
 */
export function PaletteEditor({ value, disabled }: { value: BrandColor[]; disabled?: boolean }) {
  const [rows, setRows] = useState(() => withIds(value));

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-xs text-muted">No palette yet — add the colours designers should use.</p>
      )}
      {rows.map(({ key, row }, i) => (
        <div key={key} className="flex items-center gap-2">
          <input
            type="color"
            name="palette.hex"
            defaultValue={row.hex}
            disabled={disabled}
            aria-label={`Colour ${i + 1} hex`}
            className="!w-12 shrink-0"
          />
          <input
            name="palette.name"
            defaultValue={row.name}
            disabled={disabled}
            placeholder="Primary"
            aria-label={`Colour ${i + 1} name`}
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove colour ${i + 1}`}
              onClick={() => setRows((r) => r.filter((x) => x.key !== key))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          size="sm"
          onClick={() => setRows((r) => [...r, { key: `r${nextRowId++}`, row: { name: "", hex: "#6366f1" } }])}
        >
          <Plus className="size-3.5" /> Add colour
        </Button>
      )}
    </div>
  );
}

export function LinksEditor({ value, disabled }: { value: BrandLink[]; disabled?: boolean }) {
  const [rows, setRows] = useState(() => withIds(value));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-muted">No links yet.</p>}
      {rows.map(({ key, row }, i) => (
        <div key={key} className="flex items-center gap-2">
          <input
            name="links.label"
            defaultValue={row.label}
            disabled={disabled}
            placeholder="Press kit"
            aria-label={`Link ${i + 1} label`}
            className="!w-36 shrink-0"
          />
          <input
            name="links.url"
            type="url"
            defaultValue={row.url}
            disabled={disabled}
            placeholder="https://…"
            aria-label={`Link ${i + 1} URL`}
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove link ${i + 1}`}
              onClick={() => setRows((r) => r.filter((x) => x.key !== key))}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          type="button"
          size="sm"
          onClick={() => setRows((r) => [...r, { key: `r${nextRowId++}`, row: { label: "", url: "" } }])}
        >
          <Plus className="size-3.5" /> Add link
        </Button>
      )}
    </div>
  );
}

export function LogoUploader({
  brandId, logoUrl, brandName, brandColor, canEdit,
}: { brandId: string; logoUrl: string | null; brandName: string; brandColor: string; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      await uploadBrandLogoAction(brandId, fd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <span
          className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border"
          style={logoUrl ? undefined : { background: brandColor, color: readableOn(brandColor) }}
        >
          {logoUrl ? (
            <Image src={logoUrl} alt={`${brandName} logo`} width={64} height={64} className="size-full object-contain" unoptimized />
          ) : (
            <span className="text-lg font-bold">{brandName.slice(0, 2).toUpperCase()}</span>
          )}
        </span>

        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClass("subtle", "sm")}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {logoUrl ? "Replace" : "Upload logo"}
            </button>
            {logoUrl && (
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => start(() => void clearBrandLogoAction(brandId))}
              >
                <X className="size-3.5" /> Remove
              </button>
            )}
            <input
              ref={input}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </div>
        )}
      </div>
      {error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Newline/comma list editor that renders what it parsed back to the user. */
export function ChipListField({
  label, name, hint, defaultValue, placeholder, disabled, prefix = "",
}: {
  label: string; name: string; hint?: string; defaultValue: string[];
  placeholder?: string; disabled?: boolean; prefix?: string;
}) {
  const [text, setText] = useState(defaultValue.join("\n"));
  const parsed = [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];

  return (
    <div>
      <Field label={label} hint={hint ?? "One per line, or comma separated."}>
        <textarea
          name={name}
          rows={3}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
        />
      </Field>
      {parsed.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {parsed.map((v) => (
            <span key={v} className="rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-text">
              {prefix && !v.startsWith(prefix) ? prefix + v : v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
