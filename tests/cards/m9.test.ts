// Scenario tests for the mechanics added in M9 (every card supported), with the real card data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, CardId, GameState, PlayerId, ZoneName } from "../../src/engine/types";
import { scenario as baseScenario, type ScenarioSpec } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);

const GM = "ST01-005"; // (Earth Federation) 2/2, Lv.2
const GELGOOG = "ST06-008"; // 3/3, Lv.3
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });
const id = (s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId => {
  const ids = s.players[p][zone].filter((x) => s.cards[x]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
};
const nos = (s: GameState, p: PlayerId, zone: ZoneName) => s.players[p][zone].map((x) => s.cards[x]!.no);
const apply = (s: GameState, a: Action) => engine.apply(s, a);
const target = (card: CardId): Action => ({ type: "target", card });
const attack = (s: GameState, unit: CardId, t: CardId | "player" = "player") =>
  apply(s, { type: "attack", unit, target: t });
function settle(s: GameState): void {
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== "main"; i++) {
    const pick = s.pending.options.find(
      (a) => a.type === "noBlock" || a.type === "pass" || a.type === "no" || a.type === "done",
    );
    if (!pick) return;
    apply(s, pick);
  }
}

describe("card support", () => {
  it("every card text is fully understood", () => {
    const partial = [...lib.all()].filter((c) => c.script.status === "partial").map((c) => c.no);
    expect(partial).toEqual([]);
  });
});

describe("event triggers", () => {
  it("GD04-126 Izuma Colony deals 1 damage back to a weak attacker", () => {
    const s = scenario({ active: 1, p0: { base: "GD04-126" }, p1: { battle: [GM] } });
    attack(s, id(s, 1, "battle", GM));
    settle(s);
    expect(s.cards[s.players[0].base[0]!]!.damage).toBe(2);
    expect(s.cards[id(s, 1, "battle", GM)]!.damage).toBe(1);
  });

  it("GD04-066 Unicorn (Awakened): a Command's 【Main】 gives an enemy Unit AP-2", () => {
    const s = scenario({ p0: { battle: ["GD04-066"], hand: ["ST05-013"] }, p1: { battle: [GM] } });
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "ST05-013") });
    settle(s);
    expect(engine.ap(s, id(s, 1, "battle", GM))).toBe(0);
  });

  it("EB01-003 Narrative Gundam: at the end of the turn, resting 3 or more Units draws 1", () => {
    const s = scenario({
      p0: { battle: [{ no: "EB01-003", rested: true }, GM, GM] },
      p1: { battle: [GM] },
    });
    apply(s, { type: "endMain" });
    settle(s);
    expect(s.active).toBe(1);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.cards[id(s, 0, "battle", GM)]!.rested).toBe(true);
  });
});

describe("delayed and gained effects", () => {
  it("GD04-002 Penelope (Flight Form): during this turn, an (Earth Federation) Unit's kill rests an enemy", () => {
    const s = scenario({
      p0: { hand: ["GD04-002"], resources: 6, battle: [GM] },
      p1: { battle: [{ no: GM, rested: true }, GELGOOG] },
    });
    apply(s, { type: "deployUnit", card: id(s, 0, "hand", "GD04-002") });
    settle(s);
    attack(s, id(s, 0, "battle", GM), id(s, 1, "battle", GM));
    settle(s);
    expect(nos(s, 1, "trash")).toEqual([GM]);
    expect(s.cards[id(s, 1, "battle", GELGOOG)]!.rested).toBe(true);
  });

  it("GD06-094 Nyaan: the chosen Unit destroys an enemy Unit of Lv.4 or lower it deals battle damage to", () => {
    const s = scenario({
      p0: { battle: [GM, "ST05-002"], hand: ["GD06-094"] },
      p1: { battle: [{ no: "GD02-073", rested: true }] },
    });
    apply(s, { type: "pair", card: id(s, 0, "hand", "GD06-094"), unit: id(s, 0, "battle", GM) });
    apply(s, target(id(s, 0, "battle", "ST05-002")));
    attack(s, id(s, 0, "battle", "ST05-002"), id(s, 1, "battle", "GD02-073"));
    settle(s);
    expect(nos(s, 1, "trash")).toEqual(["GD02-073"]); // 2 damage to a 4-HP Unit
  });
});

describe("costs", () => {
  it("GD01-002 Unicorn (Destroy Mode) is deployed for free by destroying a Lv.5 'Unicorn Mode' Link Unit", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST14-007", pilot: "ST14-012" }], hand: ["GD01-002"], resources: 1 },
    });
    const alt = s.pending!.options.find((o) => o.type === "deployUnit" && o.sacrifice !== undefined);
    expect(alt).toBeDefined();
    apply(s, alt!);
    expect(nos(s, 0, "battle")).toEqual(["GD01-002"]);
    expect(nos(s, 0, "trash")).toContain("ST14-007");
    expect(s.players[0].resources.every((r) => !s.cards[r]!.rested)).toBe(true);
  });

  it("GD03-085 Christina Mackenzie pairs with Gundam NT-1 for 0", () => {
    const s = scenario({
      p0: { battle: ["GD03-001", GM], hand: ["GD03-085"], resources: 3, restedResources: 3 },
    });
    const pairs = s.pending!.options.filter((o) => o.type === "pair");
    expect(pairs).toEqual([
      { type: "pair", card: id(s, 0, "hand", "GD03-085"), unit: id(s, 0, "battle", "GD03-001") },
    ]);
  });

  it("GD04-067 ∀ Gundam gains the keywords of a Unit card in the trash", () => {
    const s = scenario({ p0: { battle: ["GD04-067"], trash: ["ST09-007"], resources: 2 } });
    const turnA = id(s, 0, "battle", "GD04-067");
    apply(s, { type: "activate", card: turnA, effect: 0 });
    expect(engine.keywords(s, turnA).blocker).toBe(true);
    expect(engine.ap(s, turnA)).toBe(5);
  });
});

describe("targets and battles", () => {
  it("GD03-110 Eliminate Target destroys a Pilot paired with an enemy Unit", () => {
    const s = scenario({
      p0: { hand: ["GD03-110"], resources: 6 },
      p1: { battle: [{ no: GM, pilot: "ST01-010" }] },
    });
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "GD03-110") });
    expect(nos(s, 1, "trash")).toEqual(["ST01-010"]);
    expect(s.cards[id(s, 1, "battle", GM)]!.pilot).toBeNull();
  });

  it("GD03-019 Gundam AGE-2 (paired, rested) must be attacked, also by Link Units", () => {
    const s = scenario({
      active: 1,
      p0: {
        battle: [
          { no: "GD03-019", rested: true, pilot: "ST01-010" },
          { no: GM, rested: true },
        ],
      },
      p1: { battle: [GM] },
    });
    const attacks = s.pending!.options.filter((o) => o.type === "attack");
    expect(attacks).toEqual([
      { type: "attack", unit: id(s, 1, "battle", GM), target: id(s, 0, "battle", "GD03-019") },
    ]);
  });

  it("GD05-055 Destiny Gundam reduces enemy battle damage by 2 once per turn", () => {
    const s = scenario({
      active: 1,
      p0: { battle: [{ no: "GD05-055", rested: true }] },
      p1: { battle: [GM, GM] },
    });
    const destiny = id(s, 0, "battle", "GD05-055");
    attack(s, id(s, 1, "battle", GM), destiny);
    settle(s);
    expect(s.cards[destiny]!.damage).toBe(0);
    attack(s, id(s, 1, "battle", GM), destiny);
    settle(s);
    expect(s.cards[destiny]!.damage).toBe(2);
  });
});
