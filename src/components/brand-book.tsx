"use client";
import { useState } from "react";
import { BookOpen, ChevronDown, Plus } from "lucide-react";
import { Card, CardHeader, Button } from "./ui";
import type { ComposerBrand } from "./composer";

/** Whole-word, case-insensitive match so "prosynergy" isn't flagged for "synergy". */
export function findBannedWords(copy: string, banned: string[]) {
  if (!copy.trim() || banned.length === 0) return [];
  const haystack = copy.toLowerCase();
  return banned.filter((word) => {
    const w = word.toLowerCase().trim();
    if (!w) return false;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u").test(haystack);
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="mt-1 text-xs text-text">{children}</div>
    </div>
  );
}

/**
 * The writing-facing half of the brand profile, docked beside the composer so
 * nobody has to open the brand page in another tab to remember the tone.
 */
export function BrandBook({ brand, onInsert }: { brand: ComposerBrand; onInsert: (text: string) => void }) {
  const [open, setOpen] = useState(false);

  const hasDetail =
    brand.voice || brand.audience || brand.ctaText || brand.valueProps.length > 0 || brand.defaultHashtags.length > 0;
  if (!brand.brief && !hasDetail && brand.bannedWords.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            <BookOpen className="size-3.5 text-muted" /> Brand book
          </span>
        }
        subtitle={brand.name}
        action={
          hasDetail ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Less" : "More"}
              <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          ) : null
        }
      />
      <div className="space-y-3 p-4">
        {brand.brief && <p className="text-xs text-text">{brand.brief}</p>}

        {open && (
          <>
            {brand.voice && <Section title="Tone of voice">{brand.voice}</Section>}
            {brand.audience && <Section title="Audience">{brand.audience}</Section>}
            {brand.valueProps.length > 0 && (
              <Section title="Key messages">
                <ul className="list-disc space-y-0.5 pl-4">
                  {brand.valueProps.map((v) => <li key={v}>{v}</li>)}
                </ul>
              </Section>
            )}
          </>
        )}

        {brand.emojiPolicy !== "free" && (
          <p className="text-[11px] text-muted">
            Emoji: {brand.emojiPolicy === "none" ? "never" : "sparingly"}.
          </p>
        )}

        {(brand.defaultHashtags.length > 0 || brand.ctaText) && (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Insert</p>
            <div className="flex flex-wrap gap-1.5">
              {brand.ctaText && (
                <Button size="sm" onClick={() => onInsert(brand.ctaText!)}>
                  <Plus className="size-3" /> CTA
                </Button>
              )}
              {brand.defaultHashtags.length > 0 && (
                <Button size="sm" onClick={() => onInsert(brand.defaultHashtags.join(" "))}>
                  <Plus className="size-3" /> All hashtags
                </Button>
              )}
              {brand.defaultHashtags.map((tag) => (
                <Button key={tag} size="sm" variant="ghost" className="border border-border" onClick={() => onInsert(tag)}>
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        )}

        {brand.bannedWords.length > 0 && (
          <p className="border-t border-border pt-3 text-[11px] text-muted">
            Avoid: {brand.bannedWords.join(", ")}.
          </p>
        )}
      </div>
    </Card>
  );
}
