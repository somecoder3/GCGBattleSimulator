// Battles started by effects (The Final Victor, ST12-013) and activated First Strike in the rule AI
// (src/ai/heuristic.ts fightCommandValue / fightChoice / firstStrikeGain), with real cards.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, GameState, PlayerId } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { scenario as baseScenario, type ScenarioSpec } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const v0 = new HeuristicPolicy(engine);
const old = new HeuristicPolicy(engine, { plainFights: true });

const GM = "ST01-005"; // 2/2
const FINAL_VICTOR = "ST12-013"; // Lv.6, cost 2: you and the opponent each choose a Unit, they battle
const DESTINY = "GD05-055"; // 5/6 <First Strike>, enemy battle damage -2 once per turn
const BANSHEE = "ST12-006"; // 5/4; paired: exile 4 trash cards → <First Strike> this turn
const GUNDAM = "ST01-001"; // 3/4
const PLE = "ST12-012"; // Ple-Twelve, Pilot +1/+2: Banshee 6/6
const EPYON = "GD02-002"; // 6/6
const BIG = "GD04-065"; // Banshee Norn 5/5
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });

const choose = (policy: HeuristicPolicy, s: GameState): Action =>
  policy.choose(viewFor(s, s.pending!.player), s.pending!);
const no = (s: GameState, a: Action) => ("card" in a ? s.cards[a.card]!.no : "");
const unit = (s: GameState, p: PlayerId, n: string) => s.players[p].battle.find((u) => s.cards[u]!.no === n)!;

/** Plays the game on with v0 for both until the own next main decision or the end. */
function settle(s: GameState, policy = v0) {
  for (let i = 0; i < 50 && s.pending && !(s.pending.kind === "main" && s.pending.player === 0); i++) {
    engine.apply(s, choose(policy, s));
  }
}

describe("v0: The Final Victor", () => {
  it("plays it with a First Strike Unit that wins against every answer", () => {
    const s = scenario({
      p0: { hand: [FINAL_VICTOR], resources: 6, battle: [DESTINY] },
      p1: { battle: [GUNDAM, GM] },
    });
    const a = choose(v0, s);
    expect(a.type === "playCommand" && no(s, a) === FINAL_VICTOR).toBe(true);
    expect(choose(old, s).type === "playCommand").toBe(false); // the rule before: never
    engine.apply(s, a);
    settle(s);
    // Whatever the opponent chose, it is destroyed and Destiny is still there.
    expect(s.players[1].battle.length).toBe(1);
    expect(s.players[0].battle.map((u) => s.cards[u]!.no)).toEqual([DESTINY]);
  });

  it("keeps it when the opponent has an answer that destroys the own Unit", () => {
    const s = scenario({
      p0: { hand: [FINAL_VICTOR], resources: 6, battle: [GM] },
      p1: { battle: [GUNDAM] },
    });
    const a = choose(v0, s);
    expect(a.type === "playCommand" && no(s, a) === FINAL_VICTOR).toBe(false);
  });

  it("answers with a Unit that destroys the attacker and survives", () => {
    // The opponent (p0) plays it with Banshee Norn 5/5; p1 has GM 2/2 and Gundam 3/4 … and Destiny 5/6,
    // which takes 5 - 2 = 3 damage and destroys the Banshee.
    const s = scenario({
      p0: { hand: [FINAL_VICTOR], resources: 6, battle: [BIG] },
      p1: { battle: [GM, DESTINY, GUNDAM] },
    });
    engine.apply(s, { type: "playCommand", card: s.players[0].hand[0]! });
    while (s.pending?.player === 0) engine.apply(s, choose(v0, s)); // p0 chooses Banshee Norn
    expect(s.pending?.player).toBe(1);
    const reply = choose(v0, s);
    expect(reply.type === "target" && s.cards[reply.card]!.no).toBe(DESTINY);
    const before = choose(old, s); // the rule before: its most valuable Unit, here also Destiny
    expect(before.type).toBe("target");
  });

  it("the opponent gives up its cheapest Unit when none survives", () => {
    const s = scenario({
      p0: { hand: [FINAL_VICTOR], resources: 6, battle: [DESTINY] },
      p1: { battle: [GUNDAM, GM] },
    });
    engine.apply(s, { type: "playCommand", card: s.players[0].hand[0]! });
    while (s.pending?.player === 0) engine.apply(s, choose(v0, s));
    const reply = choose(v0, s);
    expect(reply.type === "target" && s.cards[reply.card]!.no).toBe(GM);
  });
});

describe("v0: activated First Strike", () => {
  const banshee = (hand: string[]) =>
    scenario({
      p0: {
        hand,
        resources: 7,
        battle: [{ no: BANSHEE, pilot: PLE }],
        trash: [GM, GM, GM, GM, GM, GM],
      },
      p1: { battle: [EPYON] },
    });

  it("activates it before The Final Victor, which then destroys a Unit without loss", () => {
    const s = banshee([FINAL_VICTOR]);
    const first = choose(v0, s);
    expect(first.type).toBe("activate");
    engine.apply(s, first);
    settle(s);
    expect(s.cards[unit(s, 0, BANSHEE)] && engine.keywords(s, unit(s, 0, BANSHEE)).firstStrike).toBe(true);
    const next = choose(v0, s);
    expect(next.type === "playCommand" && no(s, next) === FINAL_VICTOR).toBe(true);
    engine.apply(s, next);
    settle(s);
    expect(s.players[1].battle).toEqual([]);
    expect(s.players[0].battle.map((u) => s.cards[u]!.no)).toEqual([BANSHEE]);
  });

  it("keeps the trash cards when First Strike changes nothing this turn", () => {
    const s = banshee([]);
    expect(choose(v0, s).type).not.toBe("activate");
    expect(choose(old, s).type).toBe("activate"); // the rule before: whenever possible
  });
});

describe("v0: other battles started by effects", () => {
  it("Nu Gundam's 【When Paired】 battle takes the most valuable Unit it destroys and survives", () => {
    const NU = "GD05-017"; // 5/5; when paired: exile 3 (Londo Bell) cards → battle with an enemy Unit
    const s = scenario({
      p0: { hand: [PLE], resources: 6, battle: [NU], trash: [NU, NU, NU] }, // Nu + Ple-Twelve: 6/7
      p1: { battle: [GM, EPYON] }, // Epyon 6/6: destroyed, and its 6 damage leaves Nu alive
    });
    engine.apply(s, { type: "pair", card: s.players[0].hand[0]!, unit: s.players[0].battle[0]! });
    for (let i = 0; i < 20 && s.pending?.kind === "effect"; i++) engine.apply(s, choose(v0, s));
    expect(s.players[1].battle.map((u) => s.cards[u]!.no)).toEqual([GM]);
    expect(s.players[0].battle.map((u) => s.cards[u]!.no)).toEqual([NU]);
  });
});
