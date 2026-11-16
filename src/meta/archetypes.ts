// Groups the decks of a snapshot into archetypes, weighs them (recency, tournament size, placing) and
// builds one representative, legal list per archetype.

import { DEFAULT_RESOURCE, DECK_SIZE, MAX_COPIES, RESOURCE_DECK_SIZE } from "../engine/deck";
import type { CardLib } from "../engine/cardlib";
import type { DeckList } from "../engine/types";
import { BANNED, BANNED_PAIRS, RESTRICTED, banlistProblems, isVanillaTwoTwo } from "./banlist";
import type { Archetype, MetaDeck, MetaSnapshot } from "./types";

export interface ArchetypeOptions {
  /** Days after which a deck counts half (recency weighting). */
  halfLifeDays?: number;
  /** Reference day for the recency weighting (default: end of the snapshot window). */
  now?: string;
  /** Unnamed ("other") decks join an archetype if they are at least this similar to its consensus. */
  minSimilarity?: number;
}

type Counts = Record<string, number>;

/** Weighted Jaccard similarity of two card count vectors (Σ min / Σ max). */
export function similarity(a: Counts, b: Counts): number {
  let min = 0;
  let max = 0;
  for (const no of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[no] ?? 0;
    const y = b[no] ?? 0;
    min += Math.min(x, y);
    max += Math.max(x, y);
  }
  return max ? min / max : 0;
}

/** Weight of a deck: newer, bigger tournaments and better placings count more. */
export function deckWeight(deck: MetaDeck, snapshot: MetaSnapshot, options: ArchetypeOptions = {}): number {
  const t = snapshot.tournaments.find((x) => x.id === deck.tournament);
  if (!t) return 0;
  const halfLife = options.halfLifeDays ?? 28;
  const now = Date.parse(options.now ?? snapshot.to);
  const ageDays = Math.max(0, (now - Date.parse(t.date)) / 86_400_000);
  const recency = 0.5 ** (ageDays / halfLife);
  const size = Math.log2(Math.max(2, t.players));
  const placing = 1 / Math.sqrt(Math.max(1, deck.placing));
  return recency * size * placing;
}

/** Legal limit for a card in a deck. */
function maxCopies(no: string): number {
  if (BANNED.includes(no)) return 0;
  return Math.min(MAX_COPIES, RESTRICTED[no] ?? MAX_COPIES);
}

/**
 * The weighted average count of each card, rounded so that the list has exactly 50 cards: cards
 * with the highest averages first, the remainder by the largest fractions. Respects the card limits.
 */
export function consensus(lists: { cards: Counts; weight: number }[], lib?: CardLib): Counts {
  const total = lists.reduce((s, l) => s + l.weight, 0) || 1;
  const mean = new Map<string, number>();
  for (const l of lists) {
    for (const [no, n] of Object.entries(l.cards)) mean.set(no, (mean.get(no) ?? 0) + (n * l.weight) / total);
  }
  let usable = [...mean].filter(([no]) => maxCopies(no) > 0 && (!lib || lib.has(no)));
  if (lib) usable = legalCards(usable, lib);
  usable.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const counts: Counts = {};
  let sum = 0;
  for (const [no, m] of usable) {
    const n = Math.min(maxCopies(no), Math.floor(m));
    if (n > 0) {
      counts[no] = n;
      sum += n;
    }
  }
  // Fill up by the largest remainders (then the most played cards), trim the least played.
  const byRemainder = [...usable].sort(
    (a, b) => b[1] - Math.floor(b[1]) - (a[1] - Math.floor(a[1])) || b[1] - a[1],
  );
  while (sum < DECK_SIZE) {
    const next =
      byRemainder.find(
        ([no]) => (counts[no] ?? 0) < maxCopies(no) && (counts[no] ?? 0) < Math.ceil(mean.get(no)!),
      ) ?? usable.find(([no]) => (counts[no] ?? 0) < maxCopies(no));
    if (!next) break;
    counts[next[0]] = (counts[next[0]] ?? 0) + 1;
    sum++;
  }
  for (let i = usable.length - 1; sum > DECK_SIZE && i >= 0; i--) {
    const no = usable[i]![0];
    while (sum > DECK_SIZE && (counts[no] ?? 0) > 0) {
      counts[no]!--;
      sum--;
    }
    if (counts[no] === 0) delete counts[no];
  }
  return counts;
}

/**
 * Mixed lists of an archetype can add up to more than two colors or to a banned pair. Keeps the two
 * colors with the most cards (6-1-2) and, of a banned pair, the side that is played more.
 */
