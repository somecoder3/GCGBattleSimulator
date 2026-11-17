<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { flip } from "svelte/animate";
  import { crossfade, fade, fly } from "svelte/transition";
  import { cardImageUrl } from "../../../data/cards";
  import CardImage from "../CardImage.svelte";
  import type { FieldDeck } from "../../../ai/opponent";
  import { makePolicy } from "../../../ai/registry";
  import type { CardPool } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import type { Engine } from "../../../engine/engine";
  import type { Action, CardId, GameEvent, PlayerId } from "../../../engine/types";
  import { HIDDEN } from "../../../engine/view";
  import type { GameSession, LogStep } from "../../../sim/session";
  import {
    actionLabel,
    decisionText,
    isButton,
    primaryButton,
    primaryCard,
    secondary,
  } from "../../lib/actions";
  import { cardName, describeSteps, type LogLine } from "../../lib/gamelog";
  import BoardCard from "./BoardCard.svelte";
  import CardInfo from "./CardInfo.svelte";

  let {
    engine,
    pool,
    session,
    onsave,
    onnew,
    opponentField = [],
    replay = false,
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
  let flashed = $state.raw(new Set<CardId>());
  let speed = $state(600);

  // When the game stops for the human in an action step (9-4).
  type Stops = "always" | "smart" | "never";
  const STOPS: { value: Stops; label: string }[] = [
    { value: "smart", label: "Klug" },
    { value: "always", label: "Immer" },
    { value: "never", label: "Nie (passen)" },
  ];
  const STOPS_KEY = "gcg-battle-simulator.stops";
  let stops = $state<Stops>(loadStops());

  function loadStops(): Stops {
    try {
      const v = localStorage.getItem(STOPS_KEY);
      return v === "always" || v === "never" ? v : "smart";
    } catch {
      return "smart";
    }
  }

  $effect(() => {
    try {
      localStorage.setItem(STOPS_KEY, stops);
    } catch {
      // only a convenience
    }
  });

  /**
   * "Klug": stop in an action step only when two Units fight (AP changes decide the battle) or when an
   * attack on the player could leave you without Shields and Base.
   */
  function skipActionStep(): boolean {
    const pending = session.state.pending;
    if (!pending || pending.player !== human || pending.kind !== "action") return false;
    if (stops === "always") return false;
    if (stops === "never") return true;
    const b = session.state.battle;
    if (!b || session.state.step !== "battleAction") return true;
    if (b.target !== "player") return false;
    if (b.attackerOwner === human) return true;
    const me = session.state.players[human];
    return me.shields.length + me.base.length > 1;
  }
  let showTrash = $state<PlayerId | null>(null);
  /** On narrow screens the side panel (controls, details, log) is a drawer. */
  let panelOpen = $state(false);
  let logBox = $state<HTMLElement>();

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
    for (const e of step.events) {
      if (e.t === "damage" || e.t === "recover") {
        const amount = (nextHits.get(e.card)?.amount ?? 0) + (e.t === "damage" ? -e.amount : e.amount);
        nextHits.set(e.card, { amount, n: ++effectN });
        const card = step.after.cards[e.card]!;
        if (e.t === "damage" && card.zone === "base") nextShake.add(card.owner);
      } else if (e.t === "shieldBreak" || e.t === "playerDamage") nextShake.add(e.player);
      else if (e.t === "turnStart") {
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
    if (nextShake.size) {
      shaking = nextShake;
      later(600, () => (shaking = new Set()));
    }
  }

  onDestroy(() => timers.forEach(clearTimeout));

  function refresh(step?: LogStep) {
    view = session.view();
    lines = describeSteps(engine, session.steps, human);
    selected = null;
    flashed = new Set(step && step.player !== human ? touched(step.events) : []);
    reveal(step);
    animate(step);
    onsave();
  }

  // Destroyed Shields are revealed to both players; they are shown for a moment in the middle of the
  // board. The card number comes from the full state, since the card may be hidden again by now
  // (a Burst that goes to the AI's hand).
  let revealed = $state.raw<{ id: CardId; card: CardDef; owner: PlayerId }[]>([]);
  let revealTimer: ReturnType<typeof setTimeout> | undefined;

  function reveal(step?: LogStep) {
    const fresh = (step?.events ?? []).flatMap((e) => {
      if (e.t !== "shieldBreak") return [];
      const card = pool.get(session.state.cards[e.card]!.no);
      return card ? [{ id: e.card, card, owner: e.player }] : [];
    });
    if (!step) revealed = [];
    if (!fresh.length) return;
    revealed = [...revealed, ...fresh].slice(-4);
    clearTimeout(revealTimer);
    revealTimer = setTimeout(() => (revealed = []), 2800);
  }

  onDestroy(() => clearTimeout(revealTimer));

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

  // AI turns: one decision at a time with a short pause, so the human can follow. Action steps the
  // human doesn't want to stop in are passed automatically (marked, so undo skips them).
  $effect(() => {
    void view;
    void stops;
    if (replay) return;
    if (skipActionStep()) {
      const timer = setTimeout(() => refresh(session.apply({ type: "pass" }, true)), Math.min(speed, 150));
      return () => clearTimeout(timer);
    }
    if (!session.aiToAct) return;
    const kind = session.state.pending!.kind;
    const delay = kind === "mulligan" ? Math.min(speed, 300) : speed;
    const timer = setTimeout(() => refresh(session.stepAI(ai)), delay);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    void lines;
    logBox?.scrollTo({ top: logBox.scrollHeight });
  });

  const decision = $derived(!replay && view.pending && view.pending.player === human ? view.pending : null);
  const options = $derived(decision?.options ?? []);
  const buttons = $derived(options.filter(isButton));
  const spaceAction = $derived(primaryButton(buttons));
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
    const no = view.cards[id]!.no;
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
    const b = view.battle;
    if (!b) return "";
    return b.attacker === id ? "attacker" : b.target === id ? "defender" : "";
  }

  function cardState(id: CardId): "" | "legal" | "selected" | "target" {
    if (id === selected) return "selected";
    if (targets.has(id)) return "target";
    if (selected === null && legal.has(id)) return "legal";
    return "";
  }

  function act(action: Action) {
    if (!decision) return;
    refresh(session.apply(action));
  }

  /** Options that need no second click: choosing a target, blocking, discarding, a simple deploy. */
  function immediate(o: Action): boolean {
    return secondary(o) === null;
  }

  function clickCard(id: CardId) {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!decision) return;
    if (selected !== null) {
      const complete = selectedOptions.filter((o) => secondary(o) === id);
      if (complete.length === 1) return act(complete[0]!);
      if (id === selected) {
        selected = null;
        return;
      }
    }
    const own = options.filter((o) => primaryCard(o) === id);
    if (!own.length) {
      selected = null;
      return;
    }
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
    if (!decision || !legal.has(id) || e.button !== 0) return;
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
    } else if (e.key === "Escape") {
      selected = null;
      showTrash = null;
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

  const activeResources = (ids: CardId[]) => ids.filter((id) => !view.cards[id]!.rested).length;
  const detailId = $derived(hovered ?? selected);
  const battleInfo = $derived.by(() => {
    const b = view.battle;
    if (!b) return "";
    return `${name(b.attacker)} greift ${b.target === "player" ? (b.attackerOwner === human ? "die KI" : "dich") : name(b.target)} an`;
  });
  const endText = $derived(
    !result
      ? ""
      : result.winner === null
        ? "Unentschieden"
        : result.winner === human
          ? "Gewonnen!"
          : "Verloren",
  );
</script>

<svelte:window {onkeydown} {onpointermove} {onpointerup} onpointercancel={onpointerup} />

{#snippet field(p: PlayerId)}
  {@const player = view.players[p]}
  <div class="field" class:mine={p === human}>
    <div
      class="shieldzone"
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
    >
      <div class="shields" title="Schilde">
        {#each player.shields as id, i (id)}
          <span class="shield" style="--i:{i}"></span>
        {/each}
        <strong class="count">{player.shields.length}</strong>
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
      class="battle"
      data-drop={p === human ? "field" : undefined}
      class:over={drag !== null && p === human && drag.over === "field"}
    >
      {#each player.battle as id (id)}
        <!-- Dragging only adds to the card button inside; keyboard and screen readers use the button. -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="unit draggable"
          class:dragging={drag?.id === id}
          data-drop={id}
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
{/snippet}

{#snippet info(p: PlayerId)}
  {@const player = view.players[p]}
  <div class="info">
    <span class="who">{p === human ? "Du" : "KI"}</span>
    <span title="Level = Anzahl Ressourcen">Lv. <strong>{player.resources.length}</strong></span>
    <span class="resources" title="Aktive / alle Ressourcen">
      {#each player.resources as id (id)}
        <span class="res" class:rested={view.cards[id]!.rested} class:ex={view.cards[id]!.no === "EXR-001"}
        ></span>
      {/each}
      <small>{activeResources(player.resources)}/{player.resources.length}</small>
    </span>
    <span title="Deck">Deck {player.deck.length}</span>
    <button class="pile" onclick={() => (showTrash = showTrash === p ? null : p)} title="Trash ansehen">
      Trash {player.trash.length}
    </button>
    {#if p !== human}
      <span title="Handkarten der KI">Hand {player.hand.length}</span>
    {/if}
  </div>
{/snippet}

<div class="game">
  <section class="board" aria-label="Spielfeld">
    <div class="side enemy">
      {@render info(enemy)}
      <div class="opp-hand" aria-label="Hand der KI">
        {#each opp.hand as id (id)}
          <span class="mini-back" animate:flip={{ duration: 250 }} in:fade={{ duration: 200 }}></span>
        {/each}
      </div>
      {@render field(enemy)}
    </div>

    <div class="center" class:waiting={!decision && !result}>
      <div class="status">
        <span class="turn">Zug {view.turn} · {myTurn ? "Dein Zug" : "Zug der KI"}</span>
        <button class="panel-toggle" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen}>
          ☰ Log &amp; Details
        </button>
        <span class="step">{STEP_NAMES[view.step]}</span>
        {#if battleInfo}<span class="battle-info">{battleInfo}</span>{/if}
      </div>
      {#if result}
        <p class="prompt">Spielende.</p>
      {:else if decision}
        <p class="prompt">{decisionText(decision, name)}</p>
        {#if selected !== null && selectedOptions.length}
          <div class="menu" role="group" aria-label="Möglichkeiten für {name(selected)}">
            <span class="menu-title">{name(selected)}:</span>
            <button class="opt info-button" onclick={() => (panelOpen = true)} title="Karte im Detail"
              >ⓘ</button
            >
            {#each selectedOptions as o (JSON.stringify(o))}
              <button class="opt" onclick={() => act(o)}>{actionLabel(o, name)}</button>
            {/each}
            <button class="opt ghost" onclick={() => (selected = null)}>Abbrechen</button>
          </div>
        {/if}
        {#if offBoard.length}
          <div class="choices">
            {#each offBoard as id (id)}
              <BoardCard
                card={def(id)}
                state="legal"
                onclick={() => clickCard(id)}
                onhover={(on) => (hovered = on ? id : null)}
              />
            {/each}
          </div>
        {/if}
        {#if buttons.length}
          <div class="buttons">
            {#each buttons as o (JSON.stringify(o))}
              <button class="btn" class:primary={o === spaceAction} onclick={() => act(o)}>
                {actionLabel(o, name)}{#if o === spaceAction}<kbd>Leertaste</kbd>{/if}
              </button>
            {/each}
          </div>
        {/if}
      {:else if replay}
        <p class="prompt">Replay (Sicht von Sitz 1)</p>
      {:else}
        <p class="prompt thinking">KI ist am Zug …</p>
      {/if}
    </div>

    <div class="side me">
      {@render field(human)}
      {@render info(human)}
      <div class="hand" aria-label="Deine Hand" style="--n: {Math.max(2, me.hand.length)}">
        {#each me.hand as id (id)}
          <!-- Dragging only adds to the card button inside; keyboard and screen readers use the button. -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="hand-card draggable"
            class:dragging={drag?.id === id}
            onpointerdown={(e) => onpointerdown(e, id)}
            animate:flip={{ duration: 300 }}
            in:receive={{ key: id }}
            out:send={{ key: id }}
          >
            <BoardCard
              card={def(id)}
              state={cardState(id)}
              onclick={() => clickCard(id)}
              onhover={(on) => (hovered = on ? id : null)}
            />
          </div>
        {/each}
      </div>
    </div>

    {#if drag && def(drag.id)}
      <div
        class="drag-ghost"
        style="left: {drag.x}px; top: {drag.y}px"
        class:valid={!!dropAction(drag.id, drag.over)}
      >
        <BoardCard card={def(drag.id)} />
      </div>
    {/if}

    {#if banner}
      {#key banner.n}
        <div class="banner" class:mine={banner.mine} aria-live="polite">{banner.text}</div>
      {/key}
    {/if}

    {#if revealed.length}
      <button class="reveal" transition:fade={{ duration: 200 }} onclick={() => (revealed = [])}>
        <span class="reveal-title">
          Schild {revealed.every((r) => r.owner === human)
            ? "von dir"
            : revealed.every((r) => r.owner !== human)
              ? "der KI"
              : ""}
          aufgedeckt
        </span>
        <span class="reveal-cards">
          {#each revealed as r (r.id)}
            <span class="reveal-card" in:fly={{ y: 30, duration: 300 }}>
              <CardImage card={r.card} src={cardImageUrl(r.card, "full")} eager />
              <small>{r.card.name}{r.card.text.includes("【Burst】") ? " · Burst" : ""}</small>
            </span>
          {/each}
        </span>
      </button>
    {/if}

    {#if result}
      <div class="overlay" transition:fade>
        <div class="end-card">
          <h2 class:won={result.winner === human}>{endText}</h2>
          <p>Nach {result.turn} Zügen.</p>
          <div class="buttons">
            {#if canUndo}<button class="btn" onclick={undo}>Letzte Entscheidung zurück</button>{/if}
            <button class="btn primary" onclick={onnew}>Neues Spiel</button>
          </div>
        </div>
      </div>
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
        <label>
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
    </div>

    <div class="detail">
      {#if detailId !== null && def(detailId)}
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
      {:else if showTrash !== null}
        <h3>Trash {showTrash === human ? "(du)" : "(KI)"}</h3>
        <div class="trash">
          {#each [...view.players[showTrash].trash].reverse() as id (id)}
            <BoardCard card={def(id)} onhover={(on) => (hovered = on ? id : null)} />
          {:else}
            <p class="hint">Leer.</p>
          {/each}
        </div>
      {:else}
        <p class="hint">
          Karte überfahren (oder ⓘ) für Details. Leuchtende Karten kannst du nutzen: anklicken oder auf das
          Ziel ziehen. Strg+Z oder ↶ nimmt deine letzte Entscheidung zurück.
        </p>
      {/if}
    </div>

    <ol class="log" bind:this={logBox} aria-label="Spielverlauf">
      {#each lines as line, i (i)}
        {@const back = rollbackIndex(line, i)}
        <li class="kind-{line.kind}" class:mine={line.subject === human && line.kind !== "turn"}>
          <span>{line.text}</span>
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
      {/each}
    </ol>
  </aside>
</div>

<style>
  .game {
    /* Card width that still fits the window height: header, paddings and the center bar take about
       360 px, each side needs about 2.9 card widths (battle area, info line, hand). Below 720 px of
       height this is smaller than the width-based size, so nothing overlaps on low windows. */
    --fit: calc((100dvh - 360px) / 5.8);
    --cw: clamp(44px, min(6.2vw, var(--fit)), 92px);
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 14px;
    height: calc(100dvh - 62px);
    padding: 10px 14px;
    overflow: hidden;
  }
  .board {
    position: relative;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    gap: 8px;
    min-height: 0;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background:
      radial-gradient(ellipse at 50% 50%, rgb(79 195 255 / 7%), transparent 60%),
      linear-gradient(180deg, #0e1420, #0a0e16 50%, #0e1420);
    overflow: hidden;
  }
  .side {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }
  .enemy {
    justify-content: flex-start;
  }
  .me {
    /* "safe": if it still doesn't fit, overflow downwards instead of into the center bar. */
    justify-content: safe flex-end;
  }
  .info {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .info strong {
    color: var(--text);
  }
  .who {
    font-weight: 700;
    color: var(--text);
    letter-spacing: 0.04em;
  }
  .resources {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .res {
    width: 9px;
    height: 14px;
    border-radius: 2px;
    background: var(--accent);
    box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .res.ex {
    background: #ffd166;
  }
  .res.rested {
    background: #2a3446;
    box-shadow: none;
  }
  .resources small {
    margin-left: 4px;
  }
  .pile {
    padding: 1px 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg-sunken);
    font-size: 13px;
    color: var(--text-dim);
  }
  .opp-hand {
    display: flex;
    gap: 3px;
    min-height: 20px;
  }
  .mini-back {
    width: 14px;
    height: 20px;
    border-radius: 2px;
    border: 1px solid #2f4466;
    background: linear-gradient(160deg, #1a2a44, #0b1220);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .shieldzone {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    border-radius: 10px;
    border: 1px dashed transparent;
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
  .battle.over,
  .shieldzone.over {
    outline: 2px dashed var(--accent);
    outline-offset: 4px;
    border-radius: 12px;
  }
  .field:not(.mine) {
    --lunge: 8px;
  }
  .shieldzone.defender {
    border-color: var(--danger);
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
  .shieldzone.target {
    border-color: var(--danger);
    background: color-mix(in srgb, var(--danger) 12%, transparent);
    cursor: pointer;
    animation: zonepulse 1s ease-in-out infinite;
  }
  @keyframes zonepulse {
    50% {
      background: transparent;
    }
  }
  .shields {
    position: relative;
    width: calc(var(--cw) * 0.62);
    height: calc(var(--cw) * 0.62 * 1.395 + 20px);
  }
  .shield {
    position: absolute;
    left: 0;
    top: calc(var(--i) * 4px);
    width: 100%;
    aspect-ratio: 600 / 837;
    border-radius: 4px;
    border: 1px solid #36507a;
    background: linear-gradient(160deg, #1d3152, #0b1220);
  }
  .count {
    position: absolute;
    inset: auto 0 0 0;
    text-align: center;
    font-size: 15px;
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
  .battle {
    display: flex;
    gap: calc(var(--cw) * 0.42);
    padding: 0 calc(var(--cw) * 0.2);
    flex: 1;
    min-height: calc(var(--cw) * 1.395 + 18px);
    align-items: center;
  }
  .unit {
    width: var(--cw);
  }
  .placeholder {
    aspect-ratio: 600 / 837;
    border: 1px dashed rgb(36 48 68 / 70%);
    border-radius: var(--radius-card);
  }
  .center {
    /* Above both sides, so its buttons stay clickable even if a side overflows. */
    position: relative;
    z-index: 2;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-block: 1px solid var(--line);
    background: rgb(7 10 16 / 55%);
    text-align: center;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px 14px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .turn {
    color: var(--accent);
    font-weight: 650;
  }
  .battle-info {
    color: var(--danger);
  }
  .prompt {
    margin: 0;
    font-weight: 550;
  }
  .thinking {
    color: var(--text-dim);
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    50% {
      opacity: 0.45;
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
    font-weight: 600;
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
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
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
  .hand {
    display: flex;
    justify-content: center;
    gap: 6px;
    min-height: calc(var(--cw) * 1.395 + 6px);
    padding-top: 4px;
  }
  .hand-card {
    --cw: clamp(46px, min(6.6vw, calc(var(--fit) * 1.06)), 100px);
    flex: none;
    transition: transform 0.15s;
  }
  /* Many cards overlap instead of overflowing; the hovered one comes to the front. */
  .hand-card + .hand-card {
    margin-left: min(0px, calc((100% - var(--n) * (var(--cw) + 6px)) / (var(--n) - 1)));
  }
  .hand-card:hover {
    z-index: 1;
  }
  .reveal {
    position: absolute;
    left: 50%;
    top: 50%;
    z-index: 5;
    transform: translate(-50%, -50%);
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
    gap: 10px;
  }
  .reveal-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: clamp(110px, 11vw, 170px);
    font-size: 12px;
    color: var(--text-dim);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    background: rgb(5 8 14 / 70%);
    backdrop-filter: blur(3px);
  }
  .end-card {
    padding: 28px 40px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-raised);
    text-align: center;
    box-shadow: var(--shadow);
  }
  .end-card h2 {
    margin: 0 0 4px;
    font-size: 34px;
    color: var(--danger);
  }
  .end-card h2.won {
    color: #7fe0a0;
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
  .detail {
    min-height: 120px;
    max-height: 52vh;
    overflow: auto;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-raised);
  }
  .detail h3 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  .trash {
    --cw: 64px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: var(--text-dim);
  }
  .log {
    margin: 0;
    padding: 8px 10px;
    list-style: none;
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
    font-size: 13px;
  }
  .log li {
    display: flex;
    justify-content: space-between;
    gap: 6px;
    padding: 2px 0;
    color: var(--text-dim);
  }
  .log li.mine {
    color: var(--text);
  }
  .log li.kind-turn {
    margin-top: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--line);
    color: var(--accent);
    font-weight: 650;
  }
  .log li.kind-battle {
    color: #f0b8a0;
  }
  .log li.kind-important {
    color: #ffd166;
    font-weight: 600;
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
      --cw: clamp(44px, 9.5vw, 80px);
    }
    .board {
      min-height: 80dvh;
    }
    .side-panel {
      grid-template-rows: auto auto 300px;
    }
    .field {
      gap: 8px;
    }
    .battle {
      gap: calc(var(--cw) * 0.3);
      padding: 0;
    }
    .hand-card {
      --cw: clamp(48px, 11vw, 84px);
    }
  }

  /* Phones in portrait: cards sized from the screen width, side panel as a drawer from the bottom. */
  @media (max-width: 700px) {
    .game {
      --cw: min(50px, calc((100vw - 40px) / 7.7));
      padding: 4px;
      gap: 0;
    }
    .board {
      min-height: calc(100dvh - 118px);
      padding: 6px;
      gap: 4px;
      border-radius: 10px;
    }
    .side {
      gap: 4px;
    }
    .field {
      gap: 4px;
    }
    .shieldzone {
      gap: 4px;
      padding: 2px;
    }
    .shields {
      width: calc(var(--cw) * 0.55);
      height: calc(var(--cw) * 0.55 * 1.395 + 14px);
    }
    .count {
      font-size: 13px;
    }
    .base {
      width: calc(var(--cw) * 0.9);
      --cw: calc(min(50px, calc((100vw - 40px) / 7.7)) * 0.9);
    }
    .battle {
      gap: 3px;
      min-height: calc(var(--cw) * 1.395 + 12px);
    }
    /* A rested card is turned; smaller, so it stays within its slot. */
    .battle :global(.slot.rested .stack) {
      transform: rotate(90deg) scale(0.7);
    }
    .info {
      gap: 2px 10px;
      font-size: 12px;
    }
    .opp-hand {
      min-height: 14px;
    }
    .mini-back {
      width: 10px;
      height: 14px;
    }
    .center {
      gap: 4px;
      padding: 6px 4px;
    }
    .status {
      gap: 2px 10px;
      font-size: 12px;
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
      justify-content: flex-start;
      min-height: calc(var(--cw) * 1.395);
    }
    .hand-card {
      --cw: min(64px, 17vw);
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
      max-height: 34dvh;
    }
    .reveal-card {
      width: 28vw;
    }
    .banner {
      font-size: 24px;
    }
    .end-card {
      padding: 20px;
      margin: 0 12px;
    }
  }
</style>
