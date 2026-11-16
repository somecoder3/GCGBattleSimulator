// Rules of the Comprehensive Rules Ver. 1.10.0, one block per section, with test cards from helpers.ts.

import { describe, expect, it } from "vitest";
import { randomDeck, validateDeck } from "../../src/engine/deck";
import { checkInvariants } from "../../src/engine/invariants";
import { seedRng } from "../../src/engine/rng";
import type { DeckList, GameEvent } from "../../src/engine/types";
import { viewFor } from "../../src/engine/view";
import { act, engine, find, has, lib, nos, options, scenario } from "./helpers";

const deckOf = (no: string): DeckList => ({
  main: Array<string>(50).fill(no),
  resources: Array<string>(10).fill("R-001"),
});
const types = (events: GameEvent[]) => events.map((e) => e.t);

describe("6 Preparing to play", () => {
  it("deals 5 cards, asks Player One first, then places 6 Shields, EX Bases and the EX Resource", () => {
    const { state: s } = engine.newGame([deckOf("X-VAN"), deckOf("X-23")], { seed: 7, firstPlayer: 1 });
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[1].hand).toHaveLength(5);
    expect(s.pending).toMatchObject({ player: 1, kind: "mulligan" }); // 6-2-1-6
    act(s, { type: "keepHand" });
    expect(s.pending).toMatchObject({ player: 0, kind: "mulligan" }); // 6-2-1-7
    act(s, { type: "keepHand" });
    for (const p of [0, 1] as const) {
      expect(s.players[p].shields).toHaveLength(6); // 6-2-2
      expect(nos(s, p, "base")).toEqual(["EXB-001"]); // 6-2-3
    }
    expect(nos(s, 0, "resources")).toContain("EXR-001"); // 6-2-4: Player Two
    expect(nos(s, 1, "resources")).not.toContain("EXR-001");
    // 6-2-5, 7-3, 7-4: Player One's first turn, with a draw and a Resource.
    expect(s).toMatchObject({ turn: 1, active: 1, step: "main" });
    expect(s.players[1].hand).toHaveLength(6);
    expect(nos(s, 1, "resources")).toEqual(["R-001"]);
    expect(s.players[1].deck).toHaveLength(50 - 5 - 6 - 1);
  });

  it("redraws the whole hand once (6-2-1-6-1)", () => {
    const { state: s } = engine.newGame([deckOf("X-VAN"), deckOf("X-VAN")], { seed: 3 });
    const before = [...s.players[0].hand];
    act(s, { type: "redraw" });
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].hand).not.toEqual(before);
    expect(s.players[0].deck).toHaveLength(45);
    expect(s.pending).toMatchObject({ player: 1, kind: "mulligan" });
  });

  it("validates decks (6-1-1)", () => {
    expect(validateDeck(lib, deckOf("X-VAN"))).toEqual(["50 copies of X-VAN, at most 4"]);
    const ok: DeckList = {
      main: [
        "X-VAN",
        "X-23",
        "X-33",
        "X-55",
        "X-AP0",
        "X-BLOCK",
        "X-FIRST",
        "X-HIGH",
        "X-SUPP",
        "X-BREACH",
        "X-REPAIR",
        "X-SUPPORT",
      ]
        .flatMap((no) => Array<string>(4).fill(no))
        .concat(["X-LINKU", "X-LINKU"]),
      resources: Array<string>(10).fill("R-001"),
    };
    expect(validateDeck(lib, ok)).toEqual([]);
    expect(validateDeck(lib, { ...ok, main: ok.main.slice(1) })).toContain("deck has 49 cards, needs 50");
    expect(validateDeck(lib, { ...ok, main: [...ok.main.slice(1), "EXB-001"] })[0]).toMatch(
      /cannot be in the deck/,
    );
  });

  it("generates random legal decks", () => {
    const rng = seedRng(5);
    for (let i = 0; i < 20; i++) expect(validateDeck(lib, randomDeck(lib, rng))).toEqual([]);
  });
});

