// When the AI may use up its EX Resource (RuleOptions.ex in src/ai/heuristic.ts, docs/AI.md).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy, type RuleOptions } from "../../src/ai/heuristic";
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

const GM = "ST01-005"; // Unit Lv.2, cost 1
const GUNDAM = "ST01-001"; // Unit Lv.4, links with Amuro Ray
const AMURO = "ST01-010"; // Pilot Lv.4, cost 1
const BIG = "ST08-001"; // Unit Lv.9

/** Level 4: three rested Resources and the active EX Resource; Gundam in play. */
const position = (hand: string[]) =>
  scenario({
    engine,
    filler: GM,
    p0: { battle: [GUNDAM], hand, resources: 3, restedResources: 3, exResources: 1 },
  });
const allows = (rules: RuleOptions, s: GameState, type: string) =>
  new HeuristicPolicy(engine, rules).allowed(viewFor(s, 0), s.pending!).some((o) => o.type === type);

describe("EX Resource rules", () => {
  it("the engine knows which options use it up", () => {
    const s = position([AMURO]);
    const pair = s.pending!.options.find((o) => o.type === "pair")!;
    expect(engine.spendsEx(s, 0, pair)).toBe(true);
    const normal = scenario({ engine, filler: GM, p0: { battle: [GUNDAM], hand: [AMURO], resources: 4 } });
    expect(
      engine.spendsEx(
        normal,
        0,
        normal.pending!.options.find((o) => o.type === "pair")!,
      ),
    ).toBe(false);
  });

  it("hand: not while a Unit in the hand needs the level; a linking Pilot may (exLink)", () => {
    const s = position([AMURO, BIG]);
    expect(allows({ ex: "free" }, s, "pair")).toBe(true);
    expect(allows({}, s, "pair")).toBe(true); // default: deck rule (here: hand, no deck list) + link
    expect(allows({ ex: "hand" }, s, "pair")).toBe(false); // Lv.9 in the hand
    expect(allows({ ex: "hand", exLink: true }, s, "pair")).toBe(true); // Amuro links with Gundam
    expect(allows({ ex: "hand" }, position([AMURO, GM]), "pair")).toBe(true); // GM stays reachable
  });

  it("never, level and deck", () => {
    const s = position([AMURO]);
    expect(allows({ ex: "never" }, s, "pair")).toBe(false);
    expect(allows({ ex: "level", exLevel: 3 }, s, "pair")).toBe(true); // level 3 after using it
    expect(allows({ ex: "level", exLevel: 7 }, s, "pair")).toBe(false);
    const deck = (no: string) => ({ main: Array<string>(50).fill(no), resources: [] });
    expect(allows({ ex: "deck", ownDeck: deck(GM) }, s, "pair")).toBe(true);
    expect(allows({ ex: "deck", ownDeck: deck(GUNDAM) }, s, "pair")).toBe(false);
  });

  it("v0 follows the rule: ends the main phase instead", () => {
    const s = position([AMURO, BIG]);
    const a = new HeuristicPolicy(engine, { ex: "never" }).choose(viewFor(s, 0), s.pending!);
    expect(a.type).not.toBe("pair");
    const b = new HeuristicPolicy(engine).choose(viewFor(s, 0), s.pending!);
    expect(b.type).toBe("pair"); // default: Amuro links with Gundam
  });
});
