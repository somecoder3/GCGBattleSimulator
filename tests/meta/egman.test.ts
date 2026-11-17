import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { buildArchetypes } from "../../src/meta/archetypes";
import { newestSnapshot } from "../../src/meta/decks";
import {
  archetypeName,
  egmanPart,
  fromEgman,
  limitlessId,
  parseDeckUrl,
  sameEvent,
  withEgman,
  type EgmanResult,
  type EgmanTournament,
} from "../../src/meta/egman";
import type { MetaSnapshot } from "../../src/meta/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);
const lib = CardLib.fromPool(pool);

const dir = new URL("../../data/meta/", import.meta.url);
const snapshot = newestSnapshot(
  Object.fromEntries(
    readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8")) as MetaSnapshot]),
  ),
)!;
// Only the Limitless part, so the tests don't depend on what a newer snapshot already contains.
const limitless: MetaSnapshot = {
  ...snapshot,
  source: "limitless",
  tournaments: snapshot.tournaments.filter((t) => t.source !== "egman"),
  decks: snapshot.decks.filter((d) => !d.tournament.startsWith("egman:")),
};

const urlOf = (cards: Record<string, number>) =>
  `https://deckbuilder.egmanevents.com/?deck=${Object.entries(cards)
    .map(([no, n]) => `${no}:${n}`)
    .join(",")}&type=gundam`;
const shiningList = limitless.decks.find((d) => d.archetype === "Shining Gundam (Master Gundam)")!.cards;

/** An Egman result as their JSON has it, including fields we must drop. */
function result(placement: number, cards: Record<string, number>, lead: string, secondary: string[] = []) {
  return {
    placement,
    wins: 6,
    losses: 2,
    ties: null,
    deck_type: lead,
    deck_type_secondary: secondary,
    deck_list_url: [urlOf(cards)],
    player_name: "Secret Player",
    social_url: "https://example.com/secret",
  } as EgmanResult;
}

function tournament(
  id: string,
  date: string,
  players: number | null,
  results: EgmanResult[],
  source: string | null = null,
) {
  return {
    id,
    tournament_name: `Regional ${id}`,
    format: "GD05",
    start_date: date,
    source,
    player_count: players,
    event_type: "Large Official Event",
    tournament_results: results,
  } as EgmanTournament;
}

const options = { from: "2026-09-21", to: "2026-11-16", minPlayers: 8, topN: 16 };

