// Shining Gundam (M01) rules of v0 (22 Nov 2026, docs/AI.md "Shining Gundam"): own trash cards an effect
// exiles are a cost worth paying, and a Pilot next to the Unit it links is kept when discarding.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { viewFor } from "../../src/engine/view";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const SHINING = "GD05-066"; // 【Deploy】 may exile 2 (MF) Units from the trash → a (Special Move) back
const MAXTER = "GD05-069";
const RISING = "GD05-072";
const DARKNESS = "GD05-110";
const MASTER = "GD05-033";
const ASIA = "GD05-089"; // links Master Gundam
const SILVER = "GD04-068";

describe("v0 and Shining Gundam", () => {
  it("exiles two (MF) Units from the trash to get a Special Move back", () => {
    const s = scenario({
      engine,
      filler: "ST01-005",
      p0: { hand: [SHINING], trash: [MAXTER, RISING, DARKNESS], resources: 4 },
    });
    const deploy = s.pending!.options.find((o) => o.type === "deployUnit")!;
    engine.apply(s, deploy);
    const pending = s.pending!;
    expect(pending.options.some((o) => o.type === "done")).toBe(true);
    expect(new HeuristicPolicy(engine).choose(viewFor(s, 0), pending).type).toBe("target");
    expect(new HeuristicPolicy(engine, { plainTrashCost: true }).choose(viewFor(s, 0), pending).type).toBe(
      "done",
    );
  });

  it("keeps the Pilot of the Unit in the hand when discarding", () => {
    const s = scenario({ engine, filler: "ST01-005", p0: { hand: [ASIA, MASTER, SILVER], resources: 2 } });
    const hand = s.players[0].hand;
    const decision = {
      player: 0 as const,
      kind: "discard" as const,
      options: hand.map((card) => ({ type: "discard" as const, card })),
    };
    const pick = (policy: HeuristicPolicy) => {
      const a = policy.choose(viewFor(s, 0), decision);
      return a.type === "discard" ? s.cards[a.card]!.no : "";
    };
    expect(pick(new HeuristicPolicy(engine))).not.toBe(ASIA);
    expect(pick(new HeuristicPolicy(engine, { plainLinkKeep: true }))).toBe(ASIA);
  });

  it("takes the Special Move back that does something now (Darkness Finger against a 2-HP Unit)", () => {
    const FINGER = "GD05-120"; // Shining Finger: rest an enemy Unit (it is rested already: useless)
    const s = scenario({
      engine,
      filler: "ST01-005",
      p0: { hand: [SHINING], trash: [MAXTER, RISING, FINGER, DARKNESS], resources: 5 },
      p1: { battle: [{ no: "ST01-005", damage: 1, rested: true }] }, // GM 2/2, 1 HP left, rested
    });
    engine.apply(
      s,
      s.pending!.options.find((o) => o.type === "deployUnit")!,
    );
    const v0 = new HeuristicPolicy(engine);
    // Exile two (MF) Units, then the Special Move to take back.
    while (s.pending?.kind === "effect" && s.pending.options.some((o) => o.type === "target")) {
      const candidates = s.pending.options.flatMap((o) => (o.type === "target" ? [s.cards[o.card]!.no] : []));
      if (candidates.includes(DARKNESS)) {
        const pick = v0.choose(viewFor(s, 0), s.pending);
        expect(pick.type === "target" && s.cards[pick.card]!.no).toBe(DARKNESS);
        const old = new HeuristicPolicy(engine, { plainToHandPick: true }).choose(viewFor(s, 0), s.pending);
        expect(old.type === "target" && s.cards[old.card]!.no).toBe(FINGER);
        return;
      }
      engine.apply(s, v0.choose(viewFor(s, 0), s.pending));
    }
    throw new Error("no choice of the Special Move");
  });
});

describe("v0 discards for Domon Kasshu's bonus", () => {
  // Domon pairs with Shining Gundam: draw 1, discard 1; a discarded (Special Move) Command may activate its
  // 【Main】. Darkness Finger (2 damage) now destroys the enemy GM with 1 HP left, Incident (ST01-014) has no
  // bonus and is the card least worth keeping otherwise.
  const DOMON = "GD05-097";
  const INCIDENT = "ST01-014";
  const discarded = (policy: HeuristicPolicy) => {
    const s = scenario({
      engine,
      filler: "ST01-005",
      p0: { battle: [SHINING], hand: [DOMON, DARKNESS, INCIDENT], resources: 4 },
      p1: { battle: [{ no: "ST01-005", damage: 1 }] },
    });
    const pair = s.pending!.options.find((o) => o.type === "pair")!;
    engine.apply(s, pair);
    const pending = s.pending!;
    expect(pending.prompt).toBe("discard");
    const pick = policy.choose(viewFor(s, 0), pending);
    return pick.type === "target" ? s.cards[pick.card]!.no : "";
  };

  it("the Special Move that works now, else (old rule) the card least worth keeping", () => {
    expect(discarded(new HeuristicPolicy(engine))).toBe(DARKNESS);
    expect(discarded(new HeuristicPolicy(engine, { plainDiscardBonus: true }))).toBe(INCIDENT);
  });
});
