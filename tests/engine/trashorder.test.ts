// The newest card of a trash is the first one (moveTo puts cards on top = at the front). The board shows
// trash[0] on the pile and the trash dialog in this order (user, 23 Nov 2026: the pile showed the oldest card).

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
const OVERFLOWING = "GD01-118"; // 【Main】Draw 2. Then, discard 1.

describe("trash order", () => {
  it("the card that went to the trash last is the first one", () => {
    const s = scenario({ engine, filler: "ST01-005", p0: { hand: [OVERFLOWING], resources: 3 } });
    const play = s.pending!.options.find((o) => o.type === "playCommand")!;
    engine.apply(s, play);
    // Discard one of the drawn cards; then the Command itself goes to the trash.
    const discard = s.pending!.options.find((o) => o.type === "target")!;
    engine.apply(s, discard);
    const trash = s.players[0].trash.map((id) => s.cards[id]!.no);
    expect(trash).toEqual([OVERFLOWING, "ST01-005"]);
  });
});
