// Turns engine events into readable German log lines for the human player. Cards hidden from the
// human at that moment (opponent's hand, decks, shields) are not named.

import type { Engine } from "../../engine/engine";
import type { CardId, GameEvent, GameState, PlayerId } from "../../engine/types";
import { isHiddenFrom } from "../../engine/view";
import type { LogStep } from "../../sim/session";
import type { StartChoice } from "../../sim/start";

export interface LogLine {
  /** Action index this line belongs to (-1 = setup); rollback goes to just before it. */
  index: number;
  /** Whose action caused the line (null = setup). */
  actor: PlayerId | null;
  /** Whom the line is about (the player, or the owner of the card). */
  subject: PlayerId | null;
  kind: "turn" | "info" | "battle" | "important";
  text: string;
  /** Turn number of a "turn" line. */
  turn?: number;
  /** Player whose turn a "turn" line starts. */
  player?: PlayerId;
  /** Caused by an automatic pass. */
  auto?: boolean;
  /** The event the line describes ("attack", "draw" …), or "choice" for a decision without an event. */
  event?: string;
  /** Cards named in the text (visible to the human then), to highlight and show them. */
  cards?: { id: CardId; no: string; name: string }[];
}

const REASONS = {
  damage: "durch Schaden",
  deckOut: "durch leeres Deck",
  turnLimit: "durch das Zuglimit",
  concede: "durch Aufgabe",
};

export function describeSteps(engine: Engine, steps: readonly LogStep[], human: PlayerId): LogLine[] {
  return steps.flatMap((step) => describeStep(engine, step, human));
}

/** The die roll before the game: "Würfeln: Du 5, KI 3. Du darfst wählen, wer beginnt." */
export function describeStart(start: StartChoice, human: PlayerId): LogLine[] {
  const ai = (human === 0 ? 1 : 0) as PlayerId;
  const rolls = start.rolls.map((r) => `Du ${r[human]}, KI ${r[ai]}`).join("; ");
  const chooser = start.winner === human ? "Du darfst" : "Die KI darf";
  return [
    {
      index: -1,
      actor: null,
      subject: start.winner,
      kind: "info",
      text: `Würfeln: ${rolls}. ${chooser} wählen, wer beginnt.`,
    },
  ];
}

