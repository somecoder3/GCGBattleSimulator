// Mulligan study (docs/AI.md "Mulligan"): which starting hands win less than the average?
//
//   npm run mulligan -- --games 9216          v1 self-play with the meta decks, every hand kept
//   npm run mulligan -- --compare basic,hand  A/B: rule A against rule B (v1 vs v1)
//
// A redraw gives a random new hand of the same deck, so its expected result is the average win rate of
// that deck in that position (Player One or Two). A rule should redraw exactly the hands below it.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import { MULLIGAN_RULES, type MulliganRule } from "../src/ai/mulligan";
import type { EngineCard } from "../src/engine/cardlib";
import { metaDecks } from "../src/meta/decks";
import { runPool } from "../src/sim/pool";
import { fullRounds, type GameSummary, type SimJob } from "../src/sim/runner";
import { wilson } from "../src/sim/stats";
import { loadLib, loadSnapshot } from "./lib";
import { threadWorker } from "./node-pool";

const { values: args } = parseArgs({
  options: {
    games: { type: "string", default: "9216" },
    seed: { type: "string", default: "11" },
    decks: { type: "string", default: "8" },
    ai: { type: "string", default: "heuristic-v1" },
    compare: { type: "string" },
    /** Analyse the hands of an earlier study instead of playing (build/mulligan-hands.json). */
    load: { type: "boolean", default: false },
  },
});

const lib = loadLib();
const decks = metaDecks(loadSnapshot(), lib, Number(args.decks)).map((d) => ({
  id: d.id,
  name: d.name,
  deck: d.deck,
}));
const ai = args.ai as SimJob["ai"][0];
const workers = Array.from({ length: Math.max(1, availableParallelism() - 1) }, threadWorker);

