// Scenario tests for the mechanics added for the meta decks (M5), with the real card data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, CardId, GameState, PlayerId, ZoneName } from "../../src/engine/types";
import { scenario as baseScenario, type ScenarioSpec } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);

const GM = "ST01-005"; // vanilla 2/2, Lv.2
const scenario = (spec: ScenarioSpec) => baseScenario({ engine, filler: GM, ...spec });
const id = (s: GameState, p: PlayerId, zone: ZoneName, no: string, n = 0): CardId => {
  const ids = s.players[p][zone].filter((x) => s.cards[x]!.no === no);
  if (ids[n] === undefined) throw new Error(`no ${no} #${n} in ${p}.${zone}`);
  return ids[n]!;
};
const nos = (s: GameState, p: PlayerId, zone: ZoneName) => s.players[p][zone].map((x) => s.cards[x]!.no);
const apply = (s: GameState, a: Action) => engine.apply(s, a);
const target = (card: CardId): Action => ({ type: "target", card });
const ap = (s: GameState, card: CardId) => engine.ap(s, card);
const yes: Action = { type: "yes" };

function play(s: GameState, no: string): void {
  const card = id(s, s.active, "hand", no);
  const type = engine.card(s, card).type;
  apply(
    s,
    type === "UNIT"
      ? { type: "deployUnit", card }
      : type === "BASE"
        ? { type: "deployBase", card }
        : { type: "playCommand", card },
  );
}
function pair(s: GameState, pilot: string, unit: CardId): void {
  apply(s, { type: "pair", card: id(s, s.active, "hand", pilot), unit });
}
function attack(s: GameState, unit: CardId, t: CardId | "player" = "player"): void {
  apply(s, { type: "attack", unit, target: t });
}
/** Answers "no block", passes and declines until the active player has a main decision. */
function settle(s: GameState): void {
  for (let i = 0; i < 30 && s.pending && s.pending.kind !== "main"; i++) {
    const pick = s.pending.options.find(
      (a) => a.type === "noBlock" || a.type === "pass" || a.type === "no" || a.type === "done",
    );
    if (!pick) return;
    apply(s, pick);
  }
}

describe("choosing several cards", () => {
  it("GD02-055 Gusion Rebake: 1 damage to one own and one enemy Unit", () => {
    const s = scenario({ p0: { hand: ["GD02-055"], battle: [GM] }, p1: { battle: [GM] } });
    play(s, "GD02-055");
    apply(s, target(id(s, 0, "battle", GM))); // own (the new Unit is a candidate too)
    expect(s.cards[id(s, 0, "battle", GM)]!.damage).toBe(1);
    expect(s.cards[id(s, 1, "battle", GM)]!.damage).toBe(1);
  });

  it("GD05-033 Master Gundam: 'may choose 2' needs two cards and deals 5 damage to the shield area", () => {
    const one = scenario({ p0: { battle: ["GD05-033"], trash: ["GD05-110"] } });
    attack(one, id(one, 0, "battle", "GD05-033"));
    expect(one.pending?.kind).not.toBe("effect"); // only one Special Move card: no choice offered
    const s = scenario({
      p0: { battle: ["GD05-033"], trash: ["GD05-110", "GD05-120"] },
      p1: { base: "GD01-128" },
    });
    attack(s, id(s, 0, "battle", "GD05-033"));
    expect(s.pending?.options.some((o) => o.type === "done")).toBe(true);
    apply(s, target(s.players[0].trash[0]!)); // the second one is then the only choice left
    expect(s.players[0].removal).toHaveLength(2);
    expect(nos(s, 1, "trash")).toContain("GD01-128"); // the Base (5 HP) took 5 damage
  });
});

describe("damage changes", () => {
  it("GD04-068 Silver Bullet reduces enemy effect damage by 3, not battle damage", () => {
    const s = scenario({ p0: { hand: ["GD04-109"] }, p1: { battle: ["GD04-068"] } });
    play(s, "GD04-109"); // 4 damage
    expect(s.cards[id(s, 1, "battle", "GD04-068")]!.damage).toBe(1);
  });

  it("GD05-123 Archangel: friendly (Orb) Units ignore 2 or less enemy effect damage in the opponent's turn", () => {
    const s = scenario({ p0: { hand: ["ST03-013"] }, p1: { battle: ["GD05-015"], base: "GD05-123" } });
    play(s, "ST03-013"); // Close Combat: 2 damage
    expect(s.cards[id(s, 1, "battle", "GD05-015")]!.damage).toBe(0);
  });

  it("GD02-129 Argama can't receive enemy effect damage (<Breach>)", () => {
    const s = scenario({
      p0: { battle: ["GD01-030"] },
      p1: { battle: [{ no: GM, rested: true }], base: "GD02-129" },
    });
    attack(s, id(s, 0, "battle", "GD01-030"), id(s, 1, "battle", GM));
    settle(s);
    expect(nos(s, 1, "trash")).toEqual([GM]);
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(0);
  });

  it("GD06-033 ZZ Gundam: (AEUG) cards deal 1 more damage to enemy Units", () => {
    const s = scenario({ p0: { hand: ["GD06-033"], resources: 9 }, p1: { battle: ["GD01-086"] } });
    play(s, "GD06-033"); // 2 damage to all enemy Units, +1
    expect(s.cards[id(s, 1, "battle", "GD01-086")]?.damage ?? 3).toBeGreaterThanOrEqual(3);
  });
});

