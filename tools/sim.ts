// Plays many games headless and prints statistics.
//
//   npm run sim -- --games 10000                 random decks, random play
//   npm run sim -- --games 100000 --check        also check invariants after every step (fuzzing)
//   npm run sim -- --seed 42 --games 1 --verbose print the result of each game

import { parseArgs } from "node:util";
import { RandomPolicy } from "../src/ai/random";
import { randomDeck, validateDeck } from "../src/engine/deck";
import { Engine } from "../src/engine/engine";
import { checkInvariants } from "../src/engine/invariants";
import { seedRng } from "../src/engine/rng";
import type { DeckList, GameEndReason } from "../src/engine/types";
import { playMatch } from "../src/sim/match";
import { loadLib } from "./lib";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "1000" },
    seed: { type: "string", default: "1" },
    check: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
  },
});

const games = Number(args.games);
const baseSeed = Number(args.seed);
const lib = loadLib();
const engine = new Engine(lib);

const reasons: Record<GameEndReason, number> = { damage: 0, deckOut: 0, turnLimit: 0, concede: 0 };
let firstWins = 0;
let decided = 0;
let turns = 0;
let decisions = 0;
let failures = 0;
const started = performance.now();

for (let g = 0; g < games; g++) {
  const seed = (baseSeed * 1_000_003 + g) >>> 0;
  const rng = seedRng(seed);
  const decks: [DeckList, DeckList] = [randomDeck(lib, rng), randomDeck(lib, rng)];
  for (const deck of decks) {
    const errors = validateDeck(lib, deck);
    if (errors.length) throw new Error(`seed ${seed}: generated an illegal deck: ${errors.join("; ")}`);
  }
  const options = { seed, firstPlayer: (g % 2) as 0 | 1 };
  const expected: [number, number] = [60, 60];
  try {
    const record = playMatch(
      engine,
      decks,
      options,
      [new RandomPolicy(seed * 2), new RandomPolicy(seed * 2 + 1)],
      {
        onStep: args.check
          ? (state) => {
              const errors = checkInvariants(engine, state, expected);
              if (errors.length) throw new Error(errors.join("\n"));
            }
          : undefined,
      },
    );
    const { result } = record;
    reasons[result.reason]++;
    turns += result.turn;
    decisions += record.actions.length;
    if (result.winner !== null) {
      decided++;
      if (result.winner === options.firstPlayer) firstWins++;
    }
    if (args.verbose)
      console.log(`seed ${seed}: ${JSON.stringify(result)} after ${record.actions.length} actions`);
  } catch (error) {
    failures++;
    console.error(`seed ${seed} (game ${g}) failed:`, error instanceof Error ? error.message : error);
    if (failures >= 5) break;
  }
}

const seconds = (performance.now() - started) / 1000;
const played = games - failures;
console.log(
  [
    `${played} games in ${seconds.toFixed(1)} s (${((seconds * 1000) / Math.max(1, played)).toFixed(2)} ms/game)`,
    `end: ${Object.entries(reasons)
      .filter(([, n]) => n)
      .map(([r, n]) => `${r} ${((n / played) * 100).toFixed(1)} %`)
      .join(", ")}`,
    `avg ${(turns / played).toFixed(1)} turns, ${(decisions / played).toFixed(0)} decisions`,
    `first player wins ${((firstWins / Math.max(1, decided)) * 100).toFixed(1)} % of decided games`,
    args.check ? `invariants checked after every step, ${failures} failures` : "",
  ]
    .filter(Boolean)
    .join("\n"),
);
process.exit(failures ? 1 : 0);
