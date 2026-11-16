// Scenario tests for the mechanics added for the starter decks ST05–ST14, with the real card data.

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

const GM = "ST01-005"; // vanilla 2/2, Lv.2
const GELGOOG = "ST06-008"; // (Clan) 3/3, Lv.3
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });
const id = (s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId => {
  const ids = s.players[p][zone].filter((x) => s.cards[x]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
};
const nos = (s: GameState, p: PlayerId, zone: ZoneName) => s.players[p][zone].map((x) => s.cards[x]!.no);
const apply = (s: GameState, a: Action) => engine.apply(s, a);
const target = (card: CardId): Action => ({ type: "target", card });
const ap = (s: GameState, card: CardId) => engine.ap(s, card);

function play(s: GameState, no: string): void {
  const card = id(s, s.active, "hand", no);
  const type = engine.card(s, card).type;
  apply(
    s,
    type === "UNIT"
      ? { type: "deployUnit", card }
      : type === "BASE"
        ? { type: "deployBase", card }
        : { type: "playCommand", card },
  );
}
function pair(s: GameState, pilot: string, unit: CardId): void {
  apply(s, { type: "pair", card: id(s, s.active, "hand", pilot), unit });
}
function attack(s: GameState, unit: CardId, t: CardId | "player" = "player"): void {
  apply(s, { type: "attack", unit, target: t });
}
/** Answers "no block", passes and declines until the active player has a main decision. */
function settle(s: GameState): void {
  for (let i = 0; i < 30 && s.pending && s.pending.kind !== "main"; i++) {
    const pick = s.pending.options.find(
      (a) => a.type === "noBlock" || a.type === "pass" || a.type === "no" || a.type === "done",
    );
    if (!pick) return;
    apply(s, pick);
  }
}

describe("constant effects", () => {
  it("ST05-002 Barbatos 2nd Form gets AP+2 while damaged", () => {
    const s = scenario({ p0: { battle: [{ no: "ST05-002", damage: 1 }, "ST05-002"] } });
    expect(ap(s, id(s, 0, "battle", "ST05-002"))).toBe(4);
    expect(ap(s, id(s, 0, "battle", "ST05-002", 1))).toBe(2);
  });

  it("GD02-076 Buster Gundam gains <Blocker> with 5 or more AP", () => {
    const s = scenario({ p0: { battle: ["GD02-076", { no: "GD02-076", pilot: "ST06-009" }] } });
    expect(engine.keywords(s, id(s, 0, "battle", "GD02-076")).blocker).toBe(false);
    expect(engine.keywords(s, id(s, 0, "battle", "GD02-076", 1)).blocker).toBe(true);
  });

  it("ST09-004 Freedom Gundam gains <Suppression> while a friendly Base is in play", () => {
    const withBase = scenario({ p0: { battle: ["ST09-004"] } }); // EX Base
    expect(engine.keywords(withBase, id(withBase, 0, "battle", "ST09-004")).suppression).toBe(true);
    const none = scenario({ p0: { battle: ["ST09-004"], base: null } });
    expect(engine.keywords(none, id(none, 0, "battle", "ST09-004")).suppression).toBe(false);
  });

  it("ST08-001 Ξ Gundam costs 1 less per enemy Unit while you have no Unit of Lv.6 or higher", () => {
    const canDeploy = (s: GameState) => s.pending!.options.some((o) => o.type === "deployUnit");
    // Lv.9/cost 8 - 3 enemy Units = Lv.6/cost 5.
    expect(
      canDeploy(scenario({ p0: { hand: ["ST08-001"], resources: 6 }, p1: { battle: [GM, GM, GM] } })),
    ).toBe(true);
    expect(canDeploy(scenario({ p0: { hand: ["ST08-001"], resources: 6 }, p1: { battle: [GM, GM] } }))).toBe(
      false,
    );
  });

  it("ST07-015 Ptolemaios can't receive damage from enemy Units of Lv.3 or lower while a (CB) Unit is rested", () => {
    const spec = (rested: boolean): ScenarioSpec => ({
      active: 1,
      p0: { base: "ST07-015", battle: [{ no: "ST07-002", rested }] },
      p1: { battle: [GM] },
    });
    const s = scenario(spec(true));
    attack(s, id(s, 1, "battle", GM));
    settle(s);
    expect(s.cards[s.players[0].base[0]!]!.damage).toBe(0);
    const open = scenario(spec(false));
    attack(open, id(open, 1, "battle", GM));
    settle(open);
    expect(open.cards[open.players[0].base[0]!]!.damage).toBe(2);
  });

  it("ST14-001 The-O keeps the enemy's rested Units with the lowest Lv. rested", () => {
    const s = scenario({
      p0: { battle: ["ST14-001"] },
      p1: {
        battle: [
          { no: GM, rested: true },
          { no: GELGOOG, rested: true },
        ],
      },
    });
    apply(s, { type: "endMain" });
    settle(s);
    expect(s.active).toBe(1);
    expect(s.cards[id(s, 1, "battle", GM)]!.rested).toBe(true);
    expect(s.cards[id(s, 1, "battle", GELGOOG)]!.rested).toBe(false);
  });

  it("ST14-006 Full Armor Unicorn ignores battle damage from a weaker Unit once per turn while paired", () => {
    const s = scenario({
      active: 1,
      p0: { battle: [{ no: "ST14-006", rested: true, pilot: "ST14-012" }] },
      p1: { battle: [GM, GM] },
    });
    const unicorn = id(s, 0, "battle", "ST14-006");
    attack(s, id(s, 1, "battle", GM), unicorn);
    settle(s);
    expect(s.cards[unicorn]!.damage).toBe(0);
    expect(nos(s, 1, "battle")).toEqual([GM]); // the first attacker was destroyed (5 AP)
    attack(s, id(s, 1, "battle", GM), unicorn);
    settle(s);
    expect(s.cards[unicorn]!.damage).toBe(2);
  });
});

describe("triggers", () => {
  it("ST06-005 Red Gundam gives 1 to 2 (Clan) Units AP+2 when attacking", () => {
    const s = scenario({ p0: { battle: ["ST06-005", GELGOOG] } });
    attack(s, id(s, 0, "battle", "ST06-005"));
    apply(s, target(id(s, 0, "battle", GELGOOG)));
    apply(s, target(id(s, 0, "battle", "ST06-005")));
    expect(ap(s, id(s, 0, "battle", GELGOOG))).toBe(5);
    expect(ap(s, id(s, 0, "battle", "ST06-005"))).toBe(6);
  });

  it("ST06-015 Kaneban: a friendly (Clan) Unit that links gains <Breach 3>", () => {
    const s = scenario({ p0: { base: "ST06-015", battle: ["ST06-005"], hand: ["ST06-010"] } });
    pair(s, "ST06-010", id(s, 0, "battle", "ST06-005"));
    settle(s);
    expect(engine.keywords(s, id(s, 0, "battle", "ST06-005")).breach).toBe(1 + 3);
  });

  it("ST07-001 Exia draws 1 when a (CB) card is milled by its pairing", () => {
    const s = scenario({ p0: { battle: ["ST07-001"], hand: ["ST07-009"], deck: ["ST07-002", GM, GM, GM] } });
    pair(s, "ST07-009", id(s, 0, "battle", "ST07-001"));
    expect(nos(s, 0, "trash")).toEqual([GM, "ST07-002"]);
    expect(nos(s, 0, "hand")).toEqual([GM]);
    const none = scenario({ p0: { battle: ["ST07-001"], hand: ["ST07-009"], deck: [GM, GM, GM, GM] } });
    pair(none, "ST07-009", id(none, 0, "battle", "ST07-001"));
    expect(none.players[0].hand).toHaveLength(0);
  });

  it("ST08-011 Lane Aim: drawing with an effect gives a blue Unit <High-Maneuver>", () => {
    const s = scenario({ p0: { battle: [{ no: "ST08-006", pilot: "ST08-011" }], hand: ["GD01-118"] } });
    const penelope = id(s, 0, "battle", "ST08-006");
    expect(engine.keywords(s, penelope).highManeuver).toBe(false);
    play(s, "GD01-118"); // draw 2, then discard 1
    apply(s, s.pending!.options[0]!);
    settle(s);
    expect(engine.keywords(s, penelope).highManeuver).toBe(true);
  });

  it("ST10-001 Zeta Gundam (EX) is set active after breaking a Shield but can't attack the player again", () => {
    const s = scenario({ p0: { battle: ["ST10-001"] }, p1: { base: null } });
    const zeta = id(s, 0, "battle", "ST10-001");
    attack(s, zeta);
    settle(s);
    expect(s.players[1].shields).toHaveLength(5);
    expect(s.cards[zeta]!.rested).toBe(false);
    expect(s.pending!.options.some((o) => o.type === "attack" && o.unit === zeta)).toBe(false);
  });

  it("ST10-002 Zeta Gundam: Development 2 exiles two (G Generation) cards to rest an enemy Unit", () => {
    const s = scenario({
      p0: { hand: ["ST10-002"], trash: ["ST10-005", "ST10-005"] },
      p1: { battle: [GM] },
    });
    play(s, "ST10-002");
    expect(s.pending!.options.some((o) => o.type === "done")).toBe(true); // "You may"
    apply(s, target(s.players[0].trash[0]!));
    expect(s.players[0].removal).toHaveLength(2);
    expect(s.cards[id(s, 1, "battle", GM)]!.rested).toBe(true);
  });

  it("ST12-001 Epyon: its effect damage that destroys Units triggers again", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST12-001", pilot: "ST12-011" }] },
      p1: { battle: [{ no: GM, rested: true }, { no: GELGOOG, damage: 1 }, "ST05-002"] },
    });
    attack(s, id(s, 0, "battle", "ST12-001"), id(s, 1, "battle", GM));
    settle(s);
    // GM by battle; Gelgoog (1+2) by the effect; that kill deals 2 more to Barbatos (2+2 = 4 HP).
    expect(nos(s, 1, "battle")).toEqual([]);
  });

  it("ST12-003 Tallgeese III: once per turn", () => {
    const s = scenario({
      p0: { battle: ["ST12-003"] },
      p1: { battle: [{ no: GM, rested: true }, { no: GM, damage: 1 }, "ST05-002"] },
    });
    attack(s, id(s, 0, "battle", "ST12-003"), id(s, 1, "battle", GM));
    settle(s);
    expect(nos(s, 1, "battle")).toEqual(["ST05-002"]);
    expect(s.cards[id(s, 1, "battle", "ST05-002")]!.damage).toBe(1); // not a second time
  });

  it("ST13-009 Pharact: the opponent chooses 2 Unit cards in their trash to exile", () => {
    const s = scenario({ p0: { battle: ["ST13-009"] }, p1: { trash: [GM, GM, GELGOOG, "GD01-118"] } });
    attack(s, id(s, 0, "battle", "ST13-009"));
    expect(s.pending!.player).toBe(1);
    expect(s.pending!.options).toHaveLength(3); // only Unit cards
    apply(s, target(id(s, 1, "trash", GELGOOG)));
    apply(s, target(id(s, 1, "trash", GM)));
    expect(nos(s, 1, "removal").sort()).toEqual([GM, GELGOOG].sort());
  });
});

