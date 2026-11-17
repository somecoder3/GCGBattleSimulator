import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { validateDeck } from "../../src/engine/deck";
import {
  archetypeProblems,
  buildArchetypes,
  consensus,
  entryLabel,
  similarity,
} from "../../src/meta/archetypes";
import { banlistProblems } from "../../src/meta/banlist";
import { metaBaseId, metaDecks, newestSnapshot } from "../../src/meta/decks";
import { fetchSnapshot, toMetaDeck } from "../../src/meta/limitless";
import type { MetaSnapshot } from "../../src/meta/types";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);
const lib = CardLib.fromPool(pool);
const get = (no: string) => (lib.has(no) ? lib.get(no) : undefined);

const dir = new URL("../../data/meta/", import.meta.url);
const files = Object.fromEntries(
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), "utf8")) as MetaSnapshot]),
);
const snapshot = newestSnapshot(files)!;

describe("banlist", () => {
  it("finds banned, restricted and banned pairs", () => {
    expect(banlistProblems({ "GD01-020": 1 }, get)).toHaveLength(1);
    expect(banlistProblems({ "ST02-016": 3 }, get)).toHaveLength(1);
    expect(banlistProblems({ "ST02-016": 2 }, get)).toEqual([]);
    expect(banlistProblems({ "ST01-010": 1, "ST05-010": 1 }, get)).toHaveLength(1);
    expect(banlistProblems({ "GD01-008": 4, "GD05-015": 1 }, get)).toHaveLength(1);
    // Guntank with one kind of vanilla 2/2 Unit is legal (e.g. the winner of a 208-player regional).
    expect(banlistProblems({ "GD01-008": 4, "GD05-027": 4 }, get)).toEqual([]);
    // Vanilla Lv.2/cost 1/2/2 Units: every two different ones are a banned pair.
    expect(banlistProblems({ "ST01-005": 2, "ST04-008": 2 }, get)).toHaveLength(1);
    expect(banlistProblems({ "ST01-005": 4 }, get)).toEqual([]);
  });
});

describe("archetypes", () => {
  it("measures list similarity", () => {
    expect(similarity({ a: 4, b: 4 }, { a: 4, b: 4 })).toBe(1);
    expect(similarity({ a: 4 }, { b: 4 })).toBe(0);
    expect(similarity({ a: 4, b: 2 }, { a: 2, b: 2 })).toBeCloseTo(4 / 6);
  });

  it("builds a consensus of exactly 50 cards from weighted lists", () => {
    const full = (no: string) => Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`${no}${i}`, 4]));
    const a = { ...full("A"), X: 2 }; // 54 → trimmed
    const counts = consensus([
      { cards: a, weight: 2 },
      { cards: full("A"), weight: 1 },
    ]);
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(50);
    expect(Math.max(...Object.values(counts))).toBeLessThanOrEqual(4);
  });

  it("gives legal 50-card lists for every archetype of the committed snapshot", () => {
    const archetypes = buildArchetypes(snapshot, lib);
    expect(archetypes.length).toBeGreaterThanOrEqual(8);
    for (const a of archetypes) {
      expect(validateDeck(lib, a.consensus), a.name).toEqual([]);
      expect(archetypeProblems(a, lib), a.name).toEqual([]);
    }
    expect(archetypes.reduce((s, a) => s + a.share, 0)).toBeLessThanOrEqual(1.0001);
  });

  it("the eight most played archetypes use only cards the engine fully understands", () => {
    for (const d of metaDecks(snapshot, lib, 8)) expect(d.archetype.partial, d.name).toEqual([]);
  });
});

