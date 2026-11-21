// Any copy of a card in the hand can be played (user's wish, 21 Nov 2026): the options list one copy per
// card number, `Engine.isCopyOfOption` accepts the others and plays exactly the chosen one.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { scenario } from "./helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const GM = "ST01-005"; // Lv.1, cost 1

describe("copies of a card in the hand", () => {
  it("lists one copy, but plays the copy that was chosen", () => {
    const s = scenario({ engine, filler: GM, p0: { hand: [GM, GM, "ST01-001"], resources: 2 } });
    const [first, second] = s.players[0].hand;
    const deploys = s.pending!.options.filter((o) => o.type === "deployUnit");
    expect(deploys.map((o) => ("card" in o ? o.card : -1))).not.toContain(second);
    expect(engine.isCopyOfOption(s, { type: "deployUnit", card: second! })).toBe(true);
    engine.apply(s, { type: "deployUnit", card: second! });
    expect(s.players[0].battle).toContain(second);
    expect(s.players[0].hand).toContain(first);
  });

  it("still refuses other cards", () => {
    const s = scenario({ engine, filler: GM, p0: { hand: [GM, "ST01-001"], resources: 2 } });
    const enemyCard = s.players[1].deck[0]!;
    expect(() => engine.apply(s, { type: "deployUnit", card: enemyCard })).toThrow(/illegal/);
  });
});