describe("Egman source", () => {
  it("reads deck builder links into GCGDB card numbers and reports unknown entries", () => {
    expect(parseDeckUrl(pool, urlOf({ "GD05-066": 4, "XX99-999": 2 }))).toEqual({
      cards: { "GD05-066": 4 },
      unknown: ["XX99-999:2"],
    });
    // Events with sideboards: the sideboard follows "|" and doesn't count.
    expect(
      parseDeckUrl(
        pool,
        "https://deckbuilder.egmanevents.com/?deck=GD05-066:4,GD05-068:1|GD04-038:4&type=gundam",
      ).cards,
    ).toEqual({ "GD05-066": 4, "GD05-068": 1 });
    expect(archetypeName(pool, "GD05-066", ["GD05-033"])).toBe("Shining Gundam (Master Gundam)");
    expect(limitlessId("https://play.limitlesstcg.com/tournament/6aeb3df90c463890f304b1dd/standings")).toBe(
      "6aeb3df90c463890f304b1dd",
    );
  });

  it("keeps the window, size and top placings, skips Limitless duplicates and drops player names", () => {
    const data = [
      tournament("a", "2026-11-01", 512, [
        result(1, shiningList, "GD05-066", ["GD05-033"]),
        result(2, shiningList, "GD05-066", ["GD05-033"]),
        result(20, shiningList, "GD05-066", ["GD05-033"]), // below the top 16
      ]),
      tournament("old", "2026-08-01", 300, [result(1, shiningList, "GD05-066")]), // before the window
      tournament("small", "2026-11-01", 5, [result(1, shiningList, "GD05-066")]), // too small
      tournament("unknown-size", "2026-11-02", null, [result(1, shiningList, "GD05-066")]),
      tournament(
        "dup",
        "2026-11-03",
        26,
        [result(1, shiningList, "GD05-066")],
        "https://play.limitlesstcg.com/tournament/abc123/standings",
      ),
      // The same event as one from Limitless, but without a source link (name "Regional same").
      tournament("same", "2026-11-04", 16, [result(1, shiningList, "GD05-066")]),
    ];
    const egman = fromEgman(pool, data, {
      ...options,
      skipLimitless: new Set(["abc123"]),
      skipEvents: new Set([sameEvent("2026-11-04", "Regional  SAME!")]),
    });
    expect(egman.tournaments.map((t) => [t.id, t.players, t.source])).toEqual([
      ["egman:a", 512, "egman"],
      ["egman:unknown-size", 8, "egman"],
    ]);
    expect(egman.decks.map((d) => d.placing)).toEqual([1, 2, 1]);
    expect(egman.decks[0]).toMatchObject({
      tournament: "egman:a",
      archetype: "Shining Gundam (Master Gundam)",
      soft: true,
      record: { wins: 6, losses: 2, ties: 0 },
    });
    const stored = JSON.stringify(egman);
    expect(stored).not.toContain("Secret Player");
    expect(stored).not.toContain("example.com");
  });

  it("joins Egman decks to the Limitless archetype of the same name and counts the big event more", () => {
    const egman = fromEgman(
      pool,
      [tournament("a", "2026-11-14", 512, [result(1, shiningList, "GD05-066", ["GD05-033"])])],
      options,
    );
    const merged = withEgman(limitless, egman);
    expect(merged.source).toBe("limitless+egman");
    const before = buildArchetypes(limitless, lib).find((a) => a.name === "Shining Gundam (Master Gundam)")!;
    const after = buildArchetypes(merged, lib).find((a) => a.name === "Shining Gundam (Master Gundam)")!;
    expect(after.lists).toBe(before.lists + 1);
    expect(after.share).toBeGreaterThan(before.share);
    expect(buildArchetypes(merged, lib).some((a) => a.id.startsWith("egman:"))).toBe(false);
  });

  it("forms an own archetype for a deck no Limitless archetype resembles, once per suggested group", () => {
    // A list of different cards with an unknown lead-card name.
    const other = {
      "ST02-001": 4,
      "ST02-002": 4,
      "ST02-003": 4,
      "ST02-004": 3,
      "ST02-005": 3,
      "ST02-006": 2,
      "ST02-007": 4,
      "ST02-008": 3,
      "ST02-009": 3,
      "ST02-010": 4,
      "ST02-011": 4,
      "ST02-012": 3,
      "ST02-013": 3,
      "ST02-014": 2,
      "ST02-015": 2,
      "ST02-016": 2,
    };
    const egman = fromEgman(
      pool,
      [tournament("b", "2026-11-10", 200, [result(1, other, "ST02-001"), result(3, other, "ST02-001")])],
      options,
    );
    const archetypes = buildArchetypes(withEgman(limitless, egman), lib);
    const own = archetypes.find((a) => a.id === "egman:ST02-001")!;
    expect(own).toMatchObject({ name: "Wing Gundam", lists: 2 });
  });

  it("keeps Egman's part of a snapshot when the browser reloads Limitless", () => {
    const egman = fromEgman(
      pool,
      [tournament("a", "2026-11-14", 512, [result(1, shiningList, "GD05-066", ["GD05-033"])])],
      options,
    );
    const merged = withEgman(limitless, egman);
    expect(egmanPart(merged, "2026-11-01", "2026-11-30").decks).toHaveLength(1);
    expect(egmanPart(merged, "2026-11-15", "2026-11-30").decks).toHaveLength(0);
    expect(egmanPart(limitless, "2026-01-01", "2026-12-31").tournaments).toHaveLength(0);
  });
});
