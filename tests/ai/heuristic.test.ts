import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { determinize, LookaheadPolicy } from "../../src/ai/lookahead";
import { RandomPolicy } from "../../src/ai/random";
import type { AiName } from "../../src/ai/registry";
import { HIDDEN, viewFor } from "../../src/engine/view";
import { runRange, type SimJob } from "../../src/sim/runner";
import { computeStats } from "../../src/sim/stats";
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

describe("heuristic AI v1 (evaluation and lookahead)", () => {
  it("beats random play and v0 with the starter decks, on its own view", () => {
    const job = (ai: [AiName, AiName]): SimJob => ({
      decks: STARTER_DECKS.map((d) => ({ id: d.id, name: d.name, deck: d.deck })),
      ai,
      games: 64,
      seed: 21,
      check: true,
    });
    const vsRandom = computeStats(runRange(engine, job(["heuristic-v1", "random"]), 0, 64));
    expect(vsRandom.errors).toBe(0);
    expect(vsRandom.byAi["heuristic-v1"]!.rate).toBeGreaterThan(0.9);
    const vsV0 = computeStats(runRange(engine, job(["heuristic-v1", "heuristic-v0"]), 0, 64));
    expect(vsV0.byAi["heuristic-v1"]!.rate).toBeGreaterThan(0.55);
  }, 120_000);

  it("simulates with stand-ins for hidden cards, leaves the view unchanged and finds the win", () => {
    const s = scenario({
      engine,
      filler: GM,
      p0: { battle: [GM] },
      p1: { battle: [{ no: GM, rested: true }], shields: 0, base: null },
    });
    const view = viewFor(s, 0);
    const before = JSON.stringify(view);
    expect(determinize(view).cards.some((c) => c.no === HIDDEN)).toBe(false);
    const action = new LookaheadPolicy(engine).choose(view, view.pending!);
    expect(JSON.stringify(view)).toBe(before);
    expect(action).toEqual({ type: "attack", unit: s.players[0].battle[0], target: "player" });
  });
});
