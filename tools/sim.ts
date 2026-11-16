// Plays many games headless and prints statistics.
//
//   npm run sim -- --games 10000                 random decks, random play
//   npm run sim -- --games 100000 --check        also check invariants after every step (fuzzing)
//   npm run sim -- --seed 42 --games 1 --verbose print the result of each game
//   npm run sim -- --ai heuristic,random --decks starters   AIs per side, starter decks instead of random

import { parseArgs } from "node:util";
import { HeuristicPolicy } from "../src/ai/heuristic";
import { RandomPolicy } from "../src/ai/random";
import type { Policy } from "../src/ai/types";
import { STARTER_DECKS } from "../src/data/decks";
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
    ai: { type: "string", default: "random,random" },
    decks: { type: "string", default: "random" },
  },
});

const aiNames = args.ai.split(",");
if (aiNames.length === 1) aiNames.push(aiNames[0]!);
for (const name of aiNames)
  if (name !== "random" && name !== "heuristic") throw new Error(`unknown AI ${name}`);
if (args.decks !== "random" && args.decks !== "starters") throw new Error(`unknown deck set ${args.decks}`);

const games = Number(args.games);
const baseSeed = Number(args.seed);
const lib = loadLib();
const engine = new Engine(lib);

const reasons: Record<GameEndReason, number> = { damage: 0, deckOut: 0, turnLimit: 0, concede: 0 };
let firstWins = 0;
const sideWins = [0, 0];
let decided = 0;
let turns = 0;
let decisions = 0;
let failures = 0;
const started = performance.now();

for (let g = 0; g < games; g++) {
  const seed = (baseSeed * 1_000_003 + g) >>> 0;
  const rng = seedRng(seed);
  const decks: [DeckList, DeckList] =
    args.decks === "starters"
      ? [STARTER_DECKS[g % 4]!.deck, STARTER_DECKS[Math.floor(g / 4) % 4]!.deck]
      : [randomDeck(lib, rng), randomDeck(lib, rng)];
  for (const deck of decks) {
    const errors = validateDeck(lib, deck);
    if (errors.length) throw new Error(`seed ${seed}: generated an illegal deck: ${errors.join("; ")}`);
  }
  const options = { seed, firstPlayer: (Math.floor(g / 16) % 2) as 0 | 1 };
  const policy = (side: 0 | 1): Policy =>
    aiNames[side] === "heuristic" ? new HeuristicPolicy(engine) : new RandomPolicy(seed * 2 + side);
  const expected: [number, number] = [60, 60];
  try {
    const record = playMatch(engine, decks, options, [policy(0), policy(1)], {
      onStep: args.check
        ? (state) => {
            const errors = checkInvariants(engine, state, expected);
            if (errors.length) throw new Error(errors.join("\n"));
          }
        : undefined,
    });
    const { result } = record;
    reasons[result.reason]++;
    turns += result.turn;
    decisions += record.actions.length;
    if (result.winner !== null) {
      decided++;
      if (result.winner === options.firstPlayer) firstWins++;
      sideWins[result.winner]!++;
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
    `side 0 (${aiNames[0]}) wins ${((sideWins[0]! / played) * 100).toFixed(1)} %, side 1 (${aiNames[1]}) ${((sideWins[1]! / played) * 100).toFixed(1)} %`,
    `first player wins ${((firstWins / Math.max(1, decided)) * 100).toFixed(1)} % of decided games`,
    args.check ? `invariants checked after every step, ${failures} failures` : "",
  ]
    .filter(Boolean)
    .join("\n"),
);
process.exit(failures ? 1 : 0);
