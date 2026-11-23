// Fixed deck lists. Starter decks ST01–ST04 from the published lists (coolstuffinc.com, 17 Jul 2025); ST01 sums
// to 51 there, so Guntank (ST01-004) is counted 3× like the third Unit of the other starters.

import { DEFAULT_RESOURCE, RESOURCE_DECK_SIZE } from "../engine/deck";
import type { DeckList } from "../engine/types";

export interface NamedDeck {
  id: string;
  name: string;
  colors: string;
  deck: DeckList;
}

function list(counts: Record<string, number>): DeckList {
  const main = Object.entries(counts).flatMap(([no, n]) => Array<string>(n).fill(no));
  return { main, resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE) };
}

const starter = (set: string, counts: number[]) =>
  Object.fromEntries(counts.map((n, i) => [`${set}-${String(i + 1).padStart(3, "0")}`, n]));

// Counts for card numbers 001–016 of each starter deck.
export const STARTER_DECKS: NamedDeck[] = [
  {
    id: "ST01",
    name: "Heroic Beginnings",
    colors: "Blue/White",
    deck: list(starter("ST01", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST02",
    name: "Wings of Advance",
    colors: "Green/Blue",
    deck: list(starter("ST02", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST03",
    name: "Zeon's Rush",
    colors: "Red/Green",
    deck: list(starter("ST03", [2, 4, 4, 3, 3, 2, 3, 4, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  {
    id: "ST04",
    name: "SEED Strike",
    colors: "White/Red",
    deck: list(starter("ST04", [2, 4, 4, 3, 3, 2, 4, 3, 3, 4, 4, 3, 3, 2, 3, 3])),
  },
  // ST05–ST14 (16 Nov 2026): product lists from exburst.dev/gundam/starter-decks (ST11 also matches
  // tcgtalk.com). ST05: an earlier pre-release list (essential-japan.com) differs in six counts; the
  // list after release is used. Reprints from other sets are part of some boxes (e.g. ST01-014 in ST05).
  {
    id: "ST05",
    name: "Iron Bloom",
    colors: "Purple/White",
    deck: list({
      ...starter("ST05", [2, 4, 4, 4, 4, 3, 2, 4, 3, 4, 3, 3, 2, 2, 4]),
      "ST01-014": 2,
    }),
  },
  {
    id: "ST06",
    name: "Clan Unity",
    colors: "Red/Green",
    deck: list({ ...starter("ST06", [2, 4, 4, 4, 2, 4, 4, 4, 4, 4, 2, 4, 2, 2, 2]), "ST03-013": 2 }),
  },
  {
    id: "ST07",
    name: "Celestial Drive",
    colors: "Purple/Green",
    deck: list({ ...starter("ST07", [2, 4, 4, 3, 2, 4, 3, 4, 3, 3, 3, 3, 2, 4, 4]), "ST05-014": 2 }),
  },
  {
    id: "ST08",
    name: "Flash of Radiance",
    colors: "Red/Blue",
    deck: list({ ...starter("ST08", [2, 4, 3, 4, 3, 2, 4, 4, 3, 4, 4, 3, 3, 3, 2]), "ST02-014": 2 }),
  },
  // ST09 "Destiny Ignition" holds cards for two decks; these are the two official builds from
  // gundam-gcg.com/en/decks/deck-026.php and deck-027.php.
  {
    id: "ST09W",
    name: "Destiny Ignition (Purple-White)",
    colors: "Purple/White",
    deck: list({
      "GD01-118": 4,
      "GD02-076": 2,
      "GD02-110": 3,
      "ST04-002": 3,
      "ST04-010": 4,
      "ST04-015": 2,
      "ST09-001": 4,
      "ST09-002": 4,
      "ST09-004": 4,
      "ST09-005": 4,
      "ST09-006": 4,
      "ST09-007": 4,
      "ST09-008": 4,
      "ST09-010": 4,
    }),
  },
  {
    id: "ST09R",
    name: "Destiny Ignition (Red-Purple)",
    colors: "Red/Purple",
    deck: list({
      "GD01-049": 3,
      "GD01-054": 4,
      "ST04-007": 4,
      "ST04-011": 4,
      "ST04-016": 2,
      "ST09-001": 4,
      "ST09-002": 4,
      "ST09-003": 4,
      "ST09-005": 4,
      "ST09-006": 4,
      "ST09-007": 4,
      "ST09-008": 4,
      "ST09-009": 2,
      "ST09-010": 3,
    }),
  },
  {
    id: "ST10",
    name: "Generation Pulse",
    colors: "Blue/White",
    deck: list(starter("ST10", [2, 3, 4, 3, 4, 2, 3, 4, 4, 3, 4, 4, 2, 2, 2, 4])),
  },
  {
    id: "ST11",
    name: "Aquatic Assault",
    colors: "Blue/Purple",
    deck: list(starter("ST11", [2, 3, 3, 4, 3, 2, 3, 4, 4, 3, 4, 4, 2, 3, 2, 4])),
  },
  {
    id: "ST12",
    name: "Raging Onslaught",
    colors: "Red/Purple",
    deck: list(starter("ST12", [2, 2, 4, 3, 4, 2, 4, 3, 4, 3, 4, 4, 2, 3, 2, 4])),
  },
  {
    id: "ST13",
    name: "Silent Barrage",
    colors: "Green/Red",
    deck: list(starter("ST13", [2, 3, 4, 3, 3, 2, 2, 3, 4, 4, 4, 4, 3, 2, 3, 4])),
  },
  {
    id: "ST14",
    name: "Heavy Dominion",
    colors: "Green/White",
    deck: list(starter("ST14", [2, 3, 3, 4, 2, 2, 4, 3, 4, 3, 4, 4, 3, 3, 2, 4])),
  },
];

/** A starter deck with some cards swapped (a test list: not an official deck, legal under the normal rules). */
function swapped(id: string, base: string, swap: Record<string, string>, name: string): NamedDeck {
  const from = STARTER_DECKS.find((d) => d.id === base)!;
  const main = from.deck.main.map((no) => swap[no] ?? no);
  return { id, name, colors: from.colors, deck: { ...from.deck, main } };
}

/** Test lists for measuring AI rules (docs/AI.md); offered in the app as "Testdecks". */
export const TEST_DECKS: NamedDeck[] = [
  // The Final Victor ×4 (instead of Two Unicorns ST12-015) and Destiny Gundam GD05-055 ×2 (instead of Epyon).
  swapped(
    "ST12X",
    "ST12",
    { "ST12-015": "ST12-013", "ST12-001": "GD05-055" },
    "Raging Onslaught + Final Victor ×4 + Destiny ×2",
  ),
  // Resources and EX Resources (docs/AI.md "Ressourcen und EX Resources", 23 Nov 2026).
  // ST14 without its Resource cards: Rick Dias (Blocker 3/3, cost 2) for Duel Gundam (Assault Shroud), Overflowing
  // Affection for Battlefield Emotions; v1 against the starters 50.3 → 67.8 %, against Meta M01–M06 9.4 → 17.3 %.
  swapped(
    "ST14X",
    "ST14",
    { "ST14-009": "GD02-079", "ST14-015": "GD01-118" },
    "Heavy Dominion + Rick Dias, Overflowing Affection (ohne Ressourcen-Karten)",
  ),
  // ST02 with more Resources: First Contact (Tragos), Gundam Deathscythe GD01-025 (Aries), Mutual Attraction
  // (Corsica Base, at most 2× under the banlist), Wing Gundam ×4 (Tallgeese).
  swapped(
    "WINGX",
    "ST02",
    { "ST02-009": "GD01-107", "ST02-008": "GD01-025", "ST02-016": "GD05-106", "ST02-006": "ST02-001" },
    "Wings of Advance + First Contact, Deathscythe, Mutual Attraction",
  ),
  {
    id: "AGEX",
    name: "AGE (Test, EX Resources)",
    colors: "Green",
    deck: list({
      "GD02-021": 4, // AGE-1 Normal: discard → EX Resource
      "GD02-022": 3, // G-Exes: EX placed → Breach 2
      "GD02-023": 3, // Spallow: Lv.7 → First Strike
      "GD02-026": 2, // Genoace Custom: Lv.7 → AP+2
      "GD02-027": 3,
      "GD02-031": 3, // Titus: Lv.7 → AP+2
      "GD03-019": 4, // AGE-2 Normal: linked → EX Resource
      "GD03-023": 3, // G-Bouncer: EX placed → High-Maneuver
      "GD03-031": 3,
      "GD05-021": 2,
      "GD05-024": 2,
      "GD02-088": 4, // Flit Asuno
      "GD03-088": 4, // Asemu Asuno
      "GD02-103": 4, // AGE Device: EX Resource
      "GD01-107": 2, // First Contact
      "GD02-124": 4, // Diva: Lv.7
    }),
  },
  {
    // Tournament list (Limitless, Nu Gundam, 7th place, snapshot 2026-11-21): Re-GZ BWS and Nu Gundam GD05-020.
    id: "LBX",
    name: "Nu Gundam mit Re-GZ BWS (Turnierliste)",
    colors: "Green/Blue",
    deck: list({
      "GD01-008": 4,
      "GD05-027": 4,
      "GD05-029": 4,
      "GD05-028": 3,
      "GD05-023": 3,
      "GD01-030": 3,
      "GD05-019": 4,
      "ST01-001": 4,
      "GD05-020": 3,
      "GD05-017": 4,
      "ST01-010": 4,
      "GD05-085": 4,
      "GD01-100": 2,
      "GD05-125": 4,
    }),
  },
  {
    // Tournament list (Limitless, "Other", 5th place, snapshot 2026-11-21): G-Self, Calibarn, First Contact.
    id: "ACAX",
    name: "Calibarn/G-Self (Turnierliste)",
    colors: "Green/Red",
    deck: list({
      "ST13-009": 2,
      "EB01-038": 4,
      "GD05-025": 3,
      "ST13-006": 3,
      "GD05-022": 2,
      "GD05-018": 3,
      "ST13-012": 4,
      "GD04-085": 2,
      "GD05-111": 4,
      "GD05-108": 4,
      "GD03-109": 4,
      "GD01-107": 3,
      "GD05-110": 4,
      "GD02-107": 2,
      "GD04-109": 2,
      "GD05-126": 4,
    }),
  },
];
