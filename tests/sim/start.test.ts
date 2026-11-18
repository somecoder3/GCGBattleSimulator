// The die roll for who chooses to go first (src/sim/start.ts) and the AI's choice (src/ai/turnorder.ts).

import { describe, expect, it } from "vitest";
import { aiWantsFirst } from "../../src/ai/turnorder";
import { rollForStart } from "../../src/sim/start";

describe("start roll", () => {
  it("is the same for the same seed, the higher die wins, ties are rolled again", () => {
    let ties = 0;
    const winners = [0, 0];
    for (let seed = 0; seed < 600; seed++) {
      const roll = rollForStart(seed);
      expect(rollForStart(seed)).toEqual(roll);
      const last = roll.rolls[roll.rolls.length - 1]!;
      expect(last[roll.winner]).toBeGreaterThan(last[1 - roll.winner]!);
      for (const r of roll.rolls.slice(0, -1)) expect(r[0]).toBe(r[1]);
      for (const r of roll.rolls) for (const d of r) expect(d >= 1 && d <= 6).toBe(true);
      ties += roll.rolls.length - 1;
      winners[roll.winner]!++;
    }
    expect(ties).toBeGreaterThan(50); // 1 in 6 rolls is a tie
    expect(Math.min(...winners)).toBeGreaterThan(240);
  });

  it("the AI chooses to go first (measured for every deck, docs/AI.md)", () => {
    expect(aiWantsFirst()).toBe(true);
  });
});
