// Card filters of the card list and deck builder (src/app/lib/cardfilter.ts) on the real card data.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SECTION,
  cardFacts,
  cardMatcher,
  facets,
  parseQuery,
  sortCards,
  type CardFilter,
} from "../../src/app/lib/cardfilter";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);
const card = (no: string) => pool.get(no)!;
const find = (query: string, selection: CardFilter["selection"] = {}) =>
  pool.cards.filter(cardMatcher({ query, selection })).map((c) => c.no);

describe("card facts", () => {
  it("reads keywords, pilot names and link conditions", () => {
    const destiny = cardFacts(card("GD05-055"));
    expect(destiny.keywords).toContain("First Strike");
    expect(cardFacts(card("ST01-010")).pilots).toEqual(["Amuro Ray"]); // Pilot card
    // A Command with 【Pilot】[name] also counts for that pilot.
    const command = pool.cards.find((c) => c.type === "COMMAND" && c.text.includes("【Pilot】[Lowe Guele]"))!;
    expect(cardFacts(command).pilots).toEqual(["Lowe Guele"]);
    expect(cardFacts(card("ST01-001")).links).toEqual(["[Amuro Ray]"]);
    expect(cardFacts(card("ST01-001")).linkTypes).toEqual(["name"]);
    expect(cardFacts(card("ST01-005")).linkTypes).toEqual(["none"]);
    // 【When Paired･(Zeon) Pilot】 counts as 【When Paired】, <Repair 2> as <Repair>.
    const paired = pool.cards.find((c) => c.text.includes("【When Paired･(Zeon) Pilot】"))!;
    expect(cardFacts(paired).keywords).toContain("When Paired");
    const repair = pool.cards.find((c) => /<Repair \d>/.test(c.text))!;
    expect(cardFacts(repair).keywords).toContain("Repair");
  });

  it("lists section values with counts in display order", () => {
    const levels = facets(SECTION.level, pool.cards).map((f) => f.value);
    expect(levels[0]).toBe("–");
    expect(levels.slice(1, 4)).toEqual(["1", "2", "3"]);
    expect(
      facets(SECTION.rarity, pool.cards)
        .slice(0, 4)
        .map((f) => f.value),
    ).toEqual(["C", "U", "R", "LR"]);
    expect(facets(SECTION.type, pool.cards)[0]!.value).toBe("UNIT");
  });
});

describe("filter sections", () => {
  it("any chosen value of a section, all sections together", () => {
    const blue34 = find("", { colors: ["Blue"], level: ["3", "4"] });
    expect(blue34.length).toBeGreaterThan(10);
    for (const no of blue34) {
      expect(card(no).color).toBe("Blue");
      expect([3, 4]).toContain(card(no).level);
    }
    expect(find("", { keywords: ["First Strike"] })).toContain("GD05-055");
    expect(find("", { pilot: ["Amuro Ray"] })).toContain("ST01-010");
  });
});

describe("search syntax", () => {
  it("free text, fields, comparisons, exclusion, OR and parentheses", () => {
    expect(find("gd05-055")).toEqual(["GD05-055"]);
    const zeon = find("trait:zeon ap>=4");
    expect(zeon.length).toBeGreaterThan(0);
    for (const no of zeon) {
      expect(card(no).traits.some((t) => t.toLowerCase().includes("zeon"))).toBe(true);
      expect(card(no).ap).toBeGreaterThanOrEqual(4);
    }
    const pilotsOrCommands = find("t=pilot OR t=command");
    expect(pilotsOrCommands.every((no) => ["PILOT", "COMMAND"].includes(card(no).type))).toBe(true);
    expect(pilotsOrCommands.length).toBe(find("", { type: ["PILOT", "COMMAND"] }).length);
    const noBlocker = find("t=unit kw<>blocker c:blue");
    expect(noBlocker.some((no) => cardFacts(card(no)).keywords.includes("Blocker"))).toBe(false);
    expect(find("t=unit -blocker c:blue")).toEqual(noBlocker);
    const red = find('(c:red OR c:blue) name="Gundam"');
    expect(red.every((no) => card(no).name === "Gundam")).toBe(true);
    expect(find("level=-").every((no) => card(no).level === null)).toBe(true);
    expect(find("lt:trait").every((no) => card(no).link.some((l) => "trait" in l))).toBe(true);
  });

  it("parses into a tree and forgives broken input", () => {
    expect(parseQuery("")).toBeUndefined();
    expect(parseQuery("a OR b c")).toMatchObject({ kind: "or" });
    expect(parseQuery("(a b")).toMatchObject({ kind: "and" });
    expect(parseQuery("a ) b")).toMatchObject({ kind: "and" });
    expect(parseQuery("unknown:x")).toEqual({ kind: "text", value: "unknown:x", exact: false });
  });
});

describe("ordering", () => {
  it("sorts by a field, missing values last, ties by number", () => {
    const units = pool.cards;
    const byAp = sortCards(units, { key: "ap", desc: true });
    expect(byAp[0]!.ap).toBe(Math.max(...units.map((c) => c.ap ?? -1)));
    expect(byAp.at(-1)!.ap).toBeNull();
    const byName = sortCards(units, { key: "name", desc: false });
    expect(byName[0]!.name.localeCompare(byName[1]!.name)).toBeLessThanOrEqual(0);
  });
});
