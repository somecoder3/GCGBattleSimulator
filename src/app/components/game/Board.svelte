<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { crossfade, fade, fly } from "svelte/transition";
  import { cardImageUrl } from "../../../data/cards";
  import CardImage from "../CardImage.svelte";
  import type { FieldDeck } from "../../../ai/opponent";
  import { DIFFICULTIES, makePolicy, type AiName } from "../../../ai/registry";
  import type { CardPool } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import { satisfiesLink } from "../../../engine/cardlib";
  import type { Engine } from "../../../engine/engine";
  import type { Action, AttackTarget, CardId, GameEvent, PlayerId } from "../../../engine/types";
  import { HIDDEN } from "../../../engine/view";
  import type { GameSession, LogStep } from "../../../sim/session";
  import {
    actionLabel,
    choiceInfo,
    decisionText,
    doneLabel,
    isButton,
    primaryButton,
    primaryCard,
    secondary,
  } from "../../lib/actions";
  import {
    LOG_FILTERS,
    cardName,
    describeStart,
    describeSteps,
    segments,
    type LogLine,
  } from "../../lib/gamelog";
  import { gameFileName, gameLogText, matchExport, type MatchInfo } from "../../lib/gameexport";
  import { download } from "../../lib/db";
  import BoardCard from "./BoardCard.svelte";
  import CardInfo from "./CardInfo.svelte";
  import LogIcon from "./LogIcon.svelte";
  import type { KeywordBadge } from "./KeywordIcon.svelte";
  import GameEnd from "./GameEnd.svelte";
  import { summarize } from "../../lib/gamesummary";

  let {
    engine,
    pool,
    session,
    onsave,
    onnew,
    opponentField = [],
    replay = false,
    revealHands = false,
    match,
  }: {
    engine: Engine;
    pool: CardPool;
    session: GameSession;
    onsave: () => void;
    onnew: () => void;
    /** Decks the AI considers for the human (search AI's opponent model). */
    opponentField?: FieldDeck[];
    /** Watching a recorded game: no decisions, no AI turns, no undo. */
    replay?: boolean;
    /** Replay: show the opponent's hand (face up, with details on hover). */
    revealHands?: boolean;
    /** A simulated game: hash, job and AIs for the export. */
    match?: MatchInfo;
  } = $props();

  // The AI knows its own list and the field, never the human's actual deck.
  // svelte-ignore state_referenced_locally
  const ai = makePolicy(session.setup.ai ?? "heuristic-v1", engine, session.setup.options.seed, undefined, {
    deck: session.setup.decks[session.human === 0 ? 1 : 0],
    field: opponentField,
  });
  // svelte-ignore state_referenced_locally
  const human = session.human;
  const enemy: PlayerId = human === 0 ? 1 : 0;

  const SPEEDS = [
    { label: "Langsam", ms: 1100 },
    { label: "Normal", ms: 600 },
    { label: "Schnell", ms: 220 },
    { label: "Sofort", ms: 0 },
  ];

  // The session is a plain object; `view` and `lines` are refreshed after every change.
  // svelte-ignore state_referenced_locally
  let view = $state.raw(session.view());
  let lines = $state.raw<LogLine[]>([]);
  let selected = $state<CardId | null>(null);
  let hovered = $state<CardId | null>(null);
  /** A card held in the detail by a click (cards without options; hovering others still shows them). */
  let pinned = $state<CardId | null>(null);
  let flashed = $state.raw(new Set<CardId>());
  let speed = $state(loadSetting("speed", 600, (v) => SPEEDS.some((sp) => sp.ms === v)));

  // Autopilot (user's wish, 21 Nov 2026): an AI plays the human's side until it is switched off again; it
  // knows the human's deck and, like the opponent AI, only the field of possible enemy decks.
  let autopilot = $state(false);
  let autopilotAi = $state<AiName>(
    loadSetting("autopilot", "heuristic-v1" as AiName, (v) => DIFFICULTIES.some((d) => d.ai === v)),
  );
  const helper = $derived(
    makePolicy(autopilotAi, engine, session.setup.options.seed + 7, undefined, {
      deck: session.setup.decks[human],
      field: opponentField,
    }),
  );

  /** Small settings of the board in localStorage (only a convenience). */
  function loadSetting<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
    try {
      const v = JSON.parse(localStorage.getItem(`gcg-battle-simulator.board.${key}`) ?? "null") as unknown;
      return valid(v) ? (v as T) : fallback;
    } catch {
      return fallback;
    }
  }
  $effect(() => {
    const values = { speed, autopilot: autopilotAi };
    try {
      for (const [k, v] of Object.entries(values))
        localStorage.setItem(`gcg-battle-simulator.board.${k}`, JSON.stringify(v));
    } catch {
      // only a convenience
    }
  });

  // When the game stops for the human in an action step (9-4).
  // When the game stops for the human in an action step (9-4). The engine only asks when the human can
  // play something, so by default every such chance is offered ("Immer"). "Nur eigene Züge" skips the
  // action steps of the own attacks on the player and of the end of turn (never the opponent's attacks).
  type Stops = "always" | "reactive" | "never";
  const STOPS: { value: Stops; label: string }[] = [
    { value: "always", label: "Immer" },
    { value: "reactive", label: "Bei Angriffen der KI" },
    { value: "never", label: "Nie (passen)" },
  ];
  // A new key: the earlier default ("smart") skipped chances to react and is not carried over.
  const STOPS_KEY = "gcg-battle-simulator.stops-v2";
  let stops = $state<Stops>(loadStops());

  function loadStops(): Stops {
    try {
      const v = localStorage.getItem(STOPS_KEY);
      return v === "reactive" || v === "never" ? v : "always";
    } catch {
      return "always";
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(STOPS_KEY, stops);
    } catch {
      // only a convenience
    }
  });

  /** Should the human's pending action step be passed automatically? */
  function skipActionStep(): boolean {
    const pending = session.state.pending;
    if (!pending || pending.player !== human || pending.kind !== "action") return false;
    if (stops === "always") return false;
    if (stops === "never") return true;
    // "reactive": stop whenever the AI attacks or a Unit of yours fights; skip the rest.
    const b = session.state.battle;
    if (!b || session.state.step !== "battleAction") return true;
    return b.attackerOwner === human && b.target === "player";
  }
  let showTrash = $state<PlayerId | null>(null);
  /** On narrow screens the side panel (controls, details, log) is a drawer. */
  let panelOpen = $state(false);
  let logBox = $state<HTMLElement>();
  /** A card named in the log under the pointer (shown in the detail even if hidden on the board now). */
  let peek = $state<CardDef | null>(null);
  type LogFilter = keyof typeof LOG_FILTERS;
  let logFilter = $state<LogFilter>("all");
  function shownInLog(line: LogLine): boolean {
    const events: readonly string[] | null = LOG_FILTERS[logFilter].events;
    return !events || events.includes(line.event ?? "");
  }

  // Cards fly between hand, battle area and base; cards without a counterpart (to the trash, drawn
  // from the deck) shrink and fade, with a red flash when they leave.
  const [send, receive] = crossfade({
    duration: 380,
    fallback: (_node, _params, intro) => ({
      duration: intro ? 260 : 420,
      css: (t) =>
        `opacity:${t};transform:scale(${0.75 + 0.25 * t});` +
        (intro ? "" : `filter:sepia(${1 - t}) saturate(${1 + 3 * (1 - t)}) hue-rotate(-30deg)`),
    }),
  });

  // Short-lived effects of the last step: damage numbers, shaking shield areas, the turn banner.
  let hits = $state.raw(new Map<CardId, { amount: number; n: number }>());
  let shaking = $state.raw(new Set<PlayerId>());
  /** Shield breaks of the last step per player, to play an impact (the number restarts it). */
  let booms = $state.raw(new Map<PlayerId, number>());
  let banner = $state.raw<{ text: string; mine: boolean; n: number } | null>(null);
  let effectN = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

  function animate(step?: LogStep) {
    if (!step) return;
    // Built locally and then assigned as a whole to $state.raw, so plain collections are right here.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const nextHits = new Map<CardId, { amount: number; n: number }>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const nextShake = new Set<PlayerId>();
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const nextBooms = new Map<PlayerId, number>();
    for (const e of step.events) {
      if (e.t === "damage" || e.t === "recover") {
        const amount = (nextHits.get(e.card)?.amount ?? 0) + (e.t === "damage" ? -e.amount : e.amount);
        nextHits.set(e.card, { amount, n: ++effectN });
        const card = step.after.cards[e.card]!;
        if (e.t === "damage" && card.zone === "base") nextShake.add(card.owner);
      } else if (e.t === "shieldBreak" || e.t === "playerDamage") {
        nextShake.add(e.player);
        nextBooms.set(e.player, ++effectN);
      } else if (e.t === "turnStart") {
        banner = {
          text: e.player === human ? "Dein Zug" : "Zug der KI",
          mine: e.player === human,
          n: ++effectN,
        };
        later(1300, () => (banner = null));
      }
    }
    if (nextHits.size) {
      hits = nextHits;
      later(1200, () => (hits = new Map()));
    }
    if (nextBooms.size) {
      booms = nextBooms;
      later(900, () => (booms = new Map()));
    }
    if (nextShake.size) {
      shaking = nextShake;
      later(600, () => (shaking = new Set()));
    }
  }

  onDestroy(() => timers.forEach(clearTimeout));

  // Export of the history: the log as text (clipboard), the game as JSON (can be loaded again).
  let exportNote = $state<string>();
  async function copyLog() {
    try {
      await navigator.clipboard.writeText(gameLogText(engine, session, new Date(), match));
      exportNote = "Verlauf kopiert.";
    } catch (e) {
      exportNote = `Kopieren fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
    }
    later(2500, () => (exportNote = undefined));
  }
  function saveGame() {
    const file = match ? `replay-${match.hash}` : gameFileName(session);
    download(`${file}.json`, JSON.stringify(matchExport(engine, pool, session, match), null, 1));
    exportNote = match
      ? "Exportiert: Decks, alle Entscheidungen, Ergebnis und Verlauf."
      : "Partie gespeichert (im Spiel-Reiter wieder ladbar).";
    later(3500, () => (exportNote = undefined));
  }

  function refresh(step?: LogStep) {
    view = session.view();
    lines = [
      ...(session.setup.start ? describeStart(session.setup.start, human) : []),
      ...describeSteps(engine, session.steps, human),
    ];
    // A card selected only to look at it stays selected while the game goes on (AI steps).
    if (!infoOnly || selected === null || !view.cards[selected]) selected = null;
    flashed = new Set(step && step.player !== human ? touched(step.events) : []);
    reveal(step);
    animate(step);
    onsave();
  }

  // Destroyed Shields are revealed to both players; they are shown for a moment in the middle of the
  // board. The card number comes from the full state, since the card may be hidden again by now
  // (a Burst that goes to the AI's hand).
  type Revealed = { id: CardId; card: CardDef; owner: PlayerId };
  let revealed = $state.raw<Revealed[]>([]);
  let revealTimer: ReturnType<typeof setTimeout> | undefined;
  // Cards the human looked at and put under the deck (Gundam Maxter …), also when none could be taken:
  // shown until the human closes them (the AI waits), so the human knows which cards are gone for now.
  let under = $state.raw<Revealed[]>([]);

  function reveal(step?: LogStep) {
    const card = (id: CardId) => pool.get(session.state.cards[id]!.no);
    const events = step?.events ?? [];
    const fresh = events.flatMap((e): Revealed[] => {
      const c = e.t === "shieldBreak" ? card(e.card) : undefined;
      return c && e.t === "shieldBreak" ? [{ id: e.card, card: c, owner: e.player }] : [];
    });
    const seen = events.flatMap((e): Revealed[] => {
      if (e.t !== "toDeck" || e.seenBy !== human || e.pos !== "bottom") return [];
      const c = card(e.card);
      return c ? [{ id: e.card, card: c, owner: human }] : [];
    });
    if (!step) {
      revealed = [];
      under = [];
    }
    if (seen.length) under = seen;
    if (!fresh.length) return;
    revealed = [...revealed, ...fresh].slice(-4);
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => (revealed = []), 2800);
  }

  onDestroy(() => clearTimeout(revealTimer));

  // ------------------------------------------------------------------------------------------
  // Arrows over the board: the running battle (attacker → target) and, while the human picks a target
  // for an attack, from the attacker to the hovered or dragged-over target.

  let boardEl = $state<HTMLElement>();
  let size = $state({ w: 0, h: 0 });
  type Arrow = { key: string; d: string; kind: "battle" | "aim"; x: number; y: number };
  let arrows = $state.raw<Arrow[]>([]);
  /** Where the menu of the selected card floats: its top left corner in board coordinates. */
  let menuAt = $state<{ x: number; y: number } | null>(null);
  let menuEl = $state<HTMLElement>();
  /** The menu folded to a small tab, so it doesn't cover cards to click (phones; user's wish, 21 Nov). */
  let menuMin = $state(false);
  /** The selected card has no options: the menu only offers its details. */
  let infoOnly = $state(false);
  /** The enemy's shield area under the pointer (aiming at the player). */
  let aimPlayer = $state(false);

  function centerOf(el: Element | null, box: DOMRect) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width) return null;
    return { x: r.left + r.width / 2 - box.left, y: r.top + r.height / 2 - box.top };
  }

  function arrowPath(from: { x: number; y: number }, to: { x: number; y: number }) {
    // A curve that bends sideways, ending a little before the target's center.
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const end = { x: to.x - (dx / len) * 18, y: to.y - (dy / len) * 18 };
    const bend = Math.min(80, len * 0.25);
    const c = { x: (from.x + end.x) / 2 - (dy / len) * bend, y: (from.y + end.y) / 2 + (dx / len) * bend };
    return { d: `M ${from.x} ${from.y} Q ${c.x} ${c.y} ${end.x} ${end.y}`, mid: c };
  }

  function placeArrows() {
    if (!boardEl) return;
    const box = boardEl.getBoundingClientRect();
    size = { w: box.width, h: box.height };
    const card = (id: CardId) => boardEl!.querySelector(`[data-card="${id}"]`);
    const shields = (p: PlayerId) => boardEl!.querySelector(`[data-shields="${p}"] .shields`);
    const list: Arrow[] = [];
    const b =
      view.battle ?? (announced ? { ...announced, attackerOwner: enemy as PlayerId, blocked: false } : null);
    if (b) {
      const from = centerOf(card(b.attacker), box);
      const to = centerOf(
        b.target === "player" ? shields(b.attackerOwner === 0 ? 1 : 0) : card(b.target),
        box,
      );
      if (from && to) {
        const { d, mid } = arrowPath(from, to);
        list.push({ key: `b${b.attacker}`, d, kind: "battle", x: mid.x, y: mid.y });
      }
    }
    if (selected !== null) {
      const over = drag?.over;
      const goal =
        over === "player" || (over === undefined && aimPlayer)
          ? "player"
          : over !== null && over !== undefined && over !== "field"
            ? Number(over)
            : hovered;
      const aims = selectedOptions.some((o) => o.type === "attack" && o.target === goal);
      if (goal !== null && aims) {
        const from = centerOf(card(selected), box);
        const to = centerOf(goal === "player" ? shields(enemy) : card(goal), box);
        if (from && to) {
          const { d, mid } = arrowPath(from, to);
          list.push({ key: "aim", d, kind: "aim", x: mid.x, y: mid.y });
        }
      }
    }
    arrows = list;
    const el = selected !== null ? card(selected) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      const w = menuEl?.offsetWidth || 220;
      const h = menuEl?.offsetHeight || 150;
      let x: number;
      let y: number;
      if (el.closest(".hand")) {
        // Above the hand card.
        x = r.left + r.width / 2 - box.left - w / 2;
        y = r.top - box.top - 8 - h;
      } else {
        // Beside a card on the field, so the targets stay visible.
        const right = r.right - box.left + 12;
        x = right + w < box.width ? right : r.left - box.left - 12 - w;
        y = r.top - box.top + r.height / 2 - h / 2;
      }
      // Always completely on the screen (user, 21 Nov 2026): inside the board and the window.
      const minX = Math.max(0, -box.left) + 8;
      const maxX = Math.min(box.width, innerWidth - box.left) - w - 8;
      const minY = Math.max(0, -box.top) + 8;
      const maxY = Math.min(box.height, innerHeight - box.top) - h - 8;
      menuAt = {
        x: Math.max(minX, Math.min(x, maxX)),
        y: Math.max(minY, Math.min(y, maxY)),
      };
    } else menuAt = null;
  }

  $effect(() => {
    void [view, selected, hovered, aimPlayer, drag?.over, menuEl, menuMin, announced];
    placeArrows();
    // Cards move with an animation (flip, rest): place again when they have settled.
    const t = setTimeout(placeArrows, 360);
    return () => clearTimeout(t);
  });

  $effect(() => {
    if (!boardEl) return;
    const ro = new ResizeObserver(() => placeArrows());
    ro.observe(boardEl);
    if (menuEl) ro.observe(menuEl);
    return () => ro.disconnect();
  });

  // A new selection opens the menu unfolded.
  $effect(() => {
    void selected;
    menuMin = false;
  });

  onMount(refresh);

  /** Cards an AI action affected, to highlight them. */
  function touched(events: GameEvent[]): CardId[] {
    const ids: CardId[] = [];
    for (const e of events) {
      if (e.t === "deploy" || e.t === "play" || e.t === "damage" || e.t === "token") ids.push(e.card);
      else if (e.t === "attack") {
        ids.push(e.attacker);
        if (e.target !== "player") ids.push(e.target);
      } else if (e.t === "block") ids.push(e.blocker);
      else if (e.t === "pair") ids.push(e.unit);
    }
    return ids;
  }

  /** An attack of the AI shown before it happens (arrow and highlighted attacker). */
  let announced = $state<{ attacker: CardId; target: AttackTarget } | null>(null);
  const ANNOUNCE_MS = 1100;

  // AI turns: one decision at a time with a short pause, so the human can follow. Action steps the
  // human doesn't want to stop in are passed automatically (marked, so undo skips them).
  $effect(() => {
    void view;
    void stops;
    if (replay) return;
    // While destroyed Shields are shown, nobody acts: neither the AI nor the autopilot nor automatic passes
    // (user's wish, 21 Nov 2026). The overlay closes after 2.8 s or with a click; then the game goes on.
    if (revealed.length) return;
    if (autopilot && !session.over && session.state.pending?.player === human) {
      // The autopilot also closes the cards put under the deck after a moment.
      if (under.length) {
        const timer = setTimeout(() => (under = []), Math.max(speed, 1500));
        return () => clearTimeout(timer);
      }
      const policy = helper;
      const timer = setTimeout(
        () => refresh(session.apply(session.choiceFor(policy))),
        session.state.pending.kind === "mulligan" ? Math.min(speed, 300) : speed,
      );
      return () => clearTimeout(timer);
    }
    if (under.length) return; // the human first closes the cards put under the deck
    if (skipActionStep()) {
      const timer = setTimeout(() => refresh(session.apply({ type: "pass" }, true)), Math.min(speed, 150));
      return () => clearTimeout(timer);
    }
    if (!session.aiToAct) return;
    const kind = session.state.pending!.kind;
    const delay = kind === "mulligan" ? Math.min(speed, 300) : speed;
    let battle: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      const action = session.aiChoice(ai);
      if (action.type !== "attack") return refresh(session.apply(action));
      // An attack of the AI is announced: the arrow stays a moment before the battle runs (user's wish,
      // 21 Nov 2026: without a chance to react, the whole battle happened in one step).
      announced = { attacker: action.unit, target: action.target };
      battle = setTimeout(() => {
        announced = null;
        refresh(session.apply(action));
      }, ANNOUNCE_MS);
    }, delay);
    return () => {
      clearTimeout(timer);
      clearTimeout(battle);
      announced = null;
    };
  });

  $effect(() => {
    void lines;
    logBox?.scrollTo({ top: logBox.scrollHeight });
  });

  const decision = $derived(
    !replay && !autopilot && view.pending && view.pending.player === human ? view.pending : null,
  );
  // The game is over: the autopilot stops.
  $effect(() => {
    if (view.result) autopilot = false;
  });
  const options = $derived(withCopies(decision?.options ?? []));

  /**
   * The engine lists one copy per card number from the hand; every copy is selectable on the board (user's
   * wish, 21 Nov 2026) and plays itself (`Engine.isCopyOfOption`).
   */
  function withCopies(list: Action[]): Action[] {
    const hand = view.players[human].hand;
    const out = [...list];
    for (const o of list) {
      if (!("card" in o) || view.cards[o.card]?.zone !== "hand") continue;
      const no = view.cards[o.card]!.no;
      for (const id of hand) {
        if (id === o.card || view.cards[id]!.no !== no) continue;
        out.push({ ...o, card: id } as Action);
      }
    }
    return out;
  }
  const buttons = $derived(options.filter(isButton));
  /** A running choice of cards (how many, optional): for the text and the "done" button. */
  const choice = $derived(decision ? choiceInfo(session.state) : undefined);
  // Without any card chosen, "done" skips the effect: never the button of the space key then.
  const spaceAction = $derived(
    primaryButton(
      choice?.optional && choice.chosen === 0 ? buttons.filter((o) => o.type !== "done") : buttons,
    ),
  );
  const buttonLabel = (o: Action) => (o.type === "done" ? doneLabel(choice) : actionLabel(o, name));

  // Choosing cards for an effect: taps only collect them (again: remove), "Bestätigen" applies them (user's
  // wish, 21 Nov 2026: the first tap of two had already resolved the effect, a wrong tap couldn't be undone).
  let staged = $state<CardId[]>([]);
  /** The last card tapped in a choice: shown in the detail (and on the phone with "Karte ansehen"). */
  let stagedLook = $state<CardId | null>(null);
  const staging = $derived(!!choice);
  /** How many cards a confirmation needs: exactly the number (or all there are), or 1 … that many. */
  const stageMax = $derived(choice ? Math.min(choice.left, choice.candidates) : 0);
  const canConfirm = $derived.by(() => {
    if (!choice || !staged.length) return false;
    const upTo = choice.optional && !choice.exact;
    return upTo ? staged.length <= stageMax : staged.length === stageMax;
  });
  $effect(() => {
    void decision;
    staged = [];
    stagedLook = null;
  });

  function stage(id: CardId) {
    stagedLook = id;
    pinned = id;
    if (staged.includes(id)) staged = staged.filter((x) => x !== id);
    else if (stageMax === 1) staged = [id];
    else if (staged.length < stageMax) staged = [...staged, id];
  }

  /** Applies the collected cards one by one (the engine asks for each), then "done" if it still asks. */
  function confirmStaged() {
    if (!decision || !canConfirm) return;
    const source = decision.source;
    let step: LogStep | undefined;
    for (const id of staged) {
      const pending = session.state.pending;
      if (!pending || pending.player !== human || pending.source !== source) break;
      const option = withCopies(pending.options).find((o) => o.type === "target" && o.card === id);
      if (!option) break;
      step = session.apply(option);
    }
    const pending = session.state.pending;
    const info = choiceInfo(session.state);
    if (pending?.player === human && pending.source === source && info && info.chosen > 0) {
      const done = pending.options.find((o) => o.type === "done");
      if (done) step = session.apply(done);
    }
    refresh(step);
  }
  const selectedOptions = $derived(
    selected === null ? [] : options.filter((o) => primaryCard(o) === selected),
  );
  const legal = $derived(new Set(options.map(primaryCard).filter((id): id is CardId => id !== null)));
  const targets = $derived(new Set(selectedOptions.map(secondary)));
  /** Target cards that are not on the board (trash, looked-at cards …), shown in the prompt. */
  const offBoard = $derived(
    options.flatMap((o) => {
      if (o.type !== "target") return [];
      const zone = view.cards[o.card]!.zone;
      const onBoard =
        zone === "battle" || zone === "base" || (zone === "hand" && view.cards[o.card]!.owner === human);
      return onBoard ? [] : [o.card];
    }),
  );
  const me = $derived(view.players[human]);
  const opp = $derived(view.players[enemy]);
  const myTurn = $derived(view.active === human);
  const result = $derived(view.result);
  const canUndo = $derived.by(() => {
    void view;
    return session.canUndo;
  });

  function def(id: CardId): CardDef | undefined {
    let no = view.cards[id]!.no;
    // Replay with open hands: the opponent's hand cards come from the full state.
    if (no === HIDDEN && revealHands && view.cards[id]!.zone === "hand") no = session.state.cards[id]!.no;
    return no === HIDDEN ? undefined : pool.get(no);
  }

  const name = (id: CardId) => cardName(engine, view, id, human);

  // Values with effects come from the full state (they are public); reading `view` keeps them reactive.
  function stats(id: CardId) {
    const card = view.cards[id]!;
    const d = engine.card(session.state, id);
    const pilot = card.pilot === null ? null : engine.card(session.state, card.pilot);
    return {
      ap: engine.ap(session.state, id),
      hp: engine.hp(session.state, id),
      damage: card.damage,
      baseAp: d.ap + (pilot?.ap ?? 0),
      baseHp: d.hp + (pilot?.hp ?? 0),
      showAp: d.type !== "BASE" && d.type !== "EX BASE",
    };
  }

  const KW_ORDER = [
    "blocker",
    "firstStrike",
    "highManeuver",
    "suppression",
    "breach",
    "repair",
    "support",
  ] as const;

  /** Keywords a Unit has right now (printed, from its Pilot/Link, or given by an effect for a while). */
  function keywordBadges(id: CardId): KeywordBadge[] {
    if (view.cards[id]!.zone !== "battle") return [];
    const now = engine.keywords(session.state, id);
    const printed = engine.card(session.state, id).keywords;
    const out: KeywordBadge[] = [];
    for (const key of KW_ORDER) {
      const v = now[key];
      if (!v) continue;
      const amount = typeof v === "number" ? v : 0;
      const temporary = session.state.modifiers.some((m) => m.target === id && m.keyword === key);
      out.push({ key, amount, granted: printed[key] !== v, temporary });
    }
    return out;
  }

  /** Own cards that would link with the hovered/selected own card: a Pilot (or Command with 【Pilot】) and
   *  Units in hand or on the field without a Pilot, or a Unit in hand and the Pilots in hand. */
  const linkHints = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt on every change, never mutated later
    const out = new Set<CardId>();
    const src = hovered ?? selected;
    if (src === null || replay) return out;
    const c = view.cards[src];
    if (!c || c.owner !== human || (c.zone !== "hand" && c.zone !== "battle")) return out;
    const me = engine.card(session.state, src);
    const isUnit = (id: CardId) => engine.card(session.state, id).type === "UNIT";
    if (c.zone === "hand" && me.pairable) {
      for (const id of [...view.players[human].hand, ...view.players[human].battle]) {
        if (id === src || !isUnit(id) || view.cards[id]!.pilot !== null) continue;
        if (satisfiesLink(engine.card(session.state, id), me)) out.add(id);
      }
    } else if (me.type === "UNIT" && c.pilot === null) {
      for (const id of view.players[human].hand) {
        const other = engine.card(session.state, id);
        if (id !== src && other.pairable && satisfiesLink(me, other)) out.add(id);
      }
    }
    return out;
  });

  function pilotOf(id: CardId) {
    const p = view.cards[id]!.pilot;
    if (p === null) return null;
    return {
      card: def(p),
      link: engine.isLinked(session.state, id),
      // Hovering the visible edge of the Pilot shows the Pilot; moving back onto the Unit shows the Unit.
      onhover: (on: boolean) => (hovered = on ? p : id),
    };
  }

  function battleRole(id: CardId): "" | "attacker" | "defender" {
    const b = view.battle ?? announced;
    if (!b) return "";
    return b.attacker === id ? "attacker" : b.target === id ? "defender" : "";
  }

  function cardState(id: CardId): "" | "legal" | "selected" | "target" {
    if (staging) return staged.includes(id) ? "selected" : legal.has(id) ? "legal" : "";
    if (id === selected) return "selected";
    if (targets.has(id)) return "target";
    if (selected === null && legal.has(id)) return "legal";
    return "";
  }

  /**
   * A play that would spend EX Resources because the normal ones are not enough waits for a confirmation
   * (user's wish, 23 Nov 2026: a miscounted Resource must not cost a level by accident). Choosing
   * "… (mit EX Resource)" on purpose asks nothing.
   */
  let exConfirm = $state<{ action: Action; ex: number; cost: number; level: number } | null>(null);
  $effect(() => {
    void decision;
    exConfirm = null;
  });

  /** EX Resources an action spends only because the normal ones are short (0 if none). */
  function forcedEx(action: Action): number {
    if (("ex" in action && action.ex) || !engine.spendsEx(session.state, human, action)) return 0;
    const cost = engine.resourceCost(session.state, human, action);
    const active = session.state.players[human].resources.filter((id) => !session.state.cards[id]!.rested);
    const normal = active.filter((id) => !session.state.cards[id]!.token).length;
    return Math.max(0, cost - normal);
  }

  function act(action: Action, confirmed = false) {
    if (!decision) return;
    const ex = confirmed ? 0 : forcedEx(action);
    if (ex > 0) {
      const level = session.state.players[human].resources.length;
      exConfirm = { action, ex, cost: engine.resourceCost(session.state, human, action), level };
      selected = null; // the card's menu closes, the question is on top
      return;
    }
    exConfirm = null;
    refresh(session.apply(action));
  }

  /** Options that need no second click: answers to a question (choosing a target, blocking, discarding).
   *  Playing a card (deploy, pair, command, activate) always opens the menu first (user's wish: a click on a
   *  hand card must never play it by itself). */
  function immediate(o: Action): boolean {
    return (o.type === "target" || o.type === "discard" || o.type === "block") && secondary(o) === null;
  }

  function clickCard(id: CardId) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (staging && options.some((o) => o.type === "target" && o.card === id)) return stage(id);
    if (decision && selected !== null) {
      const complete = selectedOptions.filter((o) => secondary(o) === id);
      if (complete.length === 1) return act(complete[0]!);
      if (id === selected) {
        selected = null;
        return;
      }
    }
    const own = decision ? options.filter((o) => primaryCard(o) === id) : [];
    if (!own.length) {
      // A card without options: it is selected anyway, the menu offers its details (on the phone the
      // detail is in the drawer; user, 21 Nov 2026), and the detail holds it (again: release).
      const again = selected === id;
      selected = again ? null : id;
      pinned = again ? null : id;
      infoOnly = !again;
      return;
    }
    pinned = null;
    infoOnly = false;
    if (own.length === 1 && immediate(own[0]!)) return act(own[0]!);
    selected = id;
  }

  // ------------------------------------------------------------------------------------------
  // Drag and drop (mouse and touch): a card with options is picked up after a few pixels; dropping it on
  // a highlighted target completes the option, on the own field it deploys/plays it.

  let drag = $state<{ id: CardId; x: number; y: number; over: string | null } | null>(null);
  let pressed: { id: CardId; x: number; y: number; pointer: number } | null = null;
  let suppressClick = false;

  function dropKey(el: Element | null): string | null {
    return el?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;
  }

  /** The option a drop on `key` ("player", "field" or a card id) completes. */
  function dropAction(id: CardId, key: string | null): Action | undefined {
    if (key === null) return undefined;
    const own = options.filter((o) => primaryCard(o) === id);
    if (key === "field") return own.length === 1 && secondary(own[0]!) === null ? own[0] : undefined;
    const target = key === "player" ? "player" : Number(key);
    const matching = own.filter((o) => secondary(o) === target);
    return matching.length === 1 ? matching[0] : undefined;
  }

  function onpointerdown(e: PointerEvent, id: CardId) {
    // In a choice of cards a tap only collects (no drag that would apply it at once).
    if (!decision || staging || !legal.has(id) || e.button !== 0) return;
    pressed = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  }

  function onpointermove(e: PointerEvent) {
    if (!pressed || e.pointerId !== pressed.pointer) return;
    if (!drag) {
      if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) < 10) return;
      selected = pressed.id; // highlights the targets
      drag = { id: pressed.id, x: e.clientX, y: e.clientY, over: null };
    }
    const under =
      document.elementsFromPoint(e.clientX, e.clientY).find((el) => !el.closest(".drag-ghost")) ?? null;
    drag = { ...drag, x: e.clientX, y: e.clientY, over: dropKey(under) };
  }

  function onpointerup(e: PointerEvent) {
    if (!pressed || e.pointerId !== pressed.pointer) return;
    const current = drag;
    pressed = null;
    drag = null;
    if (!current) return; // a plain click
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    const action = dropAction(current.id, current.over);
    if (action) act(action);
    else selected = null;
  }

  function clickEnemyPlayer() {
    const attack = selectedOptions.find((o) => o.type === "attack" && o.target === "player");
    if (attack) act(attack);
  }

  function undo() {
    if (!canUndo) return;
    session.undo();
    refresh();
  }

  function rollbackTo(index: number) {
    session.rollbackTo(index);
    refresh();
  }

  /** Rollback points: the first log line of each human action, and the start of the human's turns. */
  function rollbackIndex(line: LogLine, i: number): number | undefined {
    if (replay) return undefined;
    if (line.kind === "turn") return line.player === human ? session.turnStart(line.turn!) : undefined;
    if (line.actor !== human || line.index < 0 || line.auto) return undefined;
    return lines[i - 1]?.index === line.index ? undefined : line.index;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if (exConfirm) {
      if (e.key === "Escape") exConfirm = null;
      else if (e.key === "Enter" && !e.repeat) {
        e.preventDefault();
        act(exConfirm.action, true);
      }
    } else if (e.key === "Escape" && showTrash !== null) {
      showTrash = null;
    } else if (e.key === "Escape") {
      selected = null;
      pinned = null;
      showTrash = null;
    } else if (e.key === " " && staging && canConfirm && !e.repeat) {
      e.preventDefault();
      confirmStaged();
    } else if (e.key === " " && spaceAction && !e.repeat) {
      e.preventDefault();
      act(spaceAction);
    }
  }

  const STEP_NAMES: Record<string, string> = {
    mulligan: "Vorbereitung",
    startTurn: "Start Phase",
    draw: "Draw Phase",
    resource: "Resource Phase",
    main: "Main Phase",
    attack: "Angriff",
    block: "Block Step",
    battleAction: "Action Step (Kampf)",
    damage: "Damage Step",
    battleEnd: "Kampfende",
    endAction: "Action Step (Zugende)",
    endStep: "End Phase",
    handStep: "Hand Step",
    cleanup: "Cleanup",
    over: "Spielende",
  };

  /** The five phases of a turn (7-1) for the phase bar; battle and end steps are shown as a sub-step. */
  const PHASES = [
    { key: "start", label: "Start", steps: ["startTurn"] },
    { key: "draw", label: "Draw", steps: ["draw"] },
    { key: "resource", label: "Resource", steps: ["resource"] },
    { key: "main", label: "Main", steps: ["main", "attack", "block", "battleAction", "damage", "battleEnd"] },
    { key: "end", label: "End", steps: ["endAction", "endStep", "handStep", "cleanup"] },
  ];
  const phaseIndex = $derived(PHASES.findIndex((ph) => ph.steps.includes(view.step)));
  const substep = $derived(
    ["attack", "block", "battleAction", "damage", "battleEnd", "endAction", "handStep"].includes(view.step)
      ? STEP_NAMES[view.step]
      : "",
  );
  const aiLabel = DIFFICULTIES.find((d) => d.ai === (session.setup.ai ?? "heuristic-v1"))?.label ?? "";
  const autopilotLabel = $derived(DIFFICULTIES.find((d) => d.ai === autopilotAi)?.label ?? "");

  const activeResources = (ids: CardId[]) => ids.filter((id) => !view.cards[id]!.rested).length;
  const detailId = $derived(hovered ?? selected ?? pinned);
  const battleInfo = $derived.by(() => {
    const b = view.battle ?? (announced ? { ...announced, attackerOwner: enemy } : null);
    if (!b) return "";
    return `${name(b.attacker)} greift ${b.target === "player" ? (b.attackerOwner === human ? "die KI" : "dich") : name(b.target)} an`;
  });
  /** The end screen is hidden to look at the final position. */
  let endHidden = $state(false);
  $effect(() => {
    if (!result) endHidden = false;
  });
  const summary = $derived.by(() => {
    void view;
    return result ? summarize(engine, session.steps, human) : null;
  });
</script>

<svelte:window {onkeydown} {onpointermove} {onpointerup} onpointercancel={onpointerup} />

{#snippet mat(p: PlayerId)}
  {@const player = view.players[p]}
  {@const top = player.trash.length ? def(player.trash[player.trash.length - 1]!) : undefined}
  <div
    class="mat"
    class:mine={p === human}
    class:active={view.active === p && !result && view.step !== "mulligan"}
    aria-label={p === human ? "Deine Seite" : "Seite der KI"}
  >
    <div
      class="zone shieldzone"
      data-shields={p}
      data-drop={p === enemy ? "player" : undefined}
      class:over={drag !== null && p === enemy && drag.over === "player"}
      class:shake={shaking.has(p)}
      class:defender={view.battle?.target === "player" && view.battle.attackerOwner !== p}
      class:target={p === enemy && targets.has("player")}
      role="button"
      tabindex={p === enemy && targets.has("player") ? 0 : -1}
      aria-label={p === enemy ? "KI angreifen" : "Deine Schilde"}
      onclick={() => p === enemy && clickEnemyPlayer()}
      onkeydown={(e) => e.key === "Enter" && p === enemy && clickEnemyPlayer()}
      onpointerenter={() => p === enemy && (aimPlayer = true)}
      onpointerleave={() => p === enemy && (aimPlayer = false)}
    >
      <span class="zlabel">Schilde</span>
      <div class="shields" title="{player.shields.length} Schilde">
        {#each player.shields as id, i (id)}
          <span class="shield" style="--i:{i}" out:fade={{ duration: 300 }}></span>
        {/each}
        <strong class="count" class:low={player.shields.length <= 2}>{player.shields.length}</strong>
        {#if booms.has(p)}
          {#key booms.get(p)}<span class="boom" aria-hidden="true"></span>{/key}
        {/if}
      </div>
      <div class="base">
        {#each player.base as id (id)}
          <!-- Dragging only adds to the card button inside; keyboard and screen readers use the button. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            in:receive={{ key: id }}
            out:send={{ key: id }}
            class="draggable"
            class:dragging={drag?.id === id}
            data-card={id}
            onpointerdown={(e) => onpointerdown(e, id)}
          >
            <BoardCard
              card={def(id)}
              stats={stats(id)}
              rested={view.cards[id]!.rested}
              state={cardState(id)}
              flash={flashed.has(id)}
              hit={hits.get(id) ?? null}
              onclick={() => clickCard(id)}
              onhover={(on) => (hovered = on ? id : null)}
            />
          </div>
        {:else}
          <span class="empty">Keine Base</span>
        {/each}
      </div>
    </div>
    <div
      class="zone battlezone"
      data-drop={p === human ? "field" : undefined}
      class:over={drag !== null && p === human && drag.over === "field"}
      class:droppable={p === human && drag !== null && !!dropAction(drag.id, "field")}
    >
      <span class="zlabel">Battle Area <small>{player.battle.length}/6</small></span>
      <div class="battle">
        {#each player.battle as id (id)}
          <!-- Dragging only adds to the card button inside; keyboard and screen readers use the button. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="unit draggable"
            class:dragging={drag?.id === id}
            data-drop={id}
            data-card={id}
            animate:flip={{ duration: 300 }}
            in:receive={{ key: id }}
            out:send={{ key: id }}
            onpointerdown={(e) => onpointerdown(e, id)}
          >
            <BoardCard
              card={def(id)}
              stats={stats(id)}
              rested={view.cards[id]!.rested}
              pilot={pilotOf(id)}
              keywords={keywordBadges(id)}
              linkHint={linkHints.has(id)}
              state={cardState(id)}
              flash={flashed.has(id)}
              battle={battleRole(id)}
              hit={hits.get(id) ?? null}
              onclick={() => clickCard(id)}
              onhover={(on) => (hovered = on ? id : null)}
            />
          </div>
        {/each}
        {#each { length: Math.max(0, 6 - player.battle.length) } as _, i (i)}
          <div class="unit placeholder" aria-hidden="true"></div>
        {/each}
      </div>
    </div>
    <div class="zone reszone" title="Level = Anzahl Ressourcen; aktive Ressourcen bezahlen Kosten">
      <span class="zlabel">Ressourcen</span>
      <span class="level">Lv <strong>{player.resources.length}</strong></span>
      <div class="res-cards" style="--n: {Math.max(1, player.resources.length)}">
        {#each player.resources as id (id)}
          {@const c = def(id)}
          <span
            class="res-card"
            class:rested={view.cards[id]!.rested}
            class:ex={view.cards[id]!.no === "EXR-001"}
            in:fly={{ y: p === human ? 20 : -20, duration: 300 }}
          >
            {#if c}<CardImage card={c} src={cardImageUrl(c, "small")} eager />{/if}
          </span>
        {/each}
      </div>
      <span class="res-count"
        ><strong>{activeResources(player.resources)}</strong>/{player.resources.length} aktiv</span
      >
    </div>
    <div class="piles">
      <div class="pile" title="Deck: {player.deck.length} Karten">
        <span class="pile-card back-card"></span>
        <span class="pile-count">{player.deck.length}</span>
        <small>Deck</small>
      </div>
      <button
        class="pile"
        class:open={showTrash === p}
        onclick={() => (showTrash = showTrash === p ? null : p)}
        title="Trash ansehen ({player.trash.length})"
      >
        {#if top}
          <span class="pile-card"><CardImage card={top} src={cardImageUrl(top, "small")} eager /></span>
        {:else}
          <span class="pile-card empty-pile"></span>
        {/if}
        <span class="pile-count">{player.trash.length}</span>
        <small>Trash</small>
      </button>
    </div>
  </div>
{/snippet}

<div class="game">
  <section class="board" aria-label="Spielfeld" bind:this={boardEl}>
    <div class="plate enemy-plate">
      <span class="avatar" aria-hidden="true">KI</span>
      <span class="pname">KI <small>{aiLabel}</small></span>
      <div class="opp-hand" aria-label="Hand der KI: {opp.hand.length} Karten">
        {#if revealHands}
          {#each opp.hand as id (id)}
            {@const open = def(id)}
            {#if open}
              <button
                class="mini-face"
                class:hot={hovered === id}
                title={open.name}
                onpointerenter={() => (hovered = id)}
                onpointerleave={() => (hovered = null)}
                onclick={() => (pinned = pinned === id ? null : id)}
              >
                <CardImage card={open} src={cardImageUrl(open, "small")} eager />
              </button>
            {/if}
          {/each}
        {:else}
          {#each opp.hand as id (id)}
            <span class="mini-back" animate:flip={{ duration: 250 }} in:fly={{ y: -12, duration: 250 }}
            ></span>
          {/each}
        {/if}
      </div>
      <span class="plate-info">Hand <strong>{opp.hand.length}</strong></span>
    </div>
    {@render mat(enemy)}

    <div class="center" class:waiting={!decision && !result}>
      <div class="turnbar">
        <span class="turn-pill" class:mine={myTurn}>
          Zug {view.turn} · {view.step === "mulligan" ? "Vorbereitung" : myTurn ? "Du" : "KI"}
        </span>
        <ol class="phases" class:mine={myTurn} aria-label="Phasen">
          {#each PHASES as ph, i (ph.key)}
            <li class:now={phaseIndex === i} class:done={phaseIndex > i}>{ph.label}</li>
          {/each}
        </ol>
        {#if substep}<span class="substep">{substep}</span>{/if}
        {#if !replay && !result}
          <button
            class="autopilot-toggle"
            class:on={autopilot}
            onclick={() => {
              autopilot = !autopilot;
              selected = null;
            }}
            aria-pressed={autopilot}
            title="Eine KI spielt für dich ({autopilotLabel}); KI und Tempo unter ☰ bzw. in der Seitenleiste"
          >
            🤖 {autopilot ? "Autopilot an" : "Autopilot"}
          </button>
        {/if}
        <button class="panel-toggle" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen}>
          ☰ Log &amp; Details
        </button>
      </div>
      <div class="ask">
        {#if battleInfo}<p class="battle-info">⚔ {battleInfo}</p>{/if}
        {#if result}
          <p class="prompt">Spielende.</p>
        {:else if decision}
          <p class="prompt">{decisionText(decision, name, choice)}</p>
          {#if offBoard.length}
            <div class="choices">
              {#each offBoard as id (id)}
                <BoardCard
                  card={def(id)}
                  state={staged.includes(id) ? "selected" : "legal"}
                  onclick={() => clickCard(id)}
                  onhover={(on) => (hovered = on ? id : null)}
                />
              {/each}
            </div>
          {/if}
        {:else if replay}
          <p class="prompt">Replay (Sicht von Sitz 1)</p>
        {:else if autopilot && view.pending?.player === human}
          <p class="prompt thinking">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> Autopilot ({autopilotLabel})
            spielt für dich …
          </p>
        {:else}
          <p class="prompt thinking">
            <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span> KI denkt nach …
          </p>
        {/if}
      </div>
      <div class="buttons">
        {#if decision && staging}
          {#if staged.length}
            <button class="btn primary" disabled={!canConfirm} onclick={confirmStaged}>
              Bestätigen ({staged.length}/{stageMax}){#if canConfirm}<kbd>Leertaste</kbd>{/if}
            </button>
          {/if}
          {#if stagedLook !== null}
            <button class="btn look-btn" onclick={() => (panelOpen = true)}>ⓘ Karte ansehen</button>
          {/if}
          {#each buttons as o (JSON.stringify(o))}
            {#if !(o.type === "done" && staged.length)}
              <button class="btn" class:primary={o === spaceAction && !staged.length} onclick={() => act(o)}>
                {buttonLabel(o)}{#if o === spaceAction && !staged.length}<kbd>Leertaste</kbd>{/if}
              </button>
            {/if}
          {/each}
        {:else if decision}
          {#each buttons as o (JSON.stringify(o))}
            <button class="btn" class:primary={o === spaceAction} onclick={() => act(o)}>
              {buttonLabel(o)}{#if o === spaceAction}<kbd>Leertaste</kbd>{/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>

    {@render mat(human)}
    <div class="hand" aria-label="Deine Hand" style="--n: {Math.max(2, me.hand.length)}">
      {#each me.hand as id, i (id)}
        <!-- Dragging only adds to the card button inside; keyboard and screen readers use the button. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="hand-card draggable"
          class:dragging={drag?.id === id}
          class:raised={selected === id}
          style="--k: {i - (me.hand.length - 1) / 2}; --ak: {Math.abs(i - (me.hand.length - 1) / 2)}"
          data-card={id}
          onpointerdown={(e) => onpointerdown(e, id)}
          animate:flip={{ duration: 300 }}
          in:receive={{ key: id }}
          out:send={{ key: id }}
        >
          <BoardCard
            card={def(id)}
            state={cardState(id)}
            linkHint={linkHints.has(id)}
            onclick={() => clickCard(id)}
            onhover={(on) => (hovered = on ? id : null)}
          />
        </div>
      {/each}
    </div>

    {#if selected !== null && menuAt && !drag && view.cards[selected]}
      {#if menuMin}
        <button
          class="card-menu folded"
          bind:this={menuEl}
          style="left: {menuAt.x}px; top: {menuAt.y}px"
          onclick={() => (menuMin = false)}
          title="Menü wieder aufklappen"
          aria-label="Menü für {name(selected)} aufklappen"
        >
          ▴ {name(selected)}
        </button>
      {:else}
        <div
          class="card-menu"
          bind:this={menuEl}
          style="left: {menuAt.x}px; top: {menuAt.y}px"
          role="group"
          aria-label="Möglichkeiten für {name(selected)}"
          transition:fade={{ duration: 120 }}
        >
          <div class="menu-head">
            <span class="menu-title">{name(selected)}</span>
            <button
              class="fold"
              onclick={() => (menuMin = true)}
              title="Menü einklappen"
              aria-label="Einklappen">▾</button
            >
          </div>
          {#each selectedOptions as o (JSON.stringify(o))}
            <button class="opt" onclick={() => act(o)}>{actionLabel(o, name)}</button>
          {:else}
            <span class="menu-note">{decision ? "Gerade keine Aktion möglich." : "Nur ansehen."}</span>
          {/each}
          <div class="menu-row">
            <button class="opt info-button" onclick={() => (panelOpen = true)} title="Karte im Detail"
              >ⓘ Details</button
            >
            <button
              class="opt ghost"
              onclick={() => {
                selected = null;
                pinned = null;
              }}>{selectedOptions.length ? "Abbrechen" : "Schließen"}</button
            >
          </div>
        </div>
      {/if}
    {/if}

    <svg class="arrows" width={size.w} height={size.h} aria-hidden="true">
      <defs>
        <marker
          id="head-battle"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#ff8a3d" />
        </marker>
        <marker
          id="head-aim"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#ffd166" />
        </marker>
      </defs>
      {#each arrows as a (a.key)}
        <g class="arrow {a.kind}" in:fade={{ duration: 180 }}>
          <path class="glow" d={a.d} />
          <path class="line" d={a.d} marker-end="url(#head-{a.kind})" />
        </g>
      {/each}
    </svg>

    {#if drag && def(drag.id)}
      <div
        class="drag-ghost"
        style="left: {drag.x}px; top: {drag.y}px"
        class:valid={!!dropAction(drag.id, drag.over)}
      >
        <BoardCard card={def(drag.id)} />
      </div>
    {/if}

    {#if decision?.kind === "mulligan"}
      <div class="opening" transition:fade={{ duration: 200 }}>
        <span class="opening-title">Deine Starthand</span>
        <span class="opening-hint"
          >Behalten oder einmal komplett neu ziehen (die Hand kommt unter das Deck). Antippen zeigt eine Karte
          im Detail.</span
        >
        <div class="opening-cards" style:--n={me.hand.length}>
          {#each me.hand as id, i (id)}
            {@const c = def(id)}
            <!-- A tap shows the card in the detail (on the phone: the drawer; user's wish, 21 Nov 2026). -->
            <button
              class="opening-card"
              style="--d: {i * 70}ms"
              onpointerenter={() => (hovered = id)}
              onpointerleave={() => (hovered = null)}
              onclick={() => {
                pinned = id;
                panelOpen = true;
              }}
              title="Karte im Detail ansehen"
              aria-label="{c?.name ?? 'Karte'} ansehen"
            >
              {#if c}<CardImage card={c} src={cardImageUrl(c, "full")} eager />{/if}
            </button>
          {/each}
        </div>
        <div class="buttons">
          {#each buttons as o (JSON.stringify(o))}
            <button class="btn" class:primary={o === spaceAction} onclick={() => act(o)}>
              {buttonLabel(o)}{#if o === spaceAction}<kbd>Leertaste</kbd>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if banner}
      {#key banner.n}
        <div class="banner" class:mine={banner.mine} aria-live="polite">{banner.text}</div>
      {/key}
    {/if}

    {#if under.length}
      <div class="reveal" role="dialog" aria-label="Unter dein Deck" transition:fade={{ duration: 200 }}>
        <span class="reveal-title">Unter dein Deck</span>
        <span class="reveal-cards" style:--n={under.length}>
          {#each under as r (r.id)}
            <span class="reveal-card" in:fly={{ y: 30, duration: 300 }}>
              <CardImage card={r.card} src={cardImageUrl(r.card, "full")} eager />
              <small>{r.card.name}{r.card.text.includes("【Burst】") ? " · Burst" : ""}</small>
            </span>
          {/each}
        </span>
        <button class="btn primary" onclick={() => (under = [])}>Schließen</button>
      </div>
    {:else if revealed.length}
      <button class="reveal" transition:fade={{ duration: 200 }} onclick={() => (revealed = [])}>
        <span class="reveal-title">
          Schild {revealed.every((r) => r.owner === human)
            ? "von dir"
            : revealed.every((r) => r.owner !== human)
              ? "der KI"
              : ""}
          aufgedeckt
        </span>
        <span class="reveal-cards" style:--n={revealed.length}>
          {#each revealed as r (r.id)}
            <span class="reveal-card" in:fly={{ y: 30, duration: 300 }}>
              <CardImage card={r.card} src={cardImageUrl(r.card, "full")} eager />
              <small>{r.card.name}{r.card.text.includes("【Burst】") ? " · Burst" : ""}</small>
            </span>
          {/each}
        </span>
      </button>
    {/if}

    {#if exConfirm}
      {@const c = exConfirm}
      <div class="trash-layer ex-layer" transition:fade={{ duration: 150 }}>
        <button class="trash-backdrop" aria-label="Abbrechen" onclick={() => (exConfirm = null)}></button>
        <div class="trash-dialog ex-dialog" role="alertdialog" aria-label="EX Resource verwenden?">
          <h3>EX Resource verwenden?</h3>
          <p>
            {primaryCard(c.action) !== null ? name(primaryCard(c.action)!) : "Das"} kostet {c.cost}, deine
            aktiven normalen Ressourcen reichen nicht. Dafür {c.ex === 1
              ? "wird eine EX Resource"
              : `werden ${c.ex} EX Resources`} verbannt, dein Level sinkt von {c.level} auf {c.level - c.ex}.
          </p>
          <div class="ex-buttons">
            <button class="btn" onclick={() => (exConfirm = null)}>Abbrechen</button>
            <button class="btn primary" onclick={() => act(c.action, true)}>Mit EX Resource bezahlen</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- The trash in its own dialog over the field, so the detail panel stays free for the hovered card. -->
    {#if showTrash !== null}
      {@const trash = [...view.players[showTrash].trash].reverse()}
      <div class="trash-layer" transition:fade={{ duration: 150 }}>
        <button class="trash-backdrop" aria-label="Trash schließen" onclick={() => (showTrash = null)}
        ></button>
        <div class="trash-dialog" role="dialog" aria-label="Trash">
          <div class="trash-head">
            <h3>
              Trash {showTrash === human ? "(du)" : "(KI)"} · {trash.length}
              {trash.length === 1 ? "Karte" : "Karten"}
            </h3>
            <span class="hint">neueste zuerst · Überfahren zeigt das Detail, Klick hält es fest</span>
            <button class="btn ghost small" onclick={() => (showTrash = null)} aria-label="Schließen"
              >✕</button
            >
          </div>
          <div class="trash">
            {#each trash as id (id)}
              <BoardCard
                card={def(id)}
                state={pinned === id ? "selected" : ""}
                onclick={() => (pinned = pinned === id ? null : id)}
                onhover={(on) => (hovered = on ? id : null)}
              />
            {:else}
              <p class="hint">Leer.</p>
            {/each}
          </div>
        </div>
      </div>
    {/if}

    {#if result && summary && endHidden}
      <button class="show-end" onclick={() => (endHidden = false)}>Statistik der Partie</button>
    {:else if result && summary}
      <GameEnd
        {summary}
        {human}
        {pool}
        canUndo={canUndo && !replay}
        {replay}
        hash={match?.hash}
        {exportNote}
        onundo={undo}
        {onnew}
        oncopy={copyLog}
        onsave={saveGame}
        onhide={() => (endHidden = true)}
      />
    {/if}
  </section>

  {#if panelOpen}
    <button class="panel-backdrop" aria-label="Schließen" onclick={() => (panelOpen = false)}></button>
  {/if}
  <aside class="side-panel" class:open={panelOpen}>
    <div class="controls">
      <button class="btn panel-close" onclick={() => (panelOpen = false)} aria-label="Schließen">✕</button>
      {#if !replay}
        <button class="btn" onclick={undo} disabled={!canUndo} title="Strg+Z">↶ Rückgängig</button>
        <label title="Welche KI für dich spielt, wenn der Autopilot an ist">
          Autopilot
          <select bind:value={autopilotAi}>
            {#each DIFFICULTIES as d (d.ai)}
              <option value={d.ai}>{d.label}</option>
            {/each}
          </select>
        </label>
        <label title="Wie schnell die KI zieht (auch der Autopilot)">
          Tempo
          <select bind:value={speed}>
            {#each SPEEDS as sp (sp.ms)}
              <option value={sp.ms}>{sp.label}</option>
            {/each}
          </select>
        </label>
        <label title="Wann das Spiel im Action Step für dich anhält, wenn du etwas spielen könntest">
          Anhalten
          <select bind:value={stops}>
            {#each STOPS as st (st.value)}
              <option value={st.value}>{st.label}</option>
            {/each}
          </select>
        </label>
      {/if}
      <button class="btn ghost" onclick={onnew}>{replay ? "Replay schließen" : "Neues Spiel"}</button>
      {#if !replay}
        <button class="btn ghost" onclick={copyLog} title="Den Verlauf als Text kopieren"
          >Verlauf kopieren</button
        >
        <button class="btn ghost" onclick={saveGame} title="Seed, Decks und alle Entscheidungen als Datei"
          >Partie speichern</button
        >
        {#if exportNote && !result}<span class="export-note" role="status">{exportNote}</span>{/if}
      {/if}
    </div>

    <div class="detail">
      {#if peek}
        <CardInfo card={peek} />
      {:else if detailId !== null && def(detailId)}
        {#if detailId === pinned && hovered === null}
          <div class="pin-bar">
            <span>📌 Festgehalten</span>
            <button class="btn ghost small" onclick={() => (pinned = null)}>Lösen</button>
          </div>
        {/if}
        <CardInfo
          card={def(detailId)!}
          stats={view.cards[detailId]!.zone === "battle" || view.cards[detailId]!.zone === "base"
            ? stats(detailId)
            : null}
          pilot={view.cards[detailId]!.pilot === null ? undefined : def(view.cards[detailId]!.pilot!)}
          linked={view.cards[detailId]!.zone === "battle" && engine.isLinked(session.state, detailId)}
          pairedTo={view.cards[detailId]!.pairedTo === null
            ? undefined
            : def(view.cards[detailId]!.pairedTo!)}
        />
      {:else}
        <ul class="help">
          <li><b>Überfahren</b> zeigt eine Karte hier im Detail (auch Namen im Log).</li>
          <li>
            <b>Leuchtende Karten</b> kannst du nutzen: anklicken öffnet die Auswahl, oder auf das Ziel ziehen. Andere
            Karten hält ein Klick hier fest.
          </li>
          <li>
            <b>Symbole am Kartenrand</b> sind die Keywords, die gerade wirken (gold leuchtend = nur
            vorübergehend). Die <b>Kette</b> zeigt Links, beim Überfahren auch, welche Handkarte linken würde.
          </li>
          <li>
            <b>Leertaste</b> löst den blauen Knopf aus, <b>Strg+Z</b> nimmt deine letzte Entscheidung zurück, ↶
            im Log springt zurück.
          </li>
        </ul>
      {/if}
    </div>

    <div class="logbox">
      <div class="log-tabs" role="tablist" aria-label="Log filtern">
        {#each Object.entries(LOG_FILTERS) as [key, f] (key)}
          <button role="tab" aria-selected={logFilter === key} onclick={() => (logFilter = key as LogFilter)}
            >{f.label}</button
          >
        {/each}
      </div>
      <ol class="log" bind:this={logBox} aria-label="Spielverlauf">
        {#each lines as line, i (i)}
          {@const back = rollbackIndex(line, i)}
          {#if line.kind === "turn" || shownInLog(line)}
            <li
              class="kind-{line.kind}"
              class:mine={line.subject === human && line.kind !== "turn"}
              class:theirs={line.subject !== null && line.subject !== human && line.kind !== "turn"}
              class:turn-mine={line.kind === "turn" && line.player === human}
            >
              {#if line.kind !== "turn"}<LogIcon event={line.event} />{/if}
              <span class="txt">
                {#each segments(line) as seg, j (j)}
                  {#if "card" in seg}
                    <button
                      class="ref"
                      class:theirs={view.cards[seg.card.id]?.owner !== human}
                      onpointerenter={() => (peek = pool.get(seg.card.no) ?? null)}
                      onpointerleave={() => (peek = null)}
                      onfocus={() => (peek = pool.get(seg.card.no) ?? null)}
                      onblur={() => (peek = null)}>{seg.card.name}</button
                    >
                  {:else}{seg.text}{/if}
                {/each}
              </span>
              {#if back !== undefined}
                <button
                  class="back"
                  title={line.kind === "turn"
                    ? "Zurück zum Beginn dieses Zuges"
                    : "Zurück vor diese Entscheidung"}
                  onclick={() => rollbackTo(back)}>↶</button
                >
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
    </div>
  </aside>
</div>

<style>
  .game {
    /* Card width that still fits the window height: header, paddings, labels and the center bar take
       about 390 px (two rows on narrow boards); both mats and the hand need about 5.45 card widths. */
    --fit: calc((100dvh - var(--chrome, 62px) - 330px) / 5.45);
    --cw: clamp(44px, min(6.2vw, var(--fit)), 92px);
    --mine: 79 195 255;
    --theirs: 255 93 108;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 330px;
    gap: 14px;
    height: calc(100dvh - var(--chrome, 62px));
    padding: 10px 14px;
    overflow: hidden;
  }
  .board {
    position: relative;
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 0;
    padding: 8px 12px 0;
    border: 1px solid var(--line);
    border-radius: 16px;
    background:
      radial-gradient(ellipse 70% 30% at 50% 50%, rgb(79 195 255 / 8%), transparent 70%),
      repeating-linear-gradient(90deg, rgb(255 255 255 / 1.6%) 0 1px, transparent 1px 48px),
      repeating-linear-gradient(0deg, rgb(255 255 255 / 1.6%) 0 1px, transparent 1px 48px),
      linear-gradient(180deg, #111724, #0a0e16 50%, #0d1522);
    overflow: hidden;
  }

  /* Name plate of the AI with its hand. */
  .plate {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 26px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .avatar {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: linear-gradient(135deg, #ff5d6c, #7a1830);
    box-shadow: 0 0 0 2px rgb(var(--theirs) / 30%);
    color: #fff;
    font-size: 10px;
    font-weight: 800;
  }
  .pname {
    font-weight: 700;
    color: var(--text);
  }
  .pname small {
    margin-left: 4px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .plate-info strong {
    color: var(--text);
  }
  .opp-hand {
    display: flex;
    padding-left: 4px;
  }
  .mini-face {
    width: 40px;
    margin-left: -8px;
    padding: 0;
    border: 1px solid #36507a;
    border-radius: 3px;
    overflow: hidden;
    background: none;
    box-shadow: -1px 0 2px rgb(0 0 0 / 50%);
    transition: transform 0.12s;
  }
  .mini-face:first-child {
    margin-left: 0;
  }
  .mini-face.hot,
  .mini-face:hover {
    transform: translateY(3px) scale(1.08);
    z-index: 1;
    border-color: var(--accent, #4fc3ff);
  }
  .mini-back {
    width: 15px;
    height: 21px;
    margin-left: -5px;
    border-radius: 2px;
    border: 1px solid #36507a;
    background:
      repeating-linear-gradient(45deg, transparent 0 3px, rgb(79 195 255 / 10%) 3px 4px),
      linear-gradient(160deg, #1d3152, #0b1220);
    box-shadow: -1px 0 2px rgb(0 0 0 / 50%);
  }

  /* One player's side: shields and base, battle area, resources, deck and trash. The AI's side is
     mirrored, so both battle areas face the center. */
  .mat {
    --tone: var(--theirs);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      "sh res piles"
      "sh bat piles";
    gap: 6px 8px;
    padding: 6px 8px;
    border: 1px solid rgb(var(--tone) / 12%);
    border-radius: 14px;
    background: linear-gradient(180deg, rgb(var(--tone) / 6%), transparent 80%);
    transition:
      border-color 0.35s,
      box-shadow 0.35s;
  }
  .mat.mine {
    --tone: var(--mine);
    grid-template-areas:
      "sh bat piles"
      "sh res piles";
    background: linear-gradient(0deg, rgb(var(--tone) / 6%), transparent 80%);
  }
  .mat.active {
    border-color: rgb(var(--tone) / 55%);
    box-shadow:
      0 0 0 1px rgb(var(--tone) / 18%),
      inset 0 0 36px rgb(var(--tone) / 10%);
  }
  .zone {
    position: relative;
    padding: 16px 8px 6px;
    border: 1px solid rgb(255 255 255 / 5%);
    border-radius: 10px;
    background: rgb(0 0 0 / 22%);
  }
  .zlabel {
    position: absolute;
    top: 3px;
    left: 9px;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: rgb(var(--tone) / 70%);
    pointer-events: none;
  }
  .zlabel small {
    margin-left: 4px;
    font-weight: 500;
    letter-spacing: 0;
    color: var(--text-dim);
  }

  .shieldzone {
    grid-area: sh;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .shields {
    position: relative;
    width: calc(var(--cw) * 0.62);
    height: calc(var(--cw) * 0.62 * 1.395 + 22px);
  }
  .shield {
    position: absolute;
    left: 0;
    top: calc(var(--i) * 4px);
    width: 100%;
    aspect-ratio: 600 / 837;
    border-radius: 4px;
    border: 1px solid #36507a;
    background:
      repeating-linear-gradient(45deg, transparent 0 4px, rgb(79 195 255 / 8%) 4px 5px),
      linear-gradient(160deg, #1d3152, #0b1220);
    box-shadow: 0 1px 3px rgb(0 0 0 / 50%);
  }
  .count {
    position: absolute;
    left: 50%;
    bottom: 0;
    translate: -50% 0;
    min-width: 26px;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid rgb(var(--tone) / 45%);
    background: #0b111c;
    text-align: center;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .boom {
    position: absolute;
    left: 50%;
    top: 40%;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    translate: -50% -50%;
    border: 3px solid #ffd166;
    box-shadow:
      0 0 18px #ff8a3d,
      inset 0 0 12px #ff8a3d;
    pointer-events: none;
    animation: boom 0.8s ease-out forwards;
  }
  @keyframes boom {
    0% {
      opacity: 1;
      transform: scale(0.3);
    }
    100% {
      opacity: 0;
      transform: scale(4.5);
    }
  }
  .count.low {
    border-color: var(--danger);
    background: #3a0f18;
    color: #ffb3bb;
  }
  .base {
    width: var(--cw);
  }
  .empty {
    display: grid;
    place-items: center;
    aspect-ratio: 600 / 837;
    border: 1px dashed var(--line);
    border-radius: var(--radius-card);
    font-size: 11px;
    color: var(--text-dim);
  }
  .draggable {
    touch-action: none;
  }
  .draggable.dragging {
    opacity: 0.35;
  }
  .drag-ghost {
    --cw: clamp(70px, 6.8vw, 104px);
    position: fixed;
    z-index: 20;
    translate: -50% -60%;
    rotate: -4deg;
    pointer-events: none;
    filter: drop-shadow(0 12px 24px rgb(0 0 0 / 60%));
    opacity: 0.92;
  }
  .drag-ghost.valid {
    rotate: 0deg;
    filter: drop-shadow(0 0 16px color-mix(in srgb, var(--accent) 80%, transparent));
  }
  .battlezone.droppable {
    border-color: rgb(var(--mine) / 45%);
    background: rgb(var(--mine) / 7%);
  }
  .battlezone.over,
  .shieldzone.over {
    border-color: var(--accent);
    box-shadow: inset 0 0 24px rgb(var(--mine) / 25%);
  }
  .mat:not(.mine) {
    --lunge: 8px;
  }
  .shieldzone.defender {
    border-color: var(--danger);
    box-shadow: inset 0 0 20px rgb(var(--theirs) / 25%);
  }
  .shieldzone.shake {
    animation: shake 0.45s ease-in-out;
  }
  @keyframes shake {
    20% {
      translate: -6px 0;
    }
    40% {
      translate: 5px 0;
    }
    60% {
      translate: -3px 0;
    }
    80% {
      translate: 2px 0;
    }
  }
  .shieldzone.target {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    cursor: pointer;
    animation: zonepulse 1s ease-in-out infinite;
  }
  @keyframes zonepulse {
    50% {
      background: transparent;
    }
  }

  .battlezone {
    grid-area: bat;
    min-width: 0;
  }
  .battle {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: calc(var(--cw) * 0.32);
    /* Room for a rested (turned) card at either end. */
    padding-inline: calc(var(--cw) * 0.18);
    min-height: calc(var(--cw) * 1.395 + 4px);
  }
  .unit {
    width: var(--cw);
  }
  .placeholder {
    aspect-ratio: 600 / 837;
    border: 1px dashed rgb(255 255 255 / 7%);
    border-radius: var(--radius-card);
    background: rgb(255 255 255 / 1.5%);
  }

  .reszone {
    grid-area: res;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 10px 5px;
    min-width: 0;
  }
  .level {
    flex: none;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-dim);
  }
  .level strong {
    margin-left: 2px;
    font-size: 20px;
    color: var(--text);
  }
  .res-cards {
    display: flex;
    min-width: 0;
    padding: 2px 0;
  }
  .res-card {
    flex: none;
    width: calc(var(--cw) * 0.42);
    border-radius: 3px;
    box-shadow: 0 1px 4px rgb(0 0 0 / 55%);
    transition:
      filter 0.3s,
      transform 0.3s;
  }
  .res-card + .res-card {
    margin-left: calc(var(--cw) * -0.16);
  }
  .res-card.rested {
    filter: grayscale(1) brightness(0.45);
    transform: translateY(2px);
  }
  .res-card.ex {
    box-shadow:
      0 0 0 1.5px #ffd166,
      0 0 10px rgb(255 209 102 / 45%);
  }
  .res-card :global(.card) {
    border-radius: 3px;
  }
  .res-count {
    flex: none;
    margin-left: auto;
    font-size: 12px;
    color: var(--text-dim);
  }
  .res-count strong {
    font-size: 15px;
    color: rgb(var(--tone));
  }

  .piles {
    grid-area: piles;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 8px;
  }
  .pile {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    width: calc(var(--cw) * 0.6);
    padding: 0;
    border: 0;
    background: none;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .pile-card {
    display: block;
    width: 100%;
    aspect-ratio: 600 / 837;
    border-radius: 4px;
    overflow: hidden;
    box-shadow:
      0 2px 6px rgb(0 0 0 / 55%),
      2px 2px 0 #1a2740,
      4px 4px 0 #111a2a;
  }
  .back-card {
    border: 1px solid #36507a;
    background:
      repeating-linear-gradient(45deg, transparent 0 4px, rgb(79 195 255 / 8%) 4px 5px),
      linear-gradient(160deg, #1d3152, #0b1220);
  }
  .empty-pile {
    border: 1px dashed var(--line);
    box-shadow: none;
  }
  .pile-count {
    position: absolute;
    top: calc(var(--cw) * 0.6 * 1.395 / 2);
    left: 50%;
    translate: -50% -50%;
    min-width: 24px;
    padding: 0 6px;
    border-radius: 999px;
    background: rgb(5 8 14 / 85%);
    border: 1px solid var(--line);
    color: var(--text);
    font-size: 12px;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
  }
  button.pile {
    cursor: pointer;
  }
  button.pile:hover .pile-card,
  .pile.open .pile-card {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* The center bar: turn, phases, prompt and buttons. */
  .center {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr) minmax(0, auto);
    align-items: center;
    gap: 6px 14px;
    min-height: 54px;
    padding: 7px 10px 8px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: rgb(7 10 16 / 78%);
    backdrop-filter: blur(4px);
    text-align: center;
  }
  .turnbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    align-items: center;
    gap: 6px 12px;
  }
  .turn-pill {
    padding: 3px 12px;
    border: 1px solid rgb(var(--theirs) / 50%);
    border-radius: 999px;
    background: rgb(var(--theirs) / 16%);
    color: #ff9aa3;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .turn-pill.mine {
    border-color: rgb(var(--mine) / 50%);
    background: rgb(var(--mine) / 14%);
    color: #8fd8ff;
  }
  .phases {
    --ph: var(--theirs);
    display: flex;
    gap: 3px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .phases.mine {
    --ph: var(--mine);
  }
  .phases li {
    padding: 3px 12px;
    background: rgb(255 255 255 / 5%);
    clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%);
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    transition:
      background 0.3s,
      color 0.3s;
  }
  .phases li.done {
    color: rgb(var(--ph) / 55%);
  }
  .phases li.now {
    background: rgb(var(--ph));
    color: #05080e;
  }
  .substep {
    color: #ffd166;
    font-size: 12px;
    font-weight: 650;
  }
  .battle-info {
    margin: 0;
    color: #ffae70;
    font-size: 13px;
    font-weight: 600;
  }
  .prompt {
    margin: 0;
    font-weight: 550;
  }
  .thinking {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-dim);
  }
  .dots {
    display: inline-flex;
    gap: 3px;
  }
  .dots i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgb(var(--theirs));
    animation: dot 1s ease-in-out infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes dot {
    0%,
    100% {
      opacity: 0.3;
      transform: translateY(0);
    }
    40% {
      opacity: 1;
      transform: translateY(-4px);
    }
  }
  .ask {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .center > .buttons {
    justify-content: flex-end;
  }
  /* A narrow board: turn and phases in their own row above the prompt and the buttons. */
  @container (max-width: 860px) {
    .center {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 4px 10px;
    }
    .turnbar {
      grid-column: 1 / -1;
      justify-content: center;
    }
    .prompt {
      font-size: 13px;
    }
  }
  .menu,
  .buttons,
  .choices {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    gap: 8px;
  }
  .menu-title {
    color: #ffd166;
    font-weight: 700;
    font-size: 13px;
  }
  .card-menu {
    position: absolute;
    z-index: 8;
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 190px;
    max-width: 260px;
    padding: 8px;
    border: 1px solid rgb(255 209 102 / 45%);
    border-radius: 12px;
    background: rgb(12 17 27 / 96%);
    box-shadow:
      var(--shadow),
      0 0 24px rgb(255 209 102 / 12%);
    text-align: left;
  }
  .card-menu.folded {
    flex-direction: row;
    min-width: 0;
    max-width: 200px;
    padding: 4px 10px;
    overflow: hidden;
    color: #ffd166;
    font-size: 13px;
    font-weight: 700;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .menu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .menu-head .fold {
    min-width: 30px;
    min-height: 26px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg-raised);
    color: var(--text-dim);
  }
  .menu-note {
    color: var(--text-dim);
    font-size: 13px;
  }
  .card-menu .opt {
    width: 100%;
    text-align: left;
  }
  .card-menu .opt:not(.ghost):not(.info-button) {
    border-color: rgb(79 195 255 / 40%);
    background: rgb(79 195 255 / 10%);
    font-weight: 600;
  }
  .menu-row {
    display: flex;
    gap: 5px;
  }
  .menu-row .ghost {
    flex: 1;
  }
  .opt,
  .btn {
    min-height: 36px;
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    font-size: 14px;
  }
  .opt:hover,
  .btn:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .btn.primary {
    border-color: #4fc3ff;
    background: linear-gradient(180deg, #2aa8ff, #1677d9);
    box-shadow:
      0 0 0 1px rgb(79 195 255 / 30%),
      0 4px 16px rgb(31 155 255 / 35%);
    color: #fff;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .btn.primary:hover:not(:disabled) {
    filter: brightness(1.12);
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .ghost {
    background: transparent;
  }
  kbd {
    margin-left: 8px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgb(0 0 0 / 25%);
    font: 11px var(--font);
  }

  /* The hand: a fan of cards at the bottom edge; the hovered card rises. */
  .hand {
    --hcw: clamp(46px, min(6.8vw, calc(var(--fit) * 1.08)), 104px);
    display: flex;
    justify-content: center;
    flex: none;
    height: calc(var(--hcw) * 1.395 * 0.86);
    padding-top: 6px;
  }
  .hand-card {
    --cw: var(--hcw);
    flex: none;
    transform-origin: 50% 120%;
    transform: rotate(calc(var(--k) * 2.2deg)) translateY(calc(var(--ak) * 4px));
    transition: transform 0.18s ease;
  }
  /* Many cards overlap instead of overflowing. */
  .hand-card + .hand-card {
    margin-left: min(-4px, calc((100% - var(--n) * (var(--hcw) + 6px)) / (var(--n) - 1)));
  }
  /* The selected card stays up while its menu is open (the menu sits on top of it). */
  .hand-card:hover,
  .hand-card.raised {
    z-index: 3;
    transform: translateY(-22%) scale(1.08);
  }

  .opening {
    position: absolute;
    inset: 0;
    z-index: 7;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 12px;
    padding: 20px;
    background: radial-gradient(ellipse at 50% 50%, rgb(10 16 28 / 82%), rgb(3 5 10 / 92%));
    backdrop-filter: blur(3px);
  }
  .opening-title {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .opening-hint {
    color: var(--text-dim);
    font-size: 14px;
  }
  .opening-cards {
    display: flex;
    justify-content: center;
    gap: 14px;
    margin: 6px 0 4px;
  }
  .opening-card {
    padding: 0;
    border: none;
    background: none;
    cursor: zoom-in;
    width: min(170px, calc((100vw - 120px) / var(--n)), 22vh);
    border-radius: 8px;
    box-shadow: 0 12px 30px rgb(0 0 0 / 60%);
    animation: deal 0.45s cubic-bezier(0.2, 0.9, 0.3, 1.1) backwards;
    animation-delay: var(--d);
    transition: transform 0.18s;
  }
  .opening-card:hover {
    transform: translateY(-8px) scale(1.04);
  }
  @keyframes deal {
    from {
      opacity: 0;
      transform: translateY(40px) rotate(-6deg) scale(0.85);
    }
  }
  .show-end {
    position: absolute;
    z-index: 9;
    right: 14px;
    bottom: 14px;
    padding: 8px 16px;
    border: 1px solid #4fc3ff;
    border-radius: 999px;
    background: linear-gradient(180deg, #2aa8ff, #1677d9);
    box-shadow: 0 4px 16px rgb(31 155 255 / 35%);
    color: #fff;
    font-weight: 700;
  }
  .arrows {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
    overflow: visible;
  }
  .arrow path {
    fill: none;
    stroke-linecap: round;
  }
  .arrow .glow {
    stroke-width: 12px;
    opacity: 0.22;
    filter: blur(3px);
  }
  .arrow .line {
    stroke-width: 4px;
    stroke-dasharray: 14 8;
    animation: march 0.6s linear infinite;
  }
  .arrow.battle path {
    stroke: #ff8a3d;
  }
  .arrow.aim path {
    stroke: #ffd166;
  }
  .arrow.aim .line {
    stroke-width: 4px;
    stroke-dasharray: 10 7;
  }
  .arrow.aim .glow {
    opacity: 0.35;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -22;
    }
  }
  .banner {
    position: absolute;
    z-index: 6;
    left: 0;
    right: 0;
    top: 50%;
    translate: 0 -50%;
    padding: 14px 0;
    text-align: center;
    font-size: 34px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #fff;
    background: linear-gradient(
      90deg,
      transparent,
      rgb(255 93 108 / 55%) 30%,
      rgb(255 93 108 / 55%) 70%,
      transparent
    );
    text-shadow: 0 2px 12px rgb(0 0 0 / 70%);
    pointer-events: none;
    animation: banner 1.3s ease-in-out forwards;
  }
  .banner.mine {
    background: linear-gradient(
      90deg,
      transparent,
      rgb(31 155 255 / 55%) 30%,
      rgb(31 155 255 / 55%) 70%,
      transparent
    );
  }
  @keyframes banner {
    0% {
      opacity: 0;
      transform: scaleY(0.2);
    }
    15%,
    75% {
      opacity: 1;
      transform: none;
    }
    100% {
      opacity: 0;
      transform: translateX(40px);
    }
  }
  .reveal {
    position: absolute;
    left: 12px;
    right: 12px;
    top: 50%;
    z-index: 5;
    width: fit-content;
    margin: 0 auto;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 14px 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgb(10 14 22 / 92%);
    box-shadow: var(--shadow);
    cursor: pointer;
  }
  .reveal-title {
    color: #ffd166;
    font-weight: 650;
  }
  .reveal-cards {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
  }
  .reveal-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    /* Up to 5 cards (under the deck) in one row. */
    width: min(clamp(110px, 11vw, 170px), calc((100vw - 120px) / var(--n)));
    font-size: 12px;
    color: var(--text-dim);
  }
  .export-note {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--text-dim);
  }
  .side-panel {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr);
    gap: 10px;
    min-height: 0;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .controls label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .controls select {
    padding: 5px 6px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  /* Fixed height: content changes on hover (log names, cards) must not move the log below, otherwise the
     pointer leaves the name, the detail shrinks back and the log flickers up and down. */
  .detail {
    height: clamp(180px, 42vh, 440px);
    overflow: auto;
    overscroll-behavior: contain;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-raised);
  }
  .pin-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: -4px 0 8px;
    font-size: 12px;
    color: #ffd166;
  }
  .pin-bar .small {
    padding: 2px 10px;
    font-size: 12px;
  }
  .trash-layer {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: grid;
    place-items: center;
    padding: 16px;
  }
  .trash-backdrop {
    position: absolute;
    inset: 0;
    border: 0;
    padding: 0;
    background: rgb(3 5 10 / 70%);
    backdrop-filter: blur(2px);
    cursor: default;
  }
  .trash-dialog {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(900px, 100%);
    max-height: 100%;
    padding: 14px 16px 16px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: rgb(10 14 22 / 96%);
    box-shadow: var(--shadow);
  }
  .ex-layer {
    z-index: 9;
  }
  .ex-dialog {
    width: min(440px, 100%);
  }
  .ex-dialog h3 {
    margin: 0;
    font-size: 16px;
  }
  .ex-dialog p {
    margin: 0;
    line-height: 1.45;
  }
  .ex-buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .trash-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 12px;
  }
  .trash-head h3 {
    margin: 0;
    font-size: 16px;
  }
  .trash-head .btn {
    margin-left: auto;
  }
  .trash {
    --cw: clamp(64px, 8vw, 104px);
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    min-height: 0;
    overflow-y: auto;
    padding: 4px;
  }
  .help {
    margin: 0;
    padding-left: 16px;
    color: var(--text-dim);
    font-size: 12.5px;
    line-height: 1.5;
  }
  .help b {
    color: var(--text);
    font-weight: 600;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }
  .logbox {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .log-tabs {
    display: flex;
    gap: 2px;
    padding: 6px 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .log-tabs button {
    padding: 5px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 600;
  }
  .log-tabs button[aria-selected="true"] {
    border-bottom-color: var(--accent);
    color: var(--text);
  }
  .log {
    margin: 0;
    padding: 0 8px 8px;
    list-style: none;
    overflow: auto;
    font-size: 12.5px;
    line-height: 1.4;
  }
  .log li {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 3px 2px;
    color: var(--text-dim);
  }
  .log li .txt {
    flex: 1;
    min-width: 0;
    padding-top: 1px;
  }
  .log li.mine {
    color: var(--text);
  }
  .log li.kind-turn {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 8px -8px 2px;
    padding: 5px 10px;
    border-block: 1px solid var(--line);
    border-left: 3px solid rgb(255 93 108);
    background: #0d1320;
    color: #ff9aa3;
    font-size: 11px;
    font-weight: 750;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .log li.kind-turn.turn-mine {
    border-left-color: rgb(79 195 255);
    color: #8fd8ff;
  }
  .log li.kind-battle {
    color: #f3c3ae;
  }
  .log li.kind-important {
    color: #ffd166;
    font-weight: 600;
  }
  .ref {
    padding: 0 3px;
    border: 0;
    border-radius: 4px;
    background: rgb(79 195 255 / 12%);
    color: #a9e2ff;
    font: inherit;
    font-weight: 600;
    cursor: help;
  }
  .ref.theirs {
    background: rgb(255 93 108 / 12%);
    color: #ffb3bb;
  }
  .ref:hover,
  .ref:focus-visible {
    outline: 1px solid currentColor;
  }
  .back {
    flex: none;
    width: 24px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg-raised);
    font-size: 13px;
    line-height: 1;
  }
  .back:hover {
    border-color: var(--accent);
  }
  .autopilot-toggle {
    display: inline-flex;
    align-items: center;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-raised);
    font-size: 12px;
    white-space: nowrap;
  }
  .autopilot-toggle.on {
    border-color: #ffd166;
    background: color-mix(in srgb, #ffd166 22%, var(--bg-raised));
    color: #ffd166;
    font-weight: 700;
    animation: pulse-pilot 1.6s ease-in-out infinite;
  }
  @keyframes pulse-pilot {
    50% {
      box-shadow: 0 0 10px rgb(255 209 102 / 45%);
    }
  }
  .panel-toggle,
  .panel-close,
  .info-button,
  .panel-backdrop {
    display: none;
  }
  @media (max-width: 1000px) {
    .game {
      grid-template-columns: 1fr;
      height: auto;
      overflow: visible;
      --cw: clamp(44px, 8.6vw, 80px);
    }
    .board {
      min-height: 80dvh;
    }
    .side-panel {
      grid-template-rows: auto auto 300px;
    }
    .battle {
      gap: calc(var(--cw) * 0.22);
    }
    .center {
      grid-template-columns: minmax(0, 1fr);
      justify-items: center;
    }
    .turnbar,
    .center > .buttons {
      justify-content: center;
    }
    .hand {
      --hcw: clamp(48px, 10vw, 84px);
    }
  }

  /* Phones in portrait: cards sized from the screen width, resources and piles in one row, side panel
     as a drawer from the bottom. */
  @media (max-width: 700px) {
    .game {
      --cw: min(54px, calc((100vw - 48px) / 7.1));
      padding: 4px;
      gap: 0;
    }
    .board {
      min-height: calc(100dvh - 118px);
      padding: 4px 4px 0;
      gap: 4px;
      border-radius: 10px;
    }
    .plate {
      min-height: 20px;
      font-size: 12px;
    }
    .avatar {
      width: 20px;
      height: 20px;
      font-size: 8px;
    }
    .mini-back {
      width: 10px;
      height: 14px;
      margin-left: -4px;
    }
    .mat {
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas:
        "res res piles"
        "sh bat bat";
      gap: 3px;
      padding: 3px;
      border-radius: 10px;
    }
    .mat.mine {
      grid-template-areas:
        "sh bat bat"
        "res res piles";
    }
    .zone {
      padding: 11px 3px 3px;
      border-radius: 8px;
    }
    .zlabel {
      top: 1px;
      left: 5px;
      font-size: 7.5px;
    }
    .shieldzone {
      flex-direction: column;
      gap: 3px;
    }
    .shields {
      width: calc(var(--cw) * 0.5);
      height: calc(var(--cw) * 0.5 * 1.395 + 14px);
    }
    .shield {
      top: calc(var(--i) * 2px);
    }
    .count {
      min-width: 20px;
      padding: 0 4px;
      font-size: 11px;
    }
    .base {
      --cw: calc(min(54px, calc((100vw - 48px) / 7.1)) * 0.8);
    }
    .battle {
      gap: 3px;
      padding-inline: 0;
      min-height: calc(var(--cw) * 1.395);
    }
    .shieldzone .zlabel {
      display: none;
    }
    .shieldzone {
      padding-top: 4px;
    }
    /* A rested card is turned; smaller, so it stays within its slot. */
    .battle :global(.slot.rested .stack) {
      transform: rotate(90deg) scale(0.7);
    }
    .reszone {
      gap: 6px;
      padding: 10px 6px 3px;
    }
    .level strong {
      font-size: 15px;
    }
    .res-card {
      width: calc(var(--cw) * 0.36);
    }
    .piles {
      flex-direction: row;
      align-items: center;
      gap: 6px;
    }
    .pile {
      width: calc(var(--cw) * 0.42);
      font-size: 8px;
    }
    .pile-count {
      top: calc(var(--cw) * 0.42 * 1.395 / 2);
      min-width: 18px;
      padding: 0 3px;
      font-size: 10px;
    }
    .center {
      gap: 4px;
      padding: 5px 4px;
    }
    .turnbar {
      gap: 4px 6px;
    }
    .phases li {
      padding: 2px 6px;
      font-size: 9px;
    }
    .turn-pill {
      padding: 2px 8px;
      font-size: 10px;
    }
    .prompt {
      font-size: 13px;
    }
    .opt,
    .btn {
      min-height: 34px;
      padding: 4px 10px;
      font-size: 13px;
    }
    kbd {
      display: none;
    }
    .hand {
      --hcw: min(76px, 20vw);
      justify-content: flex-start;
    }
    .hand-card {
      transform: none;
    }
    .panel-toggle {
      display: inline-flex;
      padding: 2px 10px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--bg-raised);
      font-size: 12px;
    }
    .info-button,
    .panel-close {
      display: inline-flex;
      justify-content: center;
      align-items: center;
    }
    .panel-close {
      margin-left: auto;
      order: 10;
    }
    .panel-backdrop {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 39;
      border: 0;
      background: rgb(0 0 0 / 45%);
    }
    .side-panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 40;
      height: 72dvh;
      padding: 10px max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom))
        max(10px, env(safe-area-inset-left));
      grid-template-rows: auto auto minmax(0, 1fr);
      border-top: 1px solid var(--line);
      border-radius: 16px 16px 0 0;
      background: var(--bg);
      box-shadow: 0 -10px 30px rgb(0 0 0 / 50%);
      transform: translateY(105%);
      transition: transform 0.25s ease;
    }
    .side-panel.open {
      transform: none;
    }
    .detail {
      height: 34dvh;
    }
    .reveal-card {
      width: min(28vw, calc((100vw - 80px) / var(--n)));
    }
    .banner {
      font-size: 24px;
    }
  }
</style>
