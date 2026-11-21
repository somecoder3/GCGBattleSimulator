// Deck lab (docs/DECKSEARCH.md, stages 0 to 3): measure decks against the meta field, calibrate the AI
// against real results, search card swaps on a meta list. Results of every 8-game block are kept in the
// lab store (data-lab/lab.db), keyed by code version, so runs can be stopped and continued later.
//
//   npm run decklab -- calibrate [--field 12] [--blocks 4]
//   npm run decklab -- measure M01 M01B … [--field 12] [--blocks 4]
//   npm run decklab -- swaps M01 [--steps 3] [--neighbours 32] [--first 2] [--finalists 4] [--confirm 8] [--pearls]
//   npm run decklab -- pearls [M01 | --colors Blue/White] [--top 25]   underrated cards (stage 2)
//   npm run decklab -- values M01 [--variants 40] [--per 3] [--blocks 2] [--pearls]   card values (stage 2)
//   npm run decklab -- seeds [--colors White/Red]   combo seeds of the color pairs (stage 3)
//   npm run decklab -- evolve [--generations 40] [--batch 16] [--blocks 2] [--final 4] [--save 3] [--evo-ai v0]
//        [--min 0.5]   MAP-Elites (stage 3): evolves with --evo-ai against the field, measures the best new decks
//        with --ai (v1), saves novel ones with at least --min as lab decks ("Deck-Labor …"). Same --seed again
//        replays from the cache, so long runs (--evo-ai v1) can be done in parts.
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
import { pearls } from "../src/lab/decklab/pearls";
import { fmtSwap, legal, pct, rankedSwaps, setCardNames, swapSearch } from "../src/lab/decklab/swaps";
import { cardValues } from "../src/lab/decklab/values";
import { buildAround, cardScores, composition, evolve, seeds } from "../src/lab/decklab/evolve";
import { COLORS } from "../src/data/types";
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
    pearls: { type: "boolean", default: false },
    colors: { type: "string" },
    top: { type: "string", default: "25" },
    variants: { type: "string", default: "40" },
    per: { type: "string", default: "3" },
    generations: { type: "string", default: "40" },
    batch: { type: "string", default: "16" },
    final: { type: "string", default: "4" },
    save: { type: "string", default: "3" },
    "evo-ai": { type: "string", default: "v0" },
    min: { type: "string", default: "0.5" },
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
      ...(args.pearls ? { extraAdds: pearlAdds(meta.deck) } : {}),
      log,
    });
    log(`\n${meta.id} ${meta.name}: ${result.steps.filter((s) => s.accepted).length} Tausche übernommen`);
    for (const s of result.steps)
      log(`  ${s.accepted ? "✓" : "✗"} ${fmtSwap(s.swap)}: ${pct(s.confirm.diff)}`);
    store.set(`decklab:swaps:${meta.id}:${new Date().toISOString()}`, {
      settings: settings(seed),
      ...result,
    });
  } else if (command === "pearls") {
    const meta = ids[0] ? metaDecks(snapshot, lib, Infinity, "both").find((d) => d.id === ids[0]) : undefined;
    const colors = args.colors?.split("/") ?? (meta ? colorsOf(meta.deck) : undefined);
    log(
      `\nUnterschätzte Karten${colors ? ` (${colors.join("/")})` : ""}: Papierstärke, Anteil der Turnierlisten`,
    );
    for (const p of pearls(lib, snapshot, colors).slice(0, Number(args.top)))
      log(
        `  ${p.score.toFixed(2).padStart(6)}  ${p.no.padEnd(9)} ${p.name.slice(0, 32).padEnd(32)} ${p.type.padEnd(8)} ` +
          `Lv${p.level} ${String(p.color).padEnd(7)} Papier ${p.paper.toFixed(2).padStart(5)}  gespielt ${pctAbs(p.playRate)}`,
      );
  } else if (command === "values") {
    const meta = metaDecks(snapshot, lib, Infinity, "consensus").find((d) => d.id === ids[0]);
    if (!meta) throw new Error(`unbekannter Archetyp ${ids[0] ?? "(fehlt)"}`);
    const pool = rankedSwaps(lib, meta.deck, meta, args.pearls ? pearlAdds(meta.deck) : undefined).slice(
      0,
      80,
    );
    const values = await cardValues(lib, meta.deck, pool, field, search, {
      variants: Number(args.variants),
      swapsPer: Number(args.per),
      blocks: Number(args.blocks),
      seed,
      legal: (d) => legal(lib, d),
      log,
    });
    const have = new Map<string, number>();
    for (const no of meta.deck.main) have.set(no, (have.get(no) ?? 0) + 1);
    log(`\n${meta.id} ${meta.name}: Wert je zusätzlicher Kopie (Siegquote gegen das Feld, ± Standardfehler)`);
    for (const v of values)
      log(
        `  ${pct(v.value).padStart(8)} ± ${(v.se * 100).toFixed(1).padStart(4)}  ${v.no.padEnd(9)} ` +
          `${(lib.has(v.no) ? lib.get(v.no).name : v.no).slice(0, 34).padEnd(34)} im Deck ${have.get(v.no) ?? 0}×, in ${v.variants} Varianten`,
      );
    store.set(`decklab:values:${meta.id}:${new Date().toISOString()}`, { settings: settings(seed), values });
  } else if (command === "seeds") {
    for (const colors of colorPairs()) {
      const list = seeds(lib, colors);
      if (!list.length) continue;
      log(`\n${colors.join("/")}:`);
      for (const sd of list) log(`  ${sd.label}  [${sd.cards.map((no) => lib.get(no).name).join(", ")}]`);
    }
  } else if (command === "evolve") {
    const scores = cardScores(lib, snapshot);
    const comp = composition(snapshot, lib);
    log(
      `Zusammensetzung (Median der Turnierlisten): ${Object.entries(comp)
        .map(([t, n]) => `${t} ${n}`)
        .join(", ")}`,
    );
    const starts = field.map((f) => ({ deck: f.deck, origin: f.id }));
    for (const colors of colorPairs())
      for (const sd of seeds(lib, colors, 4)) {
        const deck = buildAround(lib, sd.cards, colors, scores, comp);
        if (deck) starts.push({ deck, origin: `Keim ${lib.get(sd.source).name} (${colors.join("/")})` });
      }
    // v0 is cheap but overrates new decks a lot (first run: 45–49 % with v0, 15–20 % with v1).
    const cheap = new Measurer(store, workers, { ...settings(seed), ai: parseAiName(args["evo-ai"]!) });
    measurers.push(cheap);
    const archive = await evolve(lib, snapshot, starts, field, cheap, {
      generations: Number(args.generations),
      batch: Number(args.batch),
      blocks: Number(args.blocks),
      seed,
      log,
    });
    // The best novel decks (not similar to a meta archetype) and the best overall, measured with --ai.
    const elites = [...archive.values()].sort((a, b) => b.fitness - a.fitness);
    const novel = elites.filter((e) => e.nearest.similarity < 0.5);
    const finalists = [...new Set([...novel.slice(0, Number(args.final)), ...elites.slice(0, 2)])];
    const finalR = await search.blocks(
      finalists.map((e) => e.deck),
      field,
      Number(args.blocks) * 2,
    );
    finalists.forEach((e, i) => (e.final = fieldRate(finalR[i]!, field)));
    log(
      `\nNischen (bestes Deck je Nische, ${args["evo-ai"]} gegen das Feld; „neu“ = Ähnlichkeit zum nächsten Archetyp < 0,5):`,
    );
    for (const e of elites.slice(0, 20))
      log(
        `  ${pctAbs(e.fitness).padStart(7)}${e.final !== undefined ? ` (${settings(seed).ai} ${pctAbs(e.final)})` : ""}  ${e.niche.padEnd(32)} ` +
          `${e.nearest.similarity < 0.5 ? "neu" : `≈ ${e.nearest.id}`} (${e.nearest.similarity.toFixed(2)})  ${e.origin.slice(0, 50)}`,
      );
    const toSave = novel
      .filter((e) => (e.final ?? 0) >= Number(args.min))
      .filter((e) => e.final !== undefined)
      .sort((a, b) => b.final! - a.final!)
      .slice(0, Number(args.save));
    const stamp = new Date().toISOString().slice(0, 10);
    for (const [i, e] of toSave.entries()) {
      const name = `Deck-Labor ${stamp} #${i + 1}: ${e.niche} (${pctAbs(e.final!)})`;
      store.putDeck({
        id: `u-lab-${stamp}-${i + 1}`,
        name,
        deck: e.deck,
        updatedAt: new Date().toISOString(),
        note: e.origin,
      });
      log(`Gespeichert als Labor-Deck: ${name}`);
      log(`  ${listText(e.deck)}`);
    }
    store.set(`decklab:evolve:${new Date().toISOString()}`, { settings: settings(seed), elites });
  } else {
    log(
      "Befehle: calibrate | measure <ids> | swaps <id> | pearls [id] | values <id> | seeds | evolve (siehe Kopf von tools/decklab.ts)",
    );
  }
  const played = search.played + measurers.reduce((n, m) => n + m.played, 0);
  log(
    `\n${played} Spiele gespielt (Rest aus dem Zwischenspeicher), ${((Date.now() - started) / 1000).toFixed(0)} s`,
  );
}

