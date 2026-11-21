// The field a deck is measured against, and the calibration of the AI against real results
// (docs/DECKSEARCH.md, stage 0). Node only (lab tools).

import type { CardLib } from "../../engine/cardlib";
import { metaDecks, type MetaDeck } from "../../meta/decks";
import type { MetaSnapshot } from "../../meta/types";
import { fieldRate, type FieldDeck, type Measurer } from "./measure";

/** The most played archetypes (consensus lists, fully supported), weights = meta shares normalized. */
export function metaField(
  snapshot: MetaSnapshot,
  lib: CardLib,
  size: number,
): (FieldDeck & { meta: MetaDeck })[] {
  const decks = metaDecks(snapshot, lib, Infinity, "consensus")
    .filter((d) => d.supported)
    .slice(0, size);
  const total = decks.reduce((n, d) => n + d.share, 0) || 1;
  return decks.map((d) => ({ id: d.id, name: d.name, deck: d.deck, weight: d.share / total, meta: d }));
}

export interface CalibrationRow {
  id: string;
  name: string;
  share: number;
  /** Real win rate against the field (from the pairings of the snapshot) and the real games behind it. */
  real: number;
  realGames: number;
  /** AI win rate against the same opponents with the same weights. */
  ai: number;
  /** AI minus real: positive = the AI overrates the archetype. */
  bias: number;
  /** Opponents with real games. */
  opponents: number;
}

/** Real games between archetypes: key "a|b" → [won by a (draws half), games]. */
export type RealMatchups = Map<string, [number, number]>;

/**
 * Real games between the field's archetypes, from the snapshot's pairings: each placing is mapped to the
 * archetype its list belongs to (`Archetype.entries`, "other" lists included).
 */
export function realMatchups(
  snapshot: MetaSnapshot,
  field: (FieldDeck & { meta: MetaDeck })[],
): RealMatchups {
  const archetypeOf = new Map<string, string>();
  for (const f of field)
    for (const e of f.meta.archetype.entries)
      archetypeOf.set(`${e.tournament.id}|${e.placing}`, f.meta.archetype.id);
  const out: RealMatchups = new Map();
  const add = (a: string, b: string, won: number) => {
    const m = out.get(`${a}|${b}`) ?? [0, 0];
    out.set(`${a}|${b}`, [m[0] + won, m[1] + 1]);
  };
  for (const p of snapshot.pairings ?? []) {
    const a = archetypeOf.get(`${p.tournament}|${p.a}`);
    const b = archetypeOf.get(`${p.tournament}|${p.b}`);
    if (!a || !b || a === b) continue;
    const wonA = p.result === 1 ? 1 : p.result === 0 ? 0.5 : 0;
    add(a, b, wonA);
    add(b, a, 1 - wonA);
  }
  return out;
}

export function realVs(real: RealMatchups, a: string, b: string): [number, number] {
  return real.get(`${a}|${b}`) ?? [0, 0];
}

/**
 * Every archetype of the field against every other one, by the AI and in real tournaments
 * (`realMatchups`). Both rates use only opponents with real games and the field's
 * weights, so they are comparable. Matchups with few real games are noisy: see `realGames`.
 */
export async function calibrate(
  measurer: Measurer,
  field: (FieldDeck & { meta: MetaDeck })[],
  real: RealMatchups,
  blocks: number,
): Promise<CalibrationRow[]> {
  const results = await measurer.blocks(
    field.map((f) => f.deck),
    field,
    blocks,
  );
  return field.map((f, i) => {
    let realSum = 0;
    let aiSum = 0;
    let weight = 0;
    let realGames = 0;
    let opponents = 0;
    field.forEach((o, j) => {
      if (j === i) return;
      const [won, games] = realVs(real, f.meta.archetype.id, o.meta.archetype.id);
      if (!games) return;
      const ai = fieldRate([results[i]![j]!], [{ ...o, weight: 1 }]);
      realSum += o.weight * (won / games);
      aiSum += o.weight * ai;
      weight += o.weight;
      realGames += games;
      opponents++;
    });
    const realRate = weight ? realSum / weight : 0.5;
    const ai = weight ? aiSum / weight : 0.5;
    return {
      id: f.id,
      name: f.name,
      share: f.meta.share,
      real: realRate,
      realGames,
      ai,
      bias: ai - realRate,
      opponents,
    };
  });
}
