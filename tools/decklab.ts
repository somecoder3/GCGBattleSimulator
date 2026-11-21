// Deck lab (docs/DECKSEARCH.md, stages 0 and 1): measure decks against the meta field, calibrate the AI
// against real results, search card swaps on a meta list. Results of every 8-game block are kept in the
// lab store (data-lab/lab.db), keyed by code version, so runs can be stopped and continued later.
//
//   npm run decklab -- calibrate [--field 12] [--blocks 4]
//   npm run decklab -- measure M01 M01B … [--field 12] [--blocks 4]
//   npm run decklab -- swaps M01 [--steps 3] [--neighbours 32] [--first 2] [--finalists 4] [--confirm 8]
//
// Common options: --ai v1|v0|search (default v1), --workers N (default half the cores: quieter fan),
// --seed N (search seeds; confirmation uses N + 1000), --data <file> (default data-lab/lab.db).

import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseAiName } from "../src/ai/registry";
import { Engine } from "../src/engine/engine";
import { calibrate, metaField, realMatchups } from "../src/lab/decklab/field";
import { fieldRate, Measurer, type MeasureSettings } from "../src/lab/decklab/measure";
import { fmtSwap, pct, setCardNames, swapSearch } from "../src/lab/decklab/swaps";
import { LabStore } from "../src/lab/store";
import { codeVersion } from "../src/lab/version";
import { metaDecks } from "../src/meta/decks";
import { loadLib, loadSnapshot, ROOT } from "./lib";
import { threadWorker } from "./node-pool";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ai: { type: "string", default: "v1" },
    workers: { type: "string" },
    seed: { type: "string", default: "1" },
    field: { type: "string", default: "12" },
    blocks: { type: "string", default: "4" },
    steps: { type: "string", default: "3" },
    neighbours: { type: "string", default: "32" },
    first: { type: "string", default: "2" },
    finalists: { type: "string", default: "4" },
    confirm: { type: "string", default: "8" },
    data: { type: "string" },
  },
});

const [command, ...ids] = positionals;
const lib = loadLib();
const snapshot = loadSnapshot();
const store = new LabStore(resolve(ROOT, args.data ?? process.env.GCG_LAB_DATA ?? "data-lab/lab.db"));
const workerCount = Number(args.workers ?? Math.max(1, Math.floor(availableParallelism() / 2)));
const workers = Array.from({ length: workerCount }, () => threadWorker());
const version = codeVersion(ROOT);
const seed = Number(args.seed);
const settings = (s: number): MeasureSettings => ({
  ai: parseAiName(args.ai!),
  seed: s,
  codeVersion: version,
});
const field = metaField(snapshot, lib, Number(args.field));
setCardNames((no) => (lib.has(no) ? lib.get(no).name : no));
const started = Date.now();
const log = (text: string) => console.log(text);
void new Engine(lib); // the card scripts are built once here (fails early on broken data)

log(
  `Deck-Labor: ${command ?? "?"} · KI ${settings(seed).ai} · ${workerCount} Worker · Feld ${field.length} Archetypen ` +
    `(${field.map((f) => f.id).join(" ")}) · Code ${version}`,
);

const measurers: Measurer[] = [];

async function main() {
  const search = new Measurer(store, workers, settings(seed));
  if (command === "calibrate") {
    if (!snapshot.pairings?.length)
      log("Achtung: der Snapshot hat keine Paarungen (npm run meta neu laufen lassen).");
    const rows = await calibrate(search, field, realMatchups(snapshot, field), Number(args.blocks));
    log("\nArchetyp                          Anteil     echt      KI   KI − echt   echte Spiele (Gegner)");
    for (const r of [...rows].sort((a, b) => b.bias - a.bias)) {
      log(
        `${`${r.id} ${r.name}`.slice(0, 32).padEnd(32)} ${pctAbs(r.share).padStart(6)}  ${pctAbs(r.real).padStart(7)} ` +
          `${pctAbs(r.ai).padStart(7)}   ${pct(r.bias).padStart(8)}   ${String(r.realGames).padStart(5)} (${r.opponents})`,
      );
    }
    store.set(`decklab:calibrate:${new Date().toISOString()}`, { settings: settings(seed), rows });
  } else if (command === "measure") {
    const all = metaDecks(snapshot, lib, Infinity, "both");
    const decks = ids.map((id) => {
      const d = all.find((x) => x.id === id);
      if (!d) throw new Error(`unbekanntes Deck ${id}`);
      return d;
    });
    const results = await search.blocks(
      decks.map((d) => d.deck),
      field,
      Number(args.blocks),
    );
    decks.forEach((d, i) =>
      log(`${d.id} ${d.name}: ${pctAbs(fieldRate(results[i]!, field))} gegen das Feld`),
    );
  } else if (command === "swaps") {
    const meta = metaDecks(snapshot, lib, Infinity, "consensus").find((d) => d.id === ids[0]);
    if (!meta) throw new Error(`unbekannter Archetyp ${ids[0] ?? "(fehlt)"}`);
    const confirm = new Measurer(store, workers, settings(seed + 1000));
    measurers.push(confirm);
    const result = await swapSearch(lib, meta, field, search, confirm, {
      neighbours: Number(args.neighbours),
      firstBlocks: Number(args.first),
      finalists: Number(args.finalists),
      confirmBlocks: Number(args.confirm),
      steps: Number(args.steps),
      log,
    });
    log(`\n${meta.id} ${meta.name}: ${result.steps.filter((s) => s.accepted).length} Tausche übernommen`);
    for (const s of result.steps)
      log(`  ${s.accepted ? "✓" : "✗"} ${fmtSwap(s.swap)}: ${pct(s.confirm.diff)}`);
    store.set(`decklab:swaps:${meta.id}:${new Date().toISOString()}`, {
      settings: settings(seed),
      ...result,
    });
  } else {
    log("Befehle: calibrate | measure <ids> | swaps <id> (siehe Kopf von tools/decklab.ts)");
  }
  const played = search.played + measurers.reduce((n, m) => n + m.played, 0);
  log(
    `\n${played} Spiele gespielt (Rest aus dem Zwischenspeicher), ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
}

const pctAbs = (x: number) => `${(x * 100).toFixed(1)} %`;

try {
  await main();
} finally {
  await Promise.all(workers.map((w) => w.close()));
  store.close();
}
