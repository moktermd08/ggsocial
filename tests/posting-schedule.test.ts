import { describe, expect, it } from "vitest";
import { onSchedule, parseTimes, resolveSchedule, snapToSchedule, assertTimes } from "@/lib/posting-schedule";
import { formatsNeeded, pickFormat, versionPublishText } from "@/lib/formats";

const TZ = "Europe/London";

describe("resolveSchedule", () => {
  it("prefers the channel, then the format rule, then the post rule, then the default", () => {
    const post = { windows: "08:00-10:00, 18:00-20:00", days: "mon-fri" };
    const reel = { windows: "19:00-21:00" };
    expect(resolveSchedule({ channelSettings: { postTimes: "10:30" }, formatRule: reel, postRule: post }))
      .toMatchObject({ times: ["10:30"], source: "channel" });
    expect(resolveSchedule({ formatRule: reel, postRule: post })).toMatchObject({ times: ["19:00"], source: "format" });
    expect(resolveSchedule({ postRule: post })).toMatchObject({ times: ["08:00", "18:00"], source: "post" });
    expect(resolveSchedule({})).toMatchObject({ times: ["09:00", "13:00", "17:00"], source: "default" });
  });

  it("takes days independently of times", () => {
    const sch = resolveSchedule({ channelSettings: { postDays: "sat-sun" }, postRule: { windows: "09:00-10:00" } });
    expect([...sch.days!].sort()).toEqual([0, 6]);
    expect(sch.times).toEqual(["09:00"]);
  });
});

describe("snapToSchedule", () => {
  const sch = resolveSchedule({ channelSettings: { postTimes: "09:00, 17:00", postDays: "mon-fri" } });
  const now = new Date("2026-10-12T06:00:00Z"); // Monday 07:00 in London (BST)

  it("keeps a time that is already on the schedule", () => {
    const at = new Date("2026-10-14T08:00:00Z"); // Wed 09:00 BST
    expect(onSchedule(at, sch, TZ)).toBe(true);
    expect(snapToSchedule(at, sch, TZ, now)).toEqual(at);
  });

  it("moves an off-slot time to the next slot", () => {
    const at = new Date("2026-10-14T09:30:00Z"); // Wed 10:30 BST
    expect(snapToSchedule(at, sch, TZ, now)).toEqual(new Date("2026-10-14T16:00:00Z")); // 17:00 BST
  });

  it("skips days the channel does not post on", () => {
    const sat = new Date("2026-10-17T08:00:00Z"); // Sat 09:00 BST — right time, wrong day
    expect(snapToSchedule(sat, sch, TZ, now)).toEqual(new Date("2026-10-19T08:00:00Z")); // Mon 09:00
  });

  it("never snaps into the past", () => {
    const stale = new Date("2026-10-10T12:00:00Z");
    const out = snapToSchedule(stale, sch, TZ, now);
    expect(out.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(onSchedule(out, sch, TZ)).toBe(true);
  });
});

describe("posting times text", () => {
  it("reads and rejects", () => {
    expect(parseTimes("17:00, 9:05")).toEqual(["09:05", "17:00"]);
    expect(() => assertTimes("9am")).toThrow();
  });
});

describe("formats", () => {
  it("picks the platform's best available format", () => {
    expect(pickFormat("instagram", "social", ["post", "reel"])).toBe("reel");
    expect(pickFormat("instagram", "social", ["post"])).toBe("post");
    expect(pickFormat("tiktok", "video", ["post"])).toBeNull();
    expect(pickFormat("wordpress", "blog", ["article", "post"])).toBe("article");
  });

  it("lists what a set of channels needs, first choices first", () => {
    const need = formatsNeeded([{ platform: "instagram" }, { platform: "linkedin" }, { platform: "x" }]);
    expect(need).toContain("reel");
    expect(need).toContain("carousel");
    expect(need).toContain("thread");
    expect(need.length).toBeLessThanOrEqual(5);
  });

  it("sends a thread one post per blank line", () => {
    expect(versionPublishText({ format: "thread", body: "caption", outline: ["a", "b"] })).toBe("a\n\nb");
    expect(versionPublishText({ format: "post", body: "caption", outline: [] })).toBe("caption");
  });
});
