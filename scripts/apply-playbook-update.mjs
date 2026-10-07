#!/usr/bin/env node
/**
 * Applies a playbook update file (scripts/playbook-updates/*.json) to the live
 * playbook through the agent API, so every change lands in the change log with
 * its reason, exactly as if an agent had made it.
 *
 * It never overwrites and never duplicates. For every change it reads what the
 * playbook holds right now and then:
 *   - already the wanted value / point / text / example  -> skipped
 *   - still the value the library shipped (or unset)       -> applied
 *   - anything else (someone has changed it since)         -> CONFLICT: reported, left alone
 * Nothing is written unless you pass --apply, so run it plain first and read the plan.
 *
 *   GGSOCIAL_TOKEN=ggs_… node scripts/apply-playbook-update.mjs scripts/playbook-updates/<file>.json
 *   GGSOCIAL_TOKEN=ggs_… node scripts/apply-playbook-update.mjs <file>.json --apply
 *
 * The token's owner must be a brand admin (or approver on the brand) for
 * changes to apply; otherwise they are saved as suggestions for the daily review.
 * GGSOCIAL_URL overrides the server (default https://ggsocial.gglink.co.uk).
 */
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const APPLY = args.includes("--apply");
const BASE = (process.env.GGSOCIAL_URL || "https://ggsocial.gglink.co.uk").replace(/\/$/, "");
const TOKEN = process.env.GGSOCIAL_TOKEN;
if (TOKEN && !/^ggs_[A-Za-z0-9_-]+$/.test(TOKEN)) {
  console.error("GGSOCIAL_TOKEN must be your real agent token (ggs_ followed by letters and digits), not a placeholder.");
  process.exit(1);
}
if (!file || !TOKEN) {
  console.error("Usage: GGSOCIAL_TOKEN=ggs_… node scripts/apply-playbook-update.mjs <update.json> [--apply]");
  process.exit(1);
}
const spec = JSON.parse(readFileSync(file, "utf8"));

