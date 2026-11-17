import { describe, expect, it } from "vitest";
import { compileSegments } from "../../src/effects/compile";
import { cleanLines, condition, nounPhrase, parseBody, parseLine, ParseError } from "../../src/effects/parse";

const ctx = { tokens: [{ no: "T-007", name: "Zaku Ⅱ", ap: 1, hp: 1 }] };
const unit = { type: "UNIT" as const };

describe("cleanLines", () => {
  it("drops reminder text and keeps keyword lines", () => {
    expect(
      cleanLines(
        "<Blocker> (Rest this Unit to change the attack target to it.)\n(This Unit can't be blocked.)\n-",
      ),
    ).toEqual(["<Blocker>"]);
    expect(
      cleanLines(
        "【Activate･Main】<Support 2> (Rest this Unit. 1 other friendly Unit gets AP+(specified amount) during this turn.)",
      ),
    ).toEqual(["【Activate･Main】<Support 2>"]);
  });
});

describe("noun phrases", () => {
  it("reads counts, sides, states, traits and qualifiers", () => {
    expect(nounPhrase("1 rested enemy Unit with 3 or less HP")).toEqual({
      count: 1,
      filter: { rested: true, side: "enemy", types: ["UNIT", "UNIT TOKEN"], hpMax: 3 },
    });
    expect(nounPhrase("all enemy Units that are Lv.3 or lower").filter).toMatchObject({
      side: "enemy",
      lvMax: 3,
    });
    expect(nounPhrase("1 of your Resources").filter).toMatchObject({ side: "friendly", zone: "resources" });
    expect(nounPhrase("1 (Zeon)/(Neo Zeon) Unit card").filter).toEqual({
      traits: ["Zeon", "Neo Zeon"],
      types: ["UNIT"],
    });
    expect(nounPhrase("1 friendly Unit with <Blocker>").filter.keyword).toBe("blocker");
    expect(nounPhrase("1 to 2 enemy Units with 2 or less HP")).toMatchObject({ count: 2, upTo: true });
    expect(nounPhrase("1 (Zeon) Unit card that is Lv.4 or lower from your trash").filter).toMatchObject({
      zone: "trash",
      side: "friendly",
      lvMax: 4,
    });
  });

  it("rejects what it does not know", () => {
    expect(() => nounPhrase("1 enemy Unit that dances")).toThrow(ParseError);
  });
});

describe("conditions", () => {
  it("reads common conditions", () => {
    expect(condition("it is your turn")).toEqual({ yourTurn: true });
    expect(condition("this Unit has 5 or more AP")).toEqual({ selfAp: { min: 5 } });
    expect(condition("3 or more enemy Units are in play")).toEqual({ count: { side: "enemy" }, min: 3 });
  });
});

describe("bodies", () => {
  it("splits at 'Then,' into independent segments (5-20-2)", () => {
    const segs = parseBody(
      "Add 1 of your Shields to your hand. Then, choose 1 enemy Unit with 5 or less AP. Deal 1 damage to it.",
      ctx,
    );
    expect(segs).toHaveLength(2);
    expect(segs[1]!.map((s) => s.op)).toEqual(["choose", "damage"]);
  });

  it("nests 'You may …. If you do, …' (5-20-1), discarding only with enough cards in the hand", () => {
    const segs = parseBody("You may discard 1. If you do, draw 2.", ctx);
    expect(segs).toEqual([
      [
        {
          op: "if",
          cond: { hand: { min: 1 }, side: "friendly" },
          then: [
            {
              op: "may",
              do: [
                { op: "discard", n: 1 },
                { op: "draw", n: 2 },
              ],
            },
          ],
        },
      ],
    ]);
  });

  it("scopes 'If …,' over the rest of the segment", () => {
    const segs = parseBody(
      "If you have another Link Unit in play, draw 1. Deal 1 damage to all enemy Units.",
      ctx,
    );
    expect(segs[0]![0]).toMatchObject({ op: "if", then: [{ op: "draw" }, { op: "all" }, { op: "damage" }] });
  });

  it("resolves tokens by name and stats", () => {
    expect(parseBody("Deploy 1 rested [Zaku Ⅱ]((Zeon)･AP1･HP1) Unit token.", ctx)).toEqual([
      [{ op: "token", no: "T-007", count: 1, rested: true }],
    ]);
  });
});

describe("lines", () => {
  it("knows triggers with Pilot qualifications and Once per Turn", () => {
    expect(parseLine("【When Paired･(White Base Team) Pilot】Draw 1.", unit, ctx)).toEqual([
      {
        kind: "trigger",
        on: "whenPaired",
        pilot: { traits: ["White Base Team"] },
        segments: [[{ op: "draw", n: 1 }]],
      },
    ]);
    expect(parseLine("【Activate･Main】【Once per Turn】④：Set this Unit as active.", unit, ctx)).toEqual([
      {
        kind: "activated",
        timing: "main",
        cost: { resources: 4 },
        once: true,
        segments: [[{ op: "ready", t: "self" }]],
      },
    ]);
  });

  it("knows Commands with both timings and constant effects", () => {
    expect(
      parseLine("【Main】/【Action】Choose 1 enemy Unit. Deal 2 damage to it.", { type: "COMMAND" }, ctx)[0],
    ).toMatchObject({
      kind: "command",
      timing: ["main", "action"],
    });
    expect(parseLine("【During Link】This Unit gets AP+1 and HP+1.", { type: "PILOT" }, ctx)).toEqual([
      { kind: "static", target: "self", ap: 1, hp: 1, cond: { selfLinked: true } },
    ]);
  });
});

describe("compile", () => {
  it("jumps past the rest of a segment when a choice fails and over else-branches", () => {
    const code = compileSegments([
      [
        { op: "choose", filter: {}, as: "t" },
        { op: "rest", t: "t" },
      ],
      [{ op: "if", cond: { yourTurn: true }, then: [{ op: "draw", n: 1 }], else: [{ op: "discard", n: 1 }] }],
    ]);
    expect(code.map((i) => i.op)).toEqual(["choose", "rest", "jumpUnless", "draw", "jump", "discard"]);
    expect(code[0]).toMatchObject({ fail: 2 });
    expect(code[2]).toMatchObject({ to: 5 });
    expect(code[4]).toMatchObject({ to: 6 });
  });
});
