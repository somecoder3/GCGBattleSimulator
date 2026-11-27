// The deck choices in groups, as the deck picker shows them (game and Decks tab): own decks, the decks of
// each other user, lab decks, meta, starter and test decks. Also the random deck for the AI (first a group,
// then a deck in it) and the deck's face card.

import type { CardPool } from "../../data/cards";
import type { CardDef } from "../../data/types";
import type { CardLib } from "../../engine/cardlib";
import { validateDeck } from "../../engine/deck";
import type { DeckChoice } from "./decks";

export interface DeckGroup {
  /** "user", "shared:<owner>", "lab", "meta", "starter", "test". */
  key: string;
  label: string;
  decks: DeckChoice[];
}

const byName = (a: DeckChoice, b: DeckChoice) =>
  (a.title ?? a.name).localeCompare(b.title ?? b.name, "de", { sensitivity: "base" });

/** Non-empty groups in the picker's order; own and shared decks by name, the others as given. */
export function groupDecks(decks: readonly DeckChoice[], metaLabel = "Meta"): DeckGroup[] {
  const of = (group: DeckChoice["group"]) => decks.filter((d) => d.group === group);
  const owners = [...new Set(of("shared").map((d) => d.owner ?? ""))].sort((a, b) =>
    a.localeCompare(b, "de", { sensitivity: "base" }),
  );
  const groups: DeckGroup[] = [
    { key: "user", label: "Eigene Decks", decks: of("user").sort(byName) },
    ...owners.map((owner) => ({
      key: `shared:${owner}`,
      label: owner ? `Decks von ${owner}` : "Decks der anderen",
      decks: of("shared")
        .filter((d) => (d.owner ?? "") === owner)
        .sort(byName),
    })),
    { key: "lab", label: "Labor-Decks", decks: of("lab").sort(byName) },
    { key: "meta", label: metaLabel, decks: of("meta") },
    { key: "starter", label: "Starter-Decks", decks: of("starter") },
    { key: "test", label: "Testdecks", decks: of("test") },
  ];
  return groups.filter((g) => g.decks.length > 0);
}

/** Key of the group holding the deck. */
export const groupOf = (groups: readonly DeckGroup[], id: string) =>
  groups.find((g) => g.decks.some((d) => d.id === id))?.key;

/** A deck the game can use: fully supported effects and a legal size (6-1). */
export const playable = (lib: CardLib, d: DeckChoice) =>
  d.supported && validateDeck(lib, d.deck).length === 0;

/** A random playable deck: first a group (each one equally likely), then a deck in it. */
export function randomDeck(
  groups: readonly DeckGroup[],
  ok: (d: DeckChoice) => boolean,
  random: () => number = Math.random,
): DeckChoice | undefined {
  const candidates = groups.map((g) => g.decks.filter(ok)).filter((ds) => ds.length > 0);
  if (!candidates.length) return undefined;
  const decks = candidates[Math.floor(random() * candidates.length)]!;
  return decks[Math.floor(random() * decks.length)];
}

/** Decks matching a search: every word in the name, id, owner or colours. */
export function matchDeck(d: DeckChoice, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${d.id} ${d.name} ${d.owner ?? ""} ${d.colors}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The deck's face: its highest-level Unit (the most copies first). */
export function faceCard(pool: CardPool, main: readonly string[]): CardDef | undefined {
  const counts = new Map<string, number>();
  for (const no of main) counts.set(no, (counts.get(no) ?? 0) + 1);
  let best: { card: CardDef; score: number } | undefined;
  for (const [no, n] of counts) {
    const card = pool.get(no);
    if (!card || card.type !== "UNIT") continue;
    const score = (card.level ?? 0) * 10 + n;
    if (!best || score > best.score) best = { card, score };
  }
  return best?.card;
}
