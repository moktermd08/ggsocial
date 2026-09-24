"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { Button, Card, CardHeader, Field } from "./ui";
import { relativeTime } from "@/lib/format";
import { AGENT_SUGGESTIONS } from "@/lib/activities/meta";
import { MEDIA_USES } from "@/lib/media-catalog";
import { createAgentTokenAction, revokeAgentTokenAction } from "@/server/actions/activities";
import type { ActionResult } from "@/lib/action-result";

export type AgentTokenView = { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revoked: boolean };

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button size="sm" onClick={async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * Tokens that let AI agents work the checklists — do tasks, tick them off,
 * and review each other's (or people's) work — plus the instructions to give them.
 */
export function AgentAccess({ tokens, appUrl }: { tokens: AgentTokenView[]; appUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("Claude");
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = `${appUrl.replace(/\/$/, "")}/api/agent`;
  const base = `${root}/activities`;
  const tokenText = fresh?.token ?? "ggs_YOUR_TOKEN";

  const instructions = `You help run social media for our brands. Your recurring task list lives in ggsocial.

API base: ${base}
Send the header  X-Agent-Token: ${tokenText}  with every request.

0. GET ${root}/brands
   Each brand's voice: brief, tone, audience, key messages, words to avoid, hashtags, emoji policy, call to action, links, and its channels with each platform's character limit. Follow the brand's "writingGuide" in everything you write for it, and respect each channel's limits.

1. GET ${base}?open=1
   Lists every brand you can work on and, for each frequency (daily, every_2_days, weekly, monthly, quarterly, half_yearly, yearly), the activities still open in the current period. Each activity has a code, title, description (how to do it), target, unit, proof, and a per-brand status.
2. Do the activities you are able to do (performer "ai" or "either" first). Never post, message or change a profile without the access and approval you have been given; when you can only draft, put the draft in "notes" and use status "partial".
3. Record each one:
   POST ${base}/checks
   {"brand": "<slug or all>", "code": "D-02", "status": "done" | "partial" | "skipped", "count": 12, "proofUrl": "https://…", "notes": "what you did"}
   Send {"checks": [ … ]} to record several at once. "brand": "all" records it for every brand.
4. If asked to review work, check the proof against the description and target, then:
   POST ${base}/reviews
   {"brand": "<slug>", "code": "D-02", "decision": "approved" | "rejected", "note": "why"}

Add "date": "YYYY-MM-DD" to target an earlier period. Errors come back as {"error": "…"}.

Goals — the targets the activities serve (followers, site visitors, comments, messages, engagement, reach, leads):
5. GET ${root}/goals
   Each goal's current value, target and deadline, pace (ahead, on_track, behind, at_risk, no_data), projected hit date, this week's plan per activity (perWeek, checklistTarget, doneThisWeek, expectedByNow, what each unit really brings) and "whereToImprove". Put the activities with the biggest missed impact first.
   GET ${root}/goals/{id}?grain=weekly adds progress today / this week / month / quarter / year, planned-against-actual history and recent plan changes.
6. When you can read an account's numbers, log them so the goals steer on facts:
   POST ${root}/goals/snapshots
   {"brand": "<slug>", "channel": "instagram" | "<handle>" | "<channel id>", "metric": "followers", "value": 12480}
   Leave out "channel" for a whole-brand count the app cannot see (e.g. "metric": "site_visitors" from analytics). Send {"snapshots": [ … ]} for several.
7. After logging fresh numbers you may re-plan a goal: POST ${root}/goals/{id}/recalibrate. Big changes come back "waitingForApproval" — a person approves those in the app; do not try to.

Playbook — the master instructions for every format (post, reel, story, carousel, short, video, thread, article, newsletter, product or service listing), every kind of engagement work (replies, DMs, comments, reviews, communities, leads, connection requests), profiles (bios and details, profile pictures, covers and banners), paid ads, and planning, reporting and account security. Every activity is governed by at least one rule. Every brand follows it, with its own adjustments:
8. GET ${root}/playbook?brand=all
   Per brand, each rule's limits (title words, hashtag count, copy length, media type, aspect ratio, size, video length, posting windows and days, cadence), the checklist to meet, and how to do it. Each activity above lists the rule codes that govern it in "playbook". Follow the rule in everything you make or do; the same limits block scheduling and approval in the app.
9. Before handing over any content, check it:
   POST ${root}/playbook/check
   {"brand": "<slug>", "platform": "instagram", "format": "reel", "title": "…", "body": "…", "firstComment": "…", "scheduledAt": "2026-09-24T19:30:00+06:00", "media": [{"kind": "video", "width": 1080, "height": 1920, "durationSeconds": 42}]}
   Use "format": "ads", "profile-picture" or "cover-graphics" to check ad or profile creative against those rules.
   Or send {"postId": "…"} for a saved post. Fix every "error" before you record the work; mention any "warn" in your notes.
10. If the numbers show a rule should change (say, reels do better at a different time), suggest it with the evidence:
   POST ${root}/playbook/adjustments
   {"brand": "<slug or master>", "rule": "reel", "field": "windows", "value": "18:00-21:00", "reason": "…", "evidence": {…}}
   It waits for the daily review unless "apply": true and your token's owner is an approver or admin.
11. Daily review (activity D-27): GET ${root}/playbook/adjustments?status=proposed, then decide the ones you can judge:
   POST ${root}/playbook/adjustments/decisions  {"id": "…", "decision": "approved" | "rejected", "note": "why"}
   Never decide your own suggestion; leave anything you are unsure of for a person.

Media library — every brand's images and videos, filed by category, subcategory, keywords and where each suits (${MEDIA_USES.map((u) => u.code).join(", ")}):
12. Before you build or post anything visual, look for a picture the brand already has:
   GET ${root}/media?brand=<slug>&q=coffee+morning&use=story&orientation=portrait
   Also: category, subcategory, kind (image, video), limit. Best match first; read each file's "description" and "notes" (when not to use it) before picking it, and use its "url".
   GET ${root}/media?postId=… gives the best files for a saved post, with the words they matched.
13. Files nobody has filed yet cannot be found by words. List them with ?unfiled=1, then either
   POST ${root}/media/catalogue  {"brand": "<slug>" | "master"}   Claude files up to six; repeat while "remaining" > 0
   or file one yourself:
   PATCH ${root}/media/{id}  {"description": "…", "category": "Product", "subcategory": "Close-up", "keywords": ["…"], "uses": ["feed", "story"], "notes": "…"}`;

  function run(work: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await work();
        if (!res.ok) { setError(res.error); return; }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "That did not go through.");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader icon={KeyRound} title="Agent tokens" subtitle="Each token acts as you, on the brands you can edit. Its name is recorded as who did the work." />
          <div className="space-y-3 p-4">
            <div className="flex items-end gap-2">
              <Field label="Agent name">
                <input list="agent-token-names" value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <datalist id="agent-token-names">{AGENT_SUGGESTIONS.map((n) => <option key={n} value={n} />)}</datalist>
              <Button variant="primary" disabled={pending || !name.trim()} onClick={() => run(async () => {
                const res = await createAgentTokenAction(name);
                if (res.ok) setFresh({ name, token: res.token });
                return res;
              })}>
                Create token
              </Button>
            </div>
            {fresh && (
              <div className="space-y-2 rounded-lg border border-ok/30 bg-ok/10 p-3">
                <p className="text-xs font-medium text-ok">Token for {fresh.name} — copy it now. It will not be shown again.</p>
                <code className="block break-all rounded bg-surface px-2 py-1.5 font-mono text-xs">{fresh.token}</code>
                <CopyButton text={fresh.token} label="Copy token" />
              </div>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
            <ul className="divide-y divide-border">
              {tokens.length === 0 && <li className="py-3 text-sm text-muted">No tokens yet.</li>}
              {tokens.map((t) => (
                <li key={t.id} className={`flex items-center gap-3 py-2.5 ${t.revoked ? "opacity-50" : ""}`}>
                  <Bot className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{t.name} <span className="font-mono text-[11px] font-normal text-muted">{t.prefix}…</span></p>
                    <p className="text-[11px] text-muted">
                      Created {relativeTime(t.createdAt)} · {t.revoked ? "revoked" : t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : "never used"}
                    </p>
                  </div>
                  {!t.revoked && (
                    <Button size="sm" variant="ghost" aria-label={`Revoke ${t.name}`} disabled={pending} onClick={() => run(() => revokeAgentTokenAction(t.id))}>
                      <Trash2 className="size-3.5" /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={Bot}
          title="Instructions for the agent"
          subtitle="Paste this into Claude (a project, a skill or a scheduled task) or any agent that can make HTTP requests."
          action={<CopyButton text={instructions} />}
        />
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed text-text">{instructions}</pre>
      </Card>
    </div>
  );
}
