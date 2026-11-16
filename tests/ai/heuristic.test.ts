import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { RandomPolicy } from "../../src/ai/random";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { checkInvariants } from "../../src/engine/invariants";
import type { PlayerId } from "../../src/engine/types";
import { playMatch } from "../../src/sim/match";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const GM = "ST01-005"; // vanilla 2/2, Lv.2

describe("heuristic AI v0", () => {
  it("beats random play clearly with the starter decks", () => {
    let wins = 0;
    let games = 0;
    let seed = 100;
    for (const a of STARTER_DECKS) {
      for (const b of STARTER_DECKS) {
        for (let g = 0; g < 10; g++, seed++) {
          const heuristicSide = (g % 2) as PlayerId;
          const policies: [RandomPolicy | HeuristicPolicy, RandomPolicy | HeuristicPolicy] =
            heuristicSide === 0
              ? [new HeuristicPolicy(engine), new RandomPolicy(seed)]
              : [new RandomPolicy(seed), new HeuristicPolicy(engine)];
          const record = playMatch(
            engine,
            [a.deck, b.deck],
            { seed, firstPlayer: (seed % 2) as PlayerId },
            policies,
            {
              onStep: (state) => {
                const errors = checkInvariants(engine, state, [60, 60]);
                if (errors.length) throw new Error(`seed ${seed}: ${errors.join("; ")}`);
              },
            },
          );
          games++;
          if (record.result.winner === heuristicSide) wins++;
        }
      }
    }
    expect(wins / games).toBeGreaterThan(0.85);
  });

  it("plays against itself to the end with all invariants", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = STARTER_DECKS[seed % 4]!;
      const b = STARTER_DECKS[(seed >> 2) % 4]!;
      const record = playMatch(
        engine,
        [a.deck, b.deck],
        { seed },
        [new HeuristicPolicy(engine), new HeuristicPolicy(engine)],
        {
          onStep: (state) => {
            const errors = checkInvariants(engine, state, [60, 60]);
            if (errors.length) throw new Error(`seed ${seed}: ${errors.join("; ")}`);
          },
        },
      );
      expect(record.result.reason, `seed ${seed}`).not.toBe("turnLimit");
    }
  });

  it("attacks for the win when the opponent has no shields left", () => {
    const s = scenario({ engine, filler: GM, p0: { battle: [GM] }, p1: { shields: 0, base: null } });
    const action = new HeuristicPolicy(engine).choose(s, s.pending!);
    expect(action).toEqual({ type: "attack", unit: s.players[0].battle[0], target: "player" });
  });

  it("attacks a rested Unit it destroys without being destroyed", () => {
    const s = scenario({
      engine,
      filler: GM,
      p0: { battle: [{ no: "ST01-001", pilot: "ST01-010" }] },
      p1: { battle: [{ no: GM, rested: true }] },
    });
    const action = new HeuristicPolicy(engine).choose(s, s.pending!);
    expect(action).toEqual({ type: "attack", unit: s.players[0].battle[0], target: s.players[1].battle[0] });
  });
});
