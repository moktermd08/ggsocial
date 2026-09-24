import Link from "next/link";
import { and, inArray, isNull } from "drizzle-orm";
import { AlertTriangle, BarChart3, Bot, ClipboardCheck, MessagesSquare, PenSquare } from "lucide-react";
import { requireUser, getMyBrands, can, type BrandWithRole } from "@/lib/auth";
import { getScope } from "@/lib/scope";
import { db, channels } from "@/lib/db";
import { AGENTS, AGENT_BY_CODE, AGENT_RUN_STATUS_META, type AgentCode } from "@/lib/agents/meta";
import { relativeTime } from "@/lib/format";
import { costOf, formatUsd } from "@/lib/ai-cost";
import { draftingConfigured, NOT_CONFIGURED } from "@/server/drafting";
import { getCrew, getReviewCounts, getRuns, type AgentRun, type BrandAgent } from "@/server/agents";
import { Badge, Card, CardHeader, EmptyState, IconChip, LinkButton, PageHeader, StatTile } from "@/components/ui";
import { AgentControls, type CrewChannel } from "@/components/agent-crew";

const ICONS: Record<AgentCode, typeof Bot> = { writer: PenSquare, community: MessagesSquare, analyst: BarChart3 };

export default async function AgentsPage() {
  const user = await requireUser();
  const brands = await getMyBrands(user.id);
  const scope = await getScope(brands);
  const inScope = brands.filter((b) => scope.brandIds.includes(b.id));
  const ids = inScope.map((b) => b.id);

  if (inScope.length === 0) {
    return (
      <>
        <PageHeader icon={Bot} title="Agents" />
        <Card><EmptyState icon={Bot} title="No brands yet" body="Add a brand, then give it a crew." action={<LinkButton href="/brands/new" variant="primary">Add a brand</LinkButton>} /></Card>
      </>
    );
  }

  const [crew, runs, chans, waiting] = await Promise.all([
    getCrew(ids),
    getRuns(ids, { limit: 40 }),
    db.select({ id: channels.id, brandId: channels.brandId, platform: channels.platform, handle: channels.handle })
      .from(channels).where(and(inArray(channels.brandId, ids), isNull(channels.archivedAt))),
    getReviewCounts(ids),
  ]);

  const configured = draftingConfigured();
  const onCount = crew.filter((c) => c.enabled).length;

  return (
    <>
      <PageHeader
        icon={Bot}
        title="Agents"
        subtitle="A crew for each brand that does the hourly work: writing posts, drafting replies and reading the numbers. You set the guidelines and review what they make, in the Review inbox. Nothing goes out unreviewed unless a brand's owner switches review off in Workflows."
      />

      {!configured && (
        <Card className="mb-5 flex items-start gap-3 border-warn/40 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
          <p className="text-sm text-text">{NOT_CONFIGURED} Until then the agents can be set up but will not run.</p>
        </Card>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-text">Waiting for you</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Agent posts to approve" value={waiting.posts} icon={PenSquare} tone="#4f46e5" href="/posts?status=in_review" />
          <StatTile label="Drafted replies to send" value={waiting.replies} icon={MessagesSquare} tone="#0f766e" href="/engage" />
          <StatTile label="Agent checks to review" value={waiting.checks} icon={ClipboardCheck} tone="#475569" href="/activities" />
          <StatTile label="Failed runs, last 24h" value={waiting.failed} icon={AlertTriangle} tone="#b91c1c" href="#runs"
            hint={`${onCount} agent${onCount === 1 ? "" : "s"} switched on`} />
        </div>
      </section>

      <section className="mb-6 space-y-4">
        {inScope.map((brand) => (
          <BrandCrew key={brand.id} brand={brand}
            crew={crew.filter((c) => c.brandId === brand.id)}
            runs={runs.filter((r) => r.brandId === brand.id)}
            channels={chans.filter((c) => c.brandId === brand.id)} />
        ))}
      </section>

      <RunLog runs={runs} brands={inScope} />
    </>
  );
}

function BrandCrew({ brand, crew, runs, channels }: {
  brand: BrandWithRole; crew: BrandAgent[]; runs: AgentRun[]; channels: CrewChannel[];
}) {
  const canManage = can.manageBrand(brand.role);
  const canRun = can.edit(brand.role);
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: brand.color }} />{brand.name}</span>}
        subtitle={canManage ? "Switch agents on, and tell them what matters for this brand." : "Only brand admins can change this crew."}
      />
      <div className="divide-y divide-border">
        {AGENTS.map((def) => {
          const row = crew.find((c) => c.agentCode === def.code);
          const last = runs.find((r) => r.agentCode === def.code);
          return (
            <div key={def.code} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div className="flex min-w-0 gap-3">
                <IconChip icon={ICONS[def.code]} tone={def.color} size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{def.name} <span className="font-normal text-muted">· {def.role}</span></p>
                  <p className="mt-0.5 text-xs text-muted">{def.summary}</p>
                  {last && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge color={AGENT_RUN_STATUS_META[last.status].color}>{AGENT_RUN_STATUS_META[last.status].label}</Badge>
                      <span>{relativeTime(last.startedAt)}</span>
                      <span className="text-text">{last.status === "failed" ? last.error : last.summary}</span>
                    </p>
                  )}
                </div>
              </div>
              <AgentControls
                canManage={canManage} canRun={canRun} channels={channels}
                state={{
                  brandId: brand.id, code: def.code, enabled: row?.enabled ?? false,
                  guidelines: row?.guidelines ?? "", settings: row?.settings ?? {},
                }}
              />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RunLog({ runs, brands }: { runs: AgentRun[]; brands: BrandWithRole[] }) {
  const byId = new Map(brands.map((b) => [b.id, b]));
  return (
    <Card id="runs">
      <CardHeader title="What the agents did" subtitle="Every run, newest first: what it made, what it wants you to look at, and what it cost." />
      {runs.length === 0 ? (
        <EmptyState icon={Bot} title="No runs yet" body="Switch an agent on, or press Run now to see it work." />
      ) : (
        <ul className="divide-y divide-border">
          {runs.map((r) => {
            const brand = byId.get(r.brandId);
            const meta = AGENT_RUN_STATUS_META[r.status];
            const tokens = r.usage ? r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite : 0;
            return (
              <li key={r.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={meta.color}>{meta.label}</Badge>
                  <span className="font-medium text-text">{AGENT_BY_CODE[r.agentCode]?.name ?? r.agentCode}</span>
                  {brand && <span className="flex items-center gap-1 text-xs text-muted"><span className="size-2 rounded-full" style={{ background: brand.color }} />{brand.name}</span>}
                  <span className="text-xs text-muted">{relativeTime(r.startedAt)}{r.trigger === "manual" ? " · run by hand" : ""}</span>
                  {tokens > 0 && <span className="ml-auto text-[11px] text-muted" title={`${r.usage!.input} in, ${r.usage!.output} out, ${r.usage!.cacheRead} cached — ${r.usage!.model}`}>{formatUsd(costOf(r.usage))} · {tokens.toLocaleString()} tokens</span>}
                </div>
                <p className="mt-1 text-muted">{r.status === "failed" ? <span className="text-danger">{r.error}</span> : r.summary}</p>
                {r.items.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs">
                    {r.items.slice(0, 8).map((item, i) => (
                      <li key={`${item.id}-${i}`} className="truncate">
                        {item.href ? <Link href={item.href} className="text-accent hover:underline">{item.label}</Link> : <span className="text-text">{item.label}</span>}
                      </li>
                    ))}
                    {r.items.length > 8 && <li className="text-muted">and {r.items.length - 8} more</li>}
                  </ul>
                )}
                {r.issues.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-warn">
                    {r.issues.slice(0, 5).map((issue) => <li key={issue} className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> {issue}</li>)}
                    {r.issues.length > 5 && <li className="text-muted">and {r.issues.length - 5} more</li>}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
