// The lab server (src/lab/): SQLite store, simulation jobs and the HTTP API with its access rules.

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { allowedOrigin, handleApi } from "../../src/lab/api";
import { JobManager, type JobWorker } from "../../src/lab/jobs";
import { LabStore, type LabRun } from "../../src/lab/store";
import { gameHash } from "../../src/sim/gamehash";
import { runRange, type SimJob } from "../../src/sim/runner";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));

const job: SimJob = {
  decks: STARTER_DECKS.slice(0, 2).map((d) => ({ id: d.id, name: d.name, deck: d.deck })),
  ai: ["heuristic-v0", "heuristic-v0"],
  games: 16,
  seed: 3,
  mirrors: false,
};
const names = { ST01: "Heroic Beginnings", ST02: "Wings of Advance" };

/** Plays the games in this thread, a little later (the server uses worker threads). */
const inProcess = (): JobWorker => ({
  run: (j, from, to) =>
    new Promise((resolve) => setTimeout(() => resolve(runRange(engine, j, from, to)), 20)),
  close: () => Promise.resolve(),
});

describe("lab store", () => {
  it("keeps runs with a hash index, decks and values", () => {
    const store = new LabStore(":memory:");
    const games = runRange(engine, job, 0, 4);
    const run: LabRun = { name: "Test", createdAt: "2026-11-21T10:00:00Z", job, games, deckNames: names };
    const id = store.addRun(run);
    expect(store.runs()).toEqual([
      { id, name: "Test", createdAt: run.createdAt, games: 4, decks: 2, deckNames: names },
    ]);
    expect(store.run(id)?.games).toEqual(games);
    expect(store.findGame(gameHash(job, 2).toUpperCase())).toEqual({ runId: id, index: 2 });
    expect(store.findGame(gameHash(job, 9))).toBeUndefined(); // not played in this run
    expect(store.hasRun("Test", run.createdAt)).toBe(true);
    expect(store.deleteRun(id)).toBe(true);
    expect(store.findGame(gameHash(job, 2))).toBeUndefined(); // index rows went with the run

    const deck = { id: "u-1", name: "Mein Deck", deck: STARTER_DECKS[0]!.deck, updatedAt: "x" };
    store.putDeck(deck);
    store.putDeck({ ...deck, name: "Umbenannt" });
    expect(store.decks().map((d) => d.name)).toEqual(["Umbenannt"]);
    store.set("meta", { to: "2026-11-21" });
    expect(store.get("meta")).toEqual({ to: "2026-11-21" });
    store.close();
  });
});

describe("lab API", () => {
  let server: Server;
  let store: LabStore;
  let url: string;

  beforeAll(async () => {
    store = new LabStore(":memory:");
    const jobs = new JobManager(store, inProcess, () => "test", 2);
    server = createServer((req, res) => {
      if (!handleApi({ store, jobs, version: () => "test" }, req, res)) res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => {
    server.close();
    store.close();
  });

  const call = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${url}/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    return { status: response.status, body: (await response.json().catch(() => null)) as unknown, response };
  };

  it("runs a job, saves the run and finds its games by hash", async () => {
    const started = await call("jobs", { method: "POST", body: JSON.stringify({ job, names }) });
    expect(started.status).toBe(200);
    // A second job while the first runs is refused.
    const second = await call("jobs", { method: "POST", body: JSON.stringify({ job, names }) });
    expect(second.status).toBe(409);
    for (let i = 0; i < 200; i++) {
      const { body } = await call("jobs/current");
      if (!(body as { running: boolean }).running) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const runs = (await call("runs")).body as { id: number; games: number; codeVersion: string }[];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ games: 16, codeVersion: "test" });
    const found = (await call(`games/find?hash=${gameHash(job, 11)}`)).body;
    expect(found).toEqual({ runId: runs[0]!.id, index: 11 });
    const run = (await call(`runs/${runs[0]!.id}`)).body as LabRun;
    expect(run.games.map((g) => g.index)).toEqual([...Array(16).keys()]);
  });

  it("imports runs of the browser once", async () => {
    const games = runRange(engine, job, 0, 2);
    const old = { name: "Alt", createdAt: "2026-11-01T10:00:00Z", job, games, deckNames: names, id: 7 };
    expect((await call("runs/import", { method: "POST", body: JSON.stringify([old]) })).body).toEqual({
      imported: 1,
      skipped: 0,
    });
    expect((await call("runs/import", { method: "POST", body: JSON.stringify([old]) })).body).toEqual({
      imported: 0,
      skipped: 1,
    });
  });

  it("stores decks", async () => {
    const deck = { id: "u-a b", name: "Labor", deck: STARTER_DECKS[1]!.deck, updatedAt: "x" };
    expect((await call("decks/u-a%20b", { method: "PUT", body: JSON.stringify(deck) })).status).toBe(200);
    expect(((await call("decks")).body as { name: string }[]).map((d) => d.name)).toEqual(["Labor"]);
    expect((await call("decks/u-a%20b", { method: "DELETE" })).status).toBe(200);
  });

  it("answers known origins with CORS and refuses others", async () => {
    const pages = await call("decks", { headers: { Origin: "https://somecoder3.github.io" } });
    expect(pages.status).toBe(200);
    expect(pages.response.headers.get("access-control-allow-origin")).toBe("https://somecoder3.github.io");
    expect((await call("decks", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect(allowedOrigin("http://localhost:5173")).toBe(true);
    expect(allowedOrigin("http://localhost.evil.example")).toBe(false);
    // Preflight of Chrome's Private Network Access.
    const pre = await fetch(`${url}/decks`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:5173", "Access-Control-Request-Private-Network": "true" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-private-network")).toBe("true");
  });
});