export function describeStep(engine: Engine, step: LogStep, human: PlayerId): LogLine[] {
  const s = step.after;
  const lines: LogLine[] = [];
  const who = (p: PlayerId) => (p === human ? "Du" : "KI");
  /** Verb form for "Du" or "KI". */
  const v = (p: PlayerId, du: string, ki: string) => `${who(p)} ${p === human ? du : ki}`;
  // Names used since the last line: they become the line's card references.
  let named: { id: CardId; no: string; name: string }[] = [];
  const name = (id: CardId) => {
    const n = cardName(engine, s, id, human);
    if (n !== HIDDEN_NAME) named.push({ id, no: s.cards[id]!.no, name: n });
    return n;
  };
  const owner = (id: CardId) => s.cards[id]!.owner;
  let subject: PlayerId | null = step.player;
  let event = "choice";
  const add = (kind: LogLine["kind"], text: string, extra: Partial<LogLine> = {}) => {
    const cards = named.filter((c) => text.includes(c.name));
    named = [];
    lines.push({
      index: step.index,
      actor: step.player,
      subject,
      kind,
      text,
      event,
      ...(cards.length ? { cards } : {}),
      ...(step.auto ? { auto: true } : {}),
      ...extra,
    });
  };

  // Decisions without an event of their own get a line, so every human decision can be rolled back.
  if (step.player === human && step.action) {
    const a = step.action;
    const text =
      a.type === "endMain"
        ? "Du beendest die Main Phase."
        : a.type === "pass"
          ? step.auto
            ? "Du passt (automatisch)."
            : "Du passt."
          : a.type === "noBlock"
            ? "Du blockst nicht."
            : a.type === "yes"
              ? "Du wählst Ja."
              : a.type === "no"
                ? "Du wählst Nein."
                : a.type === "done"
                  ? "Du wählst nichts weiter."
                  : a.type === "option"
                    ? `Du wählst „${a.label}“.`
                    : "";
    if (text) add("info", text);
  }

  /** Name of a card the human has seen (looked at), even if it is hidden again now. */
  const seenName = (id: CardId) => {
    const no = s.cards[id]?.no;
    if (!no || !engine.lib.has(no)) return name(id);
    const n = engine.lib.get(no).name;
    named.push({ id, no, name: n });
    return n;
  };
  // Cards the human looked at and put under the deck: one line for all of them.
  const under: CardId[] = [];
  const flushUnder = () => {
    if (!under.length) return;
    const was = event;
    event = "toDeck";
    add("info", `Unter dein Deck: ${under.map(seenName).join(", ")}.`);
    event = was;
    under.length = 0;
  };

  /** In a mulligan step, draws before the first turn are a new opening hand (one line, not five). */
  let redrawing = step.events.some((x) => x.t === "mulligan");
  for (const e of step.events) {
    if (!(e.t === "toDeck" && e.seenBy === human)) flushUnder();
    subject = eventSubject(e, s) ?? step.player;
    event = e.t;
    switch (e.t) {
      case "gameStart":
        add("info", `${v(e.firstPlayer, "beginnst", "beginnt")}.`);
        break;
      case "mulligan":
        add(
          "info",
          e.redraw
            ? `${v(e.player, "ziehst", "zieht")} eine neue Starthand.`
            : `${v(e.player, "behältst", "behält")} die Starthand.`,
        );
        break;
      case "turnStart":
        redrawing = false;
        add("turn", `Zug ${e.turn} · ${e.player === human ? "Du" : "KI"}`, {
          turn: e.turn,
          player: e.player,
        });
        break;
      case "draw":
        // The new hand of a mulligan is one line ("zieht eine neue Starthand"), not five.
        if (s.turn > 0 && !redrawing) add("info", `${v(e.player, "ziehst", "zieht")} ${name(e.card)}.`);
        break;
      case "deploy":
        add("info", `${v(e.player, "setzt", "setzt")} ${name(e.card)} ein.`);
        break;
      case "pair":
        add("info", `${name(e.card)} steigt in ${name(e.unit)}${e.link ? " – Link!" : ""}.`);
        break;
      case "play":
        add("info", `${v(e.player, "spielst", "spielt")} ${name(e.card)}.`);
        break;
      case "effect":
        if (e.origin === "trigger" || e.origin === "activated") add("info", `Effekt von ${name(e.source)}.`);
        break;
      case "attack":
        add(
          "battle",
          `${name(e.attacker)} greift ${e.target === "player" ? (owner(e.attacker) === human ? "die KI" : "dich") : name(e.target)} an.`,
        );
        break;
      case "block":
        add("battle", `${name(e.blocker)} blockt.`);
        break;
      case "damage":
        add("battle", `${name(e.card)} erhält ${e.amount} Schaden.`);
        break;
      case "playerDamage":
        add("important", `${v(e.player, "erhältst", "erhält")} ${e.amount} Schaden.`);
        break;
      case "shieldBreak":
        add("battle", `Schild ${e.player === human ? "von dir" : "der KI"} zerstört: ${name(e.card)}.`);
        break;
      case "destroyed":
        add("battle", `${name(e.card)} wird zerstört.`);
        break;
      case "toTrash":
        if (e.reason === "discard") add("info", `${name(e.card)} abgeworfen.`);
        else if (e.reason === "overflow") add("info", `${name(e.card)} verlässt das Feld (kein Platz).`);
        else if (e.reason === "mill") add("info", `${name(e.card)} vom Deck in den Trash.`);
        break;
      case "removed":
        add("info", `${name(e.card)} wird aus dem Spiel entfernt.`);
        break;
      case "recover":
        add("info", `${name(e.card)} erholt sich um ${e.amount}.`);
        break;
      case "modifier": {
        const parts = [e.ap ? `AP${sign(e.ap)}` : "", e.hp ? `HP${sign(e.hp)}` : ""].filter(Boolean);
        if (parts.length) add("info", `${name(e.card)}: ${parts.join(", ")}.`);
        break;
      }
      case "burst":
        add("important", `Burst: ${name(e.card)}${e.used ? "" : " (nicht genutzt)"}.`);
        break;
      case "ready":
        add("info", `${name(e.card)} wird aktiv.`);
        break;
      case "toHand":
        add(
          "info",
          e.from === "trash"
            ? `${name(e.card)} aus dem Trash auf die Hand.`
            : e.from === "shields"
              ? `Ein Schild geht auf die Hand${isHiddenFrom(s, e.card, human) ? "" : `: ${name(e.card)}`}.`
              : `${name(e.card)} geht auf die Hand zurück.`,
        );
        break;
      case "toDeck":
        if (e.seenBy === human && e.pos === "bottom") under.push(e.card);
        else add("info", `${name(e.card)} kommt ${e.pos === "top" ? "oben" : "unter"} das Deck.`);
        break;
      case "look": {
        const n = e.cards.length === 1 ? "oberste Karte" : `obersten ${e.cards.length} Karten`;
        add(
          "info",
          e.player === human
            ? `Du siehst dir die ${n} deines Decks an: ${e.cards.map(seenName).join(", ")}.`
            : `Die KI sieht sich die ${n} ihres Decks an.`,
        );
        break;
      }
      case "token":
        add("info", `Token ${name(e.card)} erscheint.`);
        break;
      case "exResource":
        add("info", `${v(e.player, "erhältst", "erhält")} eine EX Resource.`);
        break;
      case "reveal":
        add("info", `${v(e.player, "zeigst", "zeigt")} ${e.cards.map(name).join(", ")}.`);
        break;
      case "gameOver": {
        const w = e.result.winner;
        const text = w === null ? "Unentschieden" : w === human ? "Du gewinnst" : "Die KI gewinnt";
        add("important", `Spielende: ${text} ${REASONS[e.result.reason]}.`);
        break;
      }
      default:
        break;
    }
  }
  flushUnder();
  return lines;
}

