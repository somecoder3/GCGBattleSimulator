// Log lines of the game (src/app/lib/gamelog.ts): mulligan draws, card references, segments.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { describeSteps, segments } from "../../src/app/lib/gamelog";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { GameSession } from "../../src/sim/session";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const ai = new HeuristicPolicy(engine);

describe("game log", () => {
  it("a redraw is one line, the first turn's draw is still there", () => {
    for (const first of [0, 1] as const) {
      const session = new GameSession(engine, {
        decks: [STARTER_DECKS[0]!.deck, STARTER_DECKS[1]!.deck],
        options: { seed: 5, firstPlayer: first },
        human: 0,
      });
      while (session.state.turn === 0 || session.state.pending?.kind === "mulligan") {
        if (session.aiToAct) session.stepAI(ai);
        else session.apply({ type: "redraw" });
      }
      const lines = describeSteps(engine, session.steps, 0);
      const firstTurn = lines.findIndex((l) => l.kind === "turn");
      expect(firstTurn).toBeGreaterThan(0);
      // Before the first turn: no single draws, but the redraw line.
      expect(lines.slice(0, firstTurn).some((l) => l.event === "draw")).toBe(false);
      expect(lines.some((l) => l.text === "Du ziehst eine neue Starthand.")).toBe(true);
      // The first player's draw of turn 1 is logged.
      expect(lines[firstTurn + 1]?.event).toBe("draw");
    }
  });

  it("names cards the human sees as references", () => {
    const line = {
      index: 0,
      actor: 0 as const,
      subject: 0 as const,
      kind: "battle" as const,
      text: "Gundam greift Zaku II an.",
      cards: [
        { id: 1, no: "X", name: "Zaku II" },
        { id: 2, no: "Y", name: "Gundam" },
      ],
    };
    expect(segments(line)).toEqual([
      { card: line.cards[1] },
      { text: " greift " },
      { card: line.cards[0] },
      { text: " an." },
    ]);
    expect(segments({ ...line, cards: undefined })).toEqual([{ text: line.text }]);
  });
});
