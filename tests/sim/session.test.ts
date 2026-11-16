import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { RandomPolicy } from "../../src/ai/random";
import { describeSteps } from "../../src/app/lib/gamelog";
import { CardPool } from "../../src/data/cards";
import { STARTER_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { hashState } from "../../src/engine/hash";
import { GameSession } from "../../src/sim/session";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const ai = new HeuristicPolicy(engine);

/** A session where a random "human" (seat 0) plays against the heuristic AI. */
function play(seed: number, maxHumanActions = Infinity): GameSession {
  const session = new GameSession(engine, {
    decks: [STARTER_DECKS[0]!.deck, STARTER_DECKS[2]!.deck],
    options: { seed, firstPlayer: (seed % 2) as 0 | 1 },
    human: 0,
  });
  const human = new RandomPolicy(seed);
  let n = 0;
  while (!session.over && n < maxHumanActions) {
    if (session.aiToAct) session.stepAI(ai);
    else {
      session.apply(human.choose(session.state, session.state.pending!));
      n++;
    }
  }
  while (session.aiToAct) session.stepAI(ai);
  return session;
}

describe("game session", () => {
  it("undo takes back the human's last decision and everything after it", () => {
    const session = play(7, 12);
    const humanActions = session.humanActions();
    const last = humanActions.at(-1)!;
    const expected = new GameSession(engine, session.setup, session.actions.slice(0, last));
    session.undo();
    expect(session.actions).toHaveLength(last);
    expect(session.humanToAct).toBe(true);
    expect(hashState(session.state)).toBe(hashState(expected.state));
  });

  it("rolls back to any point and replays the same game (same random numbers)", () => {
    const full = play(11);
    const actions = [...full.actions];
    const finalHash = hashState(full.state);
    full.rollbackTo(5);
    expect(full.actions).toEqual(actions.slice(0, 5));
    for (const action of actions.slice(5)) full.apply(action);
    expect(hashState(full.state)).toBe(finalHash);
    expect(full.over).toBe(true);
  });

  it("automatic passes are no rollback points and survive saving", () => {
    // A game in which the human had something to play in an action step.
    let session!: GameSession;
    let autoCount = 0;
    for (let seed = 1; seed < 30 && autoCount === 0; seed++) {
      session = new GameSession(engine, {
        decks: [STARTER_DECKS[0]!.deck, STARTER_DECKS[2]!.deck],
        options: { seed, firstPlayer: 0 },
        human: 0,
      });
      const human = new RandomPolicy(seed);
      while (!session.over) {
        if (session.aiToAct) session.stepAI(ai);
        else if (session.state.pending!.kind === "action") {
          session.apply({ type: "pass" }, true);
          autoCount++;
        } else session.apply(human.choose(session.state, session.state.pending!));
      }
    }
    expect(autoCount).toBeGreaterThan(0);
    const autos = session.steps.filter((s) => s.auto).map((s) => s.index);
    expect(session.humanActions().some((i) => autos.includes(i))).toBe(false);
    const restored = GameSession.restore(engine, JSON.parse(JSON.stringify(session.save())));
    expect(restored.steps.filter((s) => s.auto).map((s) => s.index)).toEqual(autos);
    const last = session.humanActions().at(-1)!;
    session.undo();
    expect(session.actions).toHaveLength(last);
  });

  it("saves and restores a game exactly", () => {
    const session = play(3, 20);
    const restored = GameSession.restore(engine, JSON.parse(JSON.stringify(session.save())));
    expect(hashState(restored.state)).toBe(hashState(session.state));
    expect(restored.steps).toHaveLength(session.steps.length);
  });

  it("finds the human's first decision of a turn", () => {
    const session = play(5);
    const turn = session.steps.find((s) => s.player === 0 && s.turn > 1)!.turn;
    const index = session.turnStart(turn)!;
    expect(session.steps.find((s) => s.index === index)).toMatchObject({ player: 0, turn });
  });

  it("the log names no card the human could not see", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const session = play(seed);
      const lines = describeSteps(engine, session.steps, 0);
      expect(lines.at(-1)!.text).toMatch(/^Spielende/);
      for (const step of session.steps) {
        for (const e of step.events) {
          if (e.t !== "draw" || step.after.turn === 0) continue;
          const drawn = engine.lib.get(step.after.cards[e.card]!.no).name;
          const line = lines.find((l) => l.index === step.index && l.text.includes(" zieht"));
          if (e.player === 1) {
            expect(line?.text).toBe("KI zieht eine Karte.");
            expect(line?.text).not.toContain(drawn);
          }
        }
      }
    }
  });
});
