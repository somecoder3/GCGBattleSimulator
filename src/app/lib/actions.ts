// How the board offers the engine's options: which card an option belongs to, which second card
// (target) completes it, and a German label for menus and buttons.

import type { Action, AttackTarget, CardId, Decision } from "../../engine/types";

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

/** One-line description of what the decision asks. */
export function decisionText(decision: Decision, name: (id: CardId) => string): string {
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
        default:
          return `${src}: Ziel wählen.`;
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
