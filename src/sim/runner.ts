// Match runner: a simulation job is a plain description (decks, AIs, number of games, seed). Every
// game follows from the job and its index alone, so workers only need the job and a range of indices,
// and any game can be replayed later from (job, index).

import { makePolicy, type AiName } from "../ai/registry";
import { randomDeck } from "../engine/deck";
import type { Engine } from "../engine/engine";
import { checkInvariants } from "../engine/invariants";
import { seedRng } from "../engine/rng";
import type { DeckList, GameEndReason, PlayerId } from "../engine/types";
import { playMatch } from "./match";

export interface DeckEntry {
  id: string;
  name: string;
  deck: DeckList;
}

export interface SimJob {
  /** Decks to pair with each other (every pair once, mirrors included). Empty: random legal decks. */
  decks: DeckEntry[];
  /** The two AIs. If they differ, each plays each deck of a pairing equally often. */
  ai: [AiName, AiName];
  games: number;
  seed: number;
  maxTurns?: number;
  /** Check the engine invariants after every step (slow; for fuzzing). */
  check?: boolean;
}

export interface GameSpec {
  index: number;
  seed: number;
  firstPlayer: PlayerId;
  /** Deck ids by seat ("random" for generated decks). */
  decks: [string, string];
  ai: [AiName, AiName];
}

export interface GameSummary extends GameSpec {
  winner: PlayerId | null;
  reason: GameEndReason;
  turns: number;
  decisions: number;
  /** Did the player in each seat redraw the starting hand? */
  mulligans: [boolean, boolean];
  ms: number;
  error?: string;
}

/** Unordered pairs of deck indices, mirrors included: (0,0), (0,1), …, (1,1), … */
export function deckPairs(n: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) pairs.push([i, j]);
  return pairs;
}

/**
 * The game with this index. Blocks of 8 games share a pairing and cover both first players, both AI
 * seats and both deck seats, so no side gets an advantage from the order.
 */
export function gameSpec(job: SimJob, index: number): GameSpec {
  const seed = (job.seed * 1_000_003 + index) >>> 0;
  const firstPlayer = (index & 1) as PlayerId;
  const swapAi = ((index >> 1) & 1) === 1;
  const swapDecks = ((index >> 2) & 1) === 1;
  let decks: [string, string] = ["random", "random"];
  if (job.decks.length) {
    const pairs = deckPairs(job.decks.length);
    const [a, b] = pairs[Math.floor(index / 8) % pairs.length]!;
    decks = [job.decks[a]!.id, job.decks[b]!.id];
    if (swapDecks) decks = [decks[1], decks[0]];
  }
  const ai: [AiName, AiName] = swapAi ? [job.ai[1], job.ai[0]] : [job.ai[0], job.ai[1]];
  return { index, seed, firstPlayer, decks, ai };
}

/** Deck lists of a game (random decks are generated from the game's seed). */
export function specDecks(engine: Engine, job: SimJob, spec: GameSpec): [DeckList, DeckList] {
  if (!job.decks.length) {
    const rng = seedRng(spec.seed);
    return [randomDeck(engine.lib, rng), randomDeck(engine.lib, rng)];
  }
  const byId = (id: string) => job.decks.find((d) => d.id === id)!.deck;
  return [byId(spec.decks[0]), byId(spec.decks[1])];
}

export function runGame(engine: Engine, job: SimJob, index: number): GameSummary {
  const spec = gameSpec(job, index);
  const started = performance.now();
  const decks = specDecks(engine, job, spec);
  const expected: [number, number] = [
    decks[0].main.length + decks[0].resources.length,
    decks[1].main.length + decks[1].resources.length,
  ];
  try {
    const record = playMatch(
      engine,
      decks,
      { seed: spec.seed, firstPlayer: spec.firstPlayer, ...(job.maxTurns ? { maxTurns: job.maxTurns } : {}) },
      [makePolicy(spec.ai[0], engine, spec.seed * 2), makePolicy(spec.ai[1], engine, spec.seed * 2 + 1)],
      {
        onStep: job.check
          ? (state) => {
              const errors = checkInvariants(engine, state, expected);
              if (errors.length) throw new Error(errors.join("\n"));
            }
          : undefined,
      },
    );
    const redraws = record.actions.filter((a) => a.type === "redraw" || a.type === "keepHand");
    // The first two actions are the mulligan decisions, Player One first (6-2-1-6).
    const first = spec.firstPlayer;
    const mulligans: [boolean, boolean] = [false, false];
    mulligans[first] = redraws[0]?.type === "redraw";
    mulligans[first === 0 ? 1 : 0] = redraws[1]?.type === "redraw";
    return {
      ...spec,
      winner: record.result.winner,
      reason: record.result.reason,
      turns: record.result.turn,
      decisions: record.actions.length,
      mulligans,
      ms: performance.now() - started,
    };
  } catch (error) {
    return {
      ...spec,
      winner: null,
      reason: "turnLimit",
      turns: 0,
      decisions: 0,
      mulligans: [false, false],
      ms: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function runRange(engine: Engine, job: SimJob, from: number, to: number): GameSummary[] {
  const out: GameSummary[] = [];
  for (let i = from; i < to; i++) out.push(runGame(engine, job, i));
  return out;
}

/** Splits [0, total) into chunks for workers. Smaller chunks at the end keep all workers busy. */
export function chunks(total: number, workers: number): [number, number][] {
  const size = Math.max(1, Math.min(50, Math.ceil(total / (workers * 8))));
  const out: [number, number][] = [];
  for (let from = 0; from < total; from += size) out.push([from, Math.min(total, from + size)]);
  return out;
}
