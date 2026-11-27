import { describe, expect, it } from "vitest";
import { groupDecks, matchDeck, randomDeck } from "../../src/app/lib/deckgroups";
import type { DeckChoice } from "../../src/app/lib/decks";

const deck = (id: string, group: DeckChoice["group"], extra: Partial<DeckChoice> = {}): DeckChoice => ({
  id,
  name: id,
  colors: "Blue/White",
  deck: { main: [], resources: [] },
  group,
  supported: true,
  ...extra,
});

describe("deck groups", () => {
  const decks = [
    deck("M01", "meta", { share: 0.2 }),
    deck("M02", "meta", { share: 0.1 }),
    deck("ST01", "starter"),
    deck("ST12X", "test"),
    deck("u-2", "user", { name: "zeta" }),
    deck("u-1", "user", { name: "Alpha" }),
    deck("s:a", "shared", { name: "B (Max)", title: "B", owner: "Max" }),
    deck("s:b", "shared", { name: "A (Anna)", title: "A", owner: "Anna" }),
    deck("s:c", "shared", { name: "A (Max)", title: "A", owner: "Max" }),
  ];

  it("orders own decks, each other user, meta, starter and test decks", () => {
    const groups = groupDecks(decks, "Meta");
    expect(groups.map((g) => g.key)).toEqual([
      "user",
      "shared:Anna",
      "shared:Max",
      "meta",
      "starter",
      "test",
    ]);
    expect(groups[0]!.decks.map((d) => d.name)).toEqual(["Alpha", "zeta"]);
    expect(groups[2]!.decks.map((d) => d.title)).toEqual(["A", "B"]);
    expect(groups[2]!.label).toBe("Decks von Max");
    expect(groups[3]!.decks.map((d) => d.id)).toEqual(["M01", "M02"]);
  });

  it("rolls a group first, then a deck in it", () => {
    const groups = groupDecks(decks);
    // 6 groups: 0.5 → the 4th (meta), 0.99 → its last deck.
    let calls = 0;
    const random = () => [0.5, 0.99][calls++]!;
    expect(randomDeck(groups, () => true, random)?.id).toBe("M02");
    // Groups without a usable deck are left out.
    const onlyStarter = randomDeck(
      groups,
      (d) => d.group === "starter",
      () => 0.7,
    );
    expect(onlyStarter?.id).toBe("ST01");
    expect(randomDeck(groups, () => false)).toBeUndefined();
  });

  it("finds decks by name, id, owner and colour", () => {
    const d = deck("s:a", "shared", { name: "Wing Zero (Max)", owner: "Max", colors: "Green/White" });
    expect(matchDeck(d, "wing max")).toBe(true);
    expect(matchDeck(d, "green")).toBe(true);
    expect(matchDeck(d, "red")).toBe(false);
    expect(matchDeck(d, "  ")).toBe(true);
  });
});
