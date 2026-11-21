// New archetypes (docs/DECKSEARCH.md, stage 3). Node only (lab tools).
//
// 1. Seeds from the combo graph: `deckSynergies` over all usable cards of a color pair finds cards that want
//    other cards (traits, names, links, trash fuel). A seed is such a card with its partners.
// 2. A deck around a seed: the seed cards in several copies, filled per card type to the meta's usual
//    composition with the strongest cards of the colors (paper strength, popularity, synergy with the seed).
// 3. MAP-Elites: a grid of niches (color pair × curve × share of Units) keeps the best deck of each niche.
//    Offspring are mutations (swaps) and crossovers of elites, measured cheaply (v0) against the meta
//    field; the best new decks are measured again with v1 at the end. Diversity instead of one winner.

import { satisfiesLink } from "../../engine/cardlib";
import type { CardLib, EngineCard } from "../../engine/cardlib";
import { DEFAULT_RESOURCE, RESOURCE_DECK_SIZE } from "../../engine/deck";
import { nextInt, seedRng, type RngState } from "../../engine/rng";
import type { DeckList } from "../../engine/types";
import { similarity } from "../../meta/archetypes";
import type { MetaSnapshot } from "../../meta/types";
import { deckSynergies } from "../../ai/synergy";
import { fieldRate, type FieldDeck, type Measurer } from "./measure";
import { paperStrength, playRates, usableCards } from "./pearls";
import { legal } from "./swaps";

const TYPES = ["UNIT", "PILOT", "COMMAND", "BASE"] as const;

export interface Seed {
  colors: string[];
  /** The card whose effects look for the others, and its partners (card numbers). */
  source: string;
  cards: string[];
  label: string;
}

export interface Elite {
  deck: DeckList;
  niche: string;
  /** Win rate against the field (cheap AI) and, at the end, with the better AI. */
  fitness: number;
  final?: number;
  origin: string;
  /** Similarity to the nearest meta archetype (weighted Jaccard) and its id. */
  nearest: { id: string; similarity: number };
}

const countsOf = (deck: DeckList) => {
  const m: Record<string, number> = {};
  for (const no of deck.main) m[no] = (m[no] ?? 0) + 1;
  return m;
};

/** Card scores for filling decks: paper strength plus popularity (both standardized roughly). */
export function cardScores(lib: CardLib, snapshot: MetaSnapshot): Map<string, number> {
  const cards = usableCards(lib);
  const units = cards.filter((c) => c.type === "UNIT");
  const baseline = new Map<number, number>();
  for (const level of new Set(units.map((u) => u.level))) {
    const xs = units
      .filter((u) => u.level === level)
      .map((u) => u.ap + u.hp)
      .sort((a, b) => a - b);
    baseline.set(level, xs[Math.floor(xs.length / 2)]!);
  }
  const rates = playRates(snapshot);
  return new Map(cards.map((c) => [c.no, paperStrength(c, baseline) * 0.3 + (rates.get(c.no) ?? 0) * 12]));
}

/** The usual composition of tournament decks: median copies per card type and share of low Units. */
export function composition(snapshot: MetaSnapshot, lib: CardLib): Record<string, number> {
  const per: Record<string, number[]> = { UNIT: [], PILOT: [], COMMAND: [], BASE: [] };
  for (const d of snapshot.decks) {
    const c: Record<string, number> = { UNIT: 0, PILOT: 0, COMMAND: 0, BASE: 0 };
    for (const [no, n] of Object.entries(d.cards))
      if (lib.has(no) && lib.get(no).type in c) c[lib.get(no).type]! += n;
    if (Object.values(c).reduce((a, b) => a + b, 0) === 50) for (const t of TYPES) per[t]!.push(c[t]!);
  }
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  const out = Object.fromEntries(TYPES.map((t) => [t, med(per[t]!)]));
  out.UNIT! += 50 - TYPES.reduce((n, t) => n + out[t]!, 0); // round to 50
  return out;
}