describe("7 Turn flow", () => {
  it("sets everything active in the active step (7-2-3)", () => {
    const s = scenario({
      step: "startTurn",
      p0: { battle: [{ no: "X-VAN", rested: true }], restedResources: 5 },
    });
    expect(s.players[0].battle.every((id) => !s.cards[id]!.rested)).toBe(true);
    expect(s.players[0].resources.every((id) => !s.cards[id]!.rested)).toBe(true);
  });

  it("loses when the deck runs out (7-3-1-1, 11-2-1-2)", () => {
    const s = scenario({ step: "startTurn", p0: { deck: 1 } });
    expect(s.result).toEqual({ winner: 1, reason: "deckOut", turn: 3 });
  });

  it("discards down to 10 in the hand step (7-6-5)", () => {
    const s = scenario({ p0: { hand: Array<string>(12).fill("X-55"), resources: 0 } });
    act(s, { type: "endMain" });
    expect(s.pending?.kind).toBe("discard");
    act(s, options(s)[0]!);
    act(s, options(s)[0]!);
    expect(s.players[0].hand).toHaveLength(10);
    expect(s.players[0].trash).toHaveLength(2);
    expect(s).toMatchObject({ active: 1, turn: 4, step: "main" });
  });

  it("ends in a draw at the turn limit", () => {
    const s = scenario({ turn: 10, maxTurns: 10 });
    act(s, { type: "endMain" });
    expect(s.result).toEqual({ winner: null, reason: "turnLimit", turn: 10 });
  });
});

describe("Playing cards (2-9, 2-10, 7-5-2)", () => {
  it("needs Lv. ≤ number of Resources and rests Resources for the cost", () => {
    const s = scenario({ p0: { hand: ["X-HIGHLV"], resources: 3 } });
    expect(options(s).some((o) => o.type === "deployUnit")).toBe(false);
    const s2 = scenario({ p0: { hand: ["X-HIGHLV"], resources: 4 } });
    act(s2, { type: "deployUnit", card: find(s2, 0, "hand", "X-HIGHLV") });
    expect(s2.players[0].resources.filter((id) => s2.cards[id]!.rested)).toHaveLength(2);
  });

  it("counts rested Resources for Lv. but not for the cost", () => {
    const s = scenario({ p0: { hand: ["X-HIGHLV"], resources: 4, restedResources: 3 } });
    expect(options(s).some((o) => o.type === "deployUnit")).toBe(false);
  });

  it("uses EX Resources last and removes them from the game (5-17-3-2-3)", () => {
    // Lv. 5 from 3 Resources + 2 EX Resources; cost 4 = 3 Resources + 1 EX Resource.
    const s = scenario({ p0: { hand: ["X-55"], resources: 3, exResources: 2 } });
    act(s, { type: "deployUnit", card: find(s, 0, "hand", "X-55") });
    expect(nos(s, 0, "resources")).toEqual(["R-001", "R-001", "R-001", "EXR-001"]);
    expect(s.cards.filter((c) => c.no === "EXR-001").map((c) => c.zone)).toEqual(["gone", "resources"]);
  });

  it("places a 7th Unit by trashing a chosen one, which is not destroyed (11-4)", () => {
    const s = scenario({ p0: { hand: ["X-33"], battle: Array<string>(6).fill("X-VAN") } });
    const deploys = options(s).filter((o) => o.type === "deployUnit");
    expect(deploys).toHaveLength(6);
    const events = act(s, deploys[2]!);
    expect(types(events)).not.toContain("destroyed");
    expect(s.players[0].battle).toHaveLength(6);
    expect(nos(s, 0, "trash")).toEqual(["X-VAN"]);
  });

  it("replaces the Base; the EX Base token leaves the game (11-5, 5-17-2-5)", () => {
    const s = scenario({ p0: { hand: ["X-BASE"] } });
    act(s, { type: "deployBase", card: find(s, 0, "hand", "X-BASE") });
    expect(nos(s, 0, "base")).toEqual(["X-BASE"]);
    expect(s.players[0].trash).toHaveLength(0);
  });
});

