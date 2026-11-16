// Decks the app offers: the meta archetypes of the newest snapshot in data/meta (bundled) and the
// starter decks.

import type { CardPool } from "../../data/cards";
import { STARTER_DECKS, type NamedDeck } from "../../data/decks";
import { CardLib } from "../../engine/cardlib";
import { metaDecks, newestSnapshot, type MetaDeck } from "../../meta/decks";
import type { MetaSnapshot } from "../../meta/types";

const files = import.meta.glob<MetaSnapshot>("../../../data/meta/*.json", { eager: true, import: "default" });

export const SNAPSHOT: MetaSnapshot | undefined = newestSnapshot(files);

const libs = new WeakMap<CardPool, CardLib>();

/** One card library per pool (building it parses every card text). */
export function cardLib(pool: CardPool): CardLib {
  let lib = libs.get(pool);
  if (!lib) libs.set(pool, (lib = CardLib.fromPool(pool)));
  return lib;
}

export interface DeckChoice extends NamedDeck {
  group: "meta" | "starter";
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
  return [...meta, ...starters];
}

export function deckLabel(d: DeckChoice): string {
  const share = d.share !== undefined ? ` · ${(d.share * 100).toFixed(1)} %` : "";
  return `${d.id} ${d.name} (${d.colors})${share}${d.supported ? "" : " · unvollständig"}`;
}