/** Seeds of a color pair from the combo graph, strongest relations first. */
export function seeds(lib: CardLib, colors: string[], max = 6): Seed[] {
  const pool = usableCards(lib).filter((c) => !c.color || colors.includes(c.color));
  const all: DeckList = { main: pool.map((c) => c.no), resources: [] };
  const out: Seed[] = [];
  const seen = new Set<string>();
  for (const s of deckSynergies(lib, all)) {
    const partners = [...s.matches.keys()].filter((no) => no !== s.source);
    if (partners.length < 2 || partners.length > 14) continue; // nothing to build on, or too generic
    // Prefer partners that are good cards themselves: Units and Pilots first, at most 5.
    const ranked = partners
      .map((no) => lib.get(no))
      .sort((a, b) => Number(b.type === "UNIT") - Number(a.type === "UNIT") || a.level - b.level)
      .slice(0, 5)
      .map((c) => c.no);
    // The same partners for many sources (e.g. Units linking the same Pilots): one seed is enough.
    const key = s.label + "|" + ranked.join(",");
    if (seen.has(key) || seen.has(s.label)) continue;
    seen.add(key);
    seen.add(s.label);
    out.push({
      colors,
      source: s.source,
      cards: [s.source, ...ranked],
      label: `${lib.get(s.source).name}: ${s.label}`,
    });
  }
  return out.sort((a, b) => b.cards.length - a.cards.length).slice(0, max);
}

/** A 50-card deck around some cards: them in several copies, the rest filled by type and score. */
export function buildAround(
  lib: CardLib,
  core: string[],
  colors: string[],
  scores: Map<string, number>,
  comp: Record<string, number>,
): DeckList | undefined {
  const pool = usableCards(lib).filter((c) => !c.color || colors.includes(c.color));
  const counts: Record<string, number> = {};
  const byType: Record<string, number> = { UNIT: 0, PILOT: 0, COMMAND: 0, BASE: 0 };
  const add = (c: EngineCard, n: number) => {
    const room = Math.min(n, 4 - (counts[c.no] ?? 0), comp[c.type]! - byType[c.type]!);
    if (room <= 0) return;
    counts[c.no] = (counts[c.no] ?? 0) + room;
    byType[c.type]! += room;
  };
  // The source of the seed 4×, its partners 2–3× (within the type's usual count).
  core.forEach((no, i) => {
    if (lib.has(no)) add(lib.get(no), i === 0 ? 4 : lib.get(no).type === "COMMAND" ? 2 : 3);
  });
  // Pilots that link core Units, Units that core Pilots link.
  const coreCards = core.filter((no) => lib.has(no)).map((no) => lib.get(no));
  const linked = (c: EngineCard) =>
    coreCards.some(
      (k) =>
        (k.type === "UNIT" && c.pairable && satisfiesLink(k, c)) ||
        (c.type === "UNIT" && k.pairable && satisfiesLink(c, k)),
    );
  const ranked = [...pool].sort(
    (a, b) => (scores.get(b.no) ?? 0) + (linked(b) ? 3 : 0) - ((scores.get(a.no) ?? 0) + (linked(a) ? 3 : 0)),
  );
  for (const t of TYPES) {
    // A curve: Units cheap first in two passes (Lv ≤ 4, then the rest), the others by score.
    const candidates = ranked.filter((c) => c.type === t);
    const passes = t === "UNIT" ? [candidates.filter((c) => c.level <= 4), candidates] : [candidates];
    for (const list of passes) {
      for (const c of list) {
        if (byType[t]! >= (t === "UNIT" && list !== candidates ? Math.ceil(comp.UNIT! * 0.65) : comp[t]!))
          break;
        add(c, 3);
      }
    }
  }
  const main = Object.entries(counts).flatMap(([no, n]) => Array<string>(n).fill(no));
  // Missing cards (e.g. not enough Bases in these colors): more Units.
  for (const c of ranked.filter((c) => c.type === "UNIT")) {
    while (main.length < 50 && (counts[c.no] ?? 0) < 4) {
      main.push(c.no);
      counts[c.no] = (counts[c.no] ?? 0) + 1;
    }
    if (main.length >= 50) break;
  }
  const deck = {
    main: main.slice(0, 50).sort(),
    resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE),
  };
  return legal(lib, deck) ? deck : undefined;
}

/** Niche of a deck: colors, curve (average Unit level) and share of Units. */
export function nicheOf(lib: CardLib, deck: DeckList): string {
  const cards = deck.main.map((no) => lib.get(no));
  const colors = [...new Set(cards.map((c) => c.color).filter(Boolean))].sort().join("/");
  const units = cards.filter((c) => c.type === "UNIT");
  const avg = units.reduce((n, u) => n + u.level, 0) / Math.max(1, units.length);
  const curve = avg < 3.6 ? "früh" : avg < 4.6 ? "mittel" : "spät";
  const style = units.length >= 26 ? "Units" : "Effekte";
  return `${colors} · ${curve} · ${style}`;
}

