"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Copy, ExternalLink, Loader2, Send } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";
import { approveStepAction } from "@/server/actions/workflows";
import { markRepliedAction } from "@/server/actions/engagement";
import type { AttentionItem } from "@/lib/attention";

type Inline = NonNullable<AttentionItem["inline"]>;

/**
 * The one-click way to clear an item from the dashboard. Approve is offered only
 * for work the reviewer passed cleanly (the server checks again); a reply is
 * written or edited here and marked sent once it has gone out on the platform.
 */
export function InlineAction({ item, primary }: { item: Pick<AttentionItem, "href" | "action"> & { inline: Inline }; primary: boolean }) {
  return item.inline.type === "approve"
    ? <InlineApprove inline={item.inline} href={item.href} primary={primary} />
    : <InlineReply inline={item.inline} href={item.href} primary={primary} />;
}

function Done({ text }: { text: string }) {
  return <p className="flex items-center gap-1.5 text-xs text-ok"><Check className="size-3.5" />{text}</p>;
}

function InlineApprove({ inline, href, primary }: { inline: Extract<Inline, { type: "approve" }>; href: string; primary: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showText, setShowText] = useState(false);

  const approve = () => start(async () => {
    try {
      const r = await approveStepAction({ stepId: inline.stepId });
      setResult({ ok: r.ok, text: r.ok ? r.message : r.error });
      if (r.ok) router.refresh();
    } catch {
      setResult({ ok: false, text: "Could not reach the server. Try again." });
    }
  });

  if (result?.ok) return <Done text="Approved" />;
  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => setShowText(!showText)}>{showText ? "Hide" : "Read"}</Button>
        <Button size="sm" variant={primary ? "primary" : "subtle"} disabled={pending} onClick={approve}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Approve
        </Button>
      </div>
      {showText && (
        <div className="w-64 rounded-lg border border-border bg-surface-2/50 p-2 text-left text-xs">
          <p className="whitespace-pre-line text-text">{inline.preview}</p>
          <p className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
            {inline.score !== null ? `Reviewer ${inline.score}/100, no flags` : "Reviewer passed it"}
            <Link href={href} className="underline">Open</Link>
          </p>
        </div>
      )}
      {result && !result.ok && <p className="max-w-64 text-right text-[11px] text-danger">{result.text}</p>}
    </div>
  );
}

function InlineReply({ inline, href, primary }: { inline: Extract<Inline, { type: "reply" }>; href: string; primary: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(inline.draft ?? "");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text is still selectable */ }
  };
  const send = () => start(async () => {
    try {
      const r = await markRepliedAction({ interactionId: inline.id, replyBody: text });
      setResult({ ok: r.ok, text: r.ok ? "" : r.error });
      if (r.ok) router.refresh();
    } catch {
      setResult({ ok: false, text: "Could not reach the server. Try again." });
    }
  });

  if (result?.ok) return <Done text="Marked replied" />;
  if (!open) {
    return <Button size="sm" variant={primary ? "primary" : "subtle"} onClick={() => setOpen(true)}>{inline.draft ? "Review reply" : "Reply"}</Button>;
  }
  return (
    <div className="w-full basis-full space-y-2 pt-2">
      <p className="rounded-lg border border-border bg-surface-2/50 p-2 text-xs text-muted">{inline.said}</p>
      <textarea
        autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder={inline.draft ? undefined : "Write your reply"}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={copy} disabled={!text.trim()}><Copy className="size-3.5" /> {copied ? "Copied" : "Copy"}</Button>
        {inline.url && <a href={inline.url} target="_blank" rel="noreferrer" className={buttonClass("subtle", "sm")}><ExternalLink className="size-3.5" /> Open post</a>}
        <Button size="sm" variant="primary" disabled={pending || !text.trim()} onClick={send} title="Records that you posted this reply on the platform and stops the clock.">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Mark replied
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Link href={href} className="ml-auto text-[11px] text-muted underline">Full view</Link>
      </div>
      {result && !result.ok && <p className="text-xs text-danger">{result.text}</p>}
    </div>
  );
}
