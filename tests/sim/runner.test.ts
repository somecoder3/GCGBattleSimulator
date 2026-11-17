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
  fullRounds,
  gameSpec,
  recordGame,
  roundSize,
  runGame,
  runRange,
  type GameSummary,
  type SimJob,
} from "../../src/sim/runner";
import { GameSession } from "../../src/sim/session";
import { cardStats, computeStats, gamesCsv, metaWeighted, wilson } from "../../src/sim/stats";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const decks = STARTER_DECKS.slice(0, 4).map((d) => ({ id: d.id, name: d.name, deck: d.deck }));

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

  it("rounds the number of games up to full rounds, so every pairing is played equally often", () => {
    // 4 starter decks: 10 pairings, one round = 80 games. 64 games used to play only the first 8 pairings.
    expect(roundSize({ decks })).toBe(80);
    expect(fullRounds({ decks }, 64)).toBe(80);
    expect(fullRounds({ decks }, 1000)).toBe(1040);
    expect(fullRounds({ decks }, 800)).toBe(800);
    expect(fullRounds({ decks: [] }, 100)).toBe(104); // random decks: blocks of 8
    expect(roundSize({ decks, mode: "gauntlet", focus: "ST02" })).toBe(24);

    const job: SimJob = { decks, ai: ["random", "random"], games: fullRounds({ decks }, 64), seed: 1 };
    const perPairing = new Map<string, number>();
    for (let i = 0; i < job.games; i++) {
      const key = [...gameSpec(job, i).decks].sort().join("-");
      perPairing.set(key, (perPairing.get(key) ?? 0) + 1);
    }
    expect(perPairing.size).toBe(10);
    expect(new Set(perPairing.values())).toEqual(new Set([8]));
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

describe("M8: gauntlet, card statistics, replays", () => {
  it("pairs only the focus deck with every other deck in a gauntlet", () => {
    const job: SimJob = {
      decks,
      ai: ["random", "random"],
      games: 48,
      seed: 1,
      mode: "gauntlet",
      focus: "ST02",
    };
    const pairs = new Set(Array.from({ length: 48 }, (_, i) => [...gameSpec(job, i).decks].sort().join()));
    expect(pairs).toEqual(new Set(["ST01,ST02", "ST02,ST03", "ST02,ST04"]));
  });

  it("records opening hand, drawn and played cards and computes card performance", () => {
    const job: SimJob = { decks, ai: ["heuristic-v0", "heuristic-v0"], games: 40, seed: 2, cardStats: true };
    const games = runRange(engine, job, 0, 40);
    for (const g of games) {
      for (const seat of [0, 1] as const) {
        const c = g.cards![seat];
        expect(c.opening.length).toBeGreaterThan(0);
        expect(c.opening.every((no) => c.drawn.includes(no))).toBe(true);
      }
    }
    const stats = cardStats(games, "ST01");
    expect(stats.length).toBeGreaterThan(5);
    for (const c of stats) {
      expect(c.drawn.games + c.notDrawn.games).toBe(stats[0]!.drawn.games + stats[0]!.notDrawn.games);
    }
  });

  it("replays a game with the same result as the run", () => {
    const job: SimJob = { decks, ai: ["heuristic-v1", "random"], games: 4, seed: 3 };
    const summary = runGame(engine, job, 3);
    const recorded = recordGame(engine, job, 3);
    const s = new GameSession(
      engine,
      { decks: recorded.decks, options: recorded.options, human: 0 },
      recorded.actions,
    );
    expect(s.state.result?.winner).toBe(summary.winner);
    expect(recorded.actions).toHaveLength(summary.decisions);
  });

  it("weights win rates against the field by meta share and writes CSV", () => {
    const base = {
      seed: 0,
      turns: 10,
      decisions: 50,
      mulligans: [false, false] as [boolean, boolean],
      ms: 1,
    };
    const g = (decks: [string, string], winner: 0 | 1): GameSummary => ({
      ...base,
      index: 0,
      firstPlayer: 0,
      decks,
      ai: ["random", "random"],
      slots: [0, 1],
      winner,
      reason: "damage",
    });
    const stats = computeStats([g(["A", "B"], 0), g(["A", "C"], 1)]);
    // A beats B (share 3) and loses to C (share 1): 3/4.
    expect(metaWeighted(stats, { A: 1, B: 3, C: 1 }).A).toBeCloseTo(0.75);
    expect(gamesCsv([g(["A", "B"], 0)]).split("\n")[1]).toBe("0,0,0,A,B,random,random,0,damage,10,50,0,0,");
  });
});
