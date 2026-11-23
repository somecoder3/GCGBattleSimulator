// Resources and EX Resources in the combo graph, v0 and the v1 evaluation (src/ai/ramp.ts, docs/AI.md
// "Ressourcen und EX Resources").

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Evaluator } from "../../src/ai/evaluate";
import { HeuristicPolicy } from "../../src/ai/heuristic";
import { rampRole } from "../../src/ai/ramp";
import { deckPlan } from "../../src/ai/synergy";
import { partners } from "../../src/app/lib/partners";
import { CardPool } from "../../src/data/cards";
import { TEST_DECKS } from "../../src/data/decks";
import type { RawCardsDoc } from "../../src/data/types";
import { CardLib } from "../../src/engine/cardlib";
import { Engine } from "../../src/engine/engine";
import { viewFor } from "../../src/engine/view";
import { scenario } from "../engine/helpers";

const doc = JSON.parse(
  readFileSync(new URL("../../gcgdb/data/cards.json", import.meta.url), "utf8"),
) as RawCardsDoc;
const lib = CardLib.fromPool(new CardPool(doc));
const engine = new Engine(lib);
const AGEX = TEST_DECKS.find((d) => d.id === "AGEX")!.deck;

const BIRD = "ST02-002"; // Wing Gundam (Bird Mode), Lv.3/3: 【Deploy】 place 1 EX Resource
const WING = "GD01-040"; // Wing Gundam, Lv.5/2, no effect
const SANDROCK = "ST02-004"; // Gundam Sandrock, Lv.4/2, no effect

describe("roles of cards", () => {
  it("finds makers, users and level goals", () => {
    expect(rampRole(lib.get(BIRD)).sources).toMatchObject([{ when: "deploy", ex: 1, res: 0 }]);
    expect(
      rampRole(lib.get("GD01-107"))
        .sources.map((s) => s.when)
        .sort(),
    ).toEqual(["burst", "main"]);
    expect(rampRole(lib.get("GD01-025")).sources).toMatchObject([{ when: "paired", res: 1 }]);
    expect(rampRole(lib.get("GD05-020")).sources).toMatchObject([
      { when: "deploy", ex: 1, conditional: true },
    ]);
    expect(rampRole(lib.get("GD05-018")).exUses).toEqual(["spent"]); // Calibarn
    expect(rampRole(lib.get("GD02-022")).exUses).toEqual(["placed"]); // G-Exes
    expect(rampRole(lib.get("GD04-106")).exUses).toEqual(["selfPaid"]);
    expect(rampRole(lib.get("GD02-031")).levelGoal).toBe(7); // AGE-1 Titus
    expect(rampRole(lib.get(WING))).toEqual({ sources: [], exUses: [] });
  });
});

describe("combo graph", () => {
  const plan = deckPlan(lib, AGEX);

  it("links EX Resource users to the makers, level goals to all Resource makers", () => {
    const ex = plan.synergies.find((s) => s.kind === "ex" && s.source === "GD02-022")!;
    expect([...ex.matches.keys()].sort()).toEqual(["GD01-107", "GD02-021", "GD02-103", "GD03-019"]);
    const level = plan.synergies.find((s) => s.kind === "level" && s.source === "GD02-031")!;
    expect(level.label).toBe("Lv.7+");
    expect([...level.matches.keys()].sort()).toEqual(["GD01-107", "GD02-021", "GD02-103", "GD03-019"]);
    expect(plan.ramp).toMatchObject({ exMakers: 14, resMakers: 2, goal: 7, topUnit: 7 });
    expect([...plan.ramp.exUsers].sort()).toEqual(["GD02-022", "GD03-023"]);
  });

  it("shows them in 'Passt zu'", () => {
    const groups = partners(lib, "GD02-022", { colors: new Set(["Green"]) });
    const makers = groups.find((g) => g.title === "Platzieren EX Resources")!;
    expect(makers.cards.map((c) => c.no)).toContain("GD02-021");
    const users = partners(lib, BIRD).find((g) => g.title === "Nutzen EX Resources")!;
    expect(users.cards.map((c) => c.no)).toContain("GD05-018");
  });
});

describe("v0 with ramp", () => {
  // Lv.4, four active Resources. Sandrock first leaves 2: Bird Mode (cost 3) no longer fits. Bird Mode first
  // leaves 1 plus its EX Resource and Lv.5: Wing Gundam (Lv.5, cost 2) comes down the same turn.
  const s = scenario({ engine, filler: "ST01-005", p0: { hand: [SANDROCK, BIRD, WING], resources: 4 } });
  const first = (policy: HeuristicPolicy) => {
    const o = policy.choose(viewFor(s, 0), s.pending!);
    return o.type === "deployUnit" ? s.cards[o.card]!.no : o.type;
  };

  it("plays the EX Resource maker first when it makes another card playable", () => {
    expect(first(new HeuristicPolicy(engine))).toBe(SANDROCK);
    expect(first(new HeuristicPolicy(engine, { ramp: true }))).toBe(BIRD);
  });
});

describe("v1 evaluation with Resources", () => {
  it("values Resources up to the goal and EX Resources less than normal ones", () => {
    const plan = deckPlan(lib, AGEX).ramp;
    const ev = new Evaluator(engine, undefined, { ramp: plan });
    const at = (resources: number, exResources = 0) =>
      ev.evaluate(scenario({ engine, filler: "ST01-005", p0: { resources, exResources } }), 0);
    expect(at(5) - at(4)).toBeCloseTo(1.5);
    expect(at(8) - at(7)).toBeCloseTo(0.3); // above the goal Lv.7
    // An EX Resource: a Resource (1.5) less 0.5, plus 0.5 because AGEX uses EX Resources.
    expect(at(4, 1) - at(4)).toBeCloseTo(1.5);
    const plain = new Evaluator(engine);
    const s4 = scenario({ engine, filler: "ST01-005", p0: { resources: 4 } });
    const s5 = scenario({ engine, filler: "ST01-005", p0: { resources: 5 } });
    expect(plain.evaluate(s5, 0)).toBe(plain.evaluate(s4, 0));
  });
});
