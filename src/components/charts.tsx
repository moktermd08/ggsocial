"use client";
import { useState, type ReactNode } from "react";

/*
 * Dependency-free charts. Plain HTML for anything rectangular (columns, bars,
 * segments) so it lays out responsively without measuring; SVG only for the
 * line/area path, stretched with preserveAspectRatio="none" and a
 * non-scaling stroke so the line stays 2px at any width.
 *
 * Colours come in as CSS values (usually var(--chart-n)) so both themes work
 * without the chart knowing which one is active. Text never wears a series
 * colour: labels and values stay in --text / --muted.
 */

export type ChartSeries = { key: string; label: string; color: string };
export type ChartPoint = { label: string; tip?: string; values: Record<string, number> };

/** A round axis maximum (1/2/5 × 10ⁿ steps) and the ticks under it. */
function niceScale(max: number, count = 4) {
  if (max <= 0) return { top: count, ticks: Array.from({ length: count + 1 }, (_, i) => i) };
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Counts: never a 0.5 tick.
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw);
  const top = step * Math.ceil(max / step);
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

const fmt = (n: number) => n.toLocaleString();

/** Show roughly `max` x-labels, always including the first and last. */
function labelEvery(n: number, max = 7) {
  return Math.max(1, Math.ceil(n / max));
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function Tooltip({ title, rows, align }: { title: string; rows: { label: string; value: number; color: string }[]; align: "left" | "right" | "center" }) {
  const pos = { left: "left-0", right: "right-0", center: "left-1/2 -translate-x-1/2" }[align];
  return (
    <div className={`pointer-events-none absolute bottom-full z-10 mb-2 min-w-32 whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-lg ${pos}`}>
      <p className="mb-1 font-medium text-text">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-1.5 text-muted">
          <span className="size-2 rounded-sm" style={{ background: r.color }} />
          <span className="flex-1">{r.label}</span>
          <span className="ml-3 font-medium tabular-nums text-text">{fmt(r.value)}</span>
        </p>
      ))}
    </div>
  );
}

function YAxis({ ticks, top }: { ticks: number[]; top: number }) {
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }}>
          <span className="w-8 shrink-0 -translate-y-0 pr-2 text-right text-[10px] leading-none tabular-nums text-muted">{fmt(t)}</span>
          <span className={`h-px flex-1 ${t === 0 ? "bg-muted/40" : "bg-border"}`} />
        </div>
      ))}
    </>
  );
}

/**
 * Stacked columns over a time axis. Segments are separated by a 2px surface
 * gap; only the top of the stack is rounded.
 */
