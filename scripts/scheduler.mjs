/**
 * Stand-in for a hosted cron: pings the publish endpoint every minute so
 * scheduled posts actually go out. Used by pm2 in the server deployment and by
 * `npm run scheduler` locally.
 *
 * It reads .env itself rather than relying on the process manager to inject it,
 * so it behaves the same under pm2, systemd, a bare shell or a container.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [".env.local", ".env"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Behind basic auth or a reverse proxy, tick the app port directly.
const url = process.env.SCHEDULER_TARGET_URL ?? process.env.APP_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET ?? "";

async function tick() {
  try {
    const res = await fetch(`${url}/api/cron/publish`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) {
      console.error(`scheduler tick got ${res.status} from ${url} — check SCHEDULER_TARGET_URL and CRON_SECRET`);
      return;
    }
    const json = await res.json();
    if (json.ran) console.log(new Date().toISOString(), json);
  } catch (err) {
    console.error("scheduler tick failed:", err.message);
  }
}

/**
 * Goals: reads follower counts from live channels once a day and re-plans
 * each goal every Monday. The endpoint decides what is due, so hourly is plenty.
 */
async function goalsTick() {
  try {
    const res = await fetch(`${url}/api/cron/goals`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) {
      console.error(`goals tick got ${res.status} from ${url}`);
      return;
    }
    const json = await res.json();
    if (json.recalibrated?.length || json.achieved?.length || json.followersPulled || json.failed?.length) {
      console.log(new Date().toISOString(), "goals", json);
    }
  } catch (err) {
    console.error("goals tick failed:", err.message);
  }
}

/**
 * Pages: re-visits each channel's page URL every six hours and ticks the
 * daily "confirm each page is live" activity. Hourly is plenty here too.
 */
async function pagesTick() {
  try {
    const res = await fetch(`${url}/api/cron/pages`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) {
      console.error(`pages tick got ${res.status} from ${url}`);
      return;
    }
    const json = await res.json();
    if (json.checked || json.recorded) console.log(new Date().toISOString(), "pages", json);
  } catch (err) {
    console.error("pages tick failed:", err.message);
  }
}

/**
 * Playbook: suggests posting windows from what performed. It only ever
 * suggests — people and agents decide in the daily review — so hourly is fine.
 */
async function playbookTick() {
  try {
    const res = await fetch(`${url}/api/cron/playbook`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) {
      console.error(`playbook tick got ${res.status} from ${url}`);
      return;
    }
    const json = await res.json();
    if (json.proposed?.length) console.log(new Date().toISOString(), "playbook", json);
  } catch (err) {
    console.error("playbook tick failed:", err.message);
  }
}

/**
 * Brand agents: each switched-on agent decides whether it is due (community
 * every 15 minutes, writer hourly, analyst each morning). A tick can run for a
 * few minutes, so a new one never starts while the last is still going.
 */
let agentsBusy = false;
async function agentsTick() {
  if (agentsBusy) return;
  agentsBusy = true;
  try {
    const res = await fetch(`${url}/api/cron/agents`, {
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    if (!res.ok) {
      console.error(`agents tick got ${res.status} from ${url}`);
      return;
    }
    const json = await res.json();
    if (json.ran?.length) console.log(new Date().toISOString(), "agents", JSON.stringify(json.ran));
  } catch (err) {
    console.error("agents tick failed:", err.message);
  } finally {
    agentsBusy = false;
  }
}

console.log(`scheduler watching ${url} every 60s (agents every 5 min; goals, pages and playbook hourly)`);
tick();
setInterval(tick, 60_000);
goalsTick();
setInterval(goalsTick, 60 * 60_000);
pagesTick();
setInterval(pagesTick, 60 * 60_000);
playbookTick();
setInterval(playbookTick, 60 * 60_000);
agentsTick();
setInterval(agentsTick, 5 * 60_000);
