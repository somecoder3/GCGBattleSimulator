// Deck fitness against a field (docs/DECKSEARCH.md, stage 0). Node only (lab tools).
//
// A measurement unit is a block of 8 games of one deck against one opponent: both first players, both deck
// seats, both AI seats (runner.ts). Block b of the pairing (deck, opponent) uses the games 8b … 8b+7 of a
// job whose seed is fixed; the seeds of a game depend on job seed and index only, so every candidate meets
// the same opponents in the same situations (common random numbers): comparisons between candidates and
// a base list are paired. Results are cached per block in the lab store, keyed by the code version.

import type { AiName } from "../../ai/registry";
import type { ChunkWorker } from "../../sim/pool";
import { cyrb53 } from "../../sim/gamehash";
import type { DeckEntry, GameSummary, SimJob } from "../../sim/runner";
import type { DeckList } from "../../engine/types";
import type { LabStore } from "../store";

export interface FieldDeck extends DeckEntry {
  /** Weight in the field (meta share), normalized over the field. */
  weight: number;
}

/** One block: games won, lost and drawn by the deck (out of 8). */
export interface Block {
  wins: number;
  losses: number;
  draws: number;
}

export interface MeasureSettings {
  ai: AiName;
  /** Base seed of all measurements (search and confirmation use different ones). */
  seed: number;
  codeVersion: string;
}

/** Stable hash of a deck list (order of cards does not matter). */
export function deckHash(deck: DeckList): string {
  return cyrb53([...deck.main].sort().join(",") + "|" + [...deck.resources].sort().join(",")).toString(36);
}

/** The seed of the pairing job: from the base seed and the opponent (not the candidate: paired). */
function pairSeed(base: number, opponent: DeckList): number {
  return (cyrb53(`${base}|${deckHash(opponent)}`) % 2 ** 31) >>> 0;
}

export function pairJob(deck: DeckList, opponent: DeckList, s: MeasureSettings): SimJob {
  return {
    decks: [
      { id: "deck", name: "deck", deck },
      { id: "opp", name: "opp", deck: opponent },
    ],
    mirrors: false,
    ai: [s.ai, s.ai],
    games: 8,
    seed: pairSeed(s.seed, opponent),
  };
}

function blockOf(games: GameSummary[]): Block {
  const b: Block = { wins: 0, losses: 0, draws: 0 };
  for (const g of games) {
    if (g.winner === null) b.draws++;
    else if (g.decks[g.winner] === "deck") b.wins++;
    else b.losses++;
  }
  return b;
}

/** Runs tasks (job + game range) on a set of workers, each pulling the next task when free. */
export async function runTasks<T>(
  workers: ChunkWorker[],
  tasks: { job: SimJob; from: number; to: number; key: T }[],
  onDone: (key: T, games: GameSummary[]) => void,
): Promise<void> {
  const queue = [...tasks];
  await Promise.all(
    workers.map(async (w) => {
      for (let t = queue.shift(); t; t = queue.shift()) onDone(t.key, await w.run(t.job, t.from, t.to));
    }),
  );
}

/** Block results of a deck against the field, from the cache or played now. */
export class Measurer {
  /** Games played (not from the cache) since the start, for progress and cost. */
  played = 0;

  constructor(
    private readonly store: LabStore,
    private readonly workers: ChunkWorker[],
    readonly settings: MeasureSettings,
  ) {}

  private key(deck: DeckList, opponent: DeckList, block: number): string {
    const s = this.settings;
    return `fit|${s.codeVersion}|${s.ai}|${s.seed}|${deckHash(deck)}|${deckHash(opponent)}|${block}`;
  }

  /**
   * Makes sure blocks 0 … blocks-1 of every deck against every opponent exist; returns them as
   * results[deck][opponent] = Block[].
   */
  async blocks(decks: DeckList[], field: FieldDeck[], blocks: number): Promise<Block[][][]> {
    const out: Block[][][] = decks.map(() => field.map(() => []));
    const tasks: { job: SimJob; from: number; to: number; key: [number, number, number] }[] = [];
    decks.forEach((deck, d) =>
      field.forEach((opp, o) => {
        for (let b = 0; b < blocks; b++) {
          const cached = this.store.get<Block>(this.key(deck, opp.deck, b));
          if (cached) out[d]![o]![b] = cached;
          else {
            const job = pairJob(deck, opp.deck, this.settings);
            tasks.push({ job: { ...job, games: (b + 1) * 8 }, from: b * 8, to: b * 8 + 8, key: [d, o, b] });
          }
        }
      }),
    );
    await runTasks(this.workers, tasks, ([d, o, b], games) => {
      const block = blockOf(games);
      out[d]![o]![b] = block;
      this.store.set(this.key(decks[d]!, field[o]!.deck, b), block);
      this.played += games.length;
    });
    return out;
  }
}

/** Win rate of one deck against the field, weighted by the field's shares (draws count half). */
export function fieldRate(results: Block[][], field: FieldDeck[]): number {
  let sum = 0;
  results.forEach((blocks, o) => {
    const games = blocks.reduce((n, b) => n + b.wins + b.losses + b.draws, 0);
    const won = blocks.reduce((n, b) => n + b.wins + b.draws / 2, 0);
    sum += field[o]!.weight * (games ? won / games : 0.5);
  });
  return sum;
}

/**
 * Paired difference of two decks (a − b) against the field: weighted mean of the per-block differences of
 * the win rate, with a 95 % interval from the block variance (blocks are independent, pairs are not).
 */
export function pairedDiff(
  a: Block[][],
  b: Block[][],
  field: FieldDeck[],
): { diff: number; low: number; high: number; blocks: number } {
  let mean = 0;
  let variance = 0;
  let blocks = 0;
  field.forEach((opp, o) => {
    const n = Math.min(a[o]!.length, b[o]!.length);
    if (!n) return;
    const d: number[] = [];
    for (let i = 0; i < n; i++) {
      const ra = a[o]![i]!;
      const rb = b[o]![i]!;
      d.push((ra.wins + ra.draws / 2 - rb.wins - rb.draws / 2) / 8);
    }
    const m = d.reduce((x, y) => x + y, 0) / n;
    const s2 = n > 1 ? d.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1) : 0.25;
    mean += opp.weight * m;
    variance += opp.weight ** 2 * (s2 / n);
    blocks += n;
  });
  const se = Math.sqrt(variance);
  return { diff: mean, low: mean - 1.96 * se, high: mean + 1.96 * se, blocks };
}
