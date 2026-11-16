// Effect coverage report: how many cards the engine fully understands.
//
//   npm run coverage                       summary per set
//   npm run coverage -- --set ST01,ST02    plus every unsupported line of these sets
//   npm run coverage -- --card GD01-001    the compiled script of one card
//   npm run coverage -- --json             machine-readable (for the app later)

import { parseArgs } from "node:util";
import { buildScript, parseContext } from "../src/effects/scripts";
import { loadPool } from "./lib";

const { values: args } = parseArgs({
  options: {
    set: { type: "string" },
    card: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const pool = loadPool();
const ctx = parseContext(pool.cards);
const cards = pool.cards.filter((c) => !c.token || c.type === "UNIT TOKEN" || c.set === "T");

if (args.card) {
  const card = pool.get(args.card);
  if (!card) throw new Error(`unknown card ${args.card}`);
  const script = buildScript(card, ctx);
  console.log(card.text, "\n");
  console.log(
    JSON.stringify(
      {
        status: script.status,
        effects: script.effects,
        granted: script.granted,
        unsupported: script.unsupported,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const bySet = new Map<string, Record<string, number>>();
const rows: { no: string; status: string; unsupported: string[] }[] = [];
for (const card of cards) {
  const script = buildScript(card, ctx);
  const counts = bySet.get(card.set) ?? { vanilla: 0, auto: 0, manual: 0, partial: 0 };
  counts[script.status] = (counts[script.status] ?? 0) + 1;
  bySet.set(card.set, counts);
  rows.push({ no: card.no, status: script.status, unsupported: script.unsupported });
}

if (args.json) {
  console.log(JSON.stringify(rows));
  process.exit(0);
}

const total = { vanilla: 0, auto: 0, manual: 0, partial: 0 };
console.log("set     cards  vanilla  auto  manual  partial  supported");
for (const [set, c] of [...bySet].sort()) {
  const n = c.vanilla! + c.auto! + c.manual! + c.partial!;
  for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += c[k] ?? 0;
  console.log(
    `${set.padEnd(7)} ${String(n).padStart(5)}  ${String(c.vanilla).padStart(7)} ${String(c.auto).padStart(5)} ${String(c.manual).padStart(7)} ${String(c.partial).padStart(8)}  ${(((n - c.partial!) / n) * 100).toFixed(0).padStart(8)} %`,
  );
}
const n = total.vanilla + total.auto + total.manual + total.partial;
console.log(
  `total   ${String(n).padStart(5)}  ${String(total.vanilla).padStart(7)} ${String(total.auto).padStart(5)} ${String(total.manual).padStart(7)} ${String(total.partial).padStart(8)}  ${(((n - total.partial) / n) * 100).toFixed(1).padStart(8)} %`,
);

if (args.set) {
  const sets = new Set(args.set.split(","));
  for (const row of rows) {
    const card = pool.get(row.no)!;
    if (!sets.has(card.set) || !row.unsupported.length) continue;
    console.log(`\n${row.no} ${card.name}`);
    for (const line of row.unsupported) console.log(`  ✗ ${line}`);
  }
}
