// Export of a game against the AI (src/app/lib/gameexport.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makePolicy } from "../../src/ai/registry";
import { gameFileName, gameLogText, parseSavedGame } from "../../src/app/lib/gameexport";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { viewFor } from "../../src/engine/view";
import { GameSession } from "../../src/sim/session";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));

describe("game export", () => {
  it("writes the log with a header, and the saved game loads to the same state", () => {
    const [a, b] = [STARTER_DECKS[1]!, STARTER_DECKS[0]!];
    const s = new GameSession(engine, {
      decks: [a.deck, b.deck],
      options: { seed: 7, firstPlayer: 0 },
      human: 0,
      ai: "heuristic-v0",
      deckNames: [`${a.id} ${a.name}`, `${b.id} ${b.name}`],
    });
    const ai = makePolicy("heuristic-v0", engine, 1);
    while (s.state.pending) s.apply(ai.choose(viewFor(s.state, s.state.pending.player), s.state.pending));
    const text = gameLogText(engine, s, new Date(2026, 10, 18, 12, 0));
    expect(text).toMatch(/^GCG Battle Simulator – Partie vom 18\.11\.2026/);
    expect(text).toContain("Du: ST02 ");
    expect(text).toContain("KI: ST01 ");
    expect(text).toMatch(/Ergebnis: (Gewonnen|Verloren|Unentschieden) nach \d+ Zügen/);
    expect(text).toContain("\nZug 1 ·");
    expect(gameFileName(s, new Date("2026-11-18T12:00:00Z"))).toBe("partie-2026-11-18-ST02-gegen-ST01");

    const loaded = GameSession.restore(engine, parseSavedGame(JSON.stringify(s.save(), null, 1)));
    expect(loaded.state).toEqual(s.state);
    expect(() => parseSavedGame("{}")).toThrow(/keine exportierte Partie/);
    expect(() => parseSavedGame("nope")).toThrow(/kein JSON/);
  });
});