describe("Limitless", () => {
  const standing = {
    placing: 1,
    record: { wins: 5, losses: 0, ties: 0 },
    deck: { id: "master", name: "Shining Gundam (Master Gundam)" },
    drop: null,
    decklist: {
      unit: [{ count: 4, name: "Gundam Maxter", set: "GD05", number: "069" }],
      command: [
        { count: 3, name: "Airframe​ Seizure", set: "GD05", number: "111" },
        { count: 1, name: "Unknown", set: "ZZ99", number: "001" },
      ],
    },
  };

  it("maps decklists to card numbers and keeps unknown cards apart", () => {
    const deck = toMetaDeck(pool, "t1", standing)!;
    expect(deck.cards).toEqual({ "GD05-069": 4, "GD05-111": 3 });
    expect(deck.unknown).toEqual(["ZZ99-001 Unknown"]);
    expect(deck.archetypeId).toBe("master");
  });

  it("loads only recent tournaments with enough players and their top placings, without player names", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      const body = url.includes("/standings")
        ? [
            { ...standing, name: "Someone", player: "someone" },
            { ...standing, placing: 9 },
          ]
        : [
            { id: "new", name: "New", date: "2026-11-10T00:00:00Z", players: 20 },
            { id: "small", name: "Small", date: "2026-11-10T00:00:00Z", players: 4 },
            { id: "old", name: "Old", date: "2026-08-01T00:00:00Z", players: 30 },
          ];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const snap = await fetchSnapshot(pool, {
      from: "2026-09-21",
      to: "2026-11-16",
      minPlayers: 8,
      topN: 8,
      delayMs: 0,
      fetch: fakeFetch,
    });
    expect(snap.tournaments.map((t) => t.id)).toEqual(["new"]);
    expect(snap.decks).toHaveLength(1);
    expect(JSON.stringify(snap)).not.toContain("omeone");
    expect(calls.filter((c) => c.includes("/standings"))).toHaveLength(1);
  });
});

describe("meta deck lists: consensus, best or both", () => {
  it("gives the best list the archetype's id with B, legal, and both lists side by side", () => {
    const consensus = metaDecks(snapshot, lib, 8);
    const best = metaDecks(snapshot, lib, 8, "best");
    const both = metaDecks(snapshot, lib, 8, "both");
    expect(consensus.every((d) => d.list === "consensus" && /^M\d{2}$/.test(d.id))).toBe(true);
    expect(best.every((d) => d.list === "best" && /^M\d{2}B$/.test(d.id))).toBe(true);
    for (const d of best) {
      expect(validateDeck(lib, d.deck), d.id).toEqual([]);
      expect(d.deck).toEqual(d.archetype.best);
      expect(consensus.find((c) => c.id === metaBaseId(d.id))?.archetype.id).toBe(d.archetype.id);
    }
    expect(both.map((d) => d.id)).toEqual(
      consensus.flatMap((c) => [c.id, ...best.filter((b) => metaBaseId(b.id) === c.id).map((b) => b.id)]),
    );
    expect(metaBaseId("M01B")).toBe("M01");
    expect(metaBaseId("M12")).toBe("M12");
    expect(metaBaseId("ST01")).toBe("ST01");
  });
});

describe("all real lists of an archetype", () => {
  it("keeps every list, best result first, the first one being the best list", () => {
    const score = (e: { placing: number; tournament: { players: number } }) =>
      Math.log2(Math.max(2, e.tournament.players)) / Math.sqrt(e.placing);
    const archetypes = buildArchetypes(snapshot, lib);
    expect(archetypes.reduce((s, a) => s + a.entries.length, 0)).toBeLessThanOrEqual(snapshot.decks.length);
    for (const a of archetypes) {
      expect(a.entries.length, a.id).toBe(a.lists);
      const first = a.entries[0]!;
      expect(first.placing).toBe(a.bestPlacing.placing);
      expect(first.tournament.id).toBe(a.bestPlacing.tournament);
      for (let i = 1; i < a.entries.length; i++) {
        const [x, y] = [a.entries[i - 1]!, a.entries[i]!];
        const [sx, sy] = [score(x), score(y)];
        expect(sx > sy || (sx === sy && x.weight >= y.weight), a.id).toBe(true);
      }
    }
    expect(entryLabel(archetypes[0]!.entries[0]!)).toMatch(
      /^Platz \d+ · .+ \(\d+ Spieler, \d{4}-\d\d-\d\d\)/,
    );
  });
});
