// Match runner: a simulation job is a plain description (decks, AIs, number of games, seed). Every
// game follows from the job and its index alone, so workers only need the job and a range of indices,
// and any game can be replayed later from (job, index).

import type { RuleOptions } from "../ai/heuristic";
import type { MulliganRule } from "../ai/mulligan";
import type { Weights } from "../ai/evaluate";
import { makePolicy, type AiName } from "../ai/registry";
import type { Policy } from "../ai/types";
import { randomDeck } from "../engine/deck";
import type { Engine } from "../engine/engine";
import { checkInvariants } from "../engine/invariants";
import { seedRng } from "../engine/rng";
import type {
  Action,
  DeckList,
  GameEndReason,
  GameEvent,
  GameOptions,
  GameState,
  PlayerId,
} from "../engine/types";
import { playMatch } from "./match";

export interface DeckEntry {
  id: string;
  name: string;
  deck: DeckList;
}

export interface SimJob {
  /** Decks to pair with each other (every pair once). Empty: random legal decks. */
  decks: DeckEntry[];
  /**
   * Also play each deck against itself (default true; the simulator screen and `npm run sim` leave them
   * out: the deck win rates ignore mirrors anyway). Rule comparisons (`npm run ab`, `tune`) keep them.
   */
  mirrors?: boolean;
  /** "gauntlet": only the deck `focus` against every other deck (no mirror). Default: every pair. */
  mode?: "pairs" | "gauntlet";
  focus?: string;
  /** Meta share per deck id, for the meta-weighted win rate. */
  shares?: Record<string, number>;
  /** Record opening hand, drawn and played cards per seat (card statistics). */
  cardStats?: boolean;
  /** The two AIs. If they differ, each plays each deck of a pairing equally often. */
  ai: [AiName, AiName];
  /** Evaluation weights for heuristic-v1 per AI of `ai` (tuning: the same AI with other weights). */
  weights?: [Partial<Weights> | null, Partial<Weights> | null];
  /** Mulligan rule per AI of `ai` (comparison of rules; default: the AI's own). */
  mulligans?: [MulliganRule | null, MulliganRule | null];
  /** Other v0 rules per AI of `ai` (comparison of rules). */
  rules?: [RuleOptions | null, RuleOptions | null];
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
  /** Which AI of the job (0 or 1) plays in each seat. */
  slots: [0 | 1, 0 | 1];
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
  /** Card numbers per seat (with `job.cardStats`). */
  cards?: [SeatCards, SeatCards];
}

export interface SeatCards {
  /** The hand at the start of the first turn (after mulligans). */
  opening: string[];
  /** Every card that came into the hand (drawn, from Shields or effects), opening hand included (each once). */
  drawn: string[];
  /** Cards played from the hand: deployed, paired or activated as a Command (each number once). */
  played: string[];
}

/** Unordered pairs of deck indices: (0,0), (0,1), …, (1,1), … (without (i,i) if `mirrors` is false). */
export function deckPairs(n: number, mirrors = true): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = mirrors ? i : i + 1; j < n; j++) pairs.push([i, j]);
  return pairs;
}

type PairingSpec = Pick<SimJob, "decks" | "mode" | "focus" | "mirrors">;

/** The pairings of a job (indices into job.decks). */
export function jobPairs(job: PairingSpec): [number, number][] {
  if (job.mode === "gauntlet") {
    const focus = Math.max(
      0,
      job.decks.findIndex((d) => d.id === job.focus),
    );
    return job.decks.flatMap((_, i): [number, number][] => (i === focus ? [] : [[focus, i]]));
  }
  // A single deck can only play itself.
  return deckPairs(job.decks.length, job.mirrors !== false || job.decks.length < 2);
}

/** Games in one round: a block of 8 for every pairing (8 with random decks). */
export function roundSize(job: PairingSpec): number {
  return 8 * (job.decks.length ? Math.max(1, jobPairs(job).length) : 1);
}

/**
 * The wanted number of games rounded up to full rounds. Game i plays pairing ⌊i / 8⌋ mod pairings, so
 * with fewer games only the first pairings would be played, and with a partial last round the first
 * pairings would get one block more than the rest.
 */