function eventSubject(e: GameEvent, s: GameState): PlayerId | null {
  if ("player" in e) return e.player;
  if (e.t === "gameStart") return e.firstPlayer;
  const id =
    "card" in e
      ? e.card
      : "attacker" in e
        ? e.attacker
        : "blocker" in e
          ? e.blocker
          : "source" in e
            ? e.source
            : null;
  return id === null ? null : (s.cards[id]?.owner ?? null);
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

const HIDDEN_NAME = "eine Karte";

/** Name of a card, or "eine Karte" if the human can't see it in this state. */
export function cardName(engine: Engine, s: GameState, id: CardId, human: PlayerId): string {
  const card = s.cards[id];
  if (!card || isHiddenFrom(s, id, human)) return HIDDEN_NAME;
  return engine.lib.has(card.no) ? engine.lib.get(card.no).name : card.no;
}

export type Segment = { text: string } | { card: { id: CardId; no: string; name: string } };

/** The text of a line split at the names of its cards, to show them as references. */
export function segments(line: LogLine): Segment[] {
  const out: Segment[] = [];
  let rest = line.text;
  const refs = line.cards ?? [];
  for (;;) {
    let best: { at: number; ref: (typeof refs)[number] } | null = null;
    for (const ref of refs) {
      const at = rest.indexOf(ref.name);
      if (at >= 0 && (!best || at < best.at || (at === best.at && ref.name.length > best.ref.name.length)))
        best = { at, ref };
    }
    if (!best) break;
    if (best.at) out.push({ text: rest.slice(0, best.at) });
    out.push({ card: best.ref });
    rest = rest.slice(best.at + best.ref.name.length);
  }
  if (rest) out.push({ text: rest });
  return out;
}

/** Log filters: battles, effects (and cards played), or everything. */
export const LOG_FILTERS = {
  all: { label: "Alle", events: null },
  battle: {
    label: "Kämpfe",
    events: ["attack", "block", "damage", "playerDamage", "shieldBreak", "destroyed", "gameOver"],
  },
  effects: {
    label: "Effekte",
    events: [
      "effect",
      "burst",
      "modifier",
      "recover",
      "token",
      "look",
      "reveal",
      "toHand",
      "toDeck",
      "removed",
      "play",
    ],
  },
} as const;
