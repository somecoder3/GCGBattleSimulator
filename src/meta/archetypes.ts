// Groups the decks of a snapshot into archetypes, weighs them (recency, tournament size, placing) and
// builds one representative, legal list per archetype.

import { DEFAULT_RESOURCE, DECK_SIZE, MAX_COPIES, RESOURCE_DECK_SIZE } from "../engine/deck";
import type { CardLib } from "../engine/cardlib";
import type { DeckList } from "../engine/types";
import { BANNED, BANNED_PAIRS, RESTRICTED, banlistProblems, isVanillaTwoTwo } from "./banlist";
import type { Archetype, ArchetypeEntry, MetaDeck, MetaSnapshot } from "./types";

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

/**
 * How strong a single result is, without recency: log2(players) / √placing. Winning a 9-player local
 * (3.2) ranks below 2nd of 200 players (5.4) and below winning 26 players (4.7).
 */
export function resultScore(deck: MetaDeck, snapshot: MetaSnapshot): number {
  const t = snapshot.tournaments.find((x) => x.id === deck.tournament);
  return t ? Math.log2(Math.max(2, t.players)) / Math.sqrt(Math.max(1, deck.placing)) : 0;
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
  // Of the vanilla Lv.2 2/2 Units only the most played kind stays (every two of them are a banned pair).
  const vanilla = out.filter(([no]) => isVanillaTwoTwo(lib.get(no))).sort((x, y) => y[1] - x[1]);
  if (vanilla.length > 1) {
    const drop = new Set(vanilla.slice(1).map(([no]) => no));
    out = out.filter(([no]) => !drop.has(no));
  }
  for (const pair of BANNED_PAIRS) {
    const a = new Set(pair.a);
    const b = new Set(pair.b);
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
  const join = (id: string, name: string, w: (typeof weighted)[number]) => {
    const entry = named.get(id) ?? { name, lists: [] };
    entry.lists.push({ ...w, id });
    named.set(id, entry);
  };
  for (const w of weighted) {
    if (w.id === "other" || w.deck.soft) continue;
    join(w.id, w.deck.archetype, w);
  }
  const minSimilarity = options.minSimilarity ?? 0.5;
  const centersOf = () =>
    new Map(
      [...named].map(([id, e]) => [
        id,
        consensus(e.lists.map((l) => ({ cards: l.deck.cards, weight: l.weight }))),
      ]),
    );
  const mostSimilar = (cards: Counts, centers: Map<string, Counts>): string | null => {
    let bestId: string | null = null;
    let best = 0;
    for (const [id, center] of centers) {
      const sim = similarity(cards, center);
      if (sim > best) [best, bestId] = [sim, id];
    }
    return bestId && best >= minSimilarity ? bestId : null;
  };

  // Suggested archetypes (Egman, named after the lead card), decided once per suggested group: a named
  // archetype of the same name, else the one most similar to the group's consensus, else their own.
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const byName = new Map([...named].map(([id, e]) => [normalize(e.name), id]));
  const firmCenters = centersOf();
  const suggested = new Map<string, typeof weighted>();
  for (const w of weighted) {
    if (!w.deck.soft || w.id === "other") continue;
    suggested.set(w.id, [...(suggested.get(w.id) ?? []), w]);
  }
  for (const [groupId, group] of suggested) {
    const center = consensus(group.map((l) => ({ cards: l.deck.cards, weight: l.weight })));
    const name = group[0]!.deck.archetype;
    const id = byName.get(normalize(name)) ?? mostSimilar(center, firmCenters) ?? groupId;
    for (const w of group) join(id, name, w);
  }

  // Unnamed decks join the most similar archetype if they are close enough.
  const centers = centersOf();
  const others: typeof weighted = [];
  for (const w of weighted) {
    if (w.id !== "other") continue;
    const id = mostSimilar(w.deck.cards, centers);
    if (id) join(id, named.get(id)!.name, w);
    else others.push(w);
  }

  const tournaments = new Map(snapshot.tournaments.map((t) => [t.id, t]));
  const totalWeight = weighted.reduce((s, w) => s + w.weight, 0) || 1;
  const archetypes: Archetype[] = [];
  for (const [id, e] of named) {
    const counts = consensus(
      e.lists.map((l) => ({ cards: l.deck.cards, weight: l.weight })),
      lib,
    );
    const ranked = [...e.lists].sort(
      (a, b) => resultScore(b.deck, snapshot) - resultScore(a.deck, snapshot) || b.weight - a.weight,
    );
    const bestList = ranked[0]!;
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
      entries: ranked.flatMap((l) => {
        const tournament = tournaments.get(l.deck.tournament);
        return tournament
          ? [
              {
                tournament,
                placing: l.deck.placing,
                record: l.deck.record,
                cards: l.deck.cards,
                weight: l.weight,
              },
            ]
          : [];
      }),
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

/** Banlist problems of one real list. */
export function entryProblems(entry: ArchetypeEntry, lib: CardLib): string[] {
  return banlistProblems(entry.cards, (no) => (lib.has(no) ? lib.get(no) : undefined));
}

/** Short label of a real list, e.g. "Platz 1 · Regional Tokyo (208 Spieler, 2026-11-08) · 6-1". */
export function entryLabel(entry: ArchetypeEntry): string {
  const { wins, losses, ties } = entry.record;
  const record = wins + losses + ties ? ` · ${wins}-${losses}${ties ? `-${ties}` : ""}` : "";
  return `Platz ${entry.placing} · ${entry.tournament.name} (${entry.tournament.players} Spieler, ${entry.tournament.date})${record}`;
}
