// Tunes the evaluation weights of heuristic-v1 by self-play (coordinate search): every weight is tried
// at ×0.5 and ×1.6 against the current weights; a change is kept if it wins clearly and a second,
// independent run with twice the games confirms it (with ~36 tries per round, single wins at 53 % happen
// by chance).
//
//   npm run tune -- --games 1000 --rounds 1 --decks meta
//
// Prints each step and the final weights (to copy into DEFAULT_WEIGHTS in src/ai/evaluate.ts).

import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { DEFAULT_WEIGHTS, type Weights } from "../src/ai/evaluate";
import { STARTER_DECKS } from "../src/data/decks";
import { metaDecks } from "../src/meta/decks";
import { runPool } from "../src/sim/pool";
import { fullRounds, type DeckEntry, type GameSummary, type SimJob } from "../src/sim/runner";
import { wilson } from "../src/sim/stats";
import { loadLib, loadSnapshot } from "./lib";
import { threadWorker } from "./node-pool";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "1000" },
    rounds: { type: "string", default: "1" },
    decks: { type: "string", default: "meta" },
    accept: { type: "string", default: "0.535" },
    workers: { type: "string" },
  },
});

const accept = Number(args.accept);
const decks: DeckEntry[] =
  args.decks === "starters"
    ? STARTER_DECKS.map((d) => ({ id: d.id, name: d.name, deck: d.deck }))
    : metaDecks(loadSnapshot(), loadLib(), 8).map((d) => ({ id: d.id, name: d.name, deck: d.deck }));
// Full rounds, so every pairing is played equally often (src/sim/runner.ts fullRounds).
const games = fullRounds({ decks }, Number(args.games));
const workers = Array.from(
  { length: args.workers ? Number(args.workers) : Math.max(1, availableParallelism() - 1) },
  threadWorker,
);

const KEYS = (Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]).filter(
  (k) => k !== "win" && k !== "handCap",
);

/** Score of AI slot 0 (the candidate) against slot 1, draws count half. */
function score(results: GameSummary[]): { rate: number; low: number; high: number } {
  let points = 0;
  for (const g of results) {
    if (g.winner === null) points += 0.5;
    else if (g.slots[g.winner] === 0) points += 1;
  }
  const [low, high] = wilson(points, results.length);
  return { rate: points / results.length, low, high };
}

let current: Weights = { ...DEFAULT_WEIGHTS };
let seed = 7000;
const started = performance.now();
for (let round = 1; round <= Number(args.rounds); round++) {
  for (const key of KEYS) {
    for (const factor of [0.5, 1.6]) {
      const value = current[key] === 0 ? (factor > 1 ? 1 : 0) : +(current[key] * factor).toFixed(3);
      if (value === current[key]) continue;
      const candidate: Weights = { ...current, [key]: value };
      const job: SimJob = {
        decks,
        ai: ["heuristic-v1", "heuristic-v1"],
        weights: [candidate, current],
        games,
        seed: seed++,
      };
      const s = score(await runPool(job, workers));
      let kept = s.rate >= accept;
      let confirm = "";
      if (kept) {
        const c = score(await runPool({ ...job, games: games * 2, seed: seed++ + 50_000 }, workers));
        kept = c.low > 0.5;
        confirm = `, Bestätigung ${(c.rate * 100).toFixed(1)} % (${(c.low * 100).toFixed(1)}–${(c.high * 100).toFixed(1)})`;
      }
      console.log(
        `R${round} ${key} ${current[key]} → ${value}: ${(s.rate * 100).toFixed(1)} % ` +
          `(${(s.low * 100).toFixed(1)}–${(s.high * 100).toFixed(1)})${confirm}${kept ? "  ✓ übernommen" : ""}` +
          `  [${((performance.now() - started) / 60000).toFixed(1)} min]`,
      );
      if (kept) {
        current = candidate;
        break;
      }
    }
  }
}
console.log("\nGewichte:", JSON.stringify(current, null, 2));
await Promise.all(workers.map((w) => w.close()));