describe("triggers of other Units", () => {
  it("GD04-033 Neo Zeong deals 3 damage when a (Neo Zeon) Unit is deployed", () => {
    const s = scenario({
      p0: { battle: ["GD04-033"], hand: ["GD05-049"], resources: 8 },
      p1: { battle: ["GD02-079"] },
    });
    play(s, "GD05-049"); // Sazabi (Neo Zeon)
    expect(nos(s, 1, "trash")).toEqual(["GD02-079"]); // 3 damage destroy Rick Dias (3 HP)
  });

  it("GD05-016 Murasame gains <High-Maneuver> when an (Orb) Unit is deployed", () => {
    const s = scenario({ p0: { battle: ["GD05-016"], hand: ["GD05-015"] } });
    const murasame = id(s, 0, "battle", "GD05-016");
    expect(engine.keywords(s, murasame).highManeuver).toBe(false);
    play(s, "GD05-015");
    settle(s);
    expect(engine.keywords(s, murasame).highManeuver).toBe(true);
  });

  it("GD01-065 Freedom: pairing with a white Unit gives an enemy Unit AP-2 (once per turn)", () => {
    const s = scenario({
      p0: { battle: ["GD01-065"], hand: ["ST04-011"] },
      p1: { battle: ["GD02-079"] },
    });
    pair(s, "ST04-011", id(s, 0, "battle", "GD01-065")); // now paired: 【During Pair】 holds
    expect(ap(s, id(s, 1, "battle", "GD02-079"))).toBe(engine.card(s, id(s, 1, "battle", "GD02-079")).ap - 2);
  });
});

describe("attacks", () => {
  it("GD05-086 Kayra Su: unlinked enemy Units must attack the rested linked Unit", () => {
    const s = scenario({
      p0: { battle: [GM, "GD02-079"] },
      p1: {
        battle: [
          { no: "GD05-029", pilot: "GD05-086", rested: true },
          { no: GM, rested: true },
        ],
      },
    });
    const targets = s.pending!.options.flatMap((o) =>
      o.type === "attack" && o.unit === id(s, 0, "battle", GM) ? [o.target] : [],
    );
    expect(targets).toEqual([id(s, 1, "battle", "GD05-029")]);
  });

  it("GD05-017 Nu Gundam: a battle with only the damage step", () => {
    const s = scenario({
      p0: {
        battle: ["GD05-017"],
        hand: ["GD05-085"],
        trash: ["GD05-019", "GD05-019", "GD05-028"],
        resources: 8,
      },
      p1: { battle: ["GD02-079"] },
    });
    pair(s, "GD05-085", id(s, 0, "battle", "GD05-017"));
    apply(s, target(s.players[0].trash[0]!)); // the other two follow automatically
    expect(s.players[0].removal).toHaveLength(3);
    expect(nos(s, 1, "trash")).toEqual(["GD02-079"]);
    expect(s.cards[id(s, 0, "battle", "GD05-017")]!.damage).toBeGreaterThan(0);
  });
});

describe("cost and level", () => {
  it("GD05-004 Akatsuki (Oowashi) costs 1 less per friendly (Orb) Unit", () => {
    // Lv.6, cost 6: with two (Orb) Units Lv.4 and cost 4.
    const none = scenario({ p0: { hand: ["GD05-004"], resources: 4 } });
    expect(none.pending!.options.some((o) => o.type === "deployUnit")).toBe(false);
    const s = scenario({ p0: { hand: ["GD05-004"], resources: 4, battle: ["GD05-015", "GD05-015"] } });
    expect(s.pending!.options.some((o) => o.type === "deployUnit")).toBe(true);
  });

  it("GD03-035 GFreD: its cost exiles a Pilot card from the trash", () => {
    const none = scenario({ p0: { battle: ["GD03-035"] }, p1: { battle: [GM] } });
    expect(none.pending!.options.some((o) => o.type === "activate")).toBe(false);
    const s = scenario({ p0: { battle: ["GD03-035"], trash: ["ST01-010"] }, p1: { battle: [GM] } });
    const act = s.pending!.options.find((o) => o.type === "activate")!;
    apply(s, act);
    expect(s.players[0].removal).toHaveLength(1);
    expect(s.cards[id(s, 1, "battle", GM)]!.damage).toBe(1);
  });
});

