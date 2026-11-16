import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { runPool, type ChunkWorker } from "../../src/sim/pool";
import {
  chunks,
  deckPairs,
  gameSpec,
  runGame,
  runRange,
  type GameSummary,
  type SimJob,
} from "../../src/sim/runner";
import { computeStats, wilson } from "../../src/sim/stats";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const decks = STARTER_DECKS.map((d) => ({ id: d.id, name: d.name, deck: d.deck }));

const strip = (g: GameSummary) => ({ ...g, ms: 0 });

describe("match runner", () => {
  it("pairs every deck with every deck once, mirrors included", () => {
    expect(deckPairs(3)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
      [1, 2],
      [2, 2],
    ]);
  });

  it("balances first player, AI seats and deck seats within each block of 8 games", () => {
    const job: SimJob = { decks, ai: ["heuristic-v1", "random"], games: 80, seed: 3 };
    const block = Array.from({ length: 8 }, (_, i) => gameSpec(job, 8 + i));
    const combos = new Set(block.map((s) => `${s.firstPlayer}${s.ai[0]}${s.decks[0]}`));
    expect(combos.size).toBe(8);
    expect(new Set(block.map((s) => [...s.decks].sort().join()))).toEqual(new Set(["ST01,ST02"]));
  });

  it("plays the same game again from job and index", () => {
    const job: SimJob = { decks, ai: ["heuristic-v0", "random"], games: 4, seed: 9 };
    expect(strip(runGame(engine, job, 2))).toEqual(strip(runGame(engine, job, 2)));
  });

  it("gives the same results through the worker pool as in one process", async () => {
    const job: SimJob = { decks: [], ai: ["random", "random"], games: 37, seed: 5, check: true };
    const direct = runRange(engine, job, 0, job.games);
    const workers: ChunkWorker[] = [1, 2, 3].map(() => ({
      run: async (j, from, to) => runRange(engine, j, from, to),
    }));
    let progress = 0;
    const pooled = await runPool(job, workers, { onProgress: (done) => (progress = done) });
    expect(pooled.map(strip)).toEqual(direct.map(strip));
    expect(progress).toBe(37);
    expect(direct.every((g) => !g.error)).toBe(true);
    expect(chunks(1000, 4).at(-1)![1]).toBe(1000);
  });
});

describe("statistics", () => {
  it("computes Wilson intervals", () => {
    const [low, high] = wilson(50, 100);
    expect(low).toBeCloseTo(0.4038, 3);
    expect(high).toBeCloseTo(0.5962, 3);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  it("counts wins per AI, deck and matchup from both seats", () => {
    const base = {
      seed: 0,
      turns: 10,
      decisions: 50,
      mulligans: [false, true] as [boolean, boolean],
      ms: 1,
      slots: [0, 1] as [0 | 1, 0 | 1],
    };
    const games: GameSummary[] = [
      {
        ...base,
        index: 0,
        firstPlayer: 0,
        decks: ["A", "B"],
        ai: ["random", "heuristic-v1"],
        winner: 1,
        reason: "damage",
      },
      {
        ...base,
        index: 1,
        firstPlayer: 1,
        decks: ["B", "A"],
        ai: ["heuristic-v1", "random"],
        winner: 0,
        reason: "damage",
      },
      {
        ...base,
        index: 2,
        firstPlayer: 0,
        decks: ["A", "A"],
        ai: ["random", "random"],
        winner: null,
        reason: "turnLimit",
      },
    ];
    const s = computeStats(games);
    expect(s.byAi["heuristic-v1"]!.rate).toBe(1);
    expect(s.byAi.random!.games).toBe(2); // the mirror game doesn't count
    expect(s.byDeck.B!.wins).toBe(2);
    expect(s.matrix.A!.B!.rate).toBe(0);
    expect(s.matrix.B!.A!.rate).toBe(1);
    expect(s.matrix.A!.A!.games).toBe(1);
    expect(s.mulliganRate).toBeCloseTo(0.5);
    expect(s.firstPlayer.games).toBe(3);
  });
});