describe("Pilots and links (3-2-6, 3-3)", () => {
  it("adds the Pilot's AP and HP to the Unit", () => {
    const s = scenario({ p0: { hand: ["X-PILOT"], battle: ["X-VAN"] } });
    const unit = find(s, 0, "battle", "X-VAN");
    act(s, { type: "pair", card: find(s, 0, "hand", "X-PILOT"), unit });
    expect([engine.ap(s, unit), engine.hp(s, unit)]).toEqual([3, 4]);
    expect(options(s).some((o) => o.type === "pair")).toBe(false); // at most one Pilot (3-3-4)
  });

  it("lets a newly deployed Unit attack only when linked (3-2-4, 3-2-6-3, 3-2-6-4)", () => {
    const s = scenario({ p0: { hand: ["X-LINKU", "X-AMURO", "X-VAN"], resources: 5 } });
    act(s, { type: "deployUnit", card: find(s, 0, "hand", "X-LINKU") });
    act(s, { type: "deployUnit", card: find(s, 0, "hand", "X-VAN") });
    const linkUnit = find(s, 0, "battle", "X-LINKU");
    expect(options(s).some((o) => o.type === "attack")).toBe(false);
    const events = act(s, { type: "pair", card: find(s, 0, "hand", "X-AMURO"), unit: linkUnit });
    expect(events.find((e) => e.t === "pair")).toMatchObject({ link: true });
    expect(
      options(s)
        .filter((o) => o.type === "attack")
        .map((o) => o.type === "attack" && o.unit),
    ).toEqual([linkUnit]);
  });

  it("links by trait and with Commands that have a Pilot effect (3-4-6)", () => {
    const s = scenario({
      p0: {
        battle: [
          { no: "X-TRAITU", pilot: "X-PILOT" },
          { no: "X-LINKU", pilot: "X-CMDPILOT" },
        ],
      },
    });
    expect(engine.isLinked(s, find(s, 0, "battle", "X-TRAITU"))).toBe(true);
    expect(engine.isLinked(s, find(s, 0, "battle", "X-LINKU"))).toBe(true);
    expect(engine.ap(s, find(s, 0, "battle", "X-LINKU"))).toBe(4);
  });

  it("sends the Pilot to the trash with its Unit (3-3-6)", () => {
    const s = scenario({
      p0: { battle: ["X-55"] },
      p1: { battle: [{ no: "X-VAN", rested: true, pilot: "X-PILOT" }] },
    });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-55"), target: find(s, 1, "battle", "X-VAN") });
    expect(nos(s, 1, "trash").sort()).toEqual(["X-PILOT", "X-VAN"]);
    expect(checkInvariants(engine, s)).toEqual([]);
  });
});

