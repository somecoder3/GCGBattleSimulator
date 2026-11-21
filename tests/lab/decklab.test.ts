// Deck lab (src/lab/decklab/): paired measurement, cache, swaps, real pairings without players.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { deckHash, Measurer, pairedDiff, type FieldDeck } from "../../src/lab/decklab/measure";
import { applySwap } from "../../src/lab/decklab/swaps";
import type { JobWorker } from "../../src/lab/jobs";
import { LabStore } from "../../src/lab/store";
import { toPairings } from "../../src/meta/limitless";
import { runRange } from "../../src/sim/runner";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const worker: JobWorker = {
  run: (job, from, to) => Promise.resolve(runRange(engine, job, from, to)),
  close: () => Promise.resolve(),
};
const [st01, st02, st03] = STARTER_DECKS;
const field: FieldDeck[] = [
  { id: "ST02", name: "ST02", deck: st02!.deck, weight: 0.5 },
  { id: "ST03", name: "ST03", deck: st03!.deck, weight: 0.5 },
];

describe("deck lab", () => {
  it("hashes decks independent of order", () => {
    const d = st01!.deck;
    expect(deckHash({ main: [...d.main].reverse(), resources: d.resources })).toBe(deckHash(d));
    expect(deckHash(applySwap(d, { remove: d.main[0]!, add: "ST02-001" }))).not.toBe(deckHash(d));
  });

  it("measures blocks once and takes them from the cache afterwards", async () => {
    const store = new LabStore(":memory:");
    const m = new Measurer(store, [worker], { ai: "heuristic-v0", seed: 1, codeVersion: "t" });
    const first = await m.blocks([st01!.deck], field, 1);
    expect(m.played).toBe(16);
    expect(first[0]![0]![0]!.wins + first[0]![0]![0]!.losses + first[0]![0]![0]!.draws).toBe(8);
    const again = await m.blocks([st01!.deck], field, 1);
    expect(m.played).toBe(16);
    expect(again).toEqual(first);
    // The same deck against itself in a paired comparison: no difference.
    expect(pairedDiff(first[0]!, again[0]!, field).diff).toBe(0);
    store.close();
  });

  it("keeps pairings by placing, without players", () => {
    const standings = [
      { player: "anna", placing: 1, record: null, deck: null, decklist: null, drop: null },
      { player: "bert", placing: 2, record: null, deck: null, decklist: null, drop: null },
      { player: "carl", placing: 20, record: null, deck: null, decklist: null, drop: null },
    ];
    const raw = [
      { round: 1, player1: "anna", player2: "bert", winner: "bert" },
      { round: 1, player1: "anna", player2: "carl", winner: "anna" }, // carl's list isn't kept
      { round: 2, player1: "bert", player2: null, winner: "bert" }, // bye
      { round: 3, player1: "anna", player2: "bert", winner: "0" },
    ];
    const out = toPairings("t1", standings, raw, (p) => p <= 16);
    expect(out).toEqual([
      { tournament: "t1", a: 1, b: 2, result: 2 },
      { tournament: "t1", a: 1, b: 2, result: 0 },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/anna|bert|carl/);
  });
});
