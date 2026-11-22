// Combos of a deck, read from the compiled card effects (docs/AI.md "Kombos").
//
// A card "wants" other cards of its own deck when one of its effects looks for friendly cards with a
// specific trait, name or type in a zone: Shining Gundam (GD05-066) exiles 2 (MF) Unit cards from the
// trash and returns a (Special Move) Command from there, Master Asia (GD05-089) counts (MF) cards in the
// trash. Links between Units and Pilots of the deck are relations as well. Generic filters ("1 of your
// Units") are left out: every card matches them, they say nothing about the deck.
//
// The relations are static (deck list only) and feed the AI's card values (DeckPlan).

import type { Filter } from "../effects/dsl";
import type { CardLib, EngineCard } from "../engine/cardlib";
import { satisfiesLink } from "../engine/cardlib";
import type { DeckList } from "../engine/types";

export type SynergyZone =
  "trash" | "hand" | "battle" | "field" | "pilots" | "base" | "shieldArea" | "resources";

export interface Synergy {
  /** The card whose effect looks for the others. */
  source: string;
  kind: "zone" | "link";
  /** Where the effect looks (for links: the Pilot pairs with the Unit). */
  zone: SynergyZone | "link";
  /** How the effect uses them: counts them (condition), chooses them, checks a chosen card, or links. */
  use: "count" | "choose" | "match" | "link";
  /** Cards of the deck that match, with their copies. */
  matches: Map<string, number>;
  /** Short description of the filter, for the report. */
  label: string;
  /** How many matching cards one use of the effect needs ("choose 2", "3 or more"); 1 if not stated. */
  need: number;
}

/** Keys of the DSL that hold a filter on cards (choose, count, conditions on Pilots and battles). */
const FILTER_KEYS = new Set([
  "filter",
  "count",
  "pilotInPlay",
  "selfPilot",
  "pairedWith",
  "battling",
  "pilot",
]);

/** "match": a condition on a chosen or discarded card ("If you discard a (Special Move) Command card"). */
type Found = { filter: Filter; use: "count" | "choose" | "match"; need: number };

/**
 * Collects filters on friendly cards from any part of a compiled effect, with the number the effect needs:
 * the `count` of a choice ("choose 2") or the `min` of a count condition ("3 or more").
 */
function collect(node: unknown, key: string, out: Found[], parent?: Record<string, unknown>): void {
  if (Array.isArray(node)) {
    for (const x of node) collect(x, key, out, parent);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (FILTER_KEYS.has(key) && looksLikeFilter(o)) {
    const n = key === "count" ? parent?.min : parent?.count;
    out.push({
      filter: o as Filter,
      use: key === "count" ? "count" : parent && "varMatches" in parent ? "match" : "choose",
      need: typeof n === "number" ? n : 1,
    });
  }
  if (typeof o.nameInTrash === "string") {
    out.push({ filter: { zone: "trash", side: "friendly", names: [o.nameInTrash] }, use: "count", need: 1 });
  }
  for (const [k, v] of Object.entries(o)) collect(v, k, out, o);
}

function looksLikeFilter(o: Record<string, unknown>): boolean {
  return "traits" in o || "names" in o || "types" in o || "zone" in o || "side" in o;
}

/** Specific enough to be a combo: a trait or a name, or a card type looked for in the trash. */
function specific(f: Filter): boolean {
  if (f.side === "enemy") return false;
  if (f.traits?.length || f.names?.length) return true;
  return f.zone === "trash" && !!f.types?.length;
}

/** The part of Filter that only depends on the printed card (state-dependent fields are ignored). */
export function matchesCard(card: EngineCard, f: Filter): boolean {
  if (f.types && !f.types.includes(card.type)) return false;
  if (f.traits && !f.traits.some((t) => card.traits.includes(t))) return false;
  if (f.names && !f.names.some((n) => card.name.includes(n) || card.aliases.some((a) => a.includes(n))))
    return false;
  if (f.colors && (!card.color || !f.colors.includes(card.color))) return false;
  if (f.notColors && card.color && f.notColors.includes(card.color)) return false;
  if (f.lvMin !== undefined && card.level < f.lvMin) return false;
  if (f.lvMax !== undefined && card.level > f.lvMax) return false;
  if (f.token !== undefined && card.token !== f.token) return false;
  if (f.anyOf && !f.anyOf.some((g) => matchesCard(card, g))) return false;
  return true;
}

function describe(f: Filter): string {
  const parts: string[] = [];
  if (f.traits?.length) parts.push(f.traits.map((t) => `(${t})`).join("/"));
  if (f.names?.length) parts.push(f.names.map((n) => `„${n}“`).join("/"));
  if (f.types?.length) parts.push(f.types.join("/"));
  if (f.lvMin !== undefined || f.lvMax !== undefined) parts.push(`Lv.${f.lvMin ?? ""}–${f.lvMax ?? ""}`);
  return parts.join(" ") || "Karte";
}

/** Copies per card number. */
export function deckCounts(deck: DeckList): Map<string, number> {
  const m = new Map<string, number>();
  for (const no of deck.main) m.set(no, (m.get(no) ?? 0) + 1);
  return m;
}

/** A specific filter of a card's effects on own cards (one per zone, use and filter). */
export interface CardCombo {
  filter: Filter;
  zone: SynergyZone;
  use: "count" | "choose" | "match";
  label: string;
  need: number;
}

const combos = new WeakMap<EngineCard, CardCombo[]>();
const combosWithGranted = new WeakMap<EngineCard, CardCombo[]>();

/**
 * The specific filters on own cards in the effects of a card (cached per card). With `granted` also the
 * effects the card gives its Unit (a Pilot's lines other than 【Burst】, e.g. Domon Kasshu's 【When Paired】);
 * "Passt zu" uses them, the AI's deck plan not yet (its measured behaviour stays the same).
 */
export function cardCombos(card: EngineCard, granted = false): CardCombo[] {
  const cache = granted ? combosWithGranted : combos;
  let out = cache.get(card);
  if (out) return out;
  out = [];
  const seen = new Set<string>();
  const effects = granted ? [...card.script.compiled, ...card.script.compiledGranted] : card.script.compiled;
  for (const { effect, program } of effects) {
    const found: Found[] = [];
    collect(effect, "", found);
    collect(program, "", found);
    for (const { filter, use, need } of found) {
      if (!specific(filter)) continue;
      const zone = (filter.zone ?? "battle") as SynergyZone;
      const label = describe(filter);
      const key = `${zone}|${use}|${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ filter, zone, use, label, need });
    }
  }
  cache.set(card, out);
  return out;
}

/** All combo relations of a deck. */
export function deckSynergies(lib: CardLib, deck: DeckList, granted = false): Synergy[] {
  const counts = deckCounts(deck);
  const cards = [...counts.keys()].map((no) => lib.get(no));
  const out: Synergy[] = [];
  for (const card of cards) {
    for (const { filter, zone, use, label, need } of cardCombos(card, granted)) {
      const matches = new Map<string, number>();
      for (const other of cards) {
        if (other.no === card.no && filter.other) continue;
        if (matchesCard(other, filter)) matches.set(other.no, counts.get(other.no)!);
      }
      if (matches.size) out.push({ source: card.no, kind: "zone", zone, use, matches, label, need });
    }
    if (card.type === "UNIT" && card.link.length) {
      const matches = new Map<string, number>();
      for (const pilot of cards) {
        if (pilot.pairable && satisfiesLink(card, pilot)) matches.set(pilot.no, counts.get(pilot.no)!);
      }
      const label = card.link.map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`)).join("/");
      if (matches.size)
        out.push({ source: card.no, kind: "link", zone: "link", use: "link", matches, label, need: 1 });
    }
  }
  return out;
}

