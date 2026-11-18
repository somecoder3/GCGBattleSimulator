// "During this battle" outside a battle (found in a simulator replay, 18 Nov 2026): Unicorn Gundam 02 Banshee
// (Destroy Mode) ST12-006 gained <Suppression> in the end phase's action step and kept it for its attack in
// the next turn.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { GameState } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const GM = "ST01-005";
const BANSHEE = "ST12-006"; // 【Activate･Action】 exile 4 cards in your trash: <Suppression> during this battle

/** Player 0 ends the main phase; the end phase's action step offers Banshee's 【Activate･Action】. */
function endPhase(): GameState {
  const s = scenario({
    engine,
    filler: GM,
    p0: { battle: [BANSHEE], trash: [GM, GM, GM, GM, GM] },
  });
  engine.apply(s, { type: "endMain" });
  return s;
}
const activation = (s: GameState) => s.pending?.options.find((o) => o.type === "activate");

describe("during this battle, outside a battle", () => {
  it("ends at once: no <Suppression> left for the next battle", () => {
    const s = endPhase();
    expect(s.battle).toBeNull();
    const activate = activation(s);
    expect(activate).toBeDefined();
    engine.apply(s, activate!);
    while (s.pending?.kind === "effect") engine.apply(s, s.pending.options[0]!);
    expect(s.players[0].trash).toHaveLength(1); // the cost was paid
    const banshee = s.players[0].battle[0]!;
    expect(s.modifiers.filter((m) => m.until === "battle")).toEqual([]);
    expect(engine.keywords(s, banshee).suppression).toBe(false);
  });

  it("the AI doesn't activate it there", () => {
    const s = endPhase();
    const p = s.pending!.player;
    const v0 = new HeuristicPolicy(engine);
    expect(v0.choose(viewFor(s, p), s.pending!).type).not.toBe("activate");
    expect(v0.allowed(viewFor(s, p), s.pending!).some((o) => o.type === "activate")).toBe(false);
  });
});
