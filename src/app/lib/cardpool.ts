import cardsUrl from "../../../gcgdb/data/cards.json?url";
import { CardPool } from "../../data/cards";
import type { RawCardsDoc } from "../../data/types";

let pending: Promise<CardPool> | undefined;

/** Loads GCGDB's cards.json once (bundled as a hashed asset). */
export function loadCardPool(): Promise<CardPool> {
  pending ??= fetch(cardsUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`cards.json: HTTP ${response.status}`);
      return response.json() as Promise<RawCardsDoc>;
    })
    .then((doc) => new CardPool(doc));
  return pending;
}
