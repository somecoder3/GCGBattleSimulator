// Look effects tell the looking player which cards they saw and which went under the deck (log).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeStep } from "../../src/app/lib/gamelog";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import type { Action, GameEvent, GameState, PlayerId } from "../../src/engine/types";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const GM = "ST01-005"; // 2/2
const ZAKU = "ST03-008";
const MAXTER = "GD05-069"; // destroys a Unit in battle: look at the top 4, may take a (Special Move) Command

/** Gundam Maxter destroys a rested GM; the top 4 cards hold no Special Move. */
function maxterAttack(): { s: GameState; events: GameEvent[] } {
  const s = scenario({
    engine,
    filler: GM,
    p0: { battle: [MAXTER], deck: [ZAKU, GM, GM, ZAKU, GM, GM] },
    p1: { battle: [{ no: GM, rested: true }] },
  });
  const events: GameEvent[] = [];
  const act = (a: Action) => events.push(...engine.apply(s, a));
  const target = s.players[1].battle[0]!;
  act({ type: "attack", unit: s.players[0].battle[0]!, target });
  while (s.pending && !s.cards[target]!.zone.startsWith("trash") && events.every((e) => e.t !== "look"))
    act(s.pending.options.find((o) => o.type === "pass" || o.type === "noBlock") ?? s.pending.options[0]!);
  return { s, events };
}

const lines = (s: GameState, events: GameEvent[], human: PlayerId) =>
  describeStep(engine, { index: 0, player: 0, action: null, turn: s.turn, events, after: s }, human).map(
    (l) => l.text,
  );

describe("looking at the top of the deck", () => {
  it("shows the looking player all cards and those put under the deck", () => {
    const { s, events } = maxterAttack();
    const look = events.find((e) => e.t === "look");
    expect(look).toMatchObject({ player: 0 });
    const text = lines(s, events, 0);
    expect(text).toContain("Du siehst dir die obersten 4 Karten deines Decks an: Zaku Ⅱ, GM, GM, Zaku Ⅱ.");
    const under = text.find((t) => t.startsWith("Unter dein Deck:"))!;
    expect(under.match(/Zaku Ⅱ/g)).toHaveLength(2);
    expect(under.match(/GM/g)).toHaveLength(2);
  });

  it("tells the opponent only that cards were looked at", () => {
    const { s, events } = maxterAttack();
    const text = lines(s, events, 1).join("\n");
    expect(text).toContain("Die KI sieht sich die obersten 4 Karten ihres Decks an.");
    expect(text).not.toContain("Zaku");
  });
});
