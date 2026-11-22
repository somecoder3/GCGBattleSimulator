// Cards that go well with a chosen card (user's wish, 23 Nov 2026), from two sources:
//
// 1. Effects (the combo graph of src/ai/synergy.ts): Pilots that link a Unit and Units a Pilot links; cards
//    the effects of this card look for ("choose 2 (MF) Unit cards from your trash"); cards whose effects
//    look for this card. Only what the texts say: a good curve or colour doesn't show here.
// 2. Tournament lists of the meta snapshot: cards played together with this card more often than chance
//    (lift), with how many of its lists contain them.
//
// Shown in the card detail of the Cards tab and the deck builder, not in the game.

import { cardCombos, matchesCard, type CardCombo } from "../../ai/synergy";
import type { CardLib, EngineCard } from "../../engine/cardlib";
import { satisfiesLink } from "../../engine/cardlib";
import type { MetaSnapshot } from "../../meta/types";

export interface PartnerCard {
  no: string;
  /** Why (for "wanted": what the other card looks for). */
  note?: string;
}

export interface PartnerGroup {
  kind: "link" | "wants" | "wanted" | "played";
  title: string;
  cards: PartnerCard[];
}

export interface PartnerOptions {
  /** Only cards of these colours (and colourless ones), e.g. the two colours of a deck. */
  colors?: ReadonlySet<string>;
  snapshot?: MetaSnapshot;
}

const ZONE_TEXT: Record<string, string> = {
  trash: "im Trash",
  hand: "auf der Hand",
  battle: "in der Battle Area",
  field: "im Spiel",
  pilots: "als Pilot",
  base: "als Base",
  shieldArea: "in der Schildzone",
  resources: "bei den Ressourcen",
};

const TYPE_TEXT: Record<string, string> = {
  UNIT: "Unit",
  PILOT: "Pilot",
  COMMAND: "Command",
  BASE: "Base",
};

/** "Wählt 2× (MF) Unit im Trash", "Zählt (Zeon) Unit in der Battle Area", "„Shining Gundam“ ab Lv.5". */
export function comboText(c: CardCombo): string {
  const f = c.filter;
  const parts: string[] = [];
  if (f.traits?.length) parts.push(f.traits.map((t) => `(${t})`).join("/"));
  if (f.names?.length) parts.push(f.names.map((n) => `„${n}“`).join("/"));
  const types = [...new Set((f.types ?? []).map((t) => TYPE_TEXT[t]).filter(Boolean))];
  parts.push(types.length ? types.join("/") : "Karte");
  if (f.lvMin !== undefined && f.lvMax !== undefined) parts.push(`Lv.${f.lvMin}–${f.lvMax}`);
  else if (f.lvMin !== undefined) parts.push(`ab Lv.${f.lvMin}`);
  else if (f.lvMax !== undefined) parts.push(`bis Lv.${f.lvMax}`);
  // A condition on a chosen or discarded card: the effect is stronger with such a card.
  if (c.use === "match") return `Bonus mit ${parts.join(" ")}`;
  const zone = ZONE_TEXT[c.zone] ?? "";
  const need = c.need > 1 ? `${c.need}× ` : "";
  return `${c.use === "count" ? "Zählt" : "Wählt"} ${need}${parts.join(" ")}${zone ? ` ${zone}` : ""}`;
}

/**
 * Filters that match this many deck cards or more say nothing about a combo ("choose 1 Unit card from your
 * trash" matches every Unit); left out in both directions.
 */
export const GENERIC = 120;

const DECK_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);

const deckables = new WeakMap<CardLib, EngineCard[]>();

/** Cards that can be in a main deck (no tokens, no Resources). */
function deckable(lib: CardLib): EngineCard[] {
  let out = deckables.get(lib);
  if (!out) {
    out = [...lib.all()].filter((c) => DECK_TYPES.has(c.type) && !c.token);
    deckables.set(lib, out);
  }
  return out;
}

const breadth = new WeakMap<CardCombo, number>();

/** Whether a filter is specific enough to show (matches fewer than GENERIC deck cards). */
function narrow(lib: CardLib, combo: CardCombo): boolean {
  let n = breadth.get(combo);
  if (n === undefined) {
    n = deckable(lib).filter((c) => matchesCard(c, combo.filter)).length;
    breadth.set(combo, n);
  }
  return n < GENERIC;
}

interface CoPlay {
  total: number;
  /** Per card number: indexes of the lists that contain it. */
  lists: Map<string, number[]>;
}

