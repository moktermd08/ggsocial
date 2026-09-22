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

console.log(`scheduler watching ${url} every 60s (goals hourly)`);
tick();
setInterval(tick, 60_000);
goalsTick();
setInterval(goalsTick, 60 * 60_000);
