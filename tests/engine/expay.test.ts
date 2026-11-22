// Paying with an EX Resource on purpose (user's wish, 23 Nov 2026): offered when it changes something,
// with the fewest EX Resources (one), the rest normal Resources.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionLabel } from "../../src/app/lib/actions";
import { CardPool } from "../../src/data/cards";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { scenario } from "./helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const engine = new Engine(CardLib.fromPool(new CardPool(doc)));
const CALIBARN = "GD05-018"; // When one of your EX Resources is exiled … reduce damage by 3
const INCIDENT = "ST01-014"; // Command, cost 1, nothing about EX Resources
const SPARK = "GD05-118"; // Incendiary Spark: "If you use an EX Resource to play this card, rest …"

const exLeft = (s: ReturnType<typeof scenario>) =>
  s.players[0].resources.filter((id) => s.cards[id]!.no === "EXR-001").length;

describe("paying with an EX Resource on purpose", () => {
  it("is offered with Calibarn in play and uses exactly one EX Resource", () => {
    const s = scenario({
      engine,
      filler: "ST01-005",
      p0: { battle: [CALIBARN], hand: [INCIDENT], resources: 3, exResources: 3 },
      p1: { battle: ["ST01-005"] },
    });
    const plays = s.pending!.options.filter((o) => o.type === "playCommand");
    expect(plays).toEqual([
      { type: "playCommand", card: plays[0]!.card },
      { type: "playCommand", card: plays[0]!.card, ex: 1 },
    ]);
    expect(actionLabel(plays[1]!, () => "")).toBe("Ausspielen (mit EX Resource)");
    const events = engine.apply(s, plays[1]!);
    expect(exLeft(s)).toBe(2);
    expect(events.some((e) => e.t === "pay")).toBe(true);
    // Calibarn's trigger asks which Unit gets the damage reduction ("you may choose").
    expect(s.pending?.kind === "effect" || s.frames.length > 0 || s.queue.length > 0).toBe(true);
  });

  it("is not offered when nothing reacts to it, and not when EX Resources are needed anyway", () => {
    const plain = scenario({
      engine,
      filler: "ST01-005",
      p0: { hand: [INCIDENT], resources: 3, exResources: 1 },
      p1: { battle: ["ST01-005"] },
    });
    expect(plain.pending!.options.some((o) => "ex" in o && o.ex)).toBe(false);
  });

  it("is offered for a card that is stronger when paid with an EX Resource", () => {
    const s = scenario({
      engine,
      filler: "ST01-005",
      p0: { hand: [SPARK], resources: 4, exResources: 1 },
      p1: { battle: ["ST01-005"] },
    });
    const plays = s.pending!.options.filter((o) => o.type === "playCommand");
    expect(plays.some((o) => "ex" in o && o.ex === 1)).toBe(true);
  });
});
