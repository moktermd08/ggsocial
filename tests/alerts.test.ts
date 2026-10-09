import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db", async () => (await import("./stubs/test-db")).makeTestDb());

import { db, users, brands, memberships, activity } from "@/lib/db";
import { sendAlert, type Alert } from "@/server/alerts";

const fetchMock = vi.fn();
let seq = 0;

async function seedBrand(roles: Array<"owner" | "admin" | "editor" | "viewer">) {
  const n = ++seq;
  const [brand] = await db.insert(brands).values({ name: `Brand ${n}`, slug: `brand-${n}` }).returning();
  const emails: string[] = [];
  for (const [i, role] of roles.entries()) {
    const email = `${role}${i}-${n}@t.test`;
    const [u] = await db.insert(users).values({ email, name: role, passwordHash: "x" }).returning();
    await db.insert(memberships).values({ userId: u.id, brandId: brand.id, role });
    emails.push(email);
  }
  return { brand, emails };
}
const alertFor = (brandId: string, over: Partial<Alert> = {}): Alert => ({
  brandId, kind: "post_failed", key: `k${++seq}`, subject: "A post failed", lines: ["It failed <b>badly</b>."], path: "/posts/p1", ...over,
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ALERT_FROM", "ggsocial <alerts@example.test>");
  vi.stubEnv("APP_URL", "https://app.example.test/");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendAlert", () => {
  it("emails the brand's owners and admins only", async () => {
    const { brand, emails } = await seedBrand(["owner", "admin", "editor", "viewer"]);
    expect(await sendAlert(alertFor(brand.id))).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(init.body);
    expect(body.to.sort()).toEqual([emails[0], emails[1]].sort());
    expect(body.subject).toBe(`[${brand.name}] A post failed`);
    expect(init.headers.Authorization).toBe("Bearer re_test");
  });

  it("links into the app and escapes the lines in the HTML", async () => {
    const { brand } = await seedBrand(["owner"]);
    await sendAlert(alertFor(brand.id));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.text).toContain("https://app.example.test/posts/p1");
    expect(body.html).toContain("&lt;b&gt;badly&lt;/b&gt;");
    expect(body.html).not.toContain("<b>");
  });

  it("does not send the same alert twice inside the quiet window", async () => {
    const { brand } = await seedBrand(["owner"]);
    const a = alertFor(brand.id, { key: "same" });
    expect(await sendAlert(a)).toBe("sent");
    expect(await sendAlert(a)).toBe("skipped");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends again once the quiet window has passed", async () => {
    const { brand } = await seedBrand(["owner"]);
    const a = alertFor(brand.id, { key: "old" });
    await sendAlert(a);
    await db.update(activity).set({ createdAt: new Date(Date.now() - 13 * 3600_000) }).where(eq(activity.entityId, "post_failed:old"));
    expect(await sendAlert(a)).toBe("sent");
  });

  it("treats a different kind or key as a different alert", async () => {
    const { brand } = await seedBrand(["owner"]);
    expect(await sendAlert(alertFor(brand.id, { key: "x" }))).toBe("sent");
    expect(await sendAlert(alertFor(brand.id, { key: "x", kind: "post_interrupted" }))).toBe("sent");
    expect(await sendAlert(alertFor(brand.id, { key: "y" }))).toBe("sent");
  });

  it("does nothing when email is not configured", async () => {
    const { brand } = await seedBrand(["owner"]);
    vi.stubEnv("RESEND_API_KEY", "");
    expect(await sendAlert(alertFor(brand.id))).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing when nobody is an owner or admin", async () => {
    const { brand } = await seedBrand(["editor", "viewer"]);
    expect(await sendAlert(alertFor(brand.id))).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not record or throw when Resend refuses, so the next try can send", async () => {
    const { brand } = await seedBrand(["owner"]);
    const a = alertFor(brand.id, { key: "refused" });
    fetchMock.mockResolvedValueOnce(new Response("bad key", { status: 401 }));
    expect(await sendAlert(a)).toBe("skipped");
    expect(await sendAlert(a)).toBe("sent");
  });

  it("does not throw when the network fails", async () => {
    const { brand } = await seedBrand(["owner"]);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    await expect(sendAlert(alertFor(brand.id))).resolves.toBe("skipped");
  });
});
