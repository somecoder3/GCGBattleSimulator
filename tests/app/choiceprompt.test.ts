// The question of an optional choice of cards (found in a game of the user, 21 Nov 2026): Master Gundam's
// 【Attack】 "You may choose 2 (Special Move) Command cards from your trash. Exile them. If you do, deal 5
// damage …" said only "Ziel wählen" with "Fertig" on the space key, and "Fertig" chose nothing.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { choiceInfo, decisionText, doneLabel } from "../../src/app/lib/actions";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const name = (id: number) => engine.card(s, id).name;

const MASTER = "GD05-033";
const DARKNESS = "GD05-110"; // (Special Move)
const SHINING_FINGER = "GD05-120"; // (Special Move)

const s = scenario({
  engine,
  filler: "ST01-005",
  p0: { battle: [MASTER], trash: [DARKNESS, SHINING_FINGER] },
});
engine.apply(s, { type: "attack", unit: s.players[0].battle[0]!, target: "player" });

describe("optional choice of cards", () => {
  it("says how many cards from where, and that choosing none skips the effect", () => {
    const choice = choiceInfo(s);
    expect(choice).toEqual({ left: 2, chosen: 0, optional: true, exact: true, candidates: 2, zone: "trash" });
    expect(decisionText(s.pending!, name, choice)).toBe(
      "Master Gundam: 2 Karten aus deinem Trash wählen. Ohne Wahl entfällt der Effekt.",
    );
    expect(doneLabel(choice)).toBe("Nicht nutzen");
    expect(doneLabel({ ...choice!, chosen: 1 })).toBe("Fertig");
    expect(decisionText(s.pending!, name, { ...choice!, left: 1, chosen: 1 })).toBe(
      "Master Gundam: 1 weitere Karte wählen.",
    );
  });
});
