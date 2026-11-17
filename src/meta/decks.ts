// Meta decks for the game and the simulator: the archetypes of a snapshot as named deck lists.

import type { CardLib } from "../engine/cardlib";
import { validateDeck } from "../engine/deck";
import type { NamedDeck } from "../data/decks";
import { buildArchetypes } from "./archetypes";
import type { DeckList } from "../engine/types";
import type { Archetype, MetaSnapshot } from "./types";

/** Which list of an archetype a meta deck is: the consensus list, the best placed real list, or both. */
export type MetaList = "consensus" | "best" | "both";

export interface MetaDeck extends NamedDeck {
  archetype: Archetype;
  /** Share of the meta (0–1). */
  share: number;
  /** Every card is fully understood by the engine. */
  supported: boolean;
  /** "consensus" (id M01 …) or "best" (id M01B …). */
  list: "consensus" | "best";
}

/** Short id for an archetype, e.g. "M01" for the most played one. */
const metaId = (rank: number) => `M${String(rank + 1).padStart(2, "0")}`;

/** "M01B" → "M01": the archetype a meta deck id belongs to. */
export const metaBaseId = (id: string) => id.replace(/^(M\d{2,})B$/, "$1");

/**
 * The archetypes as decks, most played first. Ids follow the rank among archetypes with a legal
 * consensus list (M01, M02 …); the real list with the best result has the same id with "B"
 * (M01B) and is left out if it isn't legal.
 */
export function metaDecks(
  snapshot: MetaSnapshot,
  lib: CardLib,
  limit = Infinity,
  list: MetaList = "consensus",
): MetaDeck[] {
  const supported = (deck: DeckList) =>
    deck.main.every((no) => lib.has(no) && lib.get(no).script.status !== "partial");
  const out: MetaDeck[] = [];
  buildArchetypes(snapshot, lib)
    .filter((a) => validateDeck(lib, a.consensus).length === 0)
    .slice(0, limit)
    .forEach((a, rank) => {
      const base = { archetype: a, share: a.share, colors: a.colors.join("/") };
      if (list !== "best") {
        out.push({
          ...base,
          id: metaId(rank),
          name: a.name,
          deck: a.consensus,
          supported: supported(a.consensus),
          list: "consensus",
        });
      }
      if (list !== "consensus" && validateDeck(lib, a.best).length === 0) {
        out.push({
          ...base,
          id: `${metaId(rank)}B`,
          name: `${a.name} – beste Liste (Platz ${a.bestPlacing.placing} von ${a.entries[0]?.tournament.players ?? "?"})`,
          deck: a.best,
          supported: supported(a.best),
          list: "best",
        });
      }
    });
  return out;
}

/** The newest snapshot of a set of files named <date>.json. */
export function newestSnapshot(files: Record<string, MetaSnapshot>): MetaSnapshot | undefined {
  const key = Object.keys(files)
    .filter((k) => /\d{4}-\d\d-\d\d\.json$/.test(k))
    .sort()
    .at(-1);
  return key ? files[key] : undefined;
}
