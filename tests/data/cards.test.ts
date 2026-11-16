import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool, cardImageUrl, parseLink, parseTraits, parseZones } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);

describe("field parsers", () => {
  it("parses traits", () => {
    expect(parseTraits("(Earth Federation) (White Base Team)")).toEqual([
      "Earth Federation",
      "White Base Team",
    ]);
    expect(parseTraits("-")).toEqual([]);
    expect(parseTraits(null)).toEqual([]);
  });

  it("parses zones", () => {
    expect(parseZones("Space Earth")).toEqual(["Space", "Earth"]);
    expect(parseZones("-")).toEqual([]);
  });

  it("parses link conditions", () => {
    expect(parseLink("[Amuro Ray]")).toEqual([{ pilotName: "Amuro Ray" }]);
    expect(parseLink("(Newtype) Trait")).toEqual([{ trait: "Newtype" }]);
    expect(parseLink("(Orb) Trait / [Kira Yamato]")).toEqual([
      { trait: "Orb" },
      { pilotName: "Kira Yamato" },
    ]);
    expect(parseLink("(Teiwaz) / (Tekkadan) Trait")).toEqual([{ trait: "Teiwaz" }, { trait: "Tekkadan" }]);
    expect(parseLink("[Amate Yuzuriha (Machu)] / [Nyaan]")).toEqual([
      { pilotName: "Amate Yuzuriha (Machu)" },
      { pilotName: "Nyaan" },
    ]);
    expect(parseLink("-")).toEqual([]);
  });
});

describe("CardPool on the committed GCGDB data", () => {
  it("loads every card without errors", () => {
    expect(pool.cards.length).toBe(Number(doc.meta.card_count));
    expect(pool.cards.reduce((n, c) => n + c.printings.length, 0)).toBe(Number(doc.meta.variant_count));
  });

  it("gives every card at least one printing with an image, sorted by alt index", () => {
    for (const card of pool.cards) {
      expect(card.printings.length, card.no).toBeGreaterThan(0);
      const alts = card.printings.map((p) => p.alt);
      expect(alts, card.no).toEqual([...alts].sort((a, b) => a - b));
    }
    // Some general cards only exist as alt prints (EXB-001 has ALT5-7); the first printing is used then.
    expect(cardImageUrl(pool.get("EXB-001")!)).toMatch(/^cards\/small\/EXB-001_p\d\.webp$/);
  });

  it("treats a missing Unit AP as 0 (the site prints '-' for AP 0)", () => {
    expect(pool.get("GD01-048")).toMatchObject({ ap: 0, hp: 1 });
  });

  it("has the stats the rules require per card type", () => {
    for (const card of pool.cards) {
      if (card.type === "UNIT") {
        expect([card.level, card.cost, card.ap, card.hp], card.no).not.toContain(null);
        expect(card.color, card.no).not.toBeNull();
      }
      if (!card.token && (card.type === "PILOT" || card.type === "COMMAND" || card.type === "BASE")) {
        expect([card.level, card.cost], card.no).not.toContain(null);
      }
      if (!card.token) expect(card.color, card.no).not.toBeNull();
    }
  });

  it("resolves card numbers and alt-art ids", () => {
    const card = pool.get("GD01-118");
    expect(card?.name).toBeTruthy();
    expect(pool.get("gd01-118-alt1")).toBe(card);
    expect(pool.get("GD01-118_p1")).toBe(card);
    expect(cardImageUrl(card!, "full")).toBe("cards/full/GD01-118.webp");
    expect(cardImageUrl(card!, "small", 1)).toBe("cards/small/GD01-118_p1.webp");
  });

  it("marks tokens and resources as not deckable", () => {
    expect(pool.cards.filter((c) => c.token).every((c) => c.type !== "UNIT" && c.type !== "COMMAND")).toBe(
      true,
    );
    expect(pool.get("EXB-001")?.token).toBe(true);
  });
});
