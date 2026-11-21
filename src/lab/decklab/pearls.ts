// Underrated cards ("Perlen", docs/DECKSEARCH.md stage 2): strong on paper, rarely played in the meta.
// Node only (lab tools).
//
// Paper strength is a rough guess from the printed card: AP+HP compared to Units of the same level,
// keywords, the number of effects, cost below level. It only preselects; whether a card helps a deck is
// measured by the swap search (`swaps --pearls`).

import type { CardLib, EngineCard } from "../../engine/cardlib";
import type { MetaSnapshot } from "../../meta/types";

const MAIN_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);

export interface Pearl {
  no: string;
  name: string;
  type: string;
  color: string | null;
  level: number;
  /** Paper strength, standardized within the card type. */
  paper: number;
  /** Share of the snapshot's tournament lists that play the card. */
  playRate: number;
  score: number;
}

/** Cards the deck lab may use: main-deck types, no tokens, every line understood by the engine. */
export function usableCards(lib: CardLib): EngineCard[] {
  return [...lib.all()].filter((c) => MAIN_TYPES.has(c.type) && !c.token && c.script.status !== "partial");
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
}

/** Rough strength of a printed card (higher = stronger), before standardizing. */
export function paperStrength(card: EngineCard, unitBaseline: Map<number, number>): number {
  const k = card.keywords;
  const keywords =
    (k.blocker ? 1.5 : 0) +
    (k.firstStrike ? 1 : 0) +
    (k.highManeuver ? 1.5 : 0) +
    (k.suppression ? 1 : 0) +
    k.breach * 0.5 +
    k.repair * 0.6 +
    k.support * 0.3;
  const effects = card.script.effects.length;
  const cheap = (card.level - card.cost) * 0.4;
  if (card.type === "UNIT") {
    const stats = card.ap + card.hp - (unitBaseline.get(card.level) ?? card.ap + card.hp);
    return stats + keywords + effects * 1.2 + cheap;
  }
  if (card.type === "PILOT") return card.ap + card.hp + keywords + effects * 1.2;
  return effects * 1.5 - card.cost * 0.4 + keywords;
}

/** Standard score within each card type. */
function standardize(values: { type: string; v: number }[]): number[] {
  const byType = new Map<string, number[]>();
  for (const x of values) byType.set(x.type, [...(byType.get(x.type) ?? []), x.v]);
  const stats = new Map(
    [...byType].map(([t, vs]) => {
      const m = vs.reduce((a, b) => a + b, 0) / vs.length;
      const sd = Math.sqrt(vs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vs.length - 1)) || 1;
      return [t, { m, sd }] as const;
    }),
  );
  return values.map((x) => (x.v - stats.get(x.type)!.m) / stats.get(x.type)!.sd);
}

/** Play rate of every card number in the snapshot's lists. */
export function playRates(snapshot: MetaSnapshot): Map<string, number> {
  const rates = new Map<string, number>();
  for (const d of snapshot.decks)
    for (const no of Object.keys(d.cards)) rates.set(no, (rates.get(no) ?? 0) + 1);
  for (const [no, n] of rates) rates.set(no, n / Math.max(1, snapshot.decks.length));
  return rates;
}

/**
 * Cards by pearl score (paper strength minus popularity), best first. `colors` limits them to the colors
 * of a deck (colorless cards always fit).
 */
export function pearls(lib: CardLib, snapshot: MetaSnapshot, colors?: string[]): Pearl[] {
  const cards = usableCards(lib);
  const baseline = new Map<number, number>();
  const units = cards.filter((c) => c.type === "UNIT");
  for (const level of new Set(units.map((u) => u.level)))
    baseline.set(level, median(units.filter((u) => u.level === level).map((u) => u.ap + u.hp)));
  const paper = standardize(cards.map((c) => ({ type: c.type, v: paperStrength(c, baseline) })));
  const rates = playRates(snapshot);
  return cards
    .map((c, i) => {
      const playRate = rates.get(c.no) ?? 0;
      return {
        no: c.no,
        name: c.name,
        type: c.type,
        color: c.color,
        level: c.level,
        paper: paper[i]!,
        playRate,
        score: paper[i]! - 4 * playRate,
      };
    })
    .filter((p) => !colors || p.color === null || colors.includes(p.color))
    .sort((a, b) => b.score - a.score);
}