describe("commands", () => {
  it("ST07-013 Armed Intervention redirects the attack to a rested (CB) Unit", () => {
    const s = scenario({
      active: 1,
      p0: { battle: [{ no: "ST07-002", rested: true }], hand: ["ST07-013"] },
      p1: { battle: [GM] },
    });
    attack(s, id(s, 1, "battle", GM));
    apply(s, { type: "playCommand", card: id(s, 0, "hand", "ST07-013") }); // the standby player acts first
    settle(s);
    expect(s.players[0].shields).toHaveLength(6);
    expect(s.cards[id(s, 0, "battle", "ST07-002")]!.damage).toBe(2);
  });

  it("ST08-013 Lady Luck deals 2 instead of 1 with a (Mafty) Link Unit", () => {
    const plain = scenario({ p0: { hand: ["ST08-013"] }, p1: { battle: [GELGOOG] } });
    play(plain, "ST08-013");
    expect(plain.cards[id(plain, 1, "battle", GELGOOG)]!.damage).toBe(1);
    const linked = scenario({
      p0: { hand: ["ST08-013"], battle: [{ no: "ST08-002", pilot: "ST08-010" }] },
      p1: { battle: [GELGOOG] },
    });
    play(linked, "ST08-013");
    expect(linked.cards[id(linked, 1, "battle", GELGOOG)]!.damage).toBe(2);
  });

  it("ST10-014 can be played for Lv.2/cost 2 by discarding a (G Generation) Unit card", () => {
    const s = scenario({ p0: { hand: ["ST10-014", "ST10-005"], resources: 2 } });
    const alt = s.pending!.options.find((o) => o.type === "playCommand");
    expect(alt).toEqual({
      type: "playCommand",
      card: id(s, 0, "hand", "ST10-014"),
      discard: id(s, 0, "hand", "ST10-005"),
    });
    apply(s, alt!);
    expect(nos(s, 0, "trash")).toEqual(["ST10-014", "ST10-005"]);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it("ST11-015 deploys a (Marine) Unit card from the trash rested", () => {
    const s = scenario({ p0: { hand: ["ST11-015"], trash: ["ST11-001"] } });
    play(s, "ST11-015");
    expect(s.cards[id(s, 0, "battle", "ST11-001")]!.rested).toBe(true);
  });

  it("ST12-014 Wise Leader's Pride: the Unit destroys a second enemy Unit after winning its battle", () => {
    const s = scenario({
      p0: { battle: ["ST13-009"], hand: ["ST12-014"] },
      p1: { battle: [{ no: GM, rested: true }, GM] },
    });
    attack(s, id(s, 0, "battle", "ST13-009"), id(s, 1, "battle", GM));
    // Pharact's 【Attack】 has no Unit card in the enemy trash to exile.
    play(s, "ST12-014");
    settle(s);
    expect(nos(s, 1, "trash")).toEqual([GM, GM]);
  });

  it("ST13-014 Final Duty destroys an own Unit and may deploy a Unit card of Lv.4 or lower from the top 4", () => {
    const s = scenario({
      p0: { hand: ["ST13-014"], resources: 6, battle: [GM], deck: [GELGOOG, GM, GM, GM, GM] },
    });
    play(s, "ST13-014");
    expect(s.pending!.prompt).toBe("lookPick");
    apply(s, target(id(s, 0, "deck", GELGOOG)));
    expect(nos(s, 0, "battle")).toEqual([GELGOOG]);
    expect(nos(s, 0, "trash")).toContain(GM);
  });

  it("ST14-015 Battlefield Emotions places a rested Resource and sets one active", () => {
    const s = scenario({ p0: { hand: ["ST14-015"], resources: 4 } });
    play(s, "ST14-015");
    const res = s.players[0].resources;
    expect(res).toHaveLength(5);
    expect(res.filter((r) => !s.cards[r]!.rested)).toHaveLength(1);
  });
});
