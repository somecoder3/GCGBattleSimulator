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
    const room = scenario({ p0: { hand: [DRAW, ARMED], resources: 4 } });
    expect(plays(room, DRAW)).toBe(true);
    const tight = scenario({ p0: { hand: [DRAW, ARMED], resources: 4, restedResources: 3 } });
    expect(plays(tight, DRAW)).toBe(false); // paying 1 would leave nothing for Armed Intervention
  });

  it("the old rule plays every Command at once", () => {
    const eager = new HeuristicPolicy(engine, { eagerMainCommands: true });
    const s = scenario({ p0: { battle: [GM], hand: [IRON_AND_BLOOD] }, p1: { base: null } });
    const a = eager.choose(viewFor(s, 0), s.pending!);
    expect(a.type === "playCommand" && s.cards[a.card]!.no === IRON_AND_BLOOD).toBe(true);
  });
});
