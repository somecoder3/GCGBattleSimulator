// Deck statistics of the deck builder, modelled on ExBurst's deck stats (curves, Unit values, colours and
// types, traits/links/keywords, opening hand odds), plus link pairs and exact opening hand odds under the
// engine's rules: hand of 5, one redraw (hand to the bottom, draw 5, shuffle, 6-2-1-6-1), both players draw
// in their first turn, Player Two starts with an EX Resource (one more level and cost once).

import type { CardDef } from "../../data/types";
import { COLORS } from "../../data/types";
import { cardFacts } from "./cardfilter";

export interface DeckEntry {
  card: CardDef;
  n: number;
}

export interface Bucket {
  /** Label of the column: "3", "8+". */
  label: string;
  /** Filter values of the column (for a click into the card search): ["3"], ["8", "9", …]. */
  values: string[];
  count: number;
}

export interface Tally {
  value: string;
  count: number;
}

export interface Histogram {
  key: "cost" | "level" | "hp" | "ap";
  buckets: Bucket[];
  /** Mean over the cards that have the value. */
  mean: number | null;
}

/** Columns from..to, the last one open ("8+") when `open`. */
function histogram(
  entries: readonly DeckEntry[],
  key: Histogram["key"],
  from: number,
  to: number,
  open: boolean,
): Histogram {
  const buckets: Bucket[] = [];
  for (let v = from; v <= to; v++) {
    const last = open && v === to;
    buckets.push({
      label: last ? `${v}+` : String(v),
      values: last ? Array.from({ length: 13 }, (_, i) => String(v + i)) : [String(v)],
      count: 0,
    });
  }
  let sum = 0;
  let n = 0;
  for (const { card, n: copies } of entries) {
    const value = card[key];
    if (value === null) continue;
    sum += value * copies;
    n += copies;
    const i = Math.min(Math.max(value, from), to) - from;
    if (value >= from && (value <= to || open)) buckets[i]!.count += copies;
  }
  return { key, buckets, mean: n ? sum / n : null };
}

function tally(
  entries: readonly DeckEntry[],
  values: (c: CardDef) => readonly string[],
  order?: readonly string[],
) {
  const counts = new Map<string, number>();
  for (const { card, n } of entries)
    for (const v of new Set(values(card))) counts.set(v, (counts.get(v) ?? 0) + n);
  const list = [...counts].map(([value, count]) => ({ value, count }));
  return order
    ? list.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
    : list.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface LinkPair {
  unit: DeckEntry;
  /** Pilots of the deck (Pilot cards and Commands with 【Pilot】) that fulfil the Unit's link condition. */
  pilots: DeckEntry[];
}

export interface DeckStats {
  total: number;
  curve: { cost: Histogram; level: Histogram };
  units: { hp: Histogram; cost: Histogram; level: Histogram; ap: Histogram; count: number };
  colors: Tally[];
  types: Tally[];
  traits: Tally[];
  /** Link conditions of the deck's Units as printed ("[Amuro Ray]"), counted per Unit copy. */
  links: Tally[];
  keywords: Tally[];
  /** Units with a link condition and their pilots in the deck. */
  linkPairs: LinkPair[];
  /** Pilots that link no Unit of the deck. */
  lonelyPilots: DeckEntry[];
}

const TYPES = ["UNIT", "PILOT", "COMMAND", "BASE"];

/**
 * Statistics of a deck. `links(unit, pilot)` says whether `pilot` (a Pilot card or a Command with
 * 【Pilot】) fulfils the Unit's link condition (the engine's `satisfiesLink`).
 */
export function deckStats(
  entries: readonly DeckEntry[],
  links: (unit: CardDef, pilot: CardDef) => boolean,
): DeckStats {
  const units = entries.filter((e) => e.card.type === "UNIT");
  const pilots = entries.filter((e) => cardFacts(e.card).pilots.length > 0 && e.card.type !== "UNIT");
  const linkPairs = units
    .filter((u) => u.card.link.length)
    .map((unit) => ({ unit, pilots: pilots.filter((p) => links(unit.card, p.card)) }))
    .sort(
      (a, b) =>
        (a.unit.card.level ?? 0) - (b.unit.card.level ?? 0) || a.unit.card.no.localeCompare(b.unit.card.no),
    );
  return {
    total: entries.reduce((s, e) => s + e.n, 0),
    curve: { cost: histogram(entries, "cost", 0, 8, true), level: histogram(entries, "level", 1, 8, false) },
    units: {
      count: units.reduce((s, e) => s + e.n, 0),
      hp: histogram(units, "hp", 0, 8, true),
      cost: histogram(units, "cost", 0, 8, true),
      level: histogram(units, "level", 1, 8, false),
      ap: histogram(units, "ap", 0, 7, true),
    },
    colors: tally(entries, (c) => (c.color ? [c.color] : []), COLORS),
    types: tally(entries, (c) => [c.type], TYPES),
    traits: tally(entries, (c) => c.traits),
    links: tally(units, (c) => cardFacts(c).links),
    keywords: tally(entries, (c) => cardFacts(c).keywords),
    linkPairs,
    lonelyPilots: pilots.filter((p) => !units.some((u) => links(u.card, p.card))),
  };
}

// ---------------------------------------------------------------------------------------------
// Opening hand odds

export const HAND = 5;

/** Chance that `k` cards drawn from `deck` cards hold none of `hits` (hypergeometric). */
export function missChance(deck: number, hits: number, k: number): number {
  if (hits <= 0) return 1;
  if (k > deck - hits) return 0;
  let p = 1;
  for (let i = 0; i < k; i++) p *= (deck - hits - i) / (deck - i);
  return p;
}

/**
 * Chance to have seen at least one of `hits` cards after the opening hand and `draws` draws, without and
 * with the redraw (taken when the first hand has none: the five go to the bottom, five new ones come from
 * the other cards, then the whole deck is shuffled, so the later draws come from all but the new hand).
 */
export function hitChance(deck: number, hits: number, draws: number): { keep: number; redraw: number } {
  const first = missChance(deck, hits, HAND);
  const later = missChance(deck - HAND, hits, draws);
  return {
    keep: 1 - first * later,
    redraw: 1 - first * missChance(deck - HAND, hits, HAND) * later,
  };
}

export interface HandOdds {
  turn: number;
  /** Level and resources in that turn (one more on the draw: the EX Resource). */
  level: number;
  /** A Unit with level and cost ≤ `level`. */
  unit: { keep: number; redraw: number };
  /** Any card with level and cost ≤ `level`. */
  any: { keep: number; redraw: number };
}

/** Odds for the own turns 1..`turns`; `second` = on the draw (Player Two). */
export function handOdds(entries: readonly DeckEntry[], second: boolean, turns = 4): HandOdds[] {
  const deck = entries.reduce((s, e) => s + e.n, 0);
  const result: HandOdds[] = [];
  for (let turn = 1; turn <= turns; turn++) {
    const level = turn + (second ? 1 : 0);
    const fits = (c: CardDef) => (c.level ?? 0) <= level && (c.cost ?? 0) <= level;
    const count = (ok: (c: CardDef) => boolean) => entries.reduce((s, e) => s + (ok(e.card) ? e.n : 0), 0);
    result.push({
      turn,
      level,
      unit: hitChance(
        deck,
        count((c) => c.type === "UNIT" && fits(c)),
        turn,
      ),
      any: hitChance(deck, count(fits), turn),
    });
  }
  return result;
}
