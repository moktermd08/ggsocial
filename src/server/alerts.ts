import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db, activity, brands, memberships, users } from "@/lib/db";

/**
 * Email to a brand's owners and admins when something needs a person and
 * nobody is watching the screen: a post that ran out of retries, a channel
 * that needs reconnecting, an agent run stopped for a safety reason.
 *
 * Sent through Resend (RESEND_API_KEY, ALERT_FROM). Without a key it does
 * nothing. It never throws, because an alert is never the reason the work it
 * reports on fails. The same alert is not sent twice inside the quiet window.
 */

export type AlertKind = "post_failed" | "post_interrupted" | "channel_reconnect" | "run_stopped";

export type Alert = {
  brandId: string;
  kind: AlertKind;
  /** What it is about; with the kind, this is what makes two alerts "the same". */
  key: string;
  subject: string;
  lines: string[];
  /** App path the email links to, e.g. "/review". */
  path: string;
};

const QUIET_MS = 12 * 60 * 60 * 1000;
const API = "https://api.resend.com/emails";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function recipients(brandId: string): Promise<string[]> {
  const rows = await db
    .select({ email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.brandId, brandId), inArray(memberships.role, ["owner", "admin"])));
  return [...new Set(rows.map((r) => r.email).filter(Boolean))];
}

export async function sendAlert(alert: Alert): Promise<"sent" | "skipped"> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.ALERT_FROM;
    if (!apiKey || !from) return "skipped";

    const id = `${alert.kind}:${alert.key}`;
    const recent = await db.query.activity.findFirst({
      where: and(
        eq(activity.action, "alert.sent"), eq(activity.entity, "alert"), eq(activity.entityId, id),
        gt(activity.createdAt, new Date(Date.now() - QUIET_MS)),
      ),
    });
    if (recent) return "skipped";

    const to = await recipients(alert.brandId);
    if (to.length === 0) return "skipped";
    const brand = await db.query.brands.findFirst({ where: eq(brands.id, alert.brandId), columns: { name: true } });
    const link = `${(process.env.APP_URL ?? "").replace(/\/$/, "")}${alert.path}`;
    const subject = `[${brand?.name ?? "ggsocial"}] ${alert.subject}`;

    const res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, subject,
        text: [...alert.lines, "", link].join("\n"),
        html: `${alert.lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${esc(link)}">Open in ggsocial</a></p>`,
      }),
    });
    if (!res.ok) {
      console.error("Alert email was refused", res.status, await res.text().catch(() => ""));
      return "skipped";
    }
    await db.insert(activity).values({
      brandId: alert.brandId, action: "alert.sent", entity: "alert", entityId: id,
      meta: { kind: alert.kind, subject, recipients: to.length },
    });
    return "sent";
  } catch (err) {
    console.error("Could not send alert", err);
    return "skipped";
  }
}
