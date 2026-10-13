"use client";
import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, X } from "lucide-react";
import { buttonClass, Field } from "./ui";
import { pickIdeaOnCalendarAction, pinIdeaToDayAction } from "@/server/actions/ideas";
import { draftPostAction } from "@/server/actions/drafting";

/**
 * Picking an idea on the calendar: click one, or drag it onto a day, then
 * choose the brands, the day and optionally the time. Each brand gets a draft
 * on that day, and Claude can write them straight away.
 */

/** An idea dragged out of the waiting list: dropping it on a day asks which brands to draft it for. */
export const IDEA_DRAG_TYPE = "application/x-ggsocial-idea";
/** A forecast idea dragged between days: dropping it pins it to that day, with nothing to confirm. */
export const IDEA_MOVE_TYPE = "application/x-ggsocial-idea-move";

export type PickIdea = {
  id: string; title: string; status: string; pillar: string | null;
  brands: { id: string; name: string; color: string }[];
  /** The day the content writer would book it, when it has one. */
  day: string | null;
  /** Pinned to that day by a person, rather than forecast. */
  pinned: boolean;
};

type Ctx = { open: (ideaId: string, day?: string | null) => void };
const PickContext = createContext<Ctx>({ open: () => {} });
export const useIdeaPick = () => useContext(PickContext);

export function IdeaPickProvider({ ideas, aiReady, children }: { ideas: PickIdea[]; aiReady: boolean; children: ReactNode }) {
  const [target, setTarget] = useState<{ ideaId: string; day: string | null } | null>(null);
  const value = useMemo<Ctx>(() => ({ open: (ideaId, day) => setTarget({ ideaId, day: day ?? null }) }), []);
  const idea = target ? ideas.find((i) => i.id === target.ideaId) : null;
  return (
    <PickContext.Provider value={value}>
      {children}
      {target && idea && (
        <PickDialog key={target.ideaId + (target.day ?? "")} idea={idea} day={target.day ?? idea.day} aiReady={aiReady} onClose={() => setTarget(null)} />
      )}
    </PickContext.Provider>
  );
}

function tomorrow() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function PickDialog({ idea, day: initialDay, aiReady, onClose }: { idea: PickIdea; day: string | null; aiReady: boolean; onClose: () => void }) {
  const router = useRouter();
  const [day, setDay] = useState(initialDay ?? tomorrow());
  const [time, setTime] = useState("");
  const [chosen, setChosen] = useState(new Set(idea.brands.map((b) => b.id)));
  const [write, setWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => start(async () => {
    setError(null);
    try {
      const res = await pickIdeaOnCalendarAction({ ideaId: idea.id, brandIds: [...chosen], day, time: time || null });
      if (!res.ok) { setError(res.error); return; }
      if (write && res.createdPostIds.length) {
        const failed: string[] = [];
        let done = 0;
        const queue = [...res.createdPostIds];
        setProgress(`Writing 0 of ${queue.length}…`);
        const worker = async () => {
          for (let id = queue.shift(); id; id = queue.shift()) {
            const r = await draftPostAction(id);
            if (!r.ok) failed.push(r.error);
            done += 1;
            setProgress(`Writing ${done} of ${res.createdPostIds.length}…`);
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (failed.length) { setError([...new Set(failed)].join(" ")); router.refresh(); return; }
      }
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not put that on the calendar.");
    }
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Put this idea on the calendar">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted">Put on the calendar</p>
            <h2 className="text-sm font-semibold leading-snug">{idea.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-text"><X className="size-4" /></button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Day"><input type="date" value={day} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDay(e.target.value)} /></Field>
          <Field label="Time" hint="Blank = each brand's usual time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>

        <fieldset className="mt-3">
          <legend className="mb-1 text-xs font-medium">Brands</legend>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {idea.brands.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" className="!w-auto" checked={chosen.has(b.id)}
                  onChange={(e) => setChosen((c) => { const n = new Set(c); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n; })}
                />
                <span className="size-2 rounded-full" style={{ background: b.color }} />{b.name}
              </label>
            ))}
          </div>
        </fieldset>

        <label className={`mt-3 flex items-center gap-2 text-sm ${aiReady ? "" : "opacity-50"}`} title={aiReady ? "" : "Add ANTHROPIC_API_KEY to the server's .env"}>
          <input type="checkbox" className="!w-auto" checked={write} disabled={!aiReady} onChange={(e) => setWrite(e.target.checked)} />
          <Sparkles className="size-3.5" /> Have Claude write each one now
        </label>

        {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {progress && !error && <p className="mt-3 text-xs text-muted">{progress}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          {idea.pinned && (
            <button
              className={`${buttonClass("ghost", "sm")} mr-auto`} disabled={pending}
              title="Stop holding this idea to its day; the writer forecasts it again"
              onClick={() => start(async () => { const r = await pinIdeaToDayAction(idea.id, null); if (!r.ok) { setError(r.error); return; } router.refresh(); onClose(); })}
            >Clear pinned day</button>
          )}
          <button className={buttonClass("ghost", "sm")} onClick={onClose} disabled={pending}>Cancel</button>
          <button className={buttonClass("primary", "sm")} onClick={submit} disabled={pending || chosen.size === 0 || !day}>
            {pending ? "Working…" : `Put on ${chosen.size} brand${chosen.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** An idea in the "waiting" column: click to pick it, or drag it onto a day. */
export function IdeaCard({ idea }: { idea: PickIdea }) {
  const { open } = useIdeaPick();
  return (
    <div
      role="button" tabIndex={0} draggable
      onDragStart={(e) => { e.dataTransfer.setData(IDEA_DRAG_TYPE, idea.id); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={() => open(idea.id, idea.day)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(idea.id, idea.day); } }}
      className="block cursor-grab rounded-lg border border-dashed border-border bg-surface p-2.5 text-left text-xs hover:bg-surface-2"
    >
      <p className="line-clamp-2 font-medium">{idea.title}</p>
      <p className="mt-1 text-muted">{idea.status === "planned" ? "Planned" : idea.status === "drafting" ? "Drafting" : "Backlog"}{idea.pillar ? ` · ${idea.pillar}` : ""}</p>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
        {idea.brands.slice(0, 3).map((b) => (
          <span key={b.id} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: b.color }} />{b.name}</span>
        ))}
        {idea.brands.length > 3 && <span>+{idea.brands.length - 3} more</span>}
      </p>
    </div>
  );
}

/** A forecast entry on the calendar: opens the picker for its idea and day. */
export function PickEntry({ ideaId, day, className, style, title, children }: {
  ideaId: string; day: string; className?: string; style?: React.CSSProperties; title?: string; children: ReactNode;
}) {
  const { open } = useIdeaPick();
  return (
    <button type="button" onClick={() => open(ideaId, day)} className={`w-full text-left ${className ?? ""}`} style={style} title={title}>
      {children}
    </button>
  );
}
