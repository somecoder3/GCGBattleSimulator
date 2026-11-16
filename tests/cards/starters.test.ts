// One scenario per card with effects in the starter decks ST01–ST04, with the real card data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { RandomPolicy } from "../../src/ai/random";
import { CardLib } from "../../src/engine/cardlib";
import { validateDeck } from "../../src/engine/deck";
import { Engine } from "../../src/engine/engine";
import { checkInvariants } from "../../src/engine/invariants";
import type { Action, CardId, GameState, PlayerId, ZoneName } from "../../src/engine/types";
import { playMatch } from "../../src/sim/match";
import { scenario as baseScenario, type ScenarioSpec } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);

const GM = "ST01-005"; // vanilla 2/2, Lv.2
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });

const id = (s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId => {
  const ids = s.players[p][zone].filter((x) => s.cards[x]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
};
const nos = (s: GameState, p: PlayerId, zone: ZoneName) => s.players[p][zone].map((x) => s.cards[x]!.no);
const apply = (s: GameState, a: Action) => engine.apply(s, a);
const target = (card: CardId): Action => ({ type: "target", card });

/** Plays a card from the hand of the active player (Unit, Base or Command). */
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
/** Answers "no block" and passes in action steps until the active player has a main decision. */
function settle(s: GameState): void {
  for (let i = 0; i < 20 && s.pending && s.pending.kind !== "main"; i++) {
    const o = s.pending.options;
    const pick = o.find(
      (a) => a.type === "noBlock" || a.type === "pass" || a.type === "no" || a.type === "done",
    );
    if (!pick) return;
    apply(s, pick);
  }
}
const ap = (s: GameState, card: CardId) => engine.ap(s, card);

describe("starter deck lists", () => {
  it("are legal 50-card decks", () => {
    for (const d of STARTER_DECKS) expect(validateDeck(lib, d.deck), d.id).toEqual([]);
  });

  it("use only cards the engine fully understands", () => {
    for (const d of STARTER_DECKS) {
      for (const no of new Set(d.deck.main)) expect(lib.get(no).script.status, no).not.toBe("partial");
    }
  });

  it("play 100 games per pairing with all invariants", () => {
    let seed = 1;
    for (const a of STARTER_DECKS) {
      for (const b of STARTER_DECKS) {
        for (let g = 0; g < 25; g++, seed++) {
          const record = playMatch(
            engine,
            [a.deck, b.deck],
            { seed, firstPlayer: (g % 2) as PlayerId },
            [new RandomPolicy(seed), new RandomPolicy(seed + 9)],
            {
              onStep: (state) => {
                const errors = checkInvariants(engine, state, [60, 60]);
                if (errors.length) throw new Error(`${a.id} vs ${b.id}, seed ${seed}: ${errors.join("; ")}`);
              },
            },
          );
          expect(record.result.winner === null ? record.result.reason : "won").not.toBe("turnLimit");
        }
      }
    }
  });
});

describe("ST01 Heroic Beginnings", () => {
  it("ST01-001 Gundam: while paired, all your Units get AP+1 during your turn", () => {
    const s = scenario({ p0: { battle: [{ no: "ST01-001", pilot: "ST01-010" }, GM] }, p1: { battle: [GM] } });
    expect(ap(s, id(s, 0, "battle", GM))).toBe(3);
    expect(ap(s, id(s, 0, "battle", "ST01-001"))).toBe(3 + 2 + 1);
    const opp = scenario({ active: 1, p0: { battle: [{ no: "ST01-001", pilot: "ST01-010" }, GM] } });
    expect(ap(opp, id(opp, 0, "battle", GM))).toBe(2);
    const unpaired = scenario({ p0: { battle: ["ST01-001", GM] } });
    expect(ap(unpaired, id(unpaired, 0, "battle", GM))).toBe(2);
  });

  it("ST01-002 Gundam (MA Form): draws when a (White Base Team) Pilot is paired", () => {
    const s = scenario({ p0: { battle: ["ST01-002", "ST01-002"], hand: ["ST01-010", "ST01-011"] } });
    pair(s, "ST01-010", id(s, 0, "battle", "ST01-002"));
    expect(s.players[0].hand).toHaveLength(2); // played one, drew one
    pair(s, "ST01-011", id(s, 0, "battle", "ST01-002", 1));
    expect(s.players[0].hand).toHaveLength(1); // Suletta is (Academy): no draw
  });

  it("ST01-004 Guntank: rests an enemy Unit with 2 or less HP", () => {
    const s = scenario({ p0: { hand: ["ST01-004"] }, p1: { battle: [GM, "ST01-003"] } });
    play(s, "ST01-004");
    expect(s.cards[id(s, 1, "battle", GM)]!.rested).toBe(true);
    expect(s.cards[id(s, 1, "battle", "ST01-003")]!.rested).toBe(false);
  });

  it("ST01-006 Aerial (Permet Score Six): gives an enemy Unit Lv.5 or lower AP-3 when paired", () => {
    const s = scenario({ p0: { battle: ["ST01-006"], hand: ["ST01-011"] }, p1: { battle: ["ST01-003"] } });
    pair(s, "ST01-011", id(s, 0, "battle", "ST01-006"));
    expect(ap(s, id(s, 1, "battle", "ST01-003"))).toBe(0);
    apply(s, { type: "endMain" });
    expect(ap(s, id(s, 1, "battle", "ST01-003"))).toBe(2);
  });

  it("ST01-009 Zowort: <Blocker> but can't attack the player", () => {
    const s = scenario({ p0: { battle: ["ST01-009"] }, p1: { battle: [{ no: GM, rested: true }] } });
    const targets = s.pending!.options.flatMap((o) => (o.type === "attack" ? [o.target] : []));
    expect(targets).toEqual([id(s, 1, "battle", GM)]);
    expect(engine.keywords(s, id(s, 0, "battle", "ST01-009")).blocker).toBe(true);
  });

  it("ST01-010 Amuro Ray: rests an enemy Unit with 5 or less HP when paired; Burst adds it to the hand", () => {
    const s = scenario({
      p0: { battle: [GM], hand: ["ST01-010"] },
      p1: { battle: ["ST01-003", "ST02-001"] },
    });
    pair(s, "ST01-010", id(s, 0, "battle", GM));
    // Guncannon (4 HP) and Wing Gundam (5 HP) both qualify, so the player chooses.
    expect(s.pending?.prompt).toBe("target");
    apply(s, target(id(s, 1, "battle", "ST02-001")));
    expect(s.cards[id(s, 1, "battle", "ST02-001")]!.rested).toBe(true);

    const b = scenario({ p0: { battle: [GM] }, p1: { base: null, shields: ["ST01-010"] } });
    attack(b, id(b, 0, "battle", GM));
    expect(b.pending).toMatchObject({ player: 1, prompt: "burst" });
    apply(b, { type: "yes" });
    expect(nos(b, 1, "hand")).toEqual(["ST01-010"]);
    expect(b.players[1].trash).toHaveLength(0);
  });

  it("ST01-011 Suletta Mercury: on attack, once per turn, sets a rested Resource active without asking", () => {
    const s = scenario({ p0: { battle: [{ no: GM, pilot: "ST01-011" }], restedResources: 5 } });
    attack(s, id(s, 0, "battle", GM));
    expect(s.pending?.kind).not.toBe("effect");
    settle(s);
    expect(s.players[0].resources.filter((r) => !s.cards[r]!.rested)).toHaveLength(1);
  });

  it("ST01-012 Thoroughly Damaged: needs a rested enemy Unit and deals 1 damage", () => {
    const none = scenario({ p0: { hand: ["ST01-012"] }, p1: { battle: [GM] } });
    expect(none.pending!.options.some((o) => o.type === "playCommand")).toBe(false);
    const s = scenario({ p0: { hand: ["ST01-012"] }, p1: { battle: [{ no: GM, rested: true }] } });
    play(s, "ST01-012");
    expect(s.cards[id(s, 1, "battle", GM)]!.damage).toBe(1);
    expect(nos(s, 0, "trash")).toEqual(["ST01-012"]);
  });

  it("ST01-012 as Pilot: [Hayato Kobayashi] links Guntank", () => {
    const s = scenario({ p0: { battle: ["ST01-004"], hand: ["ST01-012"] } });
    pair(s, "ST01-012", id(s, 0, "battle", "ST01-004"));
    expect(engine.isLinked(s, id(s, 0, "battle", "ST01-004"))).toBe(true);
  });

  it("ST01-013 Kai's Resolve: a friendly Unit recovers 3 HP", () => {
    const s = scenario({ p0: { hand: ["ST01-013"], battle: [{ no: "ST01-003", damage: 3 }] } });
    play(s, "ST01-013");
    expect(s.cards[id(s, 0, "battle", "ST01-003")]!.damage).toBe(0);
  });

  it("ST01-014 Unforeseen Incident: AP-3 in an action step; the Burst runs its 【Main】", () => {
    const s = scenario({
      p0: { battle: ["ST01-003"] },
      p1: { hand: ["ST01-014"], battle: [{ no: GM, rested: true }] },
    });
    attack(s, id(s, 0, "battle", "ST01-003"), id(s, 1, "battle", GM));
    expect(s.pending).toMatchObject({ player: 1, kind: "action" });
    apply(s, { type: "playCommand", card: id(s, 1, "hand", "ST01-014") });
    // Guncannon (2 AP) now has 0 AP: the GM survives, Guncannon takes 2.
    settle(s);
    expect(s.players[1].battle).toHaveLength(1);
    expect(s.cards[id(s, 0, "battle", "ST01-003")]!.damage).toBe(2);

    const b = scenario({ p0: { battle: ["ST01-003"] }, p1: { base: null, shields: ["ST01-014"] } });
    attack(b, id(b, 0, "battle", "ST01-003"));
    apply(b, { type: "yes" });
    expect(ap(b, id(b, 0, "battle", "ST01-003"))).toBe(0);
    expect(nos(b, 1, "trash")).toEqual(["ST01-014"]);
  });

  it("ST01-015 White Base: Burst deploys it, it adds a Shield to the hand, ② deploys a token by Unit count", () => {
    const b = scenario({ p0: { battle: [GM] }, p1: { base: null, shields: ["ST01-015", GM] } });
    attack(b, id(b, 0, "battle", GM));
    apply(b, { type: "yes" });
    expect(nos(b, 1, "base")).toEqual(["ST01-015"]);
    expect(nos(b, 1, "hand")).toEqual([GM]);

    const s = scenario({ p0: { base: "ST01-015", battle: [] } });
    apply(s, { type: "activate", card: id(s, 0, "base", "ST01-015"), effect: 2 });
    expect(nos(s, 0, "battle")).toEqual(["T-001"]);
    expect(s.pending!.options.some((o) => o.type === "activate")).toBe(false); // once per turn
    const two = scenario({ p0: { base: "ST01-015", battle: [GM, GM] } });
    apply(two, { type: "activate", card: id(two, 0, "base", "ST01-015"), effect: 2 });
    expect(nos(two, 0, "battle")).toContain("T-003");
  });

  it("ST01-016 Asticassia: rest it for AP+1 to all friendly Link Units", () => {
    const s = scenario({ p0: { base: "ST01-016", battle: [{ no: "ST01-007", pilot: "ST01-011" }, GM] } });
    apply(s, { type: "activate", card: id(s, 0, "base", "ST01-016"), effect: 2 });
    expect(ap(s, id(s, 0, "battle", "ST01-007"))).toBe(3 + 1 + 1);
    expect(ap(s, id(s, 0, "battle", GM))).toBe(2);
  });
});

describe("ST02 Wings of Advance", () => {
  it("ST02-001 Wing Gundam: may attack active enemy Units Lv.4 or lower; <Breach 5>", () => {
    const s = scenario({ p0: { battle: ["ST02-001"] }, p1: { battle: [GM, "ST02-006"] } });
    const targets = s.pending!.options.flatMap((o) => (o.type === "attack" ? [o.target] : []));
    expect(targets).toEqual(["player", id(s, 1, "battle", GM)]);
    attack(s, id(s, 0, "battle", "ST02-001"), id(s, 1, "battle", GM));
    settle(s);
    expect(s.players[1].base).toHaveLength(0); // 5 Breach damage destroy the EX Base
  });

  it("ST02-002 Wing Gundam (Bird Mode): places an EX Resource", () => {
    const s = scenario({ p0: { hand: ["ST02-002"] } });
    play(s, "ST02-002");
    expect(nos(s, 0, "resources")).toContain("EXR-001");
  });

  it("ST02-003 Heavyarms: when paired and destroying a Unit, 1 damage to all enemy Units Lv.3 or lower", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST02-003", pilot: "ST02-010" }] },
      p1: { battle: [{ no: GM, rested: true }, "ST02-009", "ST02-006"] },
    });
    attack(s, id(s, 0, "battle", "ST02-003"), id(s, 1, "battle", GM));
    settle(s);
    expect(nos(s, 1, "battle")).toEqual(["ST02-006"]); // Tragos (Lv.1, 1 HP) destroyed, Tallgeese (Lv.5) untouched
  });

  it("ST02-006 Tallgeese: ④ sets it active once per turn", () => {
    const s = scenario({ p0: { battle: [{ no: "ST02-006", rested: true }], resources: 6 } });
    apply(s, { type: "activate", card: id(s, 0, "battle", "ST02-006"), effect: 0 });
    expect(s.cards[id(s, 0, "battle", "ST02-006")]!.rested).toBe(false);
  });

  it("ST02-010 Heero Yuy: linked Unit gets AP+1 and HP+1", () => {
    const s = scenario({
      p0: {
        battle: [
          { no: "ST02-001", pilot: "ST02-010" },
          { no: "ST02-004", pilot: "ST02-010" },
        ],
      },
    });
    expect([ap(s, id(s, 0, "battle", "ST02-001")), engine.hp(s, id(s, 0, "battle", "ST02-001"))]).toEqual([
      4 + 2 + 1,
      5 + 1 + 1,
    ]);
    expect(ap(s, id(s, 0, "battle", "ST02-004"))).toBe(4 + 2); // Sandrock links with Quatre, not Heero
  });

  it("ST02-011 Zechs Merquise: linked Unit draws when it destroys an enemy Unit", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST02-006", pilot: "ST02-011" }] },
      p1: { battle: [{ no: GM, rested: true }] },
    });
    attack(s, id(s, 0, "battle", "ST02-006"), id(s, 1, "battle", GM));
    settle(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it("ST02-012 Simultaneous Fire: gives <Breach 3> this turn", () => {
    const s = scenario({
      p0: { hand: ["ST02-012"], battle: ["ST02-005"] },
      p1: { battle: [{ no: GM, rested: true }] },
    });
    play(s, "ST02-012");
    expect(engine.keywords(s, id(s, 0, "battle", "ST02-005")).breach).toBe(3);
    attack(s, id(s, 0, "battle", "ST02-005"), id(s, 1, "battle", GM));
    settle(s);
    expect(s.players[1].base).toHaveLength(0);
  });

  it("ST02-013 Peaceful Timbre: shield area cards take no damage from Lv.4 or lower Units this battle", () => {
    const s = scenario({ p0: { battle: ["ST02-005"] }, p1: { hand: ["ST02-013"], base: null } });
    attack(s, id(s, 0, "battle", "ST02-005"));
    apply(s, { type: "playCommand", card: id(s, 1, "hand", "ST02-013") });
    settle(s);
    expect(s.players[1].shields).toHaveLength(6);
  });

  it("ST02-014 Siege Ploy: rests an enemy Unit with 5 or less HP", () => {
    const s = scenario({ p0: { hand: ["ST02-014"] }, p1: { battle: [GM] } });
    play(s, "ST02-014");
    expect(s.cards[id(s, 1, "battle", GM)]!.rested).toBe(true);
  });

  it("ST02-015 Saint Gabriel Institute: Shield to hand, then one of the top 2 on top, one at the bottom", () => {
    const s = scenario({ p0: { hand: ["ST02-015"], deck: ["ST02-004", "ST02-005", GM, GM] } });
    play(s, "ST02-015");
    expect(s.pending?.prompt).toBe("lookTop");
    apply(s, target(id(s, 0, "deck", "ST02-005")));
    expect(nos(s, 0, "deck")).toEqual(["ST02-005", GM, GM, "ST02-004"]);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it("ST02-016 Corsica Base: Tallgeese token on your turn, two Leo tokens with a Corsica Base in the trash", () => {
    const s = scenario({ p0: { hand: ["ST02-016"] } });
    play(s, "ST02-016");
    expect(nos(s, 0, "battle")).toEqual(["T-005"]);
    const t = scenario({ p0: { hand: ["ST02-016"], trash: ["ST02-016"] } });
    play(t, "ST02-016");
    expect(nos(t, 0, "battle")).toEqual(["T-004", "T-004"]);
  });
});

describe("ST03 Zeon's Rush", () => {
  it("ST03-001 Sinanju: paired it can't be blocked; destroying a shield area card deals 2 to an enemy Unit", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST03-001", pilot: "ST03-010" }] },
      p1: { battle: ["ST02-009", GM], base: null },
    });
    attack(s, id(s, 0, "battle", "ST03-001"));
    expect(s.pending?.kind).not.toBe("block");
    expect(s.pending?.prompt).toBe("target");
    apply(s, target(id(s, 1, "battle", GM)));
    settle(s);
    expect(nos(s, 1, "battle")).toEqual(["ST02-009"]);
    expect(s.players[1].shields).toHaveLength(5);
  });

  it("ST03-006 Char's Zaku Ⅱ: when destroyed, may take a (Zeon)/(Neo Zeon) Unit from the top 3", () => {
    const s = scenario({
      p0: { battle: [GM] },
      p1: { battle: [{ no: "ST03-006", rested: true }], deck: [GM, "ST03-007", GM, GM, GM] },
      active: 0,
    });
    attack(s, id(s, 0, "battle", GM), id(s, 1, "battle", "ST03-006"));
    expect(s.pending).toMatchObject({ player: 1, prompt: "lookPick" });
    apply(s, target(id(s, 1, "deck", "ST03-007")));
    expect(nos(s, 1, "hand")).toEqual(["ST03-007"]);
    expect(nos(s, 1, "deck").slice(0, 2)).toEqual([GM, GM]);
  });

  it("ST03-008 Zaku Ⅱ: AP+2 when it attacks", () => {
    const s = scenario({ p0: { battle: ["ST03-008"] } });
    attack(s, id(s, 0, "battle", "ST03-008"));
    settle(s);
    expect(s.players[1].base).toHaveLength(0); // 1+2 AP destroy the EX Base (3 HP)
  });

  it("ST03-009 Gouf: deploys a rested Zaku Ⅱ token", () => {
    const s = scenario({ p0: { hand: ["ST03-009"] } });
    play(s, "ST03-009");
    const token = id(s, 0, "battle", "T-007");
    expect(s.cards[token]!.rested).toBe(true);
  });

  it("ST03-010 Full Frontal: may deploy a (Neo Zeon)/(Zeon) Unit Lv.4 or lower from the hand", () => {
    const s = scenario({
      p0: { battle: ["ST03-003"], hand: ["ST03-010", "ST03-002", "ST03-001"], resources: 6 },
    });
    pair(s, "ST03-010", id(s, 0, "battle", "ST03-003"));
    expect(s.pending?.options).toEqual([target(id(s, 0, "hand", "ST03-002")), { type: "done" }]);
    apply(s, target(id(s, 0, "hand", "ST03-002")));
    expect(nos(s, 0, "battle")).toContain("ST03-002");
    expect(s.players[0].resources.filter((r) => s.cards[r]!.rested)).toHaveLength(1); // no cost paid
  });

  it("ST03-011 Char Aznable: AP+1 on attack, <High-Maneuver> only when linked", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST03-006", pilot: "ST03-011" }] },
      p1: { battle: ["ST02-009"] },
    });
    attack(s, id(s, 0, "battle", "ST03-006"));
    expect(s.pending?.kind).toBe("main");
    expect(s.players[1].base).toHaveLength(0); // 3+1+1 AP destroy the EX Base
    const u = scenario({ p0: { battle: [{ no: GM, pilot: "ST03-011" }] }, p1: { battle: ["ST02-009"] } });
    attack(u, id(u, 0, "battle", GM));
    expect(u.pending?.kind).toBe("block");
  });

  it("ST03-012 Indignation: AP+2 to a friendly Unit", () => {
    const s = scenario({ p0: { hand: ["ST03-012"], battle: [GM] } });
    play(s, "ST03-012");
    expect(ap(s, id(s, 0, "battle", GM))).toBe(4);
  });

  it("ST03-013 Close Combat: 2 damage to an enemy Unit", () => {
    const s = scenario({ p0: { hand: ["ST03-013"] }, p1: { battle: [GM] } });
    play(s, "ST03-013");
    expect(s.players[1].battle).toHaveLength(0);
  });

  it("ST03-014 The Blue Giant: no battle damage from Units with 2 or less AP this battle", () => {
    const s = scenario({
      p0: { battle: [GM] },
      p1: { hand: ["ST03-014"], battle: [{ no: "ST01-003", rested: true }] },
    });
    attack(s, id(s, 0, "battle", GM), id(s, 1, "battle", "ST01-003"));
    apply(s, { type: "playCommand", card: id(s, 1, "hand", "ST03-014") }); // the only friendly Unit is chosen
    settle(s);
    expect(s.cards[id(s, 1, "battle", "ST01-003")]!.damage).toBe(0);
  });

  it("ST03-015 Rewloola: Shield to hand, then 1 damage to an enemy Unit with 5 or less AP", () => {
    const s = scenario({ p0: { hand: ["ST03-015"] }, p1: { battle: [GM] } });
    play(s, "ST03-015");
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.cards[id(s, 1, "battle", GM)]!.damage).toBe(1);
  });

  it("ST03-016 Falmel: rested Char's Zaku Ⅱ token only on your turn", () => {
    const s = scenario({ p0: { hand: ["ST03-016"] } });
    play(s, "ST03-016");
    expect(nos(s, 0, "battle")).toEqual(["T-006"]);
    const b = scenario({ p0: { battle: [GM] }, p1: { base: null, shields: ["ST03-016"] } });
    attack(b, id(b, 0, "battle", GM));
    apply(b, { type: "yes" });
    expect(nos(b, 1, "base")).toEqual(["ST03-016"]);
    expect(b.players[1].battle).toHaveLength(0);
  });
});

