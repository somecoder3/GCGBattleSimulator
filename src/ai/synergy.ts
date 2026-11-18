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
  /** How the effect uses them: counts them (condition), chooses them, or names them ("Master Gundam"). */
  use: "count" | "choose" | "link";
  /** Cards of the deck that match, with their copies. */
  matches: Map<string, number>;
  /** Short description of the filter, for the report. */
  label: string;
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

/** Collects filters on friendly cards from any part of a compiled effect. */
function collect(node: unknown, key: string, out: { filter: Filter; use: "count" | "choose" }[]): void {
  if (Array.isArray(node)) {
    for (const x of node) collect(x, key, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (FILTER_KEYS.has(key) && looksLikeFilter(o)) {
    out.push({ filter: o as Filter, use: key === "count" ? "count" : "choose" });
  }
  if (typeof o.nameInTrash === "string") {
    out.push({ filter: { zone: "trash", side: "friendly", names: [o.nameInTrash] }, use: "count" });
  }
  for (const [k, v] of Object.entries(o)) collect(v, k, out);
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

/** All combo relations of a deck. */
export function deckSynergies(lib: CardLib, deck: DeckList): Synergy[] {
  const counts = deckCounts(deck);
  const cards = [...counts.keys()].map((no) => lib.get(no));
  const out: Synergy[] = [];
  for (const card of cards) {
    const seen = new Set<string>();
    for (const { effect, program } of card.script.compiled) {
      const found: { filter: Filter; use: "count" | "choose" }[] = [];
      collect(effect, "", found);
      collect(program, "", found);
      for (const { filter, use } of found) {
        if (!specific(filter)) continue;
        const zone = (filter.zone ?? "battle") as SynergyZone;
        const label = describe(filter);
        const key = `${zone}|${use}|${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const matches = new Map<string, number>();
        for (const other of cards) {
          if (other.no === card.no && filter.other) continue;
          if (matchesCard(other, filter)) matches.set(other.no, counts.get(other.no)!);
        }
        if (matches.size) out.push({ source: card.no, kind: "zone", zone, use, matches, label });
      }
    }
    if (card.type === "UNIT" && card.link.length) {
      const matches = new Map<string, number>();
      for (const pilot of cards) {
        if (pilot.pairable && satisfiesLink(card, pilot)) matches.set(pilot.no, counts.get(pilot.no)!);
      }
      const label = card.link.map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`)).join("/");
      if (matches.size)
        out.push({ source: card.no, kind: "link", zone: "link", use: "link", matches, label });
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
}

export function deckPlan(lib: CardLib, deck: DeckList): DeckPlan {
  const counts = deckCounts(deck);
  const synergies = deckSynergies(lib, deck);
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
  return { trashFuel, linksTo, synergies };
}

const plans = new WeakMap<DeckList, DeckPlan>();

/** deckPlan, computed once per deck list object. */
export function planFor(lib: CardLib, deck: DeckList): DeckPlan {
  let plan = plans.get(deck);
  if (!plan) plans.set(deck, (plan = deckPlan(lib, deck)));
  return plan;
}
