// How the board offers the engine's options: which card an option belongs to, which second card
// (target) completes it, and a German label for menus and buttons.

import type { Action, AttackTarget, CardId, Decision, GameState } from "../../engine/types";

/** The card the player starts an option from (a hand card, an attacking Unit, a target …). */
export function primaryCard(action: Action): CardId | null {
  switch (action.type) {
    case "deployUnit":
    case "pair":
    case "deployBase":
    case "playCommand":
    case "activate":
    case "discard":
    case "target":
      return action.card;
    case "attack":
    case "support":
    case "block":
      return action.unit;
    default:
      return null;
  }
}

/** The second card or the enemy player that completes an option, if any. */
export function secondary(action: Action): AttackTarget | null {
  switch (action.type) {
    case "pair":
      return action.unit;
    case "attack":
      return action.target;
    case "support":
      return action.target;
    case "deployUnit":
      return action.replace ?? null;
    default:
      return null;
  }
}

/** Options shown as buttons rather than on a card. */
export function isButton(action: Action): boolean {
  return primaryCard(action) === null;
}

export function actionLabel(action: Action, name: (id: CardId) => string): string {
  switch (action.type) {
    case "keepHand":
      return "Behalten";
    case "redraw":
      return "Neu ziehen (Mulligan)";
    case "deployUnit":
      if (action.sacrifice !== undefined) return `Günstiger einsetzen, ${name(action.sacrifice)} zerstören`;
      if (action.alt) return "Günstiger einsetzen";
      return action.replace === undefined ? "Einsetzen" : `Einsetzen, ersetzt ${name(action.replace)}`;
    case "pair":
      return `Als Pilot in ${name(action.unit)}`;
    case "deployBase":
      return "Base einsetzen";
    case "playCommand":
      if (action.discard !== undefined) return `Günstiger ausspielen, ${name(action.discard)} abwerfen`;
      return action.alt ? "Günstiger ausspielen" : "Ausspielen";
    case "activate":
      return `Effekt aktivieren${action.effect > 0 ? ` (${action.effect + 1})` : ""}`;
    case "attack":
      return action.target === "player" ? "Spieler angreifen" : `${name(action.target)} angreifen`;
    case "support":
      return `Support für ${name(action.target)}`;
    case "endMain":
      return "Main Phase beenden";
    case "block":
      return "Blocken";
    case "noBlock":
      return "Nicht blocken";
    case "pass":
      return "Passen";
    case "discard":
      return "Abwerfen";
    case "target":
      return "Wählen";
    case "done":
      return "Fertig";
    case "yes":
      return "Ja";
    case "no":
      return "Nein";
    case "option":
      return action.label;
  }
}

/**
 * A choice of cards an effect is making (the engine's `Frame.choosing`): how many are still to choose,
 * how many are chosen, whether choosing is optional, and where the candidates are (for the text).
 */
export interface ChoiceInfo {
  left: number;
  chosen: number;
  optional: boolean;
  /** Exactly `left` cards (or none, if optional). */
  exact: boolean;
  /** Cards that can be chosen now. */
  candidates: number;
  /** "trash", "hand", "battle" … if all candidates are in one zone of the chooser. */
  zone?: string;
}

/** The running choice of a decision, read from the state (undefined for other decisions). */
export function choiceInfo(state: GameState): ChoiceInfo | undefined {
  const pending = state.pending;
  if (pending?.kind !== "effect" || !pending.options.some((o) => o.type === "target")) return undefined;
  const frame = [...state.frames].reverse().find((f) => f.choosing);
  if (!frame?.choosing) return undefined;
  const { as, left, optional, candidates, exact } = frame.choosing;
  const zones = new Set(candidates.map((id) => state.cards[id]?.zone ?? ""));
  const zone = zones.size === 1 ? [...zones][0] : undefined;
  return {
    left,
    chosen: frame.vars[as]?.length ?? 0,
    optional,
    exact: !!exact,
    candidates: candidates.length,
    ...(zone ? { zone } : {}),
  };
}

const ZONE_TEXT: Record<string, string> = {
  trash: " aus deinem Trash",
  hand: " von deiner Hand",
  shieldArea: " aus deiner Schildzone",
};

/** Label of the "done" button: without any card chosen, an optional choice means not using the effect. */
export function doneLabel(choice: ChoiceInfo | undefined): string {
  return choice?.optional && choice.chosen === 0 ? "Nicht nutzen" : "Fertig";
}

/** One-line description of what the decision asks. */
export function decisionText(decision: Decision, name: (id: CardId) => string, choice?: ChoiceInfo): string {
  const src = decision.source !== undefined ? name(decision.source) : "";
  switch (decision.kind) {
    case "mulligan":
      return "Starthand behalten oder einmal neu ziehen?";
    case "main":
      return "Deine Main Phase: Karte wählen, um sie zu spielen oder anzugreifen.";
    case "block":
      return "Die KI greift an. Mit einem <Blocker> blocken?";
    case "action":
      return "Action Step: Command oder Effekt nutzen, oder passen.";
    case "discard":
      return "Zu viele Handkarten: eine Karte abwerfen.";
    case "effect":
      switch (decision.prompt) {
        case "burst":
          return `Burst von ${src} nutzen?`;
        case "may":
          return `${src}: Effekt nutzen?`;
        case "option":
          return `${src}: Möglichkeit wählen.`;
        case "discard":
          return `${src}: Karte abwerfen.`;
        case "lookPick":
          return `${src}: Karte auf die Hand nehmen.`;
        case "lookTop":
          return `${src}: Karte oben aufs Deck legen (der Rest kommt unter das Deck).`;
        case "overflow":
          return "Kein Platz: eine Unit in den Trash legen.";
        case "order":
          return "Mehrere eigene Effekte lösen gleichzeitig aus: welcher zuerst?";
        default: {
          // Found in a game of the user (21 Nov 2026): "Ziel wählen" with a highlighted "Fertig" for Master
          // Gundam's "You may choose 2 (Special Move) Command cards from your trash" looked like confirming
          // the effect, but "Fertig" chose nothing and the effect didn't happen.
          if (!choice) return `${src}: Ziel wählen.`;
          const what = `${choice.left}${choice.chosen > 0 ? " weitere" : ""} ${choice.left === 1 ? "Karte" : "Karten"}`;
          const where = choice.zone && choice.chosen === 0 ? (ZONE_TEXT[choice.zone] ?? "") : "";
          const optional = choice.optional && choice.chosen === 0 ? " Ohne Wahl entfällt der Effekt." : "";
          return `${src}: ${what}${where} wählen.${optional}`;
        }
      }
  }
}

/** The button the space key presses: passing or not blocking first, then ending the main phase. */
export function primaryButton(options: Action[]): Action | undefined {
  const order: Action["type"][] = ["pass", "noBlock", "keepHand", "done", "yes", "endMain"];
  for (const type of order) {
    const o = options.find((a) => a.type === type);
    if (o) return o;
  }
  return undefined;
}
