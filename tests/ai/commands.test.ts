// When v0 plays Commands (src/ai/heuristic.ts mainCommandScore / commandMatters), with real cards.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, GameState } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { scenario as baseScenario, type ScenarioSpec } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const v0 = new HeuristicPolicy(engine);
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });

const GM = "ST01-005"; // 2/2
const GELGOOG = "ST06-008"; // 3/3
const IRON_AND_BLOOD = "ST05-013"; // 【Main】/【Action】 1 damage to one of your Units, AP+3 during this turn
const DRAW = "GD01-118"; // 【Main】 Draw 2. Then, discard 1. (Lv.2, cost 1)
const ARMED = "ST07-013"; // 【Action】 only (Lv.4, cost 1)

const choice = (s: GameState): Action => v0.choose(viewFor(s, s.pending!.player), s.pending!);
const plays = (s: GameState, no: string) => {
  const a = choice(s);
  return a.type === "playCommand" && s.cards[a.card]!.no === no;
};

describe("v0: AP changes by the fights they change", () => {
  const UNICORN = "GD04-066"; // 4 AP
  const target = (s: GameState) => {
    engine.apply(s, { type: "playCommand", card: s.players[0].hand[0]! });
    const pick = v0.choose(viewFor(s, 0), s.pending!);
    return pick.type === "target" ? s.cards[pick.card]!.no : "";
  };

  it("reduces the Unit whose AP-2 saves a friendly Unit", () => {
    // Cyclone Punch (AP-2) against a 4-AP Unicorn and a 2-AP GM; the friendly GM has 2 HP. Unicorn
    // would still destroy it with 2 AP; the enemy GM would not with 0 AP.
    const s = scenario({ p0: { battle: [GM], hand: ["GD05-121"] }, p1: { battle: [UNICORN, GM] } });
    expect(target(s)).toBe(GM);
  });

  it("stacks: with AP-2 already on Unicorn, the next AP-2 goes there", () => {
    const s = scenario({ p0: { battle: [GM], hand: ["GD05-121"] }, p1: { battle: [UNICORN, GM] } });
    const unicorn = s.players[1].battle.find((u) => s.cards[u]!.no === UNICORN)!;
    s.modifiers.push({ target: unicorn, ap: -2, hp: 0, until: "turn", source: unicorn });
    expect(target(s)).toBe(UNICORN); // 2 → 0 AP saves the GM, and Unicorn is worth more
  });
});

describe("v0: resting by what it changes", () => {
  const REST = "GD02-101"; // 【Main】/【Action】 rest 1 to 2 enemy Units of Lv.2 or lower (Lv.1, cost 1)
  const RICK_DOM = "GD01-030"; // 3/3 <Breach 2>

  it("rests only if an attack on the rested Unit pays off", () => {
    const pays = scenario({ p0: { battle: [RICK_DOM], hand: [REST] }, p1: { battle: [GM] } });
    expect(plays(pays, REST)).toBe(true); // Rick Dom destroys the GM, survives, Breach hits a Shield
    const trade = scenario({ p0: { battle: [GM], hand: [REST] }, p1: { battle: [GM] } });
    expect(plays(trade, REST)).toBe(false); // GM against GM: an even trade, nothing gained
    const old = new HeuristicPolicy(engine, { plainRest: true }).choose(viewFor(trade, 0), trade.pending!);
    expect(old.type === "playCommand").toBe(true); // the old rule rests whenever it can attack
  });

  it("chooses an active Unit worth resting", () => {
    const s = scenario({
      p0: { battle: [RICK_DOM], hand: [REST] },
      p1: { battle: [{ no: GM, rested: true }, GM] },
    });
    engine.apply(s, { type: "playCommand", card: s.players[0].hand[0]! });
    const pick = v0.choose(viewFor(s, 0), s.pending!);
    expect(pick.type === "target" && !s.cards[pick.card]!.rested).toBe(true);
  });
});