const pctAbs = (x: number) => `${(x * 100).toFixed(1)} %`;

function colorsOf(deck: { main: string[] }): string[] {
  return [
    ...new Set(
      deck.main
        .map((no) => (lib.has(no) ? lib.get(no).color : null))
        .filter((c): c is NonNullable<typeof c> => !!c),
    ),
  ];
}

function colorPairs(): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < COLORS.length; i++)
    for (let j = i + 1; j < COLORS.length; j++) out.push([COLORS[i]!, COLORS[j]!]);
  return args.colors ? [args.colors.split("/")] : out;
}

function listText(deck: { main: string[] }): string {
  const c = new Map<string, number>();
  for (const no of deck.main) c.set(no, (c.get(no) ?? 0) + 1);
  return [...c].map(([no, n]) => `${n}x ${lib.get(no).name}`).join(", ");
}

/** The 12 best pearls of the deck's colors, as extra adds for swaps (support 1.5 copies). */
function pearlAdds(deck: { main: string[] }): Map<string, number> {
  return new Map(
    pearls(lib, snapshot, colorsOf(deck))
      .filter((p) => !deck.main.includes(p.no))
      .slice(0, 12)
      .map((p) => [p.no, 1.5]),
  );
}

try {
  await main();
} finally {
  await Promise.all(workers.map((w) => w.close()));
  store.close();
}
