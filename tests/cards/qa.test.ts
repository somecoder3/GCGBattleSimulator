// Cases from the official Rules Q&A (rule-qa_en.pdf) and the card FAQ (gundam-gcg.com/en/rules/faqs/), as
// of 16 Oct 2026, where the engine had decided differently before M9. The numbers are the FAQ numbers.

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
const AILE = "GD03-072"; // (Triple Ship Alliance) 3/4, Lv.4
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });
const id = (s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId => {
  const ids = s.players[p][zone].filter((x) => s.cards[x]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
};
const nos = (s: GameState, p: PlayerId, zone: ZoneName) => s.players[p][zone].map((x) => s.cards[x]!.no);
const apply = (s: GameState, a: Action) => engine.apply(s, a);
const target = (card: CardId): Action => ({ type: "target", card });
const canPlay = (s: GameState, no: string) =>
  s.pending!.options.some((o) => o.type === "playCommand" && s.cards[o.card]!.no === no);
function settle(s: GameState): void {
  for (let i = 0; i < 40 && s.pending && s.pending.kind !== "main"; i++) {
    const pick = s.pending.options.find(
      (a) => a.type === "noBlock" || a.type === "pass" || a.type === "no" || a.type === "done",
    );
    if (!pick) return;
    apply(s, pick);
  }
}

describe("targets and playing cards", () => {
  it("Q96: 'with 3 or less HP' looks at the current HP after damage", () => {
    const fresh = scenario({ p0: { hand: ["ST04-013"] }, p1: { battle: [AILE] } });
    expect(canPlay(fresh, "ST04-013")).toBe(false); // 4 HP
    const hurt = scenario({ p0: { hand: ["ST04-013"] }, p1: { battle: [{ no: AILE, damage: 1 }] } });
    expect(canPlay(hurt, "ST04-013")).toBe(true); // 4 - 1 = 3
  });

  it("Q412: 'Choose 1 of your Units and 1 enemy Unit' needs both targets to be played", () => {
    expect(canPlay(scenario({ p0: { hand: ["GD05-117"], battle: [GM] } }), "GD05-117")).toBe(false);
    expect(
      canPlay(scenario({ p0: { hand: ["GD05-117"], battle: [GM] }, p1: { battle: [GM] } }), "GD05-117"),
    ).toBe(true);
  });

  it("Q245: a Command whose effect starts with an unfulfilled condition can't be played", () => {
    const two = scenario({ p0: { hand: ["GD03-103"] }, p1: { battle: [{ no: GM, rested: true }, GM] } });
    expect(canPlay(two, "GD03-103")).toBe(false);
    const three = scenario({
      p0: { hand: ["GD03-103"] },
      p1: { battle: [{ no: GM, rested: true }, GM, GM] },
    });
    expect(canPlay(three, "GD03-103")).toBe(true);
  });

  it("Q401: only alternatives whose targets exist can be chosen", () => {
    // Wings of Light: ■bounce an enemy Unit with 5 or less HP ■a Unit recovers 3 HP. Only own Units in play.
    const s = scenario({ active: 1, p0: { hand: ["GD05-102"], battle: [GM] }, p1: { battle: [GM] } });
    apply(s, { type: "attack", unit: id(s, 1, "battle", GM), target: "player" });
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "GD05-102") });
    expect(s.pending!.prompt).toBe("option");
    expect(s.pending!.options).toHaveLength(2); // both possible: there is an enemy Unit and a Unit to heal
    const none = scenario({ active: 1, p0: { hand: ["GD05-102"] }, p1: { battle: [{ no: "GD04-022" }] } });
    apply(none, { type: "attack", unit: id(none, 1, "battle", "GD04-022"), target: "player" });
    // Kikeroga has 6 HP: no bounce target, but it can be the Unit that recovers.
    apply(none, { type: "playCommand", card: id(none, 0, "hand", "GD05-102") });
    expect(none.pending!.options).toEqual([expect.objectContaining({ type: "option", index: 1 })]);
  });
});

describe("Then, inside a condition", () => {
  it("Q233: without another (Triple Ship Alliance) Unit, Aile Strike neither draws nor discards", () => {
    const s = scenario({ p0: { hand: [AILE, GM] } });
    apply(s, { type: "deployUnit", card: id(s, 0, "hand", AILE) });
    expect(nos(s, 0, "hand")).toEqual([GM]);
    expect(s.pending!.kind).toBe("main");
  });

  it("Q175: GD02-021 draws only after the optional discard", () => {
    const s = scenario({ p0: { hand: ["GD02-021", "GD02-021"], resources: 7 } });
    apply(s, { type: "deployUnit", card: id(s, 0, "hand", "GD02-021") });
    apply(s, { type: "no" }); // don't discard
    expect(s.players[0].hand).toHaveLength(1);
  });
});

