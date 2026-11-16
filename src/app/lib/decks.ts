// Decks the app offers: the meta archetypes of the active snapshot (bundled from data/meta, or a newer
// one loaded in the Meta tab and kept in IndexedDB), the starter decks and the user's own decks.

import type { CardPool } from "../../data/cards";
import { STARTER_DECKS, type NamedDeck } from "../../data/decks";
import { CardLib } from "../../engine/cardlib";
import { metaDecks, newestSnapshot, type MetaDeck } from "../../meta/decks";
import type { MetaSnapshot } from "../../meta/types";
import type { UserDeck } from "./db";

const files = import.meta.glob<MetaSnapshot>("../../../data/meta/*.json", { eager: true, import: "default" });

export const BUNDLED_SNAPSHOT: MetaSnapshot | undefined = newestSnapshot(files);

/** The active snapshot (a live binding: components read it when they are created). */
export let SNAPSHOT: MetaSnapshot | undefined = BUNDLED_SNAPSHOT;

export function setSnapshot(snapshot: MetaSnapshot | undefined): void {
  SNAPSHOT = snapshot ?? BUNDLED_SNAPSHOT;
}

let USER_DECKS: UserDeck[] = [];

export function setUserDecks(decks: UserDeck[]): void {
  USER_DECKS = decks;
}

/** Deck to preselect when switching to the game or the simulator (from the Meta or Decks tab). */
export const preset: { play: string | null; gauntlet: string | null } = { play: null, gauntlet: null };

const libs = new WeakMap<CardPool, CardLib>();

/** One card library per pool (building it parses every card text). */
export function cardLib(pool: CardPool): CardLib {
  let lib = libs.get(pool);
  if (!lib) libs.set(pool, (lib = CardLib.fromPool(pool)));
  return lib;
}

export interface DeckChoice extends NamedDeck {
  group: "meta" | "starter" | "user";
  /** Meta share (0–1) for meta decks. */
  share?: number;
  supported: boolean;
}

export function deckChoices(pool: CardPool): DeckChoice[] {
  const lib = cardLib(pool);
  const meta: DeckChoice[] = SNAPSHOT
    ? metaDecks(SNAPSHOT, lib).map((d: MetaDeck) => ({ ...d, group: "meta" as const }))
    : [];
  const starters: DeckChoice[] = STARTER_DECKS.map((d) => ({ ...d, group: "starter", supported: true }));
  const own: DeckChoice[] = USER_DECKS.map((d) => ({
    id: d.id,
    name: d.name,
    colors: deckColors(lib, d.deck.main),
    deck: d.deck,
    group: "user",
    supported: d.deck.main.every((no) => lib.has(no) && lib.get(no).script.status !== "partial"),
  }));
  return [...meta, ...starters, ...own];
}

export function deckColors(lib: CardLib, nos: readonly string[]): string {
  const colors = new Set<string>();
  for (const no of nos) {
    const color = lib.has(no) ? lib.get(no).color : null;
    if (color) colors.add(color);
  }
  return [...colors].sort().join("/");
}

export function deckLabel(d: DeckChoice): string {
  const share = d.share !== undefined ? ` · ${(d.share * 100).toFixed(1)} %` : "";
  const title = d.group === "user" ? d.name : `${d.id} ${d.name}`;
  return `${title} (${d.colors})${share}${d.supported ? "" : " · unvollständig"}`;
}
