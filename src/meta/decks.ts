// Meta decks for the game and the simulator: the archetypes of a snapshot as named deck lists.

import type { CardLib } from "../engine/cardlib";
import { validateDeck } from "../engine/deck";
import type { NamedDeck } from "../data/decks";
import { buildArchetypes } from "./archetypes";
import type { Archetype, MetaSnapshot } from "./types";

export interface MetaDeck extends NamedDeck {
  archetype: Archetype;
  /** Share of the meta (0–1). */
  share: number;
  /** Every card is fully understood by the engine. */
  supported: boolean;
}

/** Short id for an archetype, e.g. "M01" for the most played one. */
const metaId = (rank: number) => `M${String(rank + 1).padStart(2, "0")}`;

/** The archetypes as decks (consensus lists), most played first. Illegal lists are left out. */
export function metaDecks(snapshot: MetaSnapshot, lib: CardLib, limit = Infinity): MetaDeck[] {
  return buildArchetypes(snapshot, lib)
    .filter((a) => validateDeck(lib, a.consensus).length === 0)
    .slice(0, limit)
    .map((a, rank) => ({
      id: metaId(rank),
      name: a.name,
      colors: a.colors.join("/"),
      deck: a.consensus,
      archetype: a,
      share: a.share,
      supported: a.partial.length === 0,
    }));
}

/** The newest snapshot of a set of files named <date>.json. */
export function newestSnapshot(files: Record<string, MetaSnapshot>): MetaSnapshot | undefined {
  const key = Object.keys(files)
    .filter((k) => /\d{4}-\d\d-\d\d\.json$/.test(k))
    .sort()
    .at(-1);
  return key ? files[key] : undefined;
}
