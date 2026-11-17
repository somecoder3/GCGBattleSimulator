// Plays many games headless on all cores and prints statistics.
//
//   npm run sim -- --games 10000                          random decks, random AI
//   npm run sim -- --ai v1,random --decks starters        AI comparison with the starter decks
//   npm run sim -- --ai v1 --decks starters --games 4000  deck matrix (both sides the same AI)
//   npm run sim -- --decks ST01,ST03                      only these decks
//   npm run sim -- --games 100000 --check                 invariants after every step (fuzzing)
//   npm run sim -- --workers 0                            in this process (for profiling)
//   npm run sim -- --json out.json                        write all game summaries
//
//   npm run sim -- --ai v1 --decks meta                    the 8 most played archetypes (meta12: 12, …)
//
// AIs: random, v0 (heuristic-v0), v1 (heuristic-v1, = heuristic). Decks: random, starters, meta[N] or a
// list of ids (ST01, M01, …).

import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { parseAiName } from "../src/ai/registry";
import { STARTER_DECKS } from "../src/data/decks";
import { Engine } from "../src/engine/engine";
import { runPool } from "../src/sim/pool";
import { fullRounds, runRange, type DeckEntry, type GameSummary, type SimJob } from "../src/sim/runner";
import { computeStats, formatStats } from "../src/sim/stats";
import { loadLib, loadSnapshot } from "./lib";
import { threadWorker } from "./node-pool";
import { metaDecks } from "../src/meta/decks";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "1000" },
    seed: { type: "string", default: "1" },
    check: { type: "boolean", default: false },
    verbose: { type: "boolean", default: false },
    ai: { type: "string", default: "random,random" },
    decks: { type: "string", default: "random" },
    workers: { type: "string" },
    "max-turns": { type: "string" },
    json: { type: "string" },
  },
});

const ai = args.ai.split(",").map(parseAiName);
if (ai.length === 1) ai.push(ai[0]!);

function decks(spec: string): DeckEntry[] {
  if (spec === "random") return [];
  const starters = STARTER_DECKS.map((d) => ({ id: d.id, name: `${d.id} ${d.name}`, deck: d.deck }));
  if (spec === "starters") return starters;
  const meta = metaDecks(loadSnapshot(), loadLib()).map((d) => ({
    id: d.id,
    name: `${d.id} ${d.name}${d.supported ? "" : " (unvollständig)"}`,
    deck: d.deck,
  }));
  const metaMatch = spec.match(/^meta(\d+)?$/);
  if (metaMatch) return meta.slice(0, Number(metaMatch[1] ?? 8));
  const all = [...starters, ...meta];
  return spec.split(",").map((id) => {
    const deck = all.find((d) => d.id === id.trim().toUpperCase());
    if (!deck)
      throw new Error(`unknown deck ${id} (known: random, starters, ${all.map((d) => d.id).join(", ")})`);
    return deck;
  });
}

const jobDecks = decks(args.decks);
const job: SimJob = {
  decks: jobDecks,
  ai: [ai[0]!, ai[1]!],
  // Every pairing equally often (src/sim/runner.ts fullRounds).
  games: fullRounds({ decks: jobDecks }, Number(args.games)),
  seed: Number(args.seed),
  ...(args["max-turns"] ? { maxTurns: Number(args["max-turns"]) } : {}),
  ...(args.check ? { check: true } : {}),
};
const workerCount =
  args.workers === undefined ? Math.max(1, availableParallelism() - 1) : Number(args.workers);

const started = performance.now();
let lastPrint = 0;
const progress = (done: number, total: number) => {
  const now = performance.now();
  if (now - lastPrint < 1000 && done < total) return;
  lastPrint = now;
  const seconds = (now - started) / 1000;
  const eta = done ? (seconds / done) * (total - done) : 0;
  process.stderr.write(`\r${done}/${total} Spiele, ${seconds.toFixed(0)} s, noch ~${eta.toFixed(0)} s   `);
};

let games: GameSummary[];
if (workerCount === 0) {
  const engine = new Engine(loadLib());
  games = [];
  for (let from = 0; from < job.games; from += 100) {
    games.push(...runRange(engine, job, from, Math.min(job.games, from + 100)));
    progress(games.length, job.games);
  }
} else {
  const workers = Array.from({ length: Math.min(workerCount, job.games) }, threadWorker);
  games = await runPool(job, workers, { onProgress: progress });
  await Promise.all(workers.map((w) => w.close()));
}
process.stderr.write("\n");

const seconds = (performance.now() - started) / 1000;
const stats = computeStats(games);
const names = Object.fromEntries(job.decks.map((d) => [d.id, d.name]));
console.log(
  `${job.games} Spiele in ${seconds.toFixed(1)} s mit ${workerCount || "0 (ohne)"} Workern ` +
    `(${((seconds * 1000) / Math.max(1, job.games)).toFixed(2)} ms pro Spiel insgesamt); ` +
    `KI ${job.ai.join(" gegen ")}, Decks ${args.decks}, Seed ${job.seed}${job.check ? ", Invarianten geprüft" : ""}`,
);
console.log(formatStats(stats, names));

const failed = games.filter((g) => g.error);
for (const g of failed.slice(0, args.verbose ? failed.length : 5)) {
  console.error(`Spiel ${g.index} (Seed ${g.seed}) fehlgeschlagen: ${g.error}`);
}
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ job, games }, null, 1));
  console.log(`Ergebnisse: ${args.json}`);
}
process.exit(failed.length ? 1 : 0);
