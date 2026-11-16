import { describe, expect, it } from "vitest";
import { splitCardText } from "../../src/app/lib/cardtext";

describe("splitCardText", () => {
  it("separates timing keywords, keyword effects and text per line", () => {
    expect(splitCardText("【Deploy】Draw 1.\nThis Unit gains <Blocker>.")).toEqual([
      [
        { kind: "timing", value: "Deploy" },
        { kind: "text", value: "Draw 1." },
      ],
      [
        { kind: "text", value: "This Unit gains " },
        { kind: "keyword", value: "Blocker" },
        { kind: "text", value: "." },
      ],
    ]);
  });

  it("keeps lines without keywords as text", () => {
    expect(splitCardText("(Rest a Resource when paying a cost.)")).toEqual([
      [{ kind: "text", value: "(Rest a Resource when paying a cost.)" }],
    ]);
  });
});