describe("triggers", () => {
  it("Q197: 'set this Unit as active' on an active Unit does not trigger or use up 【Once per Turn】", () => {
    const s = scenario({
      p0: { battle: [{ no: "GD02-002", pilot: "ST12-011" }, GM, GM] },
      p1: {
        battle: [
          { no: GM, rested: true },
          { no: GM, rested: true },
        ],
      },
    });
    const epyon = id(s, 0, "battle", "GD02-002");
    expect(engine.isLinked(s, epyon)).toBe(true); // Milliardo is also treated as [Zechs Merquise]
    apply(s, { type: "attack", unit: id(s, 0, "battle", GM), target: id(s, 1, "battle", GM) });
    settle(s);
    expect(Object.keys(s.oncePerTurn)).toEqual([]); // Epyon was active: nothing happened
    apply(s, { type: "attack", unit: epyon, target: id(s, 1, "battle", GM) });
    settle(s);
    expect(s.cards[epyon]!.rested).toBe(false); // now rested by its attack: its own kill sets it active
  });

  it("Q368: 'destroyed by an effect' means a destroy effect, not effect damage", () => {
    // Fatal Strike's 【Main】: "Choose 1 enemy Unit that is Lv.3 or lower. Destroy it." → draw 1.
    const destroyed = scenario({ active: 1, p0: { battle: ["GD05-054", GM] }, p1: { hand: ["ST05-014"] } });
    apply(destroyed, { type: "playCommand", card: id(destroyed, 1, "hand", "ST05-014") });
    settle(destroyed);
    expect(nos(destroyed, 0, "trash")).toEqual([GM]);
    expect(destroyed.players[0].hand).toHaveLength(1);
    // Close Combat deals 2 damage: destroyed by effect damage → no draw.
    const damaged = scenario({ active: 1, p0: { battle: ["GD05-054", GM] }, p1: { hand: ["ST03-013"] } });
    apply(damaged, { type: "playCommand", card: id(damaged, 1, "hand", "ST03-013") });
    if (damaged.pending?.kind === "effect") apply(damaged, target(id(damaged, 0, "battle", GM)));
    settle(damaged);
    expect(nos(damaged, 0, "trash")).toEqual([GM]);
    expect(damaged.players[0].hand).toHaveLength(0);
  });

  it("Q107: a player chooses the order of their own simultaneous effects", () => {
    // A second Murasame: both Murasame trigger on the deploy ("When one of your (Orb) Units is deployed").
    const s = scenario({ p0: { battle: ["GD05-016"], hand: ["GD05-016"], resources: 6 } });
    s.orderChoice = true;
    apply(s, { type: "deployUnit", card: id(s, 0, "hand", "GD05-016") });
    expect(s.pending!.prompt).toBe("order");
    expect(s.pending!.options.map((o) => (o.type === "option" ? o.label : ""))).toEqual([
      "Murasame",
      "Murasame (2)",
    ]);
    apply(s, s.pending!.options[1]!);
    expect(s.pending!.kind).toBe("main"); // both resolved, no second question for the last one
    for (const m of s.players[0].battle) expect(engine.keywords(s, m).highManeuver).toBe(true);
  });
});

describe("battles", () => {
  it("Q289: a Unit chosen by Destined Battle comes before a rested AGE-2 that attracts attacks", () => {
    const s = scenario({
      active: 1,
      p0: {
        battle: [
          { no: "GD03-019", rested: true, pilot: "ST01-010" },
          { no: GM, rested: true },
        ],
        hand: ["GD04-107"],
      },
      p1: { battle: [GM, GELGOOG] },
    });
    // Destined Battle in the action step of a first attack; then the next attacker must attack the GM.
    apply(s, { type: "attack", unit: id(s, 1, "battle", GM), target: id(s, 0, "battle", "GD03-019") });
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "GD04-107") });
    apply(s, target(id(s, 0, "battle", GM)));
    settle(s);
    const attacks = s.pending!.options.filter(
      (o) => o.type === "attack" && o.unit === id(s, 1, "battle", GELGOOG),
    );
    expect(attacks).toEqual([
      { type: "attack", unit: id(s, 1, "battle", GELGOOG), target: id(s, 0, "battle", GM) },
    ]);
  });

  it("Q447: in a battle started by The Final Victor, Carta's Graze Ritter gives the other Unit <First Strike>", () => {
    const s = scenario({
      p0: { hand: ["ST12-013"], resources: 6, battle: ["GD02-076"] }, // Buster 4/3
      p1: { battle: ["GD02-073"] }, // Carta's Graze Ritter 5/4
    });
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "ST12-013") });
    settle(s);
    // Buster deals 4 first and destroys Carta (4 HP) before it strikes back.
    expect(nos(s, 1, "trash")).toEqual(["GD02-073"]);
    expect(nos(s, 0, "battle")).toEqual(["GD02-076"]);
  });

  it("Q355: a non-Link Unit attacking on its deploy turn may only attack rested Units", () => {
    // GD05-030 Michaelis: may attack a rested enemy Unit on the turn it is deployed; Bridge Crew (GD03-105)
    // lets a Unit choose an active Unit without a Pilot.
    const s = scenario({ p0: { hand: ["GD05-030", "GD03-105"], resources: 8 }, p1: { battle: [GM] } });
    apply(s, { type: "deployUnit", card: id(s, 0, "hand", "GD05-030") });
    settle(s);
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "GD03-105") });
    if (s.pending!.prompt === "target") apply(s, target(id(s, 0, "battle", "GD05-030")));
    settle(s);
    const michaelis = id(s, 0, "battle", "GD05-030");
    expect(s.modifiers.some((m) => m.target === michaelis && m.flag === "attackActive")).toBe(true);
    expect(s.pending!.options.some((o) => o.type === "attack" && o.unit === michaelis)).toBe(false);
  });

  it("Q556: 'That player chooses 2 Unit cards' with only one Unit card exiles nothing", () => {
    const s = scenario({ p0: { battle: ["ST13-009"] }, p1: { trash: [GM, "GD04-107"] } });
    apply(s, { type: "attack", unit: id(s, 0, "battle", "ST13-009"), target: "player" });
    settle(s);
    expect(s.players[1].removal).toHaveLength(0);
  });
});