async function call(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-Agent-Token": TOKEN, "Content-Type": "application/json", ...init.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const newId = () => randomBytes(4).toString("hex");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const playbook = await call("/api/agent/playbook?brand=all");
const brands = playbook.brands;
if (brands.some((b) => b.rules.some((r) => r.humanOnlyChecklist === undefined || r.masterInstructions === undefined))) {
  console.error("The server is running an older build that does not report people-only points and the master's own instructions. Deploy this commit first: without them an update could overwrite what it cannot see.");
  process.exit(1);
}

/** The rule as one scope sees it, or a reason it cannot be read. */
function view(scope, ruleCode) {
  if (scope === "master") {
    const rules = brands.map((b) => b.rules.find((r) => r.code === ruleCode)).filter(Boolean);
    if (!rules.length) return { error: `rule "${ruleCode}" is not enabled on any brand you can reach` };
    return { master: true, rules };
  }
  const brand = brands.find((b) => b.slug === scope);
  if (!brand) return { error: `no brand "${scope}" (you can reach: ${brands.map((b) => b.slug).join(", ")})` };
  const rule = brand.rules.find((r) => r.code === ruleCode);
  if (!rule) return { error: `rule "${ruleCode}" is switched off for ${scope}` };
  return { master: false, rule };
}

/** The master's own limit value: read from a brand that has not changed it. null = cannot tell. */
function masterLimit(rules, key) {
  const clean = rules.find((r) => !r.changedForThisBrand.includes(key));
  return clean ? { value: clean.limits[key] } : null;
}

/** Master checklist, read from the brands: only trusted when every brand shows the same list. */
function masterChecklist(rules) {
  const flat = (r) => [...r.checklist.map((i) => ({ ...i, for: "all" })), ...r.humanOnlyChecklist.map((i) => ({ ...i, for: "human" }))];
  const first = flat(rules[0]);
  const alike = rules.every((r) => same(flat(r).map((i) => [i.id, i.text]).sort(), first.map((i) => [i.id, i.text]).sort()));
  return alike ? first : null;
}

const plan = [];
const add = (status, change, text, post) => plan.push({ status, change, text, post });
const label = (c) => `${c.scope} · ${c.rule}`;

for (const c of spec.changes) {
  const v = view(c.scope, c.rule);
  if (v.error) { add("conflict", c, `${label(c)}: ${v.error}`); continue; }
  const post = (field, value) => ({ brand: c.scope, rule: c.rule, field, value, reason: c.reason, apply: true });

  if (c.op === "limits") {
    for (const [key, spec0] of Object.entries(c.set)) {
      // A value can come from the environment, for terms that must not sit in the repo.
      let to = spec0.to && typeof spec0.to === "object" ? process.env[spec0.to.env] : spec0.to;
      if (to === undefined || to === "") { add("conflict", c, `${label(c)}: ${key} — set ${spec0.to?.env} to its value, then run again`); continue; }
      if ((key === "bannedPhrases" || key === "blockedTerms") && typeof to === "string") to = to.split(",").map((t) => t.trim()).filter(Boolean).join(", ");
      const want = { ...spec0, to };
      let current;
      if (v.master) {
        const m = masterLimit(v.rules, key);
        if (!m) { add("conflict", c, `${label(c)}: ${key} — every brand has its own value, so the master's cannot be read`); continue; }
        current = m.value;
      } else current = v.rule.limits[key];
      if (same(current, want.to) || (want.to === null && current === undefined)) { add("skip", c, `${label(c)}: ${key} already ${JSON.stringify(want.to)}`); continue; }
      if (current === undefined || want.from.includes(current)) {
        add("apply", c, `${label(c)}: ${key} ${current === undefined ? "unset" : JSON.stringify(current)} → ${spec0.to && typeof spec0.to === "object" ? "(from " + spec0.to.env + ")" : JSON.stringify(want.to)}`, post(key, want.to));
      } else {
        add("conflict", c, `${label(c)}: ${key} is ${JSON.stringify(current)}, not the library's ${JSON.stringify(want.from)} — someone changed it; wanted ${JSON.stringify(want.to)}`);
      }
    }
  }

  if (c.op === "points-append") {
    const have = v.master ? masterChecklist(v.rules) : [...v.rule.checklist, ...v.rule.humanOnlyChecklist];
    if (!have) { add("conflict", c, `${label(c)}: brands show different checklists, so the master's cannot be read`); continue; }
    const seen = new Set(have.map((i) => norm(i.text)));
    for (const p of c.points) {
      if (seen.has(norm(p))) add("skip", c, `${label(c)}: point already there — "${p}"`);
      else add("apply", c, `${label(c)}: + "${p}"`, post("checklist.add", { text: p }));
    }
  }

  if (c.op === "points-replace") {
    const have = v.master ? masterChecklist(v.rules) : [
      ...v.rule.checklist.map((i) => ({ ...i, for: "all" })), ...v.rule.humanOnlyChecklist.map((i) => ({ ...i, for: "human" })),
    ];
    if (!have) { add("conflict", c, `${label(c)}: brands show different checklists, so the master's cannot be read`); continue; }
    const wanted = c.points.map(norm);
    const current = have.filter((i) => i.for !== "human").map((i) => norm(i.text));
    if (same(current, wanted)) { add("skip", c, `${label(c)}: checklist already replaced`); continue; }
    const seed = new RegExp(`^${c.rule}-\\d+$`);
    const foreign = have.filter((i) => !seed.test(i.id) && !wanted.includes(norm(i.text)));
    if (foreign.length || (c.expectCount && have.length !== c.expectCount)) {
      add("conflict", c, `${label(c)}: the checklist has been edited since the library (${have.length} points${c.expectCount ? `, expected ${c.expectCount}` : ""}${foreign.length ? `; added since: ${foreign.map((i) => `"${i.text}"`).join(", ")}` : ""}) — replacing would overwrite that. Reconcile by hand.`);
      continue;
    }
    const value = [
      ...c.points.map((text) => {
        const found = have.find((i) => i.for !== "human" && norm(i.text) === norm(text));
        return { id: found?.id ?? newId(), text, for: "all" };
      }),
      ...have.filter((i) => i.for === "human"), // a person's own checks are kept, never dropped by a rewrite
    ];
    const dropped = have.filter((i) => i.for !== "human" && !wanted.includes(norm(i.text))).map((i) => `"${i.text}"`);
    add("apply", c, `${label(c)}: replace ${dropped.length} point(s) with ${c.points.length}${have.some((i) => i.for === "human") ? ` (keeping ${have.filter((i) => i.for === "human").length} people-only point)` : ""}\n      removing: ${dropped.join("; ")}`, post("checklist", value));
  }

  if (c.op === "text-append") {
    const current = v.master ? v.rules[0].masterInstructions : v.rule.brandNotes ?? "";
    if (norm(current).includes(norm(c.text))) { add("skip", c, `${label(c)}: instructions already say this`); continue; }
    const next = current ? `${current}\n\n${c.text}` : c.text;
    if (next.length > 8000) { add("conflict", c, `${label(c)}: instructions would pass 8,000 characters`); continue; }
    add("apply", c, `${label(c)}: add to instructions — "${c.text.slice(0, 70)}…"`, post("instructions", next));
  }

  if (c.op === "examples-add") {
    const own = (v.master ? v.rules[0] : v.rule).examples.filter((e) => e.thisBrandsOwn === !v.master)
      .map((e) => ({ title: e.title, text: e.example, url: e.reference || "", why: e.whyItWorks }));
    const fresh = c.examples.filter((e) => !own.some((o) => norm(o.text) === norm(e.text)));
    for (const e of c.examples) if (!fresh.includes(e)) add("skip", c, `${label(c)}: example already there — "${e.title}"`);
    if (!fresh.length) continue;
    if (own.length + fresh.length > 12) { add("conflict", c, `${label(c)}: would pass the 12-example limit`); continue; }
    add("apply", c, `${label(c)}: + example${fresh.length > 1 ? "s" : ""} ${fresh.map((e) => `"${e.title}"`).join(", ")}`, post("examples", [...own, ...fresh.map((e) => ({ url: "", ...e }))]));
  }
}

const order = { apply: 0, skip: 1, conflict: 2 };
const icon = { apply: "APPLY   ", skip: "already ", conflict: "CONFLICT" };
console.log(`\n${spec.source} — ${APPLY ? "applying to" : "dry run against"} ${BASE}\n`);
for (const p of [...plan].sort((a, b) => order[a.status] - order[b.status])) console.log(`${icon[p.status]} ${p.text}`);
const n = (s) => plan.filter((p) => p.status === s).length;
console.log(`\n${n("apply")} to apply · ${n("skip")} already in place · ${n("conflict")} conflicts left alone`);

if (spec.needsBuild?.length) {
  console.log(`\nNot rules data, so not applied here (need building in ggsocial):`);
  for (const t of spec.needsBuild) console.log(`  - ${t}`);
}

if (!APPLY) {
  console.log("\nDry run: nothing was written. Re-run with --apply to make the changes above.");
  process.exit(0);
}

let failed = 0;
for (const p of plan.filter((x) => x.post)) {
  try {
    const r = await call("/api/agent/playbook/adjustments", { method: "POST", body: JSON.stringify(p.post) });
    console.log(`${r.status === "applied" ? "applied " : "SUGGEST "} ${p.post.brand} · ${p.post.rule} · ${p.post.field}${r.status === "applied" ? "" : ` — ${r.note}`}`);
  } catch (e) {
    if (/already the value/i.test(e.message)) { console.log(`already  ${p.post.brand} · ${p.post.rule} · ${p.post.field}`); continue; }
    failed++;
    console.log(`FAILED   ${p.post.brand} · ${p.post.rule} · ${p.post.field}: ${e.message}`);
  }
}
if (failed) process.exitCode = 1;
