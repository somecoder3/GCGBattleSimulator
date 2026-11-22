// "Passt zu" (src/app/lib/partners.ts): partners from the effects and from the tournament lists.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comboText, partners, playedWith } from "../../src/app/lib/partners";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import type { MetaSnapshot } from "../../src/meta/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));

const SHINING = "GD05-066";
const DOMON = "GD05-097";
const MAXTER = "GD05-069";
const CYCLONE = "GD05-121";
const MASTER_ASIA = "GD05-089";

const group = (no: string, kind: string, options = {}) =>
  partners(lib, no, options).filter((g) => g.kind === kind);
const nos = (no: string, kind: string, options = {}) =>
  group(no, kind, options).flatMap((g) => g.cards.map((c) => c.no));

describe("partners from the effects", () => {
  it("Shining Gundam: Domon links it, it wants (MF) Units and Special Moves in the trash", () => {
    expect(nos(SHINING, "link")).toEqual([DOMON]);
    const wants = group(SHINING, "wants");
    expect(wants.map((g) => g.title)).toEqual([
      "Wählt 2× (MF) Unit im Trash",
      "Wählt (Special Move) Command im Trash",
    ]);
    expect(wants[0]!.cards.map((c) => c.no)).toContain(MAXTER);
    expect(wants[1]!.cards.map((c) => c.no)).toContain(CYCLONE);
    expect(nos(SHINING, "wants")).not.toContain(SHINING);
  });

  it("the other direction: who uses a card, and Pilots link back", () => {
    expect(nos(CYCLONE, "wanted")).toEqual(expect.arrayContaining([SHINING]));
    expect(nos(MAXTER, "wanted")).toContain(MASTER_ASIA);
    expect(nos(DOMON, "link")).toContain(SHINING);
  });

  it("Pilot lines given to the Unit count too: Domon Kasshu discards a (Special Move) Command", () => {
    const wants = group(DOMON, "wants");
    expect(wants.map((g) => g.title)).toEqual(["Bonus mit (Special Move) Command"]);
    expect(wants[0]!.cards.map((c) => c.no)).toContain(CYCLONE);
    expect(nos(CYCLONE, "wanted")).toContain(DOMON);
  });

  it("generic filters (any Unit in the trash) are left out", () => {
    for (const g of partners(lib, "ST01-005")) expect(g.cards.length).toBeLessThan(120);
    expect(group("ST01-005", "wanted")[0]!.cards.every((c) => !c.note?.startsWith("Wählt 3× Unit"))).toBe(
      true,
    );
  });

  it("a colour filter keeps only those colours", () => {
    const colors = new Set(["Red"]);
    for (const no of nos(SHINING, "wants", { colors })) expect([null, "Red"]).toContain(lib.get(no).color);
  });

  it("readable filter texts", () => {
    const [combo] = group(SHINING, "wants");
    expect(combo?.title).toBe("Wählt 2× (MF) Unit im Trash");
    expect(
      comboText({
        filter: { lvMax: 5, types: ["UNIT", "UNIT TOKEN"] },
        zone: "trash",
        use: "choose",
        label: "",
        need: 1,
      }),
    ).toBe("Wählt Unit bis Lv.5 im Trash");
  });
});

describe("partners from the tournament lists", () => {
  const deck = (cards: string[]) => ({
    tournament: "t",
    placing: 1,
    record: { wins: 0, losses: 0, ties: 0 },
    archetypeId: "a",
    archetype: "a",
    cards: Object.fromEntries(cards.map((c) => [c, 4])),
    unknown: [],
  });
  const snapshot = {
    decks: [
      deck(["A", "B", "S"]),
      deck(["A", "B", "S"]),
      deck(["A", "C", "S"]),
      deck(["C", "S"]),
      deck(["C", "S"]),
      deck(["C", "S", "D"]),
    ],
  } as unknown as MetaSnapshot;

  it("counts lists together, more often than chance", () => {
    const p = playedWith(snapshot, "A");
    // B: in 2 of A's 3 lists, everywhere else never → lift 3. S is in every list (lift 1): left out.
    expect(p.map((x) => x.no)).toEqual(["B"]);
    expect(p[0]).toMatchObject({ together: 2, lists: 3 });
    expect(playedWith(snapshot, "X")).toEqual([]);
  });
});