function legalCards(cards: [string, number][], lib: CardLib): [string, number][] {
  const colorMass = new Map<string, number>();
  for (const [no, m] of cards) {
    const color = lib.get(no).color;
    if (color) colorMass.set(color, (colorMass.get(color) ?? 0) + m);
  }
  const colors = new Set(
    [...colorMass]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c),
  );
  let out = cards.filter(([no]) => {
    const color = lib.get(no).color;
    return !color || colors.has(color);
  });
  const mass = (nos: Set<string>) => out.reduce((s, [no, m]) => s + (nos.has(no) ? m : 0), 0);
  for (const pair of BANNED_PAIRS) {
    const a = new Set(pair.a);
    const b = new Set(
      pair.a.includes("GD01-008")
        ? [...pair.b, ...out.map(([no]) => no).filter((no) => isVanillaTwoTwo(lib.get(no)))]
        : pair.b,
    );
    const ma = mass(a);
    const mb = mass(b);
    if (ma > 0 && mb > 0) {
      const drop = ma >= mb ? b : a;
      out = out.filter(([no]) => !drop.has(no));
    }
  }
  return out;
}

export function toDeckList(counts: Counts): DeckList {
  const main = Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .flatMap(([no, n]) => Array<string>(n).fill(no));
  return { main, resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE) };
}

function colorsOf(counts: Counts, lib: CardLib): string[] {
  const colors = new Set<string>();
  for (const no of Object.keys(counts)) {
    const c = lib.has(no) ? lib.get(no).color : null;
    if (c) colors.add(c);
  }
  return [...colors].sort();
}

export function buildArchetypes(
  snapshot: MetaSnapshot,
  lib: CardLib,
  options: ArchetypeOptions = {},
): Archetype[] {
  const weighted = snapshot.decks.map((deck) => ({
    deck,
    weight: deckWeight(deck, snapshot, options),
    id: deck.archetypeId,
  }));
  const named = new Map<string, { name: string; lists: typeof weighted }>();
  for (const w of weighted) {
    if (w.id === "other") continue;
    const entry = named.get(w.id) ?? { name: w.deck.archetype, lists: [] };
    entry.lists.push(w);
    named.set(w.id, entry);
  }
  // Unnamed decks join the most similar named archetype if they are close enough.
  const minSimilarity = options.minSimilarity ?? 0.5;
  const centers = new Map(
    [...named].map(([id, e]) => [
      id,
      consensus(e.lists.map((l) => ({ cards: l.deck.cards, weight: l.weight }))),
    ]),
  );
  const others: typeof weighted = [];
  for (const w of weighted) {
    if (w.id !== "other") continue;
    let bestId: string | null = null;
    let best = 0;
    for (const [id, center] of centers) {
      const sim = similarity(w.deck.cards, center);
      if (sim > best) [best, bestId] = [sim, id];
    }
    if (bestId && best >= minSimilarity) named.get(bestId)!.lists.push({ ...w, id: bestId });
    else others.push(w);
  }

  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  const archetypes: Archetype[] = [];
  for (const [id, e] of named) {
    const counts = consensus(
      e.lists.map((l) => ({ cards: l.deck.cards, weight: l.weight })),
      lib,
    );
    const bestList = [...e.lists].sort((a, b) => a.deck.placing - b.deck.placing || b.weight - a.weight)[0]!;
    const bestCounts = legalize(bestList.deck.cards, counts);
    archetypes.push({
      id,
      name: e.name,
      share: e.lists.reduce((s, l) => s + l.weight, 0) / totalWeight,
      lists: e.lists.length,
      colors: colorsOf(counts, lib),
      consensus: toDeckList(counts),
      best: toDeckList(bestCounts),
      bestPlacing: { tournament: bestList.deck.tournament, placing: bestList.deck.placing },
      partial: Object.keys(counts)
        .filter((no) => lib.has(no) && lib.get(no).script.status === "partial")
        .sort(),
    });
  }
  void others;
  return archetypes.sort((a, b) => b.share - a.share);
}

/** A real list with banned/over-limit cards removed and missing cards taken from the consensus. */
function legalize(cards: Counts, fill: Counts): Counts {
  const out: Counts = {};
  let sum = 0;
  for (const [no, n] of Object.entries(cards)) {
    const k = Math.min(n, maxCopies(no));
    if (k > 0) {
      out[no] = k;
      sum += k;
    }
  }
  for (const [no, n] of Object.entries(fill)) {
    while (sum < DECK_SIZE && (out[no] ?? 0) < n) {
      out[no] = (out[no] ?? 0) + 1;
      sum++;
    }
  }
  const order = Object.keys(out).sort((a, b) => (fill[a] ?? 0) - (fill[b] ?? 0));
  for (const no of order) {
    while (sum > DECK_SIZE && out[no]! > 0) {
      out[no]!--;
      sum--;
    }
    if (out[no] === 0) delete out[no];
  }
  return out;
}

/** Banlist problems of an archetype's lists (empty if both are legal). */
export function archetypeProblems(a: Archetype, lib: CardLib): string[] {
  const count = (list: DeckList) => list.main.reduce<Counts>((m, no) => ((m[no] = (m[no] ?? 0) + 1), m), {});
  const get = (no: string) => (lib.has(no) ? lib.get(no) : undefined);
  return [...banlistProblems(count(a.consensus), get), ...banlistProblems(count(a.best), get)];
}
