import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { AlertTriangle, Hand, Inbox, Workflow } from "lucide-react";
import { requireUser, getMyBrands, can } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, channels, interactions, posts, postTargets } from "@/lib/db";
import { INTERACTION_KIND_LABELS } from "@/lib/db/engagement";
import { PAUSE_META, WORKFLOW_BY_CODE, stepDef } from "@/lib/workflows/meta";
import { isVerdict } from "@/lib/workflows/review";
import { inZone, relativeTime, truncate } from "@/lib/format";
import { getOpenPauses } from "@/server/workflows";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PlatformIcon } from "@/components/platform-icon";
import { PauseControls } from "@/components/review-inbox";

type Item = Awaited<ReturnType<typeof getOpenPauses>>[number];

export default async function ReviewPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const byId = new Map(inScope.map((b) => [b.id, b]));
  const items = await getOpenPauses(inScope.map((b) => b.id));

  const postIds = [...new Set(items.filter((i) => i.run.subjectType === "post" && i.run.subjectId).map((i) => i.run.subjectId!))];
  const [postRows, targetRows] = postIds.length
    ? await Promise.all([
        db.select().from(posts).where(inArray(posts.id, postIds)),
        db.select({ postId: postTargets.postId, platform: channels.platform }).from(postTargets)
          .innerJoin(channels, eq(channels.id, postTargets.channelId))
          .where(inArray(postTargets.postId, postIds)),
      ])
    : [[], []];
  const postById = new Map(postRows.map((p) => [p.id, p]));
  const itemIds = [...new Set(items.filter((i) => i.run.subjectType === "interaction" && i.run.subjectId).map((i) => i.run.subjectId!))];
  const itemRows = itemIds.length
    ? await db.select({ i: interactions, platform: channels.platform }).from(interactions)
        .leftJoin(channels, eq(channels.id, interactions.channelId)).where(inArray(interactions.id, itemIds))
    : [];
  const itemById = new Map(itemRows.map((r) => [r.i.id, r]));

  const decide = items.filter((i) => i.step.pause?.kind !== "human");
  const hands = items.filter((i) => i.step.pause?.kind === "human");

  const render = (item: Item) => {
    const brand = byId.get(item.run.brandId)!;
    const pause = item.step.pause!;
    const wf = WORKFLOW_BY_CODE[item.run.workflowCode];
    const step = stepDef(item.run.workflowCode, item.step.stepKey);
    const post = item.run.subjectType === "post" && item.run.subjectId ? postById.get(item.run.subjectId) : undefined;
    const said = item.run.subjectType === "interaction" && item.run.subjectId ? itemById.get(item.run.subjectId) : undefined;
    const platforms = post ? [...new Set(targetRows.filter((t) => t.postId === post.id).map((t) => t.platform))] : [];
    const canDecide = pause.kind === "human" ? can.edit(brand.role) : can.approve(brand.role);
    // An agent's post is approved where its playbook checklist is.
    const reviewOnPage = Boolean(post) && pause.after && item.step.stepKey === "draft";
    const meta = PAUSE_META[pause.kind];
    const verdict = item.step.output?.review;

    return (
      <li key={item.step.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Badge color={meta.color}>{meta.label}</Badge>
            <span className="flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}</span>
            <span>{wf.name} · {step?.name ?? item.step.stepKey}</span>
            <span>{relativeTime(item.step.createdAt)}</span>
            {item.run.revisions > 0 && <span>sent back {item.run.revisions}×</span>}
          </div>
          <p className="text-sm font-medium text-text">{pause.question}</p>
          {post && (
            <div className="rounded-lg border border-border bg-surface-2/50 p-3">
              <p className="text-sm font-medium text-text">{post.title || "Untitled post"}</p>
              <p className="mt-0.5 whitespace-pre-line text-xs text-muted">{truncate(post.body, 220)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                {platforms.map((p) => <PlatformIcon key={p} platform={p} size={16} />)}
                {post.scheduledAt && <span>for {inZone(post.scheduledAt, brand.timezone)}</span>}
              </div>
            </div>
          )}
          {said && (
            <div className="space-y-2 rounded-lg border border-border bg-surface-2/50 p-3 text-xs">
              <div>
                <p className="flex items-center gap-1.5 text-muted">
                  {said.platform && <PlatformIcon platform={said.platform} size={14} />}
                  {INTERACTION_KIND_LABELS[said.i.kind]} from {said.i.authorName ?? said.i.authorHandle ?? "someone"}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-text">{truncate(said.i.body, 400)}</p>
              </div>
              <div className="border-t border-border pt-2">
                <p className="text-muted">Reply</p>
                <p className="mt-0.5 whitespace-pre-line text-text">{said.i.replyBody ?? "—"}</p>
              </div>
            </div>
          )}
          {isVerdict(verdict) && (
            <div className="text-xs">
              <p className="flex flex-wrap items-center gap-1.5 text-muted">
                <Badge color={verdict.score >= brand.reviewThreshold ? "#15803d" : "#b45309"}>Reviewer {verdict.score}/100</Badge>
                <span className="text-text">{verdict.summary}</span>
              </p>
              {verdict.fixes.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">{verdict.fixes.map((f) => <li key={f}>{f}</li>)}</ul>
              )}
            </div>
          )}
          {pause.reasons.length > 0 && (
            <ul className={`space-y-0.5 text-xs ${pause.kind === "safety" ? "text-danger" : "text-muted"}`}>
              {pause.reasons.map((r) => (
                <li key={r} className="flex gap-1.5">{pause.kind === "safety" && <AlertTriangle className="mt-0.5 size-3 shrink-0" />}{r}</li>
              ))}
            </ul>
          )}
        </div>
        <PauseControls
          stepId={item.step.id} kind={pause.kind} after={pause.after} sendBack={Boolean(pause.sendBackTo)}
          href={pause.href} reviewOnPage={reviewOnPage} canDecide={canDecide}
        />
      </li>
    );
  };

  return (
    <>
      <PageHeader
        icon={Inbox}
        title="Review"
        subtitle="Everything the agents have stopped for you, across every brand: work waiting for a review, safety stops, and steps only a person can do. When this is empty, nothing is waiting on you."
        action={<LinkButton href="/workflows"><Workflow className="size-4" /> Review settings</LinkButton>}
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState icon={Inbox} title="Nothing waiting for you"
            body="When an agent finishes a step that has review on, or hits a safety stop, it lands here." />
        </Card>
      ) : (
        <div className="space-y-5">
          {decide.length > 0 && (
            <Card>
              <CardHeader icon={Inbox} title={`Needs your decision (${decide.length})`}
                subtitle="Approve to let the run carry on, send it back with a note for the agent to redo, or stop it." />
              <ul className="divide-y divide-border">{decide.map(render)}</ul>
            </Card>
          )}
          {hands.length > 0 && (
            <Card>
              <CardHeader icon={Hand} title={`Needs your hands (${hands.length})`}
                subtitle="Steps no agent can do yet. Do it, then mark it done — the run checks and carries on." />
              <ul className="divide-y divide-border">{hands.map(render)}</ul>
            </Card>
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Agent posts can still be approved from <Link href="/posts?status=in_review" className="text-accent hover:underline">Content</Link>; the run follows along either way.
      </p>
    </>
  );
}