describe("v0: Commands in the main phase", () => {
  it("plays an AP boost for this turn only when it makes an attack kill", () => {
    const kill = scenario({
      p0: { battle: [GM], hand: [IRON_AND_BLOOD] },
      p1: { battle: [{ no: GELGOOG, rested: true }], base: null },
    });
    expect(plays(kill, IRON_AND_BLOOD)).toBe(true); // 2 + 3 AP destroys the rested 3-HP Gelgoog
    const nothing = scenario({ p0: { battle: [GM], hand: [IRON_AND_BLOOD] }, p1: { base: null } });
    expect(plays(nothing, IRON_AND_BLOOD)).toBe(false);
  });

  it("draws at the end only if Resources stay for an Action Command in the hand", () => {
    // A full hand and a Unit in play: drawing is not urgent.
    const BIG = "ST08-001"; // Lv.9: not playable
    const hand = [DRAW, ARMED, BIG, BIG, BIG];
    const room = scenario({ p0: { hand, battle: [{ no: GM, rested: true }], resources: 4 } });
    expect(plays(room, DRAW)).toBe(true);
    const tight = scenario({
      p0: { hand, battle: [{ no: GM, rested: true }], resources: 4, restedResources: 3 },
    });
    expect(plays(tight, DRAW)).toBe(false); // paying 1 would leave nothing for Armed Intervention
  });

  it("draws first with 3 or fewer other cards, or with no Unit in play and none to deploy", () => {
    const small = scenario({ p0: { battle: [GM], hand: [DRAW, ARMED, GELGOOG], resources: 4 } });
    expect(plays(small, DRAW)).toBe(true); // before deploying the Gelgoog: more choices this turn
    const BIG = "ST08-001"; // Lv.9: not playable
    const empty = scenario({ p0: { hand: [DRAW, ARMED, BIG, BIG, BIG], resources: 4, restedResources: 3 } });
    expect(plays(empty, DRAW)).toBe(true); // nothing to defend with: urgent, even without a Resource kept
    const deployable = scenario({ p0: { hand: [DRAW, GELGOOG, BIG, BIG, BIG], resources: 4 } });
    expect(plays(deployable, DRAW)).toBe(false); // deploy the Gelgoog first
  });

  it("the old rule plays every Command at once", () => {
    const eager = new HeuristicPolicy(engine, { eagerMainCommands: true });
    const s = scenario({ p0: { battle: [GM], hand: [IRON_AND_BLOOD] }, p1: { base: null } });
    const a = eager.choose(viewFor(s, 0), s.pending!);
    expect(a.type === "playCommand" && s.cards[a.card]!.no === IRON_AND_BLOOD).toBe(true);
  });
});

describe("v1 and the search: no Command that can't change anything", () => {
  const INCIDENT = "ST01-014"; // 【Main】/【Action】 Choose 1 enemy Unit. It gets AP-3 during this turn.
  // The opponent's turn ends; AP-3 now would be wasted (found in a game against search-strong, 18 Nov 2026).
  const endOfTurn = () => {
    const s = scenario({
      p0: { battle: [GELGOOG], resources: 4 },
      p1: { battle: [GM], hand: [INCIDENT], resources: 4 },
    });
    engine.apply(s, { type: "endMain" });
    return s;
  };

  it("leaves it out of the options it searches, unless asked to", () => {
    const s = endOfTurn();
    expect(s.pending?.player).toBe(1);
    expect(s.pending?.options.some((o) => o.type === "playCommand")).toBe(true);
    expect(v0.allowed(viewFor(s, 1), s.pending!).map((o) => o.type)).toEqual(["pass"]);
    const old = new HeuristicPolicy(engine, { searchIdleCommands: true });
    expect(old.allowed(viewFor(s, 1), s.pending!).some((o) => o.type === "playCommand")).toBe(true);
  });

  it("still plays it when it changes a battle", () => {
    const s = scenario({
      p0: { battle: [GELGOOG], resources: 4 },
      p1: { battle: [{ no: GM, rested: true }], hand: [INCIDENT], resources: 4 },
    });
    engine.apply(s, { type: "attack", unit: s.players[0].battle[0]!, target: s.players[1].battle[0]! });
    while (s.pending && s.pending.player === 0) engine.apply(s, { type: "pass" });
    expect(s.pending?.player).toBe(1);
    expect(v0.allowed(viewFor(s, 1), s.pending!).some((o) => o.type === "playCommand")).toBe(true);
  });
});