async function run(job: SimJob): Promise<GameSummary[]> {
  const started = performance.now();
  const games = await runPool(job, workers, {
    onProgress: (done, total) => process.stderr.write(`\r${done}/${total} Spiele   `),
  });
  process.stderr.write(
    `\r${games.length} Spiele in ${((performance.now() - started) / 1000).toFixed(0)} s\n`,
  );
  return games;
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

if (args.compare) {
  const [a, b] = args.compare.split(",") as [MulliganRule, MulliganRule];
  for (const r of [a, b]) if (!MULLIGAN_RULES.includes(r)) throw new Error(`unknown rule ${r}`);
  const job: SimJob = {
    decks,
    ai: [ai, ai],
    mulligans: [a, b],
    games: fullRounds({ decks }, Number(args.games)),
    seed: Number(args.seed),
  };
  const games = await run(job);
  let wins = 0;
  let n = 0;
  const redraws = [0, 0];
  for (const g of games) {
    for (const seat of [0, 1] as const) if (g.mulligans[seat]) redraws[g.slots[seat]]!++;
    if (g.error) continue;
    n++;
    const seatA = g.slots[0] === 0 ? 0 : 1;
    wins += g.winner === null ? 0.5 : g.winner === seatA ? 1 : 0;
  }
  const w = wilson(wins, n);
  console.log(`${a} gegen ${b}: ${pct(wins / n)} (${pct(w[0])}–${pct(w[1])}, ${n} Spiele)`);
  console.log(`Mulligans: ${a} ${pct(redraws[0]! / games.length)}, ${b} ${pct(redraws[1]! / games.length)}`);
  for (const w of workers) await w.close();
  process.exit(0);
}

// --- Study: every hand kept --------------------------------------------------------------------------

const HANDS_FILE = "build/mulligan-hands.json";
const job: SimJob = {
  decks,
  ai: [ai, ai],
  mulligans: ["never", "never"],
  cardStats: true,
  games: fullRounds({ decks }, Number(args.games)),
  seed: Number(args.seed),
};
const games = args.load ? [] : await run(job);

interface Hand {
  deck: string;
  first: boolean;
  cards: EngineCard[];
  result: number;
}
const hands: Hand[] = [];
for (const g of games) {
  if (g.error || !g.cards) continue;
  for (const seat of [0, 1] as const) {
    hands.push({
      deck: g.decks[seat],
      first: g.firstPlayer === seat,
      cards: g.cards[seat].opening.map((no) => lib.get(no)),
      result: g.winner === null ? 0.5 : g.winner === seat ? 1 : 0,
    });
  }
}
type Saved = { deck: string; first: boolean; cards: string[]; result: number };
if (args.load) {
  const saved = JSON.parse(readFileSync(HANDS_FILE, "utf8")) as Saved[];
  for (const h of saved) hands.push({ ...h, cards: h.cards.map((no) => lib.get(no)) });
} else {
  mkdirSync("build", { recursive: true });
  const saved: Saved[] = hands.map((h) => ({ ...h, cards: h.cards.map((c) => c.no) }));
  writeFileSync(HANDS_FILE, JSON.stringify(saved));
}
// Note: `opening` is the hand at the start of turn 1; Player One has drawn no card yet, Player Two neither.
const base = new Map<string, { sum: number; n: number }>();
const key = (h: Hand) => `${h.deck}:${h.first}`;
for (const h of hands) {
  const b = base.get(key(h)) ?? { sum: 0, n: 0 };
  b.sum += h.result;
  b.n++;
  base.set(key(h), b);
}
const expected = (h: Hand) => base.get(key(h))!.sum / base.get(key(h))!.n;

type Feature = (h: Hand) => number | string;
const units = (h: Hand, max: number, min = 0) =>
  h.cards.filter((c) => c.type === "UNIT" && c.level <= max && c.level >= min).length;
const FEATURES: Record<string, Feature> = {
  "Units bis Lv.2": (h) => units(h, 2),
  "Units bis Lv.3": (h) => units(h, 3),
  "Units bis Lv.4": (h) => units(h, 4),
  "Karten bis Lv.4": (h) => h.cards.filter((c) => c.level <= 4).length,
  "Karten ab Lv.6": (h) => h.cards.filter((c) => c.level >= 6).length,
  "Units gesamt": (h) => units(h, 99),
  Piloten: (h) => h.cards.filter((c) => c.type === "PILOT").length,
  Commands: (h) => h.cards.filter((c) => c.type === "COMMAND").length,
  "Basic-Regel behält": (h) =>
    h.cards.some((c) => c.type === "UNIT" && c.level <= 3) || h.cards.filter((c) => c.level <= 4).length >= 2
      ? "ja"
      : "nein",
};

console.log(
  `\n${hands.length} Starthände (alle behalten); Abweichung = Siegquote − Mittel des Decks auf der Position\n`,
);
for (const [name, f] of Object.entries(FEATURES)) {
  const groups = new Map<string, { sum: number; exp: number; n: number }>();
  for (const h of hands) {
    const v = String(f(h));
    const g = groups.get(v) ?? { sum: 0, exp: 0, n: 0 };
    g.sum += h.result;
    g.exp += expected(h);
    g.n++;
    groups.set(v, g);
  }
  console.log(name);
  for (const [v, g] of [...groups].sort((x, y) =>
    String(x[0]).localeCompare(String(y[0]), "de", { numeric: true }),
  )) {
    const dev = (g.sum - g.exp) / g.n;
    console.log(
      `  ${v.padStart(4)}: ${String(g.n).padStart(5)} Hände (${pct(g.n / hands.length).padStart(7)}), Abweichung ${(dev >= 0 ? "+" : "") + pct(dev)}`,
    );
  }
}

// Two-dimensional view: Units up to Lv.3 × cards up to Lv.4.
console.log("\nUnits bis Lv.3 (Zeile) × Karten bis Lv.4 (Spalte): Abweichung (Anzahl)");
const grid = new Map<string, { d: number; n: number }>();
for (const h of hands) {
  const k = `${units(h, 3)}:${h.cards.filter((c) => c.level <= 4).length}`;
  const g = grid.get(k) ?? { d: 0, n: 0 };
  g.d += h.result - expected(h);
  g.n++;
  grid.set(k, g);
}
for (let u = 0; u <= 5; u++) {
  const row: string[] = [];
  for (let l = 0; l <= 5; l++) {
    const g = grid.get(`${u}:${l}`);
    row.push(
      g && g.n >= 30
        ? `${(g.d / g.n >= 0 ? "+" : "") + ((g.d / g.n) * 100).toFixed(0).padStart(3)}% (${g.n})`.padEnd(14)
        : "".padEnd(14),
    );
  }
  console.log(`  ${u}: ${row.join("")}`);
}

// Estimated gain of a rule: redrawing a hand gains (average − its result) on average.
const RULES: Record<string, (h: Hand) => boolean> = {
  basic: (h) => FEATURES["Basic-Regel behält"]!(h) === "ja",
  "u4>=1": (h) => units(h, 4) >= 1,
  "u4>=2": (h) => units(h, 4) >= 2,
  "u4>=1&u>=2": (h) => units(h, 4) >= 1 && units(h, 99) >= 2,
  "u4>=1&u>=2|u3>=2": (h) => (units(h, 4) >= 1 && units(h, 99) >= 2) || units(h, 3) >= 2,
  "u4>=1&low>=3": (h) => units(h, 4) >= 1 && h.cards.filter((c) => c.level <= 4).length >= 3,
  "u4>=2|u3>=1&u>=2": (h) => units(h, 4) >= 2 || (units(h, 3) >= 1 && units(h, 99) >= 2),
  "u4>=2|u4>=1&u>=3": (h) => units(h, 4) >= 2 || (units(h, 4) >= 1 && units(h, 99) >= 3),
  "u4>=2&u>=3": (h) => units(h, 4) >= 2 && units(h, 99) >= 3,
  "u4>=3": (h) => units(h, 4) >= 3,
  "u4>=2&big<=1": (h) => units(h, 4) >= 2 && h.cards.filter((c) => c.level >= 6).length <= 1,
  "score>=2": (h) => units(h, 4) + 0.5 * units(h, 3) + 0.25 * (units(h, 99) - units(h, 4)) >= 2,
  "score>=2.5": (h) => units(h, 4) + 0.5 * units(h, 3) + 0.25 * (units(h, 99) - units(h, 4)) >= 2.5,
};
console.log("\nGeschätzter Gewinn je Regel (Prozentpunkte Siegquote pro Spiel):");
for (const [name, keep] of Object.entries(RULES)) {
  let gain = 0;
  let redraw = 0;
  const half = [0, 0];
  hands.forEach((h, i) => {
    if (keep(h)) return;
    redraw++;
    gain += expected(h) - h.result;
    half[i % 2]! += expected(h) - h.result;
  });
  const n = hands.length;
  const points = (x: number, of: number) => ((x / of) * 100).toFixed(2);
  console.log(
    `  ${name.padEnd(18)} Mulligan ${pct(redraw / n).padStart(7)}, Gewinn ${points(gain, n)} Pkt. ` +
      `(Hälften ${points(half[0]!, n / 2)} / ${points(half[1]!, n / 2)})`,
  );
}
for (const w of workers) await w.close();
process.exit(0);