export function fullRounds(job: PairingSpec, wanted: number): number {
  const size = roundSize(job);
  return Math.max(1, Math.ceil(Math.max(1, Math.floor(wanted)) / size)) * size;
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
    const pairs = jobPairs(job);
    const [a, b] = pairs.length ? pairs[Math.floor(index / 8) % pairs.length]! : [0, 0];
    decks = [job.decks[a]!.id, job.decks[b]!.id];
    if (swapDecks) decks = [decks[1], decks[0]];
  }
  const slots: [0 | 1, 0 | 1] = swapAi ? [1, 0] : [0, 1];
  const ai: [AiName, AiName] = [job.ai[slots[0]], job.ai[slots[1]]];
  return { index, seed, firstPlayer, decks, ai, slots };
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
  const seatCards: [SeatCards, SeatCards] = [
    { opening: [], drawn: [], played: [] },
    { opening: [], drawn: [], played: [] },
  ];
  const add = (list: string[], no: string) => void (list.includes(no) || list.push(no));
  let openingDone = false;
  const collect = (state: GameState, events: GameEvent[]) => {
    for (const e of events) {
      if (e.t === "turnStart" && !openingDone) {
        openingDone = true;
        for (const p of [0, 1] as const) {
          for (const id of state.players[p].hand) add(seatCards[p].opening, state.cards[id]!.no);
        }
      }
      if (e.t === "draw") add(seatCards[e.player].drawn, state.cards[e.card]!.no);
      else if (e.t === "toHand" && e.from !== "battle" && e.from !== "pilot") {
        // Shields, searched or recovered cards: in the hand as if drawn.
        const card = state.cards[e.card]!;
        add(seatCards[card.owner].drawn, card.no);
      } else if (e.t === "deploy" || e.t === "pair" || e.t === "play") {
        const card = state.cards[e.card]!;
        if (!card.token) add(seatCards[card.owner].played, card.no);
      }
    }
  };
  try {
    const record = playMatch(
      engine,
      decks,
      { seed: spec.seed, firstPlayer: spec.firstPlayer, ...(job.maxTurns ? { maxTurns: job.maxTurns } : {}) },
      [0, 1].map((seat) =>
        makePolicy(
          spec.ai[seat]!,
          engine,
          spec.seed * 2 + seat,
          job.weights?.[spec.slots[seat]!] ?? undefined,
          {
            deck: decks[seat],
            // The field: the decks of this simulation (equally likely); random decks give no field.
            field: job.decks.map((d) => ({ deck: d.deck, weight: 1 })),
          },
          job.mulligans?.[spec.slots[seat]!] ?? undefined,
          job.rules?.[spec.slots[seat]!] ?? {},
        ),
      ) as [Policy, Policy],
      {
        onStep:
          job.check || job.cardStats
            ? (state, events) => {
                if (job.cardStats) collect(state, events);
                if (!job.check) return;
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
      ...(job.cardStats ? { cards: seatCards } : {}),
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

/** Plays game `index` of a job again and returns everything needed to watch it (replay). */
export function recordGame(
  engine: Engine,
  job: SimJob,
  index: number,
): { spec: GameSpec; decks: [DeckList, DeckList]; options: GameOptions; actions: Action[] } {
  const spec = gameSpec(job, index);
  const decks = specDecks(engine, job, spec);
  const options: GameOptions = {
    seed: spec.seed,
    firstPlayer: spec.firstPlayer,
    ...(job.maxTurns ? { maxTurns: job.maxTurns } : {}),
  };
  const policies = [0, 1].map((seat) =>
    makePolicy(
      spec.ai[seat]!,
      engine,
      spec.seed * 2 + seat,
      job.weights?.[spec.slots[seat]!] ?? undefined,
      { deck: decks[seat], field: job.decks.map((d) => ({ deck: d.deck, weight: 1 })) },
      job.mulligans?.[spec.slots[seat]!] ?? undefined,
      job.rules?.[spec.slots[seat]!] ?? {},
    ),
  ) as [Policy, Policy];
  const record = playMatch(engine, decks, options, policies);
  return { spec, decks, options, actions: record.actions };
}