const coplays = new WeakMap<MetaSnapshot, CoPlay>();

function coPlay(snapshot: MetaSnapshot): CoPlay {
  let c = coplays.get(snapshot);
  if (!c) {
    const lists = new Map<string, number[]>();
    snapshot.decks.forEach((d, i) => {
      for (const no of Object.keys(d.cards)) {
        let l = lists.get(no);
        if (!l) lists.set(no, (l = []));
        l.push(i);
      }
    });
    c = { total: snapshot.decks.length, lists };
    coplays.set(snapshot, c);
  }
  return c;
}

/** In how many lists of the snapshot a card is (0 without snapshot). */
export function listCount(snapshot: MetaSnapshot | undefined, no: string): number {
  return snapshot ? (coPlay(snapshot).lists.get(no)?.length ?? 0) : 0;
}

/**
 * Cards played together with `no`: in at least 2 of its lists and more often than chance (lift ≥ 1.2),
 * most common first. `together` of `lists` lists of the card contain the partner.
 */
export function playedWith(
  snapshot: MetaSnapshot,
  no: string,
): { no: string; together: number; lists: number; lift: number }[] {
  const { total, lists } = coPlay(snapshot);
  const mine = lists.get(no);
  if (!mine?.length) return [];
  const set = new Set(mine);
  const out: { no: string; together: number; lists: number; lift: number }[] = [];
  for (const [other, l] of lists) {
    if (other === no) continue;
    const together = l.filter((i) => set.has(i)).length;
    if (together < 2) continue;
    const lift = together / mine.length / (l.length / total);
    if (lift < 1.2) continue;
    out.push({ no: other, together, lists: mine.length, lift });
  }
  return out.sort((a, b) => b.together - a.together || b.lift - a.lift || a.no.localeCompare(b.no));
}

/** Partner groups of a card, each sorted by how often the partner is played with it, then in general. */
export function partners(lib: CardLib, no: string, options: PartnerOptions = {}): PartnerGroup[] {
  const card = lib.get(no);
  const { colors, snapshot } = options;
  const allowed = (c: EngineCard) => c.no !== no && (!colors?.size || !c.color || colors.has(c.color));
  const pool = deckable(lib).filter(allowed);
  const played = snapshot ? playedWith(snapshot, no) : [];
  const together = new Map(played.map((p) => [p.no, p.together]));
  const rank = (a: PartnerCard, b: PartnerCard) =>
    (together.get(b.no) ?? 0) - (together.get(a.no) ?? 0) ||
    listCount(snapshot, b.no) - listCount(snapshot, a.no) ||
    a.no.localeCompare(b.no);
  const groups: PartnerGroup[] = [];

  // Links: Pilots (and Commands with 【Pilot】) for a Unit, Units for a Pilot.
  const links: PartnerCard[] = [];
  if (card.type === "UNIT" && card.link.length) {
    for (const p of pool) if (p.pairable && satisfiesLink(card, p)) links.push({ no: p.no });
  }
  if (card.pairable) {
    for (const u of pool) if (u.type === "UNIT" && satisfiesLink(u, card)) links.push({ no: u.no });
  }
  if (links.length)
    groups.push({
      kind: "link",
      title: card.pairable ? "Linkt mit diesen Units" : "Linkt mit",
      cards: links.sort(rank),
    });

  // What the effects of this card look for.
  for (const combo of cardCombos(card, true)) {
    if (!narrow(lib, combo)) continue;
    const cards = pool.filter((c) => matchesCard(c, combo.filter)).map((c) => ({ no: c.no }));
    if (cards.length) groups.push({ kind: "wants", title: comboText(combo), cards: cards.sort(rank) });
  }

  // Cards whose effects look for this card.
  const wanted: PartnerCard[] = [];
  for (const other of pool) {
    const hit = cardCombos(other, true).find((c) => matchesCard(card, c.filter) && narrow(lib, c));
    if (hit) wanted.push({ no: other.no, note: comboText(hit) });
  }
  if (wanted.length) groups.push({ kind: "wanted", title: "Nutzen diese Karte", cards: wanted.sort(rank) });

  // Tournament lists.
  if (played.length) {
    const ok = new Set(pool.map((c) => c.no));
    const cards = played
      .filter((p) => ok.has(p.no))
      .map((p) => ({ no: p.no, note: `in ${p.together} von ${p.lists} Listen` }));
    if (cards.length) groups.push({ kind: "played", title: "Oft zusammen gespielt", cards });
  }
  return groups;
}