/**
 * What the AI takes from the relations: how much a card is worth in the trash for this deck (fuel for
 * trash effects), and which Pilots link Units of the deck. Values are in cards (1 = one copy needed by
 * one copy of the source); callers scale them.
 */
export interface DeckPlan {
  /** Per card number: copies of source cards that look for it in the trash, divided by its own copies. */
  trashFuel: Map<string, number>;
  /** Per Pilot number: Units of the deck it links. */
  linksTo: Map<string, string[]>;
  synergies: Synergy[];
  /** Copies per card number in the deck list. */
  counts: Map<string, number>;
}

/**
 * Trash needs of the own deck in a state (23 Nov 2026, `RuleOptions.trashAware`): for each effect of an own
 * card that uses cards from the own trash (choose/count with a trash filter), how many matching cards lie
 * there and how many it needs; only while the source card can still be played (not all copies in the trash
 * or gone). `useful` = the matching cards up to the need, summed over the effects.
 */
export function trashNeeds(
  plan: DeckPlan,
  trash: readonly string[],
  spent: ReadonlyMap<string, number>,
): { useful: number; missing: Set<string> } {
  let useful = 0;
  const missing = new Set<string>();
  for (const s of plan.synergies) {
    if (s.kind !== "zone" || s.zone !== "trash") continue;
    if ((plan.counts.get(s.source) ?? 0) <= (spent.get(s.source) ?? 0)) continue; // no copy left to use it
    const need = Math.min(4, Math.max(1, s.need));
    const have = trash.filter((no) => s.matches.has(no)).length;
    useful += Math.min(have, need);
    if (have < need) for (const no of s.matches.keys()) missing.add(no);
  }
  return { useful, missing };
}

/** `granted`: also the Pilot lines given to the Unit (RuleOptions.grantedPlan, experiment). */
export function deckPlan(lib: CardLib, deck: DeckList, granted = false): DeckPlan {
  const counts = deckCounts(deck);
  const synergies = deckSynergies(lib, deck, granted);
  const trashFuel = new Map<string, number>();
  const linksTo = new Map<string, string[]>();
  for (const s of synergies) {
    if (s.kind === "link") {
      for (const pilot of s.matches.keys()) linksTo.set(pilot, [...(linksTo.get(pilot) ?? []), s.source]);
      continue;
    }
    if (s.zone !== "trash") continue;
    const sourceCopies = counts.get(s.source) ?? 0;
    const total = [...s.matches.values()].reduce((a, b) => a + b, 0);
    for (const no of s.matches.keys()) {
      // Sources with many matching cards in the deck need each one less.
      trashFuel.set(no, (trashFuel.get(no) ?? 0) + sourceCopies / Math.max(total, 1));
    }
  }
  return { trashFuel, linksTo, synergies, counts };
}

const plans = new WeakMap<DeckList, DeckPlan>();
const grantedPlans = new WeakMap<DeckList, DeckPlan>();

/** deckPlan, computed once per deck list object. */
export function planFor(lib: CardLib, deck: DeckList, granted = false): DeckPlan {
  const cache = granted ? grantedPlans : plans;
  let plan = cache.get(deck);
  if (!plan) cache.set(deck, (plan = deckPlan(lib, deck, granted)));
  return plan;
}
