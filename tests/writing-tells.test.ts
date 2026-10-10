import { describe, expect, it } from "vitest";
import { aiTellsIn } from "@/lib/playbook/writing-tells";

describe("aiTellsIn", () => {
  it("passes plain copy", () => {
    expect(aiTellsIn("We ran out of oat milk at 8am, so we wrote the order sheet down the night before.")).toEqual([]);
  });
  it("flags stock phrases in any case, as whole words only", () => {
    expect(aiTellsIn("Let's DELVE into it")).toContain('"delve"');
    expect(aiTellsIn("A seamless fix")).toContain('"seamless"');
    expect(aiTellsIn("The seamstress finished")).toEqual([]);
  });
  it("flags engagement bait", () => {
    expect(aiTellsIn("We lost the client. Let that sink in.")).toContain('"let that sink in"');
    expect(aiTellsIn("Read that again.")).toContain('"read that again"');
    expect(aiTellsIn("Say goodbye to spreadsheets")).toContain('"say goodbye to"');
  });
  it("flags the not-just turn", () => {
    expect(aiTellsIn("It isn't just a tool, it's a mindset")).toContain(`"not just X, it's Y" turn`);
  });
  it("allows two em dashes and flags a third", () => {
    expect(aiTellsIn("a — b — c")).toEqual([]);
    expect(aiTellsIn("a — b — c — d")).toContain("3 em dashes");
  });
});
