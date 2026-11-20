// End screen statistics (src/app/lib/gamesummary.ts) on whole games of the heuristic AI against itself.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { summarize } from "../../src/app/lib/gamesummary";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { viewFor } from "../../src/engine/view";
import { GameSession } from "../../src/sim/session";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const ai = new HeuristicPolicy(engine);

function play(seed: number): GameSession {
  const session = new GameSession(engine, {
    decks: [STARTER_DECKS[0]!.deck, STARTER_DECKS[1]!.deck],
    options: { seed, firstPlayer: 0 },
    human: 0,
  });
  // The "human" is the same AI.
  while (!session.over) {
    if (session.aiToAct) session.stepAI(ai);
    else session.apply(ai.choose(viewFor(session.state, 0), session.state.pending!));
  }
  return session;
}

describe("game summary", () => {
  it("one point per turn, consistent sides, winner and final blow", () => {
    for (const seed of [1, 2, 3]) {
      const session = play(seed);
      const s = summarize(engine, session.steps, 0);
      const result = session.state.result!;
      expect(s.winner).toBe(result.winner);
      expect(s.turns).toBe(result.turn);
      expect(s.points.length).toBe(result.turn);
      expect(s.points.map((p) => p.turn)).toEqual(s.points.map((_, i) => i + 1));
      // The winner leads at the end; shields never grow above 6.
      const lastPoint = s.points.at(-1)!;
      if (result.winner !== null) expect(Math.sign(lastPoint.advantage)).toBe(result.winner === 0 ? 1 : -1);
      for (const p of s.points) for (const n of p.shields) expect(n).toBeLessThanOrEqual(6);
      // The loser's shields were all broken: the winner broke at least 6 (minus shields returned to hand).
      const w = result.winner;
      if (w !== null && result.reason === "damage") {
        expect(s.sides[w].shields + s.sides[w].toPlayer).toBeGreaterThan(0);
        expect(s.finalBlow?.player).toBe(w);
      }
      expect(s.sides[0].played + s.sides[1].played).toBeGreaterThan(4);
      if (s.mvp) expect(engine.lib.has(s.mvp.no)).toBe(true);
    }
  });
});
