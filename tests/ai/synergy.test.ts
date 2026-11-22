// Combos read from the card effects (src/ai/synergy.ts) and how v0 uses them.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { deckPlan } from "../../src/ai/synergy";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { DeckList, GameState } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);

const SHINING = "GD05-066"; // 【Deploy】 exile 2 (MF) Units from the trash → a (Special Move) Command back
const MAXTER = "GD05-069"; // (MF)
const DOMON = "GD05-097"; // links Shining Gundam
const CYCLONE = "GD05-121"; // (Special Move) Command, Lv.3
const INCIDENT = "ST01-014"; // Command, Lv.3, no Special Move
const deck = (counts: Record<string, number>): DeckList => ({
  main: Object.entries(counts).flatMap(([no, n]) => Array<string>(n).fill(no)),
  resources: [],
});
const SHINING_DECK = deck({ [SHINING]: 4, [MAXTER]: 4, [DOMON]: 4, [CYCLONE]: 4, [INCIDENT]: 4 });

describe("deck plan", () => {
  const plan = deckPlan(lib, SHINING_DECK);

  it("finds what Shining Gundam wants in the trash and whom Domon links", () => {
    expect(plan.trashFuel.get(CYCLONE)).toBe(1); // 4 Shining Gundam, 4 Special Moves
    expect(plan.trashFuel.get(MAXTER)).toBeCloseTo(0.5); // 4 Shining Gundam, 8 (MF) Units
    expect(plan.trashFuel.has(INCIDENT)).toBe(false);
    expect(plan.linksTo.get(DOMON)).toEqual([SHINING]);
  });

  it("finds nothing in a deck without such effects", () => {
    expect(deckPlan(lib, deck({ [INCIDENT]: 4, "ST01-005": 4 })).synergies).toEqual([]);
  });
});

describe("v0 discards what the own deck wants in the trash (experiment)", () => {
  const discard = (policy: HeuristicPolicy) => {
    const s: GameState = scenario({
      engine,
      filler: "ST01-005",
      p0: { hand: [INCIDENT, CYCLONE], resources: 3 },
    });
    const hand = s.players[0].hand;
    const pick = policy.choose(viewFor(s, 0), {
      player: 0,
      kind: "discard",
      options: hand.map((card) => ({ type: "discard" as const, card })),
    });
    return pick.type === "discard" ? s.cards[pick.card]!.no : "";
  };

  it("with comboFuel or trash awareness (default since 23 Nov 2026) the Special Move, else the first", () => {
    expect(discard(new HeuristicPolicy(engine, { ownDeck: SHINING_DECK, comboFuel: true }))).toBe(CYCLONE);
    expect(discard(new HeuristicPolicy(engine, { ownDeck: SHINING_DECK }))).toBe(CYCLONE);
    expect(discard(new HeuristicPolicy(engine, { ownDeck: SHINING_DECK, plainTrashAware: true }))).toBe(
      INCIDENT,
    );
  });
});

describe("v0 keeps a Pilot for the Unit it links", () => {
  // Domon links Shining Gundam, not Gundam Maxter. Shining Gundam is in the hand, but only one Resource is
  // active: pairing Domon with Maxter now would waste the link.
  const s = scenario({
    engine,
    filler: "ST01-005",
    p0: { battle: [MAXTER], hand: [DOMON, SHINING], resources: 4, restedResources: 3 },
  });
  const pairs = (policy: HeuristicPolicy) => policy.choose(viewFor(s, 0), s.pending!).type === "pair";

  it("waits, unless told to pair with any Unit", () => {
    expect(s.pending?.options.some((o) => o.type === "pair")).toBe(true);
    expect(pairs(new HeuristicPolicy(engine))).toBe(false);
    expect(pairs(new HeuristicPolicy(engine, { pairAnyPilot: true }))).toBe(true);
  });
});