describe("Special Moves", () => {
  it("GD05-097 Domon discards a Special Move and plays its 【Main】; Cyclone Punch pairs from the trash", () => {
    const s = scenario({
      p0: { battle: ["GD05-066", "GD05-069"], hand: ["GD05-097", "GD05-121"], deck: [GM, GM, GM] },
      p1: { battle: ["GD02-079"] },
    });
    pair(s, "GD05-097", id(s, 0, "battle", "GD05-066"));
    apply(s, target(id(s, 0, "hand", "GD05-121"))); // discard Cyclone Punch
    apply(s, yes); // activate its 【Main】
    expect(ap(s, id(s, 1, "battle", "GD02-079"))).toBe(engine.card(s, id(s, 1, "battle", "GD02-079")).ap - 2);
    apply(s, yes); // pair it from the trash
    const maxter = id(s, 0, "battle", "GD05-069");
    expect(s.cards[s.cards[maxter]!.pilot!]!.no).toBe("GD05-121");
    expect(engine.isLinked(s, maxter)).toBe(true); // 【Pilot】[Chibodee Crocket]
  });

  it("GD05-089 Master Asia: 【Attack】 needs a Special Move played this turn", () => {
    const s = scenario({
      p0: { battle: [{ no: "GD05-033", pilot: "GD05-089" }], hand: ["ST01-014"] },
      p1: { battle: ["GD02-079"] },
    });
    attack(s, id(s, 0, "battle", "GD05-033"));
    settle(s);
    expect(s.cards[id(s, 1, "battle", "GD02-079")]!.damage).toBe(0);
    const t = scenario({
      p0: { battle: [{ no: "GD05-033", pilot: "GD05-089" }], hand: ["GD05-110"] },
      p1: { battle: ["GD02-079"], shields: 6 },
    });
    play(t, "GD05-110"); // Darkness Finger: 2 damage to the only enemy Unit
    attack(t, id(t, 0, "battle", "GD05-033"));
    expect(t.pending?.prompt).not.toBe("may"); // Master Gundam's choice needs 2 cards in the trash
    expect(nos(t, 1, "trash")).toEqual(["GD02-079"]); // 2 + 2 damage on 3 HP
  });

  it("GD05-089 Master Asia's 【Burst】 deploys it as an AP3/HP3 Unit with 3 (MF) cards in the trash", () => {
    const s = scenario({
      active: 1,
      p0: { shields: ["GD05-089"], trash: ["GD05-066", "GD05-066", "GD05-069"], base: null },
      p1: { battle: [GM] },
    });
    attack(s, id(s, 1, "battle", GM));
    expect(s.pending?.prompt).toBe("burst");
    apply(s, yes); // use the Burst
    apply(s, { type: "option", index: 0, label: "Als Unit (AP3/HP3) einsetzen" });
    const asia = id(s, 0, "battle", "GD05-089");
    expect(engine.card(s, asia).type).toBe("UNIT");
    expect([ap(s, asia), engine.hp(s, asia)]).toEqual([3, 3]);
  });
});

describe("other new effects", () => {
  it("GD05-049 Sazabi: the opponent chooses which non-battling Unit to destroy", () => {
    const s = scenario({
      p0: { battle: ["GD05-049", GM] },
      p1: { battle: ["GD02-079", "GD01-086", { no: GM, rested: true }] },
    });
    attack(s, id(s, 0, "battle", "GD05-049"), id(s, 1, "battle", GM));
    apply(s, target(id(s, 0, "battle", GM))); // destroy own GM
    expect(s.pending?.player).toBe(1);
    const options = s.pending!.options.flatMap((o) => (o.type === "target" ? [o.card] : []));
    expect(options).toEqual([id(s, 1, "battle", "GD02-079"), id(s, 1, "battle", "GD01-086")]); // not the battling GM
  });

  it("GD06-092 Neo Lorrnoke counts as [Mu La Flaga] for links", () => {
    const s = scenario({ p0: { battle: ["GD03-072"], hand: ["GD06-092"] } });
    pair(s, "GD06-092", id(s, 0, "battle", "GD03-072"));
    settle(s);
    expect(engine.isLinked(s, id(s, 0, "battle", "GD03-072"))).toBe(true);
  });

  it("GD05-029 Kayra's Re-GZ looks at the top card and may put it to the bottom", () => {
    const s = scenario({ p0: { hand: ["GD05-029"], deck: ["GD02-079", GM, GM] } });
    play(s, "GD05-029");
    expect(s.pending?.prompt).toBe("option");
    apply(s, { type: "option", index: 1, label: "Unter das Deck" });
    expect(nos(s, 0, "deck")).toEqual([GM, GM, "GD02-079"]);
  });

  it("GD05-111 Airframe Seizure draws only after discarding", () => {
    const s = scenario({ p0: { hand: ["GD05-111"], deck: [GM, GM, GM] } });
    play(s, "GD05-111");
    expect(s.players[0].hand).toHaveLength(0);
  });

  it("ST13-012 Suletta: draws when an enemy Unit is destroyed by effect damage while attacking", () => {
    const s = scenario({
      p0: { battle: [{ no: "ST13-006", pilot: "ST13-012" }], deck: [GM, GM, GM] },
      p1: { battle: [GM] },
    });
    attack(s, id(s, 0, "battle", "ST13-006")); // Aerial: 2 damage to an enemy Unit when attacking the player
    settle(s);
    expect(nos(s, 1, "trash")).toEqual([GM]);
    expect(s.players[0].hand).toHaveLength(1);
  });
});
