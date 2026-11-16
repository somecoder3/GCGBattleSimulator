import { describe, expect, it } from "vitest";
import { actionLabel, isButton, primaryButton, primaryCard, secondary } from "../../src/app/lib/actions";
import type { Action } from "../../src/engine/types";

const name = (id: number) => `#${id}`;

describe("board actions", () => {
  it("assigns options to the card they start from and the target that completes them", () => {
    const attack: Action = { type: "attack", unit: 4, target: "player" };
    expect(primaryCard(attack)).toBe(4);
    expect(secondary(attack)).toBe("player");
    const pair: Action = { type: "pair", card: 9, unit: 2 };
    expect([primaryCard(pair), secondary(pair)]).toEqual([9, 2]);
    expect(secondary({ type: "deployUnit", card: 1 })).toBeNull();
    expect(isButton({ type: "endMain" })).toBe(true);
    expect(isButton({ type: "target", card: 3 })).toBe(false);
  });

  it("labels options in German", () => {
    expect(actionLabel({ type: "attack", unit: 1, target: 5 }, name)).toBe("#5 angreifen");
    expect(actionLabel({ type: "deployUnit", card: 1, replace: 7 }, name)).toBe("Einsetzen, ersetzt #7");
    expect(actionLabel({ type: "option", index: 1, label: "Token B" }, name)).toBe("Token B");
  });

  it("puts passing before ending the main phase on the space key", () => {
    expect(primaryButton([{ type: "endMain" }, { type: "pass" }])).toEqual({ type: "pass" });
    expect(primaryButton([{ type: "target", card: 1 }])).toBeUndefined();
  });
});