describe("8 Attacking and battles", () => {
  const attackPlayer = (s: ReturnType<typeof scenario>, no = "X-33") =>
    act(s, { type: "attack", unit: find(s, 0, "battle", no), target: "player" });

  it("can attack the player or a rested enemy Unit, not an active one (8-2-1)", () => {
    const s = scenario({ p0: { battle: ["X-33"] }, p1: { battle: ["X-VAN", { no: "X-23", rested: true }] } });
    const targets = options(s).flatMap((o) => (o.type === "attack" ? [o.target] : []));
    expect(targets).toEqual(["player", find(s, 1, "battle", "X-23")]);
  });

  it("damages the Base first (8-5-2-4) and destroys it at 0 HP", () => {
    const s = scenario({ p0: { battle: ["X-VAN"] } });
    attackPlayer(s, "X-VAN");
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(2);
    expect(s.players[1].shields).toHaveLength(6);
    const s2 = scenario({ p0: { battle: ["X-VAN"] }, p1: { baseDamage: 1 } });
    attackPlayer(s2, "X-VAN");
    expect(s2.players[1].base).toHaveLength(0);
    expect(s2.players[1].shields).toHaveLength(6); // excess damage is not dealt on (5-5-6)
  });

  it("destroys the top Shield without a Base (8-5-2-3)", () => {
    const s = scenario({ p0: { battle: ["X-33"] }, p1: { base: null, shields: ["X-55", "X-VAN", "X-VAN"] } });
    const events = attackPlayer(s);
    expect(events.find((e) => e.t === "shieldBreak")).toBeTruthy();
    expect(nos(s, 1, "shields")).toEqual(["X-VAN", "X-VAN"]);
    expect(nos(s, 1, "trash")).toEqual(["X-55"]);
  });

  it("wins by battle damage without Shields and Base (8-5-2-2), but not with 0 AP (5-5-5)", () => {
    const s = scenario({ p0: { battle: ["X-33"] }, p1: { base: null, shields: 0 } });
    attackPlayer(s);
    expect(s.result).toEqual({ winner: 0, reason: "damage", turn: 3 });
    const s2 = scenario({ p0: { battle: ["X-AP0"] }, p1: { base: null, shields: 0 } });
    attackPlayer(s2, "X-AP0");
    expect(s2.result).toBeNull();
  });

  it("deals battle damage simultaneously; both can be destroyed (8-5-3-2)", () => {
    const s = scenario({ p0: { battle: ["X-33"] }, p1: { battle: [{ no: "X-33", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-33"), target: find(s, 1, "battle", "X-33") });
    expect(s.players[0].battle).toHaveLength(0);
    expect(s.players[1].battle).toHaveLength(0);
  });

  it("keeps damage counters on survivors (5-5-1)", () => {
    const s = scenario({ p0: { battle: ["X-VAN"] }, p1: { battle: [{ no: "X-REPAIR", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-VAN"), target: find(s, 1, "battle", "X-REPAIR") });
    expect(s.cards[find(s, 1, "battle", "X-REPAIR")]!.damage).toBe(2);
    expect(s.cards[find(s, 0, "battle", "X-VAN")]!.damage).toBe(1);
  });
});

describe("13-1 Keyword effects", () => {
  it("<Blocker> redirects the attack; the attacked Unit can't block itself (8-3, 13-1-4)", () => {
    const s = scenario({
      p0: { battle: ["X-33"] },
      p1: { battle: ["X-BLOCK", { no: "X-BLOCK", rested: true }] },
    });
    const restedBlocker = find(s, 1, "battle", "X-BLOCK", 1);
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-33"), target: restedBlocker });
    expect(s.pending?.kind).toBe("block");
    const active = find(s, 1, "battle", "X-BLOCK", 0);
    expect(options(s)).toEqual([{ type: "noBlock" }, { type: "block", unit: active }]);
    act(s, { type: "block", unit: active });
    expect(s.cards[active]!.zone).toBe("trash"); // 3 AP against 3 HP
    expect(s.cards[restedBlocker]!.zone).toBe("battle");
  });

  it("<Blocker> takes the hit for the player", () => {
    const s = scenario({ p0: { battle: ["X-33"] }, p1: { battle: ["X-BLOCK"] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-33"), target: "player" });
    act(s, { type: "block", unit: find(s, 1, "battle", "X-BLOCK") });
    expect(nos(s, 1, "trash")).toEqual(["X-BLOCK"]);
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(0);
    expect(s.cards[find(s, 0, "battle", "X-33")]!.damage).toBe(1);
  });

  it("<High-Maneuver>: no block possible (13-1-6)", () => {
    const s = scenario({ p0: { battle: ["X-HIGH"] }, p1: { battle: ["X-BLOCK"] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-HIGH"), target: "player" });
    expect(s.pending?.kind).toBe("main");
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(2);
  });

  it("<First Strike>: a destroyed target deals no damage back (13-1-5)", () => {
    const s = scenario({ p0: { battle: ["X-FIRST"] }, p1: { battle: [{ no: "X-33", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-FIRST"), target: find(s, 1, "battle", "X-33") });
    expect(nos(s, 0, "battle")).toEqual(["X-FIRST"]);
    expect(s.players[1].battle).toHaveLength(0);
  });

  it("<First Strike>: a surviving target still deals damage", () => {
    const s = scenario({ p0: { battle: ["X-FIRST"] }, p1: { battle: [{ no: "X-55", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-FIRST"), target: find(s, 1, "battle", "X-55") });
    expect(s.players[0].battle).toHaveLength(0);
  });

  it("<Breach> damages the first card of the shield area after destroying a Unit (13-1-2)", () => {
    const s = scenario({ p0: { battle: ["X-BREACH"] }, p1: { battle: [{ no: "X-VAN", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-BREACH"), target: find(s, 1, "battle", "X-VAN") });
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(2);
    const s2 = scenario({
      p0: { battle: ["X-BREACH"] },
      p1: { base: null, battle: [{ no: "X-VAN", rested: true }] },
    });
    act(s2, {
      type: "attack",
      unit: find(s2, 0, "battle", "X-BREACH"),
      target: find(s2, 1, "battle", "X-VAN"),
    });
    expect(s2.players[1].shields).toHaveLength(5);
  });

  it("<Breach> does nothing when the Unit survives", () => {
    const s = scenario({ p0: { battle: ["X-BREACH"] }, p1: { battle: [{ no: "X-55", rested: true }] } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-BREACH"), target: find(s, 1, "battle", "X-55") });
    expect(s.cards[s.players[1].base[0]!]!.damage).toBe(0);
  });

  it("<Suppression> destroys the top two Shields (13-1-7)", () => {
    const s = scenario({ p0: { battle: ["X-SUPP"] }, p1: { base: null } });
    act(s, { type: "attack", unit: find(s, 0, "battle", "X-SUPP"), target: "player" });
    expect(s.players[1].shields).toHaveLength(4);
    const s2 = scenario({ p0: { battle: ["X-SUPP"] }, p1: { base: null, shields: 1 } });
    act(s2, { type: "attack", unit: find(s2, 0, "battle", "X-SUPP"), target: "player" });
    expect(s2.players[1].shields).toHaveLength(0);
    expect(s2.result).toBeNull();
  });

  it("<Repair> recovers HP at the end of its owner's turn only (13-1-1, 5-6-2)", () => {
    const s = scenario({
      p0: { battle: [{ no: "X-REPAIR", damage: 3 }] },
      p1: { battle: [{ no: "X-REPAIR", damage: 3 }] },
    });
    act(s, { type: "endMain" });
    expect(s.cards[find(s, 0, "battle", "X-REPAIR")]!.damage).toBe(1);
    expect(s.cards[find(s, 1, "battle", "X-REPAIR")]!.damage).toBe(3);
  });

  it("<Support> rests the Unit for AP+ until the end of the turn (13-1-3)", () => {
    const s = scenario({ p0: { battle: ["X-SUPPORT", "X-VAN"] } });
    const supporter = find(s, 0, "battle", "X-SUPPORT");
    const target = find(s, 0, "battle", "X-VAN");
    expect(has(s, { type: "support", unit: supporter, target: supporter })).toBe(false);
    act(s, { type: "support", unit: supporter, target });
    expect(engine.ap(s, target)).toBe(4);
    expect(s.cards[supporter]!.rested).toBe(true);
    act(s, { type: "endMain" });
    expect(engine.ap(s, target)).toBe(2); // 7-6-6
  });
});

describe("4-1 Hidden information", () => {
  it("hides the opponent's hand, both decks and all Shields", () => {
    const s = scenario({ p0: { hand: ["X-55"] }, p1: { hand: ["X-33"] } });
    const view = viewFor(s, 0);
    const no = (id: number) => view.cards[id]!.no;
    expect(no(s.players[0].hand[0]!)).toBe("X-55");
    expect(no(s.players[1].hand[0]!)).toBe("?");
    expect(s.players[0].deck.every((id) => no(id) === "?")).toBe(true);
    expect(s.players[0].shields.every((id) => no(id) === "?")).toBe(true);
    expect(no(s.players[1].base[0]!)).toBe("EXB-001");
    expect(view.rng).toEqual([0, 0, 0, 0]);
    expect(s.cards[s.players[1].hand[0]!]!.no).toBe("X-33"); // original untouched
  });
});
