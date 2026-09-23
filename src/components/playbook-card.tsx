"use client";
import Link from "next/link";
import { AlertCircle, BookCheck, Check, CircleCheck } from "lucide-react";
import { Card, CardHeader } from "./ui";
import { PlatformIcon } from "./platform-icon";
import { describeRule, type EffectiveRule } from "@/lib/playbook/check";
import { CHECK_AUDIENCE_META } from "@/lib/playbook/meta";

/**
 * The playbook rule for the channel being edited, beside the editor: the
 * limits in plain words, the points a reviewer will confirm, and how each
 * picked channel is doing against its own rule.
 */
export function PlaybookCard({ rule, channels }: {
  rule: EffectiveRule;
  channels: { label: string; platform: string; rule: string; errors: number; warnings: number }[];
}) {
  const lines = describeRule(rule);
  return (
    <Card>
      <CardHeader
        icon={BookCheck}
        title={<span>Playbook · {rule.name}</span>}
        subtitle={<Link href="/playbook" className="hover:underline">{rule.description}</Link>}
      />
      <div className="space-y-3 p-3 text-xs">
        {channels.length > 0 && (
          <ul className="space-y-1">
            {channels.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
                <PlatformIcon platform={c.platform} size={14} />
                <span className="min-w-0 flex-1 truncate">{c.label} <span className="text-muted">· {c.rule}</span></span>
                {c.errors > 0 ? <span className="inline-flex items-center gap-0.5 text-danger"><AlertCircle className="size-3" />{c.errors}</span>
                  : c.warnings > 0 ? <span className="inline-flex items-center gap-0.5 text-warn"><AlertCircle className="size-3" />{c.warnings}</span>
                  : <CircleCheck className="size-3.5 text-ok" aria-label="Meets the playbook" />}
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && <ul className="space-y-0.5">{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
        {rule.checklist.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-muted">The reviewer will confirm</p>
            <ul className="space-y-1">
              {rule.checklist.filter((i) => i.for !== "agent").map((i) => (
                <li key={i.id} className="flex items-start gap-1.5">
                  <Check className="mt-0.5 size-3 shrink-0 text-muted" />
                  <span>{i.text}{i.for === "human" && <span className="text-muted"> ({CHECK_AUDIENCE_META.human.toLowerCase()})</span>}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(rule.instructions || rule.brandNotes) && (
          <details>
            <summary className="cursor-pointer text-muted">How to do it</summary>
            <p className="mt-1 whitespace-pre-wrap leading-relaxed">{rule.instructions}</p>
            {rule.brandNotes && <p className="mt-1 whitespace-pre-wrap rounded bg-accent-soft px-2 py-1 leading-relaxed">{rule.brandNotes}</p>}
          </details>
        )}
      </div>
    </Card>
  );
}
