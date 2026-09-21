/**
 * Loads scripts/data/content-ideas.txt into the content plan.
 *
 * Idempotent: an idea is matched on its problem line, so editing the file and
 * re-running updates in place rather than duplicating. Ideas already in the
 * database that are no longer in the file are left alone — deleting is your
 * call, not the seeder's.
 *
 *   npm run seed:ideas -- you@example.com
 *
 * With no email it uses the only account in the database, or asks you to pick.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { nanoid } from "nanoid";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(root, "scripts/data/content-ideas.txt");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run through `npm run seed:ideas`, which loads .env.local.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 4 });

function parse(text) {
  const out = [];
  let pillar = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("# ")) { pillar = line.slice(2).trim(); continue; }
    // Leading "12." numbering in a pasted list is positional noise; sequence
    // comes from file order so renumbering never means re-editing the text.
    const body = line.replace(/^\d+\.\s*/, "");
    const [problem, action, outcome] = body.split("→").map((s) => s.trim());
    if (!problem) continue;
    out.push({ pillar, problem, action: action ?? null, outcome: outcome ?? null });
  }
  return out;
}

const ideas = parse(fs.readFileSync(DATA, "utf8"));
if (ideas.length === 0) {
  console.error(`No ideas found in ${path.relative(root, DATA)}.`);
  await sql.end();
  process.exit(1);
}

const wanted = process.argv[2];
const accounts = wanted
  ? await sql`select id, email from users where email = ${wanted}`
  : await sql`select id, email from users order by created_at limit 2`;

if (accounts.length === 0) {
  console.error(wanted ? `No account for ${wanted}.` : "No accounts yet — sign up first, or run `npm run seed`.");
  await sql.end();
  process.exit(1);
}
if (accounts.length > 1) {
  console.error(`More than one account. Pass the one you want:\n  npm run seed:ideas -- ${accounts[0].email}`);
  await sql.end();
  process.exit(1);
}
const owner = accounts[0];

const existing = await sql`select id, problem from content_ideas where owner_id = ${owner.id}`;
const byProblem = new Map(existing.map((r) => [r.problem, r.id]));

let created = 0;
let updated = 0;
for (const [i, idea] of ideas.entries()) {
  const sequence = i + 1;
  const found = byProblem.get(idea.problem);
  if (found) {
    await sql`update content_ideas
              set sequence = ${sequence}, pillar = ${idea.pillar}, action = ${idea.action},
                  outcome = ${idea.outcome}, updated_at = now()
              where id = ${found}`;
    updated += 1;
  } else {
    await sql`insert into content_ideas (id, owner_id, sequence, pillar, problem, action, outcome)
              values (${nanoid(16)}, ${owner.id}, ${sequence}, ${idea.pillar}, ${idea.problem},
                      ${idea.action}, ${idea.outcome})`;
    created += 1;
  }
}

const pillars = [...new Set(ideas.map((i) => i.pillar).filter(Boolean))];
console.log(`${owner.email}: ${created} idea(s) created, ${updated} updated, across ${pillars.length} pillars.`);
await sql.end();
