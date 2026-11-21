// A/B comparison of two variants of the same AI (docs/AI.md): every game has variant A in one seat and B
// in the other; seats, first player and deck seats are balanced (runner blocks of 8).
//
//   npm run ab -- --ai v0 --a default --b eager-commands --games 9216
//   npm run ab -- --ai v1 --a default --b mulligan-basic
//   npm run ab -- --ai v0 --a default --b plain-rest --by-deck   also the share of A per deck of A
//   npm run ab -- --ai v1 --b plain-fights --decks ST12,ST12X,ST01,ST02   starter decks and test lists

import { availableParallelism } from "node:os";
import { parseArgs } from "node:util";
import type { RuleOptions } from "../src/ai/heuristic";
import type { MulliganRule } from "../src/ai/mulligan";
import { parseAiName } from "../src/ai/registry";
import { STARTER_DECKS, TEST_DECKS, type NamedDeck } from "../src/data/decks";
import { metaDecks, type MetaList } from "../src/meta/decks";
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
  "late-draw": { rules: { lateDraw: true } },
  "plain-ap-targets": { rules: { plainApTargets: true } },
  "plain-rest": { rules: { plainRest: true } },
  fuel: { rules: { comboFuel: true } },
  links: { rules: { linkValue: true } },
  round: { rules: { horizon: "round" } },
  turn: { rules: { horizon: "turn" } },
  through: { rules: { horizon: "through" } },
  "pair-any-pilot": { rules: { pairAnyPilot: true } },
  "plain-trash-cost": { rules: { plainTrashCost: true } },
  "plain-link-keep": { rules: { plainLinkKeep: true } },
  "plain-shining": { rules: { plainTrashCost: true, plainLinkKeep: true } },
  "sampled-opponent": { rules: { sampledOpponent: true } },
  "forced-filler": { rules: { forcedFiller: true } },
  combos: { rules: { comboFuel: true, linkValue: true } },
  "idle-commands": { rules: { searchIdleCommands: true } },
  /** Both Command rules as before 18 Nov 2026. */
  "old-commands": { rules: { eagerCommands: true, eagerMainCommands: true } },
  // EX Resource rules (docs/AI.md "EX Resource"; default: ex-deck+link). "ex-free": the rule before 18 Nov 2026;
  "ex-free": { rules: { ex: "free" } },
  // "+link": a linking Pilot may use it, "+sos": also without Units.
  "ex-never": { rules: { ex: "never" } },
  "ex-hand": { rules: { ex: "hand" } },
  "ex-hand+link": { rules: { ex: "hand", exLink: true } },
  "ex-hand+link+sos": { rules: { ex: "hand", exLink: true, exEmergency: true } },
  "ex-deck": { rules: { ex: "deck" } },
  "ex-deck+link": { rules: { ex: "deck", exLink: true } },
  "ex-level5": { rules: { ex: "level", exLevel: 5 } },
  "ex-level7": { rules: { ex: "level", exLevel: 7 } },
  "ex-level8": { rules: { ex: "level", exLevel: 8 } },
  "ex-level9": { rules: { ex: "level", exLevel: 9 } },
  "ex-link-only": { rules: { ex: "never", exLink: true } },
  // Default plus: a Command may use it from level N on.
  "ex-cmd3": { rules: { ex: "deck", exLink: true, exCommandLevel: 3 } },
  "ex-cmd4": { rules: { ex: "deck", exLink: true, exCommandLevel: 4 } },
  "ex-cmd5": { rules: { ex: "deck", exLink: true, exCommandLevel: 5 } },
  "ex-cmd6": { rules: { ex: "deck", exLink: true, exCommandLevel: 6 } },
  "ex-cmd7": { rules: { ex: "deck", exLink: true, exCommandLevel: 7 } },
  "ex-cmd8": { rules: { ex: "deck", exLink: true, exCommandLevel: 8 } },
  "ex-cmd9": { rules: { ex: "deck", exLink: true, exCommandLevel: 9 } },
  "plain-fights": { rules: { plainFights: true } },
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
    "by-deck": { type: "boolean", default: false },
    list: { type: "string", default: "consensus" },
  },
});
const a = VARIANTS[args.a];
const b = args.b ? VARIANTS[args.b] : undefined;
if (!a || !b) throw new Error(`--a/--b: one of ${Object.keys(VARIANTS).join(", ")}`);

const ai = parseAiName(args.ai);
const meta = metaDecks(loadSnapshot(), loadLib(), Infinity, args.list as MetaList);
const pick = (ids: string[]): NamedDeck[] =>
  ids.map((id) => {
    const d = [...meta, ...STARTER_DECKS, ...TEST_DECKS].find((x) => x.id === id.toUpperCase());
    if (!d) throw new Error(`unknown deck ${id}`);
    return d;
  });
// --decks 8 (the 8 most played archetypes), starters (ST01–ST04) or ids (ST12,ST12X,ST01 …).
const decks = (
  /^\d+$/.test(args.decks)
    ? meta.slice(0, Number(args.decks))
    : args.decks === "starters"
      ? STARTER_DECKS.slice(0, 4)
      : pick(args.decks.split(","))
).map((d) => ({ id: d.id, name: d.name, deck: d.deck }));
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
const byDeck = new Map<string, { a: number; an: number; b: number; bn: number }>();
for (const g of games) {
  if (g.error) {
    errors++;
    continue;
  }
  n++;
  const seatA = g.slots[0] === 0 ? 0 : 1;
  const w = g.winner === null ? 0.5 : g.winner === seatA ? 1 : 0;
  wins += w;
  // Per deck: how A and B do with it (the difference is the rule's effect for that deck).
  const ta = byDeck.get(g.decks[seatA]) ?? { a: 0, an: 0, b: 0, bn: 0 };
  ta.a += w;
  ta.an++;
  byDeck.set(g.decks[seatA], ta);
  const tb = byDeck.get(g.decks[1 - seatA]!) ?? { a: 0, an: 0, b: 0, bn: 0 };
  tb.b += 1 - w;
  tb.bn++;
  byDeck.set(g.decks[1 - seatA]!, tb);
}
const [low, high] = wilson(wins, n);
const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
console.log(`${ai}: ${args.a} gegen ${args.b}: ${pct(wins / n)} (${pct(low)}–${pct(high)}, ${n} Spiele)`);
if (errors) console.log(`${errors} Spiele mit Fehler`);
if (args["by-deck"]) {
  console.log(`  Deck   ${args.a.padStart(10)}  ${args.b!.padStart(10)}  Differenz`);
  for (const [id, t] of [...byDeck].sort((x, y) => x[0].localeCompare(y[0]))) {
    const a = t.a / t.an;
    const b = t.b / t.bn;
    console.log(
      `  ${id.padEnd(5)} ${pct(a).padStart(10)}  ${pct(b).padStart(10)}  ${pct(a - b).padStart(9)}  (${t.an} Spiele je Seite)`,
    );
  }
}
for (const w of workers) await w.close();
process.exit(0);
