// An optional Command in the simulation (draw, look at the top …) must not make an option look worse
// (simulator game of 20 Nov 2026: White Gundam didn't attack an almost destroyed Base, because v0 would
// have played Turning Point of History after the attack and the evaluation counts it as a lost hand card).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LookaheadPolicy } from "../../src/ai/lookahead";
import { DEFAULT_WEIGHTS } from "../../src/ai/evaluate";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, GameState } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const WHITE = "GD02-032"; // 3/3
const GAZ = "GD02-050"; // 3/2
const REWLOOLA = "ST03-015"; // Base, 5 HP
const TPOH = "GD02-104"; // look at the top 3 …; draws only with a (Newtype) Pilot in play

/** The AI (player 1) has attacked with Ga-Zowmn; the human's Base has 2 HP left, no Units. */
function position(): GameState {
  return scenario({
    engine,
    filler: "GD01-030",
    turn: 8,
    active: 1,
    p0: {
      base: REWLOOLA,
      baseDamage: 3,
      shields: 5,
      hand: ["GD01-030", "GD01-030", "GD01-030"],
      resources: 4,
    },
    p1: {
      battle: [
        { no: WHITE, damage: 1 },
        { no: GAZ, rested: true },
      ],
      hand: [TPOH, "GD04-033", "GD02-020"],
      resources: 5,
      shields: 6,
    },
  });
}

const choice = (forcedFiller: boolean): Action => {
  const s = position();
  const v1 = new LookaheadPolicy(engine, DEFAULT_WEIGHTS, "round", forcedFiller ? { forcedFiller } : {});
  return v1.choose(viewFor(s, 1), s.pending!);
};

describe("optional Commands in the simulation", () => {
  it("v1 attacks the Base instead of ending the main phase", () => {
    const pick = choice(false);
    expect(pick.type).toBe("attack");
    expect(pick.type === "attack" && engine.lib.get(position().cards[pick.unit]!.no).name).toBe(
      "White Gundam",
    );
  });

  it("before 20 Nov 2026 it ended the main phase (forcedFiller)", () => {
    expect(choice(true).type).toBe("endMain");
  });
});