export function ColumnChart({
  data, series, height = 180, emptyLabel = "No data in this window", marker,
}: {
  data: ChartPoint[]; series: ChartSeries[]; height?: number; emptyLabel?: string;
  /** Index of a column to call out (e.g. today): always labelled, with a rule behind it. */
  marker?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const { top, ticks } = niceScale(Math.max(0, ...totals));
  const every = labelEvery(data.length);
  const empty = totals.every((t) => t === 0);

  return (
    <div className="space-y-3">
      <Legend series={series} />
      <div className="relative" style={{ height }}>
        <YAxis ticks={ticks} top={top} />
        {empty && (
          <p className="absolute inset-0 grid place-items-center pl-8 text-xs text-muted">{emptyLabel}</p>
        )}
        <div className="absolute inset-y-0 left-8 right-0 flex items-end">
          {data.map((d, i) => {
            const stack = series.filter((s) => (d.values[s.key] ?? 0) > 0);
            return (
              <div
                key={i}
                className="relative flex h-full flex-1 cursor-default items-end justify-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                {hover === i && <div className="absolute inset-y-0 inset-x-px rounded-md bg-surface-2" />}
                {marker === i && hover !== i && <div className="absolute inset-y-0 inset-x-px rounded-md bg-accent-soft/70" />}
                <div
                  className="relative flex w-[62%] max-w-6 flex-col-reverse gap-0.5"
                  style={{ height: `${(totals[i] / top) * 100}%` }}
                >
                  {stack.map((s, j) => (
                    <div
                      key={s.key}
                      className={j === stack.length - 1 ? "rounded-t" : ""}
                      style={{ flexGrow: d.values[s.key], flexBasis: 0, background: s.color, minHeight: 2 }}
                    />
                  ))}
                </div>
                {hover === i && (
                  <Tooltip
                    title={d.tip ?? d.label}
                    align={i < data.length / 4 ? "left" : i > (data.length * 3) / 4 ? "right" : "center"}
                    rows={series.map((s) => ({ label: s.label, value: d.values[s.key] ?? 0, color: s.color }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-8 flex text-[10px] text-muted">
        {data.map((d, i) => (
          <span key={i} className={`flex-1 whitespace-nowrap text-center ${marker === i ? "font-semibold text-accent" : ""}`}>
            {marker === i || ((i % every === 0 || i === data.length - 1) && (marker === undefined || Math.abs(marker - i) >= every))
              ? d.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A single-series area over time, with a crosshair and tooltip on hover. */
export function AreaChart({
  data, label, color = "var(--chart-1)", height = 180, emptyLabel = "No data in this window",
}: { data: { label: string; tip?: string; value: number }[]; label: string; color?: string; height?: number; emptyLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const { top, ticks } = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const n = data.length;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / top) * 100;
  const line = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(d.value)}`).join(" ");
  const area = n ? `${line} L${x(n - 1)},100 L${x(0)},100 Z` : "";
  const every = labelEvery(n);
  const empty = data.every((d) => d.value === 0);
  const last = data[n - 1];

  return (
    <div className="space-y-3">
      <div className="relative" style={{ height }}>
        <YAxis ticks={ticks} top={top} />
        {empty && <p className="absolute inset-0 grid place-items-center pl-8 text-xs text-muted">{emptyLabel}</p>}
        <div className="absolute inset-y-0 left-8 right-0">
          {!empty && <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <path d={area} fill={color} fillOpacity={0.12} />
            <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>}
          {hover === null && last && !empty && (
            <span
              className="absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-surface"
              style={{ left: `${x(n - 1)}%`, bottom: `${100 - y(last.value)}%`, background: color }}
            />
          )}
          {hover !== null && (
            <>
              <span className="absolute inset-y-0 w-px bg-muted/40" style={{ left: `${x(hover)}%` }} />
              <span
                className="absolute size-2.5 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-surface"
                style={{ left: `${x(hover)}%`, bottom: `${100 - y(data[hover].value)}%`, background: color }}
              />
              <div className="absolute" style={{ left: `${x(hover)}%`, bottom: `${100 - y(data[hover].value)}%` }}>
                <div className="relative">
                  <Tooltip
                    title={data[hover].tip ?? data[hover].label}
                    align={hover < n / 4 ? "left" : hover > (n * 3) / 4 ? "right" : "center"}
                    rows={[{ label, value: data[hover].value, color }]}
                  />
                </div>
              </div>
            </>
          )}
          {/* Hit targets: one full-height slice per point, wider than the mark. */}
          <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
            {data.map((_, i) => (
              <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />
            ))}
          </div>
        </div>
      </div>
      <div className="relative ml-8 h-3 whitespace-nowrap text-[10px] text-muted">
        {data.map((d, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every / 2) && (
          <span
            key={i}
            className={`absolute ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${x(i)}%` }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A tiny trend line for stat tiles. Decorative: the tile's number is the data. */
export function Sparkline({ values, color = "var(--chart-1)", className = "h-8 w-24" }: { values: number[]; color?: string; className?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${96 - (v / max) * 88}`);
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`M${pts.join(" L")} L100,100 L0,100 Z`} fill={color} fillOpacity={0.12} />
      <path d={`M${pts.join(" L")}`} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * One bar split into parts, with a legend underneath that carries the labels
 * and counts — so identity never rests on colour alone.
 */
export function SegmentedBar({
  parts, total: totalOverride,
}: { parts: { key: string; label: string; value: number; color: string; icon?: ReactNode; href?: string }[]; total?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const shown = parts.filter((p) => p.value > 0);
  const total = totalOverride ?? shown.reduce((s, p) => s + p.value, 0);
  return (
    <div className="space-y-3">
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-surface-2">
        {shown.map((p) => (
          <div
            key={p.key}
            className="h-full transition-opacity first:rounded-l-full last:rounded-r-full"
            style={{ flexGrow: p.value, flexBasis: 0, background: p.color, opacity: hover && hover !== p.key ? 0.35 : 1 }}
            title={`${p.label}: ${fmt(p.value)}`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {parts.map((p) => {
          const body = (
            <>
              <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
              {p.icon}
              <span className="min-w-0 flex-1 truncate">{p.label}</span>
              <span className="font-medium tabular-nums text-text">{fmt(p.value)}</span>
              {total > 0 && <span className="w-9 text-right tabular-nums">{Math.round((p.value / total) * 100)}%</span>}
            </>
          );
          const cls = `flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs text-muted ${p.value === 0 ? "opacity-50" : ""}`;
          return (
            <li key={p.key} onMouseEnter={() => setHover(p.key)} onMouseLeave={() => setHover(null)}>
              {p.href ? <a href={p.href} className={`${cls} hover:bg-surface-2`}>{body}</a> : <span className={cls}>{body}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars with a leading icon and the value at the tip. */
export function BarList({
  items, color = "var(--chart-1)", valueLabel,
}: { items: { key: string; label: ReactNode; icon?: ReactNode; value: number; sub?: string }[]; color?: string; valueLabel?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key} className="group" title={valueLabel ? `${fmt(it.value)} ${valueLabel}` : undefined}>
          <div className="mb-1 flex items-center gap-2 text-xs">
            {it.icon}
            <span className="min-w-0 flex-1 truncate text-text">{it.label}</span>
            {it.sub && <span className="text-muted">{it.sub}</span>}
            <span className="w-10 text-right font-medium tabular-nums">{fmt(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-opacity group-hover:opacity-80"
              style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A circular gauge for a single ratio, e.g. share of channels that auto-publish. */
export function Ring({ value, total, color = "var(--chart-1)", size = 64, children }: {
  value: number; total: number; color?: string; size?: number; children?: ReactNode;
}) {
  const r = 15.5;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="size-full -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="4" />
        {frac > 0 && (
          <circle cx="18" cy="18" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
            strokeDasharray={`${frac * c} ${c}`} />
        )}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** 1234 → "1.2k", 1_000_000 → "1M": axis labels that fit a narrow gutter. */
function short(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${+(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${Math.round(n)}`;
}

/** `original` is null before the goal began, where only what happened is drawn. */
export type PlanPoint = { date: string; label: string; original: number | null; current: number | null; actual: number | null };

/**
 * A goal over time: the original plan (dashed, muted), the plan in force
 * since the last recalibration (dashed), what actually happened (solid, with
 * an area) and the target. Hover shows all three for that date.
 */
export function PlanChart({
  points, target, today, height = 220, unit = "", planLabel = "Original plan",
}: { points: PlanPoint[]; target: number; today?: string; height?: number; unit?: string; planLabel?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = points.flatMap((p) => [p.original ?? 0, p.current ?? 0, p.actual ?? 0]);
  const { top, ticks } = niceScale(Math.max(target, ...values));
  const n = points.length;
  // Rounded: the compound curve's last decimals differ between server and browser maths.
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const x = (i: number) => r2(n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => r2(100 - (v / top) * 100);
  const path = (get: (p: PlanPoint) => number | null) => {
    let d = "";
    let pen = false;
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i)},${y(v)} `;
      pen = true;
    });
    return d.trim();
  };
  const actualIdx = points.map((p, i) => (p.actual !== null ? i : -1)).filter((i) => i >= 0);
  const area = actualIdx.length > 1
    ? `${path((p) => p.actual)} L${x(actualIdx[actualIdx.length - 1])},100 L${x(actualIdx[0])},100 Z`
    : "";
  const todayIdx = today ? points.findIndex((p) => p.date === today) : -1;
  const every = labelEvery(n, 3);
  const h = hover !== null ? points[hover] : null;

  // Only the lines actually drawn: a preview has just the plan.
  const series: ChartSeries[] = [
    ...(points.some((p) => p.actual !== null) ? [{ key: "actual", label: "Actual", color: "var(--chart-1)" }] : []),
    ...(points.some((p) => p.current !== null) ? [{ key: "current", label: "Plan in force", color: "var(--chart-2)" }] : []),
    { key: "original", label: planLabel, color: "var(--muted)" },
  ];

  return (
    <div className="space-y-3">
      <Legend series={series} />
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="w-10 shrink-0 pr-2 text-right text-[10px] leading-none tabular-nums text-muted">{short(t)}</span>
            <span className={`h-px flex-1 ${t === 0 ? "bg-muted/40" : "bg-border"}`} />
          </div>
        ))}
        <div className="absolute inset-y-0 left-10 right-0">
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ok/60" style={{ bottom: `${(target / top) * 100}%` }}>
            <span className="absolute -top-4 right-0 rounded bg-surface px-1 text-[10px] font-medium text-ok">Target {short(target)}{unit && ` ${unit}`}</span>
          </div>
          {todayIdx >= 0 && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-accent/40" style={{ left: `${x(todayIdx)}%` }}>
              <span className="absolute -top-1 left-1 text-[10px] font-medium text-accent">Today</span>
            </div>
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            <path d={path((p) => p.original)} fill="none" stroke="var(--muted)" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <path d={path((p) => p.current)} fill="none" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            {area && <path d={area} fill="var(--chart-1)" fillOpacity={0.12} />}
            <path d={path((p) => p.actual)} fill="none" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {h && (
            <>
              <span className="absolute inset-y-0 w-px bg-muted/40" style={{ left: `${x(hover!)}%` }} />
              <div className="absolute" style={{ left: `${x(hover!)}%`, bottom: `${100 - y(Math.max(h.actual ?? 0, h.current ?? 0, h.original ?? 0))}%` }}>
                <div className="relative">
                  <Tooltip
                    title={h.label}
                    align={hover! < n / 4 ? "left" : hover! > (n * 3) / 4 ? "right" : "center"}
                    rows={[
                      ...(h.actual !== null ? [{ label: "Actual", value: Math.round(h.actual), color: "var(--chart-1)" }] : []),
                      ...(h.current !== null ? [{ label: "Plan in force", value: Math.round(h.current), color: "var(--chart-2)" }] : []),
                      ...(h.original !== null ? [{ label: planLabel, value: Math.round(h.original), color: "var(--muted)" }] : []),
                    ]}
                  />
                </div>
              </div>
            </>
          )}
          <div className="absolute inset-0 flex" onMouseLeave={() => setHover(null)}>
            {points.map((_, i) => <div key={i} className="h-full flex-1" onMouseEnter={() => setHover(i)} />)}
          </div>
        </div>
      </div>
      <div className="relative ml-10 h-3 whitespace-nowrap text-[10px] text-muted">
        {points.map((p, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every * 0.9) && (
          <span key={i} className={`absolute ${i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${x(i)}%` }}>
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Planned against actual per period, as paired bars. The actual bar is
 * coloured by how close it came: green at or over plan, amber from 70%, red below.
 */
export function PlanBars({ rows, height = 160 }: {
  rows: { key: string; label: string; tip?: string; planned: number; actual: number | null; current?: boolean }[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { top, ticks } = niceScale(Math.max(1, ...rows.flatMap((r) => [r.planned, r.actual ?? 0])));
  const tone = (r: (typeof rows)[number]) => {
    if (r.actual === null) return "transparent";
    // Nothing planned (before the goal began): show what happened, without judging it.
    if (r.planned <= 0) return "var(--chart-1)";
    const ratio = r.planned > 0 ? r.actual / r.planned : 1;
    return ratio >= 1 ? "var(--ok)" : ratio >= 0.7 ? "var(--warn)" : "var(--danger)";
  };
  return (
    <div className="space-y-2">
      <div className="relative" style={{ height }}>
        {ticks.map((t) => (
          <div key={t} className="pointer-events-none absolute inset-x-0 flex items-center" style={{ bottom: `${(t / top) * 100}%` }}>
            <span className="w-10 shrink-0 pr-2 text-right text-[10px] leading-none tabular-nums text-muted">{short(t)}</span>
            <span className={`h-px flex-1 ${t === 0 ? "bg-muted/40" : "bg-border"}`} />
          </div>
        ))}
        <div className="absolute inset-y-0 left-10 right-0 flex items-end">
          {rows.map((r, i) => (
            <div key={r.key} className="relative flex h-full flex-1 items-end justify-center gap-0.5" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {(hover === i || r.current) && <div className={`absolute inset-y-0 inset-x-px rounded-md ${hover === i ? "bg-surface-2" : "bg-accent-soft/60"}`} />}
              <div className="relative w-[30%] max-w-4 rounded-t border border-dashed border-muted/60" style={{ height: `${(r.planned / top) * 100}%` }} />
              <div className="relative w-[30%] max-w-4 rounded-t" style={{ height: `${((r.actual ?? 0) / top) * 100}%`, background: tone(r), minHeight: r.actual ? 2 : 0 }} />
              {hover === i && (
                <Tooltip
                  title={r.tip ?? r.label}
                  align={i < rows.length / 4 ? "left" : i > (rows.length * 3) / 4 ? "right" : "center"}
                  rows={[
                    { label: "Planned", value: Math.round(r.planned), color: "var(--muted)" },
                    ...(r.actual !== null ? [{ label: "Actual", value: Math.round(r.actual), color: tone(r) }] : []),
                  ]}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-10 flex text-[10px] text-muted">
        {rows.map((r) => <span key={r.key} className={`flex-1 truncate text-center ${r.current ? "font-semibold text-accent" : ""}`}>{r.label}</span>)}
      </div>
    </div>
  );
}
