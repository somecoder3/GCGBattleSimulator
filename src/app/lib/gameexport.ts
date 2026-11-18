// Export of a game against the AI: the log as readable text, and the game itself as JSON (seed, decks,
// all decisions), which the game screen can load again and `npm run play` can replay.

import { AI_LABELS } from "../../ai/registry";
import type { Engine } from "../../engine/engine";
import type { GameSession, SavedSession } from "../../sim/session";
import type { GameEndReason } from "../../engine/types";
import { describeStart, describeSteps } from "./gamelog";

const REASONS: Record<GameEndReason, string> = {
  damage: "durch Schaden",
  deckOut: "Deck leer",
  turnLimit: "Zuglimit",
  concede: "Aufgabe",
};

/** The game's history as text: a header and the log lines as seen by the human. */
export function gameLogText(engine: Engine, session: GameSession, date = new Date()): string {
  const { setup, human } = session;
  const result = session.state.result;
  const [mine, theirs] = human === 0 ? [0, 1] : [1, 0];
  const header = [
    `GCG Battle Simulator – Partie vom ${date.toLocaleString("de-DE")}`,
    `Du: ${setup.deckNames?.[mine] ?? "?"}`,
    `KI: ${setup.deckNames?.[theirs] ?? "?"} (${AI_LABELS[setup.ai ?? "heuristic-v1"]})`,
    `Seed: ${setup.options.seed}`,
    result
      ? `Ergebnis: ${result.winner === null ? "Unentschieden" : result.winner === human ? "Gewonnen" : "Verloren"} nach ${session.state.turn} Zügen (${REASONS[result.reason]})`
      : `Stand: Zug ${session.state.turn}, Partie läuft`,
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
