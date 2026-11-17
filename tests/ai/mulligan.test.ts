// The mulligan rules (src/ai/mulligan.ts) on hands of real cards.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keepHand, withMulligan } from "../../src/ai/mulligan";
import { RandomPolicy } from "../../src/ai/random";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));

const GM = "ST01-005"; // Unit Lv.2
const GUNDAM = "ST01-001"; // Unit Lv.4
const BIG = "ST08-001"; // Unit Lv.9
const AMURO = "ST01-010"; // Pilot Lv.4
const COMMAND = "ST05-013"; // Command Lv.2
const hand = (cards: string[]) => scenario({ engine, filler: GM, p0: { hand: cards } });

describe("mulligan rules", () => {
  it("units: keeps two Units up to Lv.4, else redraws", () => {
    expect(keepHand(engine, hand([GM, GUNDAM, BIG, AMURO, COMMAND]), 0, "units")).toBe(true);
    expect(keepHand(engine, hand([GM, BIG, BIG, AMURO, COMMAND]), 0, "units")).toBe(false);
    expect(keepHand(engine, hand([AMURO, AMURO, COMMAND, COMMAND, BIG]), 0, "units")).toBe(false);
  });

  it("basic: keeps a Unit up to Lv.3 or two cards up to Lv.4", () => {
    expect(keepHand(engine, hand([GM, BIG, BIG, BIG, BIG]), 0, "basic")).toBe(true);
    expect(keepHand(engine, hand([AMURO, COMMAND, BIG, BIG, BIG]), 0, "basic")).toBe(true);
    expect(keepHand(engine, hand([AMURO, BIG, BIG, BIG, BIG]), 0, "basic")).toBe(false);
  });

  it("withMulligan decides only the mulligan", () => {
    const s = hand([BIG, BIG, BIG, AMURO, COMMAND]);
    const policy = withMulligan(new RandomPolicy(1), engine, "units");
    const decision = {
      player: 0 as const,
      kind: "mulligan" as const,
      options: [{ type: "keepHand" as const }, { type: "redraw" as const }],
    };
    expect(policy.choose(s, decision)).toEqual({ type: "redraw" });
    expect(policy.choose(s, s.pending!).type).not.toBe("redraw");
  });
});
