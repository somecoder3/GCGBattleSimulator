// A/B comparison of two variants of the same AI (docs/AI.md): every game has variant A in one seat and B
// in the other; seats, first player and deck seats are balanced (runner blocks of 8).
//
//   npm run ab -- --ai v0 --a default --b eager-commands --games 9216
//   npm run ab -- --ai v1 --a default --b mulligan-basic

import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import type { RuleOptions } from "../src/ai/heuristic";
import type { MulliganRule } from "../src/ai/mulligan";
import { parseAiName } from "../src/ai/registry";
import { metaDecks } from "../src/meta/decks";
import { runPool } from "../src/sim/pool";
import { fullRounds, type SimJob } from "../src/sim/runner";
import { wilson } from "../src/sim/stats";
import { loadLib, loadSnapshot } from "./lib";
import { threadWorker } from "./node-pool";

/** Named variants: the current rules, or one old/alternative rule. */
const VARIANTS: Record<string, { mulligan?: MulliganRule; rules?: RuleOptions }> = {
  default: {},
  "eager-commands": { rules: { eagerCommands: true } },
  "eager-main-commands": { rules: { eagerMainCommands: true } },
  /** Both Command rules as before 18 Nov 2026. */
  "old-commands": { rules: { eagerCommands: true, eagerMainCommands: true } },
  "mulligan-basic": { mulligan: "basic" },
  "mulligan-never": { mulligan: "never" },
};

const { values: args } = parseArgs({
  options: {
    ai: { type: "string", default: "v1" },
    a: { type: "string", default: "default" },
    b: { type: "string" },
    games: { type: "string", default: "9216" },
    seed: { type: "string", default: "21" },
    decks: { type: "string", default: "8" },
  },
});
const a = VARIANTS[args.a];
const b = args.b ? VARIANTS[args.b] : undefined;
if (!a || !b) throw new Error(`--a/--b: one of ${Object.keys(VARIANTS).join(", ")}`);

const ai = parseAiName(args.ai);
const decks = metaDecks(loadSnapshot(), loadLib(), Number(args.decks)).map((d) => ({
  id: d.id,
  name: d.name,
  deck: d.deck,
}));
const job: SimJob = {
  decks,
  ai: [ai, ai],
  mulligans: [a.mulligan ?? null, b.mulligan ?? null],
  rules: [a.rules ?? null, b.rules ?? null],
  games: fullRounds({ decks }, Number(args.games)),
  seed: Number(args.seed),
};
const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, threadWorker);
const started = performance.now();
const games = await runPool(job, workers, {
  onProgress: (done, total) => process.stderr.write(`\r${done}/${total} Spiele   `),
});
process.stderr.write(`\r${games.length} Spiele in ${((performance.now() - started) / 1000).toFixed(0)} s\n`);

let wins = 0;
let n = 0;
let errors = 0;
for (const g of games) {
  if (g.error) {
    errors++;
    continue;
  }
  n++;
  const seatA = g.slots[0] === 0 ? 0 : 1;
  wins += g.winner === null ? 0.5 : g.winner === seatA ? 1 : 0;
}
const [low, high] = wilson(wins, n);
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
console.log(`${ai}: ${args.a} gegen ${args.b}: ${pct(wins / n)} (${pct(low)}–${pct(high)}, ${n} Spiele)`);
if (errors) console.log(`${errors} Spiele mit Fehler`);
for (const w of workers) await w.close();
process.exit(0);
