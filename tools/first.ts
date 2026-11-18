// Does a deck want to go first? Every deck plays against every other with heuristic-v1, first player
// balanced; prints each deck's win rate as first and as second player and some deck figures
// (docs/AI.md "Startspieler", src/ai/turnorder.ts).
//
//   npm run first -- --games 10880
//   npm run first -- --list best --starters false --games 11520 --seed 7   best tournament list per archetype

import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { parseAiName } from "../src/ai/registry";
import { STARTER_DECKS } from "../src/data/decks";
import { metaDecks, type MetaList } from "../src/meta/decks";
import { runPool } from "../src/sim/pool";
import { fullRounds, type SimJob } from "../src/sim/runner";
import { wilson } from "../src/sim/stats";
import { loadLib, loadSnapshot } from "./lib";
import { threadWorker } from "./node-pool";

const { values: args } = parseArgs({
  options: {
    ai: { type: "string", default: "v1" },
    games: { type: "string", default: "10880" },
    seed: { type: "string", default: "5" },
    list: { type: "string", default: "consensus" },
    starters: { type: "string", default: "true" },
  },
});

const lib = loadLib();
const decks = [
  ...metaDecks(loadSnapshot(), lib, 15, args.list as MetaList).map((d) => ({
    id: d.id,
    name: d.name,
    deck: d.deck,
  })),
  ...STARTER_DECKS.map((d) => ({ id: d.id, name: d.name, deck: d.deck })),
];
// Two jobs (meta among themselves, starters among themselves), like the measurement in docs/AI.md.
const groups = [decks.filter((d) => d.id.startsWith("M"))];
if (args.starters !== "false") groups.push(decks.filter((d) => d.id.startsWith("ST")));
const ai = parseAiName(args.ai);
const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, threadWorker);
const tally = new Map<string, { first: number; firstN: number; second: number; secondN: number }>();
let firstWins = 0;
let decided = 0;
for (const group of groups) {
  const job: SimJob = {
    decks: group,
    ai: [ai, ai],
    games: fullRounds({ decks: group }, Number(args.games) / groups.length),
    seed: Number(args.seed),
  };
  const games = await runPool(job, workers, {
    onProgress: (done, total) => process.stderr.write(`\r${done}/${total} Spiele   `),
  });
  for (const g of games) {
    if (g.error) continue;
    if (g.winner !== null) {
      decided++;
      if (g.winner === g.firstPlayer) firstWins++;
    }
    if (g.decks[0] === g.decks[1]) continue; // mirrors say nothing about a deck
    for (const seat of [0, 1] as const) {
      const t = tally.get(g.decks[seat]) ?? { first: 0, firstN: 0, second: 0, secondN: 0 };
      const w = g.winner === null ? 0.5 : g.winner === seat ? 1 : 0;
      if (g.firstPlayer === seat) {
        t.first += w;
        t.firstN++;
      } else {
        t.second += w;
        t.secondN++;
      }
      tally.set(g.decks[seat], t);
    }
  }
}
process.stderr.write("\n");

const pct = (x: number) => `${(x * 100).toFixed(1)} %`.padStart(7);
const rows = [...tally].map(([id, t]) => {
  const deck = decks.find((d) => d.id === id)!.deck.main.map((no) => lib.get(no));
  return {
    id,
    first: t.first / t.firstN,
    second: t.second / t.secondN,
    n: t.firstN,
    lv1: deck.filter((c) => c.level <= 1 && c.cost <= 1).length,
    cheapUnits: deck.filter((c) => c.type === "UNIT" && c.level <= 2).length,
    avgLevel: deck.reduce((sum, c) => sum + c.level, 0) / deck.length,
  };
});
rows.sort((a, b) => b.first - b.second - (a.first - a.second));
console.log("Deck    als 1.   als 2.  Vorteil  Spiele  Lv.1/Kosten 1  Units bis Lv.2  Ø Lv.");
for (const r of rows) {
  console.log(
    `${r.id.padEnd(6)} ${pct(r.first)}  ${pct(r.second)}  ${pct(r.first - r.second)}  ${String(r.n).padStart(6)}` +
      `  ${String(r.lv1).padStart(13)}  ${String(r.cheapUnits).padStart(14)}  ${r.avgLevel.toFixed(2).padStart(5)}`,
  );
}
const [low, high] = wilson(firstWins, decided);
console.log(`Startspieler gewinnt ${pct(firstWins / decided)} (${pct(low)}–${pct(high)}, ${decided} Spiele)`);
for (const w of workers) await w.close();
process.exit(0);