describe("ST04 SEED Strike", () => {
  it("ST04-001 Aile Strike: a Lv.4+ Pilot returns an enemy Unit with 4 or less HP to the hand", () => {
    const s = scenario({
      p0: { battle: ["ST04-001"], hand: ["ST04-010"] },
      p1: { battle: [{ no: GM, pilot: "ST01-010" }] },
    });
    pair(s, "ST04-010", id(s, 0, "battle", "ST04-001"));
    expect(nos(s, 1, "hand").sort()).toEqual([GM, "ST01-010"].sort());
    const low = scenario({ p0: { battle: ["ST04-001"], hand: ["ST01-012"] }, p1: { battle: [GM] } });
    pair(low, "ST01-012", id(low, 0, "battle", "ST04-001")); // a Command Pilot has Lv.2
    expect(low.players[1].battle).toHaveLength(1);
  });

  it("ST04-002 Strike Gundam: draw 1, then discard 1", () => {
    const s = scenario({ p0: { hand: ["ST04-002", "ST04-005"], deck: ["ST04-008", GM] } });
    play(s, "ST04-002");
    expect(s.pending?.prompt).toBe("discard");
    apply(s, target(id(s, 0, "hand", "ST04-005")));
    expect(nos(s, 0, "hand")).toEqual(["ST04-008"]);
  });

  it("ST04-006 Aegis Gundam: with 5+ AP its attack deals 3 to an enemy Unit Lv.5 or higher", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST04-006", pilot: "ST04-011" }] },
      p1: { battle: ["ST02-006", GM] },
    });
    attack(s, id(s, 0, "battle", "ST04-006"));
    settle(s);
    expect(s.cards[id(s, 1, "battle", "ST02-006")]!.damage).toBe(3);
    const weak = scenario({ p0: { battle: ["ST04-006"] }, p1: { battle: ["ST02-006"] } });
    attack(weak, id(weak, 0, "battle", "ST04-006"));
    settle(weak);
    expect(weak.cards[id(weak, 1, "battle", "ST02-006")]!.damage).toBe(0);
  });

  it("ST04-009 Miguel's Ginn: paired and destroyed with another Link Unit in play draws 1", () => {
    const s = scenario({
      p0: { battle: [{ no: GM }] },
      p1: {
        battle: [
          { no: "ST04-009", pilot: "ST04-014", rested: true },
          { no: "ST04-006", pilot: "ST04-011" },
        ],
      },
    });
    attack(s, id(s, 0, "battle", GM), id(s, 1, "battle", "ST04-009"));
    settle(s);
    expect(nos(s, 1, "trash")).toContain("ST04-009");
    expect(s.players[1].hand).toHaveLength(1);
  });

  it("ST04-010 Kira Yamato: on attack an enemy Unit gets AP-2 during this battle", () => {
    // GM + Kira (4 AP, 3 HP) against Wing Gundam (4 AP, 5 HP): Wing hits back with 4-2 = 2.
    const s = scenario({
      p0: { battle: [{ no: GM, pilot: "ST04-010" }] },
      p1: { battle: [{ no: "ST02-001", rested: true }] },
    });
    attack(s, id(s, 0, "battle", GM), id(s, 1, "battle", "ST02-001"));
    settle(s);
    expect(s.cards[id(s, 0, "battle", GM)]!.damage).toBe(2);
    expect(ap(s, id(s, 1, "battle", "ST02-001"))).toBe(4); // only during the battle
  });

  it("ST04-011 Athrun Zala: when linked the Unit may attack an active enemy Unit Lv.5 or lower this turn", () => {
    const s = scenario({ p0: { battle: ["ST04-007"], hand: ["ST04-011"] }, p1: { battle: ["ST02-006"] } });
    pair(s, "ST04-011", id(s, 0, "battle", "ST04-007"));
    const targets = s.pending!.options.flatMap((o) => (o.type === "attack" ? [o.target] : []));
    expect(targets).toContain(id(s, 1, "battle", "ST02-006"));
  });

  it("ST04-012 Striker Pack: choose Sword or Launcher Strike; Burst deploys Aile Strike", () => {
    const s = scenario({ p0: { hand: ["ST04-012"] } });
    play(s, "ST04-012");
    expect(s.pending?.prompt).toBe("option");
    apply(s, { type: "option", index: 1, label: "Launcher Strike Gundam" });
    expect(nos(s, 0, "battle")).toEqual(["T-009"]);
    const b = scenario({ p0: { battle: [GM] }, p1: { base: null, shields: ["ST04-012"] } });
    attack(b, id(b, 0, "battle", GM));
    apply(b, { type: "yes" });
    expect(nos(b, 1, "battle")).toEqual(["T-008"]);
  });

  it("ST04-013 Hawk of Endymion: returns an enemy Unit with 3 or less HP to the hand", () => {
    const s = scenario({ p0: { hand: ["ST04-013"] }, p1: { battle: [GM] } });
    play(s, "ST04-013");
    expect(nos(s, 1, "hand")).toEqual([GM]);
  });

  it("ST04-014 The Magic Bullet of Dusk: <First Strike> for a Lv.2 or lower Unit", () => {
    const s = scenario({
      p0: { hand: ["ST04-014"], battle: ["ST04-009"] },
      p1: { battle: [{ no: GM, rested: true }] },
    });
    play(s, "ST04-014");
    attack(s, id(s, 0, "battle", "ST04-009"), id(s, 1, "battle", GM));
    settle(s);
    expect(nos(s, 0, "battle")).toEqual(["ST04-009"]); // 3 AP first strike kills the GM before it hits back
  });

  it("ST04-015 Archangel: ② sets a Unit with <Blocker> active; it can't attack this turn", () => {
    const s = scenario({ p0: { base: "ST04-015", battle: [{ no: "ST04-004", rested: true }] } });
    apply(s, { type: "activate", card: id(s, 0, "base", "ST04-015"), effect: 2 });
    const moebius = id(s, 0, "battle", "ST04-004");
    expect(s.cards[moebius]!.rested).toBe(false);
    expect(s.pending!.options.some((o) => o.type === "attack" && o.unit === moebius)).toBe(false);
  });

  it("ST04-016 Vesalius: rest it for AP+1 to a friendly Unit", () => {
    const s = scenario({ p0: { base: "ST04-016", battle: [GM] } });
    apply(s, { type: "activate", card: id(s, 0, "base", "ST04-016"), effect: 2 });
    expect(ap(s, id(s, 0, "battle", GM))).toBe(3);
    expect(s.cards[id(s, 0, "base", "ST04-016")]!.rested).toBe(true);
  });
});
