// Export of a game against the AI: the log as readable text, and the game itself as JSON (seed, decks,
// all decisions), which the game screen can load again and `npm run play` can replay.

import { AI_LABELS, type AiName } from "../../ai/registry";
import type { CardPool } from "../../data/cards";
import type { Engine } from "../../engine/engine";
import type { GameSession, SavedSession } from "../../sim/session";
import type { DeckList, GameEndReason, PlayerId } from "../../engine/types";
import type { SimJob } from "../../sim/runner";
import { describeStart, describeSteps } from "./gamelog";

const REASONS: Record<GameEndReason, string> = {
  damage: "durch Schaden",
  deckOut: "Deck leer",
  turnLimit: "Zuglimit",
  concede: "Aufgabe",
};

/** The game's history as text: a header and the log lines as seen by the human. */
export function gameLogText(
  engine: Engine,
  session: GameSession,
  date = new Date(),
  info?: MatchInfo,
): string {
  const { setup, human } = session;
  const result = session.state.result;
  const [mine, theirs] = human === 0 ? [0, 1] : [1, 0];
  const turns = session.state.turn;
  // A simulated game: two AIs, by seat; the lines are written as seen from the human's seat ("Du").
  const header = info
    ? [
        `GCG Battle Simulator – Simulationsspiel ${info.index}, Spiel-Hash ${info.hash}`,
        ...([0, 1] as const).map(
          (seat) => `Sitz ${seat + 1}: ${setup.deckNames?.[seat] ?? "?"} (${AI_LABELS[info.ai[seat]]})`,
        ),
        `Seed: ${setup.options.seed}`,
        result
          ? `Ergebnis: ${result.winner === null ? "Unentschieden" : `Sitz ${result.winner + 1} gewinnt`} nach ${turns} Zügen (${REASONS[result.reason]})`
          : `Stand: Zug ${turns}`,
        `Verlauf aus Sicht von Sitz ${human + 1} („Du“)`,
      ]
    : [
        `GCG Battle Simulator – Partie vom ${date.toLocaleString("de-DE")}`,
        `Du: ${setup.deckNames?.[mine] ?? "?"}`,
        `KI: ${setup.deckNames?.[theirs] ?? "?"} (${AI_LABELS[setup.ai ?? "heuristic-v1"]})`,
        `Seed: ${setup.options.seed}`,
        result
          ? `Ergebnis: ${result.winner === null ? "Unentschieden" : result.winner === human ? "Gewonnen" : "Verloren"} nach ${turns} Zügen (${REASONS[result.reason]})`
          : `Stand: Zug ${turns}, Partie läuft`,
      ];
  const lines = [
    ...(setup.start ? describeStart(setup.start, human) : []),
    ...describeSteps(engine, session.steps, human),
  ];
  const body = lines.map((l) => (l.kind === "turn" ? `\n${l.text}` : `  ${l.text}`));
  return [...header, "", ...body].join("\n").trimEnd() + "\n";
}

/** File name for an export, e.g. "partie-2026-11-18-ST02-gegen-ST01". */
export function gameFileName(session: GameSession, date = new Date()): string {
  const names = (session.setup.deckNames ?? ["deck", "ki"]).map((n) => n.split(" ")[0]);
  const day = date.toISOString().slice(0, 10);
  return `partie-${day}-${names[session.human === 0 ? 0 : 1]}-gegen-${names[session.human === 0 ? 1 : 0]}`;
}

/** Reads an exported game; throws with a German message if the file isn't one. */
export function parseSavedGame(text: string): SavedSession {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Die Datei ist kein JSON.");
  }
  const s = data as Partial<SavedSession>;
  if (
    s?.version !== 1 ||
    !Array.isArray(s.actions) ||
    !Array.isArray(s.decks) ||
    typeof s.options?.seed !== "number"
  ) {
    throw new Error("Die Datei ist keine exportierte Partie.");
  }
  return s as SavedSession;
}

/** Where a game came from, for the export: a simulated game (job + index) or a game against the AI. */
export interface MatchInfo {
  /** Hash of a simulated game (src/sim/gamehash.ts). */
  hash: string;
  job: SimJob;
  index: number;
  /** Deck ids and AIs by seat. */
  decks: [string, string];
  ai: [AiName, AiName];
}

/** One deck in the export: card numbers with names and copies. */
interface ExportedDeck {
  id?: string;
  name?: string;
  ai?: string;
  cards: { count: number; no: string; name: string }[];
  resources: number;
}

function exportDeck(pool: CardPool, deck: DeckList): ExportedDeck {
  const counts = new Map<string, number>();
  for (const no of deck.main) counts.set(no, (counts.get(no) ?? 0) + 1);
  return {
    cards: [...counts].map(([no, count]) => ({ count, no, name: pool.get(no)?.name ?? "?" })),
    resources: deck.resources.length,
  };
}

/**
 * Everything about a game in one JSON file (user's wish, 20 Nov 2026): the saved game itself (seed, decks,
 * all decisions; loads again in the game tab and runs with `npm run play -- show`), plus under `match` the
 * deck lists with card names, AIs, result, the simulator job and hash for simulated games, and the log.
 */
export function matchExport(
  engine: Engine,
  pool: CardPool,
  session: GameSession,
  info?: MatchInfo,
  date = new Date(),
): SavedSession & { match: Record<string, unknown> } {
  const { setup } = session;
  const result = session.state.result;
  const aiOf = (seat: PlayerId): string | undefined =>
    info ? AI_LABELS[info.ai[seat]] : seat === setup.human ? "Mensch" : AI_LABELS[setup.ai ?? "heuristic-v1"];
  const decks = ([0, 1] as const).map((seat) => {
    const id = info?.decks[seat];
    const name = setup.deckNames?.[seat];
    const ai = aiOf(seat);
    return {
      seat: seat + 1,
      ...(id ? { id } : {}),
      ...(name ? { name } : {}),
      ...(ai ? { ai } : {}),
      ...exportDeck(pool, setup.decks[seat]),
    };
  });
  return {
    ...session.save(),
    match: {
      format: "gcg-battle-simulator/match",
      exportedAt: date.toISOString(),
      source: info ? "simulator" : "game",
      ...(info ? { hash: info.hash, game: info.index } : {}),
      decks,
      firstPlayer: session.state.firstPlayer + 1,
      result: result
        ? {
            winner: result.winner === null ? null : result.winner + 1,
            reason: REASONS[result.reason],
            turns: session.state.turn,
          }
        : null,
      decisions: session.actions.length,
      log: gameLogText(engine, session, date, info).split("\n"),
      ...(info ? { job: info.job } : {}),
    },
  };
}
