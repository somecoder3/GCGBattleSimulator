// Combo relations of decks, read from the card effects (src/ai/synergy.ts).
//
//   npm run combos -- M01B          one deck (meta ids, M01B best list, ST01 …)
//   npm run combos -- meta          the most played archetypes
import { deckPlan } from "../src/ai/synergy";
import { STARTER_DECKS, TEST_DECKS } from "../src/data/decks";
import { metaDecks } from "../src/meta/decks";
import { loadLib, loadSnapshot } from "./lib";

const lib = loadLib();
const all = [...metaDecks(loadSnapshot(), lib, 99, "both"), ...STARTER_DECKS, ...TEST_DECKS];
const ids = process.argv.slice(2);
const chosen =
  ids.length === 0 || ids[0] === "meta"
    ? all.filter((d) => /^M\d+$/.test(d.id))
    : ids.map((id) => {
        const d = all.find((x) => x.id === id.toUpperCase());
        if (!d) throw new Error(`unknown deck ${id}`);
        return d;
      });
const name = (no: string) => lib.get(no).name;
const USE = { count: "zählt", choose: "wählt", link: "linkt mit" };
for (const d of chosen) {
  const plan = deckPlan(lib, d.deck);
  console.log(`\n${d.id} ${d.name}`);
  for (const s of plan.synergies) {
    const total = [...s.matches.values()].reduce((a, b) => a + b, 0);
    const where = s.zone === "link" ? "" : ` in ${s.zone}`;
    const list = [...s.matches].map(([no, n]) => `${n}× ${name(no)}`).join(", ");
    console.log(`  ${name(s.source)} ${USE[s.use]} ${s.label}${where}: ${total} Karten (${list})`);
  }
  const fuel = [...plan.trashFuel].sort((a, b) => b[1] - a[1]);
  if (fuel.length)
    console.log(`  Im Trash nützlich: ${fuel.map(([no, v]) => `${name(no)} ${v.toFixed(2)}`).join(", ")}`);
}