/** A mutation: 1–3 swaps (remove a card, add one of the colors, weighted by score). */
function mutate(
  lib: CardLib,
  deck: DeckList,
  pool: EngineCard[],
  scores: Map<string, number>,
  rng: RngState,
): DeckList {
  let main = [...deck.main];
  const swaps = 1 + nextInt(rng, 3);
  const weighted = pool.filter((c) => (scores.get(c.no) ?? 0) > 0);
  for (let k = 0; k < swaps; k++) {
    const remove = main[nextInt(rng, main.length)]!;
    // Two draws, the better one (tournament selection): good cards come more often.
    const a = weighted[nextInt(rng, weighted.length)]!;
    const b = weighted[nextInt(rng, weighted.length)]!;
    const add = (scores.get(a.no) ?? 0) >= (scores.get(b.no) ?? 0) ? a : b;
    if (main.filter((no) => no === add.no).length >= 4) continue;
    main.splice(main.indexOf(remove), 1);
    main.push(add.no);
  }
  main = main.sort();
  const next = { main, resources: deck.resources };
  return legal(lib, next) ? next : deck;
}

/** A crossover of two decks of the same colors: each card type taken from one of the parents. */
function crossover(lib: CardLib, a: DeckList, b: DeckList, rng: RngState): DeckList {
  const parts = TYPES.map((t) => {
    const from = nextInt(rng, 2) === 0 ? a : b;
    return from.main.filter((no) => lib.get(no).type === t);
  });
  let main = parts.flat();
  const fill = [...a.main, ...b.main];
  while (main.length < 50) main.push(fill[nextInt(rng, fill.length)]!);
  main = main.slice(0, 50).sort();
  const deck = { main, resources: a.resources };
  return legal(lib, deck) ? deck : a;
}

export interface EvolveOptions {
  generations: number;
  /** Offspring per generation (measured together, so all workers are busy). */
  batch: number;
  blocks: number;
  seed: number;
  log?: (t: string) => void;
}

/** MAP-Elites over the niches; returns the archive (best deck per niche). */
export async function evolve(
  lib: CardLib,
  snapshot: MetaSnapshot,
  starts: { deck: DeckList; origin: string }[],
  field: FieldDeck[],
  measurer: Measurer,
  o: EvolveOptions,
): Promise<Map<string, Elite>> {
  const rng = seedRng(o.seed);
  const scores = cardScores(lib, snapshot);
  const archive = new Map<string, Elite>();
  const nearest = (deck: DeckList) => {
    let best = { id: "", similarity: 0 };
    for (const f of field) {
      const sim = similarity(countsOf(deck), countsOf(f.deck));
      if (sim > best.similarity) best = { id: f.id, similarity: sim };
    }
    return best;
  };
  const consider = async (cands: { deck: DeckList; origin: string }[]) => {
    const results = await measurer.blocks(
      cands.map((c) => c.deck),
      field,
      o.blocks,
    );
    let improved = 0;
    cands.forEach((c, i) => {
      const fitness = fieldRate(results[i]!, field);
      const niche = nicheOf(lib, c.deck);
      const old = archive.get(niche);
      if (!old || fitness > old.fitness) {
        archive.set(niche, { deck: c.deck, niche, fitness, origin: c.origin, nearest: nearest(c.deck) });
        improved++;
      }
    });
    return improved;
  };
  await consider(starts);
  o.log?.(`Start: ${starts.length} Decks, ${archive.size} Nischen besetzt`);
  for (let g = 0; g < o.generations; g++) {
    const elites = [...archive.values()];
    const kids: { deck: DeckList; origin: string }[] = [];
    for (let k = 0; k < o.batch; k++) {
      const parent = elites[nextInt(rng, elites.length)]!;
      const colors = parent.niche.split(" · ")[0]!.split("/");
      const pool = usableCards(lib).filter((c) => !c.color || colors.includes(c.color));
      const mates = elites.filter(
        (e) => e !== parent && e.niche.split(" · ")[0] === parent.niche.split(" · ")[0],
      );
      const child =
        mates.length && nextInt(rng, 4) === 0
          ? crossover(lib, parent.deck, mates[nextInt(rng, mates.length)]!.deck, rng)
          : mutate(lib, parent.deck, pool, scores, rng);
      kids.push({ deck: child, origin: `${parent.origin} > G${g + 1}` });
    }
    const improved = await consider(kids);
    if ((g + 1) % 5 === 0 || g === o.generations - 1) {
      const best = [...archive.values()].sort((a, b) => b.fitness - a.fitness)[0]!;
      o.log?.(
        `Generation ${g + 1}: ${improved} Verbesserungen, ${archive.size} Nischen, bestes ${(best.fitness * 100).toFixed(1)} % (${best.niche}), ${measurer.played} Spiele`,
      );
    }
  }
  return archive;
}
