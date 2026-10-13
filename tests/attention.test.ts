import { describe, expect, it } from "vitest";
import { emptyDays, explainError, headline, inWords, isSafetyStop, rankAttention, replySeverity, reviewSeverity } from "@/lib/attention";

const now = new Date("2026-10-13T09:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3_600_000);

describe("explainError", () => {
  it("treats a revoked token as a sign-in problem even when the text also says rate limit", () => {
    const e = explainError("Rate limit exceeded; X rejected the last 3 requests (401 Unauthorized)");
    expect(e.cause).toBe("auth");
    expect(e.fix).toBe("reconnect");
  });
  it("tells an AI key problem apart from a platform sign-in", () => {
    expect(explainError("Anthropic API 401: invalid x-api-key").cause).toBe("ai_key");
  });
  it("lets a pure rate limit retry by itself", () => {
    expect(explainError("429 Too Many Requests").fix).toBe("wait");
  });
  it("warns that a 5xx may already have posted", () => {
    expect(explainError("502 Bad Gateway").text).toMatch(/may have posted/);
  });
  it("never returns an empty explanation", () => {
    expect(explainError(null).text.length).toBeGreaterThan(5);
  });
});

describe("replySeverity", () => {
  const base = { priority: "normal", reach: 50, sentiment: "neutral" };
  it("is now for a late complaint or a big account", () => {
    expect(replySeverity({ ...base, dueAt: h(-1), sentiment: "negative" }, now)).toBe("now");
    expect(replySeverity({ ...base, dueAt: h(-1), reach: 4000 }, now)).toBe("now");
  });
  it("is today for an ordinary late reply and a late lead is now", () => {
    expect(replySeverity({ ...base, dueAt: h(-1) }, now)).toBe("today");
    expect(replySeverity({ ...base, dueAt: h(-1), kind: "lead" }, now)).toBe("now");
  });
  it("does not interrupt for work that is not due", () => {
    expect(replySeverity({ ...base, dueAt: h(10) }, now)).toBeNull();
    expect(replySeverity({ ...base, priority: "high", dueAt: h(2) }, now)).toBe("today");
  });
});

describe("reviewSeverity", () => {
  it("is now for a safety stop or a slot within six hours", () => {
    expect(reviewSeverity({ safety: true, waitingSince: h(-1), slotAt: null }, now)).toBe("now");
    expect(reviewSeverity({ safety: false, waitingSince: h(-1), slotAt: h(3) }, now)).toBe("now");
  });
  it("escalates with waiting time", () => {
    expect(reviewSeverity({ safety: false, waitingSince: h(-1), slotAt: h(30) }, now)).toBe("soon");
    expect(reviewSeverity({ safety: false, waitingSince: h(-5), slotAt: h(30) }, now)).toBe("today");
  });
  it("calls only non-routine reasons safety stops", () => {
    expect(isSafetyStop(["review is on for this step"])).toBe(false);
    expect(isSafetyStop(["review is on for this step", "Reviewer flagged: legal claim"])).toBe(true);
  });
});

describe("rankAttention", () => {
  it("orders by severity, then oldest first, and puts undated last", () => {
    const out = rankAttention([
      { id: "a", severity: "today" as const, since: h(-9) },
      { id: "b", severity: "now" as const, since: null },
      { id: "c", severity: "now" as const, since: h(-2) },
      { id: "d", severity: "now" as const, since: h(-8) },
    ]);
    expect(out.map((x) => x.id)).toEqual(["d", "c", "b", "a"]);
  });
});

describe("headline and words", () => {
  it("does not double count problems", () => {
    expect(headline({ now: 6, today: 2, wrong: 3 }).text).toBe("6 things need you now (3 went wrong), 2 more today.");
    expect(headline({ now: 1, today: 0, wrong: 0 }).text).toBe("1 thing needs you now.");
  });
  it("says all clear only when nothing is waiting", () => {
    expect(headline({ now: 0, today: 0, wrong: 0 }).tone).toBe("ok");
    expect(headline({ now: 0, today: 2, wrong: 0 }).tone).toBe("warn");
  });
  it("speaks in hours and days", () => {
    expect(inWords(h(8), now)).toBe("in 8h");
    expect(inWords(h(-30), now)).toBe("30h ago");
  });
  it("counts days with nothing booked", () => {
    expect(emptyDays([h(2), h(30)], now, 7)).toBe(5);
  });
});
