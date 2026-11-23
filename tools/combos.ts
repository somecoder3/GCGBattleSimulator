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
const USE = {
  count: "zählt",
  choose: "wählt",
  match: "prüft auf",
  link: "linkt mit",
  ex: "nutzt",
  level: "braucht",
};
for (const d of chosen) {
  const plan = deckPlan(lib, d.deck);
  console.log(`\n${d.id} ${d.name}`);
  for (const s of plan.synergies) {
    const total = [...s.matches.values()].reduce((a, b) => a + b, 0);
    const where =
      s.zone === "link" ? "" : s.kind === "ex" ? " von" : s.kind === "level" ? ", Erzeuger" : ` in ${s.zone}`;
    const list = [...s.matches].map(([no, n]) => `${n}× ${name(no)}`).join(", ");
    console.log(`  ${name(s.source)} ${USE[s.use]} ${s.label}${where}: ${total} Karten (${list})`);
  }
  const r = plan.ramp;
  if (r.exMakers || r.resMakers || r.exUsers.size)
    console.log(
      `  Ressourcen: ${r.exMakers} Karten mit EX Resource, ${r.resMakers} mit Resource, ${r.exUsers.size} Sorten nutzen EX; Ziel Lv.${r.goal} (höchste Unit Lv.${r.topUnit})`,
    );
  const fuel = [...plan.trashFuel].sort((a, b) => b[1] - a[1]);
  if (fuel.length)
    console.log(`  Im Trash nützlich: ${fuel.map(([no, v]) => `${name(no)} ${v.toFixed(2)}`).join(", ")}`);
}
