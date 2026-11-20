// Hashes of simulated games (src/sim/gamehash.ts) and the match export of a replay (gameexport.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchExport, parseSavedGame } from "../../src/app/lib/gameexport";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { findGame, gameHash, normalizeHash } from "../../src/sim/gamehash";
import { recordGame, type SimJob } from "../../src/sim/runner";
import { GameSession } from "../../src/sim/session";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const pool = new CardPool(doc);
const engine = new Engine(CardLib.fromPool(pool));

const job: SimJob = {
  decks: STARTER_DECKS.slice(0, 3).map((d) => ({ id: d.id, name: d.name, deck: d.deck })),
  ai: ["heuristic-v0", "heuristic-v0"],
  games: 48,
  seed: 5,
  mirrors: false,
};

describe("game hash", () => {
  it("is 10 characters, differs per game and only depends on what decides the game", () => {
    const h = gameHash(job, 3);
    expect(h).toMatch(/^[0-9a-z]{10}$/);
    expect(gameHash(job, 4)).not.toBe(h);
    expect(gameHash({ ...job, seed: 6 }, 3)).not.toBe(h);
    expect(gameHash({ ...job, ai: ["heuristic-v1", "heuristic-v0"] }, 3)).not.toBe(h);
    // More games, other names, card statistics: the same game.
    const same: SimJob = {
      ...job,
      games: 480,
      cardStats: true,
      decks: job.decks.map((d) => ({ ...d, name: "x" })),
    };
    expect(gameHash(same, 3)).toBe(h);
  });

  it("finds the game in a list of runs, also typed in upper case with spaces", () => {
    const runs = [{ job: { ...job, seed: 9 } }, { job }];
    const typed = ` ${gameHash(job, 17)
      .toUpperCase()
      .replace(/(.{5})/, "$1 ")} `;
    expect(normalizeHash(typed)).toBe(gameHash(job, 17));
    expect(findGame(runs, typed)).toEqual({ run: runs[1], index: 17 });
    expect(findGame(runs, "zzzzzzzzzz")).toBeUndefined();
    expect(findGame(runs, "abc")).toBeUndefined();
  });
});

describe("match export of a replay", () => {
  it("has the deck lists with names, AIs, result, hash and job, and loads as a saved game", () => {
    const rec = recordGame(engine, job, 5);
    const names: [string, string] = [rec.spec.decks[0], rec.spec.decks[1]];
    const session = new GameSession(
      engine,
      { decks: rec.decks, options: rec.options, human: 0, deckNames: names },
      rec.actions,
    );
    const hash = gameHash(job, 5);
    const out = matchExport(engine, pool, session, {
      hash,
      job,
      index: 5,
      decks: rec.spec.decks,
      ai: rec.spec.ai,
    });
    const m = out.match as {
      hash: string;
      source: string;
      decks: { id: string; ai: string; cards: { count: number; no: string; name: string }[] }[];
      result: { winner: number | null; turns: number };
      log: string[];
      job: SimJob;
    };
    expect(m.source).toBe("simulator");
    expect(m.hash).toBe(hash);
    expect(m.decks.map((d) => d.id)).toEqual(rec.spec.decks);
    expect(m.decks[0]!.cards.reduce((n, c) => n + c.count, 0)).toBe(50);
    expect(m.decks[0]!.cards.every((c) => c.name !== "?")).toBe(true);
    expect(m.result.turns).toBe(session.state.turn);
    expect(m.log.length).toBeGreaterThan(10);
    expect(m.log[0]).toBe(`GCG Battle Simulator – Simulationsspiel 5, Spiel-Hash ${hash}`);
    expect(m.log[1]).toBe(`Sitz 1: ${names[0]} (Heuristik v0 (Regeln))`);
    expect(m.job.seed).toBe(5);

    // The file loads as a game again (the extras are dropped) and reaches the same end.
    const loaded = GameSession.restore(engine, parseSavedGame(JSON.stringify(out)));
    expect("match" in loaded.setup).toBe(false);
    expect(loaded.state.result).toEqual(session.state.result);
  });
});
