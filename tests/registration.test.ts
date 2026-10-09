import { describe, expect, it } from "vitest";
import { offHandle, registeredPlatforms, registrationPack, removedPlatforms } from "@/lib/registration";
import type { brands } from "@/lib/db/schema";

const brand = { name: "Fieldwork", tagline: "Job scheduling for trades.", website: "https://fieldwork.example" } as typeof brands.$inferSelect;
const ch = (platform: string, handle: string, archivedAt: Date | null = null) => ({ platform, handle, archivedAt });

describe("registration", () => {
  it("counts only live channels as registered", () => {
    const channels = [ch("instagram", "@fieldwork"), ch("x", "@fieldwork", new Date())];
    expect([...registeredPlatforms(channels)]).toEqual(["instagram"]);
  });
  it("treats a deliberately archived channel as removed, not missing", () => {
    const channels = [ch("x", "@fieldwork", new Date()), ch("instagram", "@fieldwork"), ch("instagram", "@old", new Date())];
    expect([...removedPlatforms(channels)]).toEqual(["x"]);
  });
  it("uses the handle most channels share and leaves empty fields out", () => {
    const pack = registrationPack(brand, [ch("instagram", "@fieldwork"), ch("x", "fieldwork")]);
    expect(pack.handle).toBe("@fieldwork");
    expect(pack.fields.map((f) => f.label)).toEqual(["Name", "Handle", "Short bio", "Website"]);
  });
  it("flags a handle that differs", () => {
    const channels = [ch("instagram", "@fieldwork"), ch("x", "@fieldwork")];
    expect(offHandle("@other", channels)).toBe(true);
    expect(offHandle("Fieldwork", channels)).toBe(false);
  });
});
