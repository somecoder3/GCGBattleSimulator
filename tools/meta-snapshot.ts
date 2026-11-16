// Loads the current meta from Limitless and writes data/meta/<to>.json (committed, used offline).
//
//   npm run meta                         last 8 weeks, tournaments with ≥ 8 players, top 16 of each
//   npm run meta -- --weeks 12 --top 8
//   npm run meta -- --report             only print the archetypes of the newest snapshot

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CardLib } from "../src/engine/cardlib";
import { archetypeProblems, buildArchetypes } from "../src/meta/archetypes";
import { fetchSnapshot } from "../src/meta/limitless";
import type { MetaSnapshot } from "../src/meta/types";
import { ROOT, loadPool } from "./lib";

const { values: args } = parseArgs({
  options: {
    weeks: { type: "string", default: "8" },
    to: { type: "string" },
    "min-players": { type: "string", default: "8" },
    top: { type: "string", default: "16" },
    report: { type: "boolean", default: false },
  },
});

const DIR = resolve(ROOT, "data/meta");
const pool = loadPool();
const lib = CardLib.fromPool(pool);

let snapshot: MetaSnapshot;
if (args.report) {
  const newest = readdirSync(DIR)
    .filter((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f))
    .sort()
    .at(-1);
  if (!newest) throw new Error("no snapshot in data/meta");
  snapshot = JSON.parse(readFileSync(resolve(DIR, newest), "utf8")) as MetaSnapshot;
  console.log(`Snapshot ${newest}`);
} else {
  const to = args.to ?? new Date().toISOString().slice(0, 10);
  const from = new Date(Date.parse(to) - Number(args.weeks) * 7 * 86_400_000).toISOString().slice(0, 10);
  snapshot = await fetchSnapshot(pool, {
    from,
    to,
    minPlayers: Number(args["min-players"]),
    topN: Number(args.top),
    onProgress: (text) => console.error(text),
  });
  mkdirSync(DIR, { recursive: true });
  const file = resolve(DIR, `${to}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`${snapshot.decks.length} Decks aus ${snapshot.tournaments.length} Turnieren → ${file}`);
}

const unknown = new Set(snapshot.decks.flatMap((d) => d.unknown));
if (unknown.size) console.log(`Nicht in GCGDB: ${[...unknown].join("; ")}`);

const archetypes = buildArchetypes(snapshot, lib);
const used = new Map<string, number>();
for (const a of archetypes.slice(0, 8))
  for (const no of new Set(a.consensus.main)) used.set(no, (used.get(no) ?? 0) + 1);
console.log(`\nArchetypen (${archetypes.length}), Anteil gewichtet:`);
for (const a of archetypes) {
  const problems = archetypeProblems(a, lib);
  console.log(
    `${(a.share * 100).toFixed(1).padStart(5)} %  ${String(a.lists).padStart(3)} Listen  ${a.name} [${a.colors.join("/")}]` +
      `  ${a.partial.length ? `${a.partial.length} Karten unvollständig` : "voll unterstützt"}` +
      (problems.length ? `  BANLIST: ${problems.join("; ")}` : ""),
  );
}
const partialTop = [...used.keys()].filter((no) => lib.get(no).script.status === "partial").sort();
console.log(`\nTop 8: ${used.size} verschiedene Karten, davon ${partialTop.length} unvollständig:`);
console.log(partialTop.join(" "));
