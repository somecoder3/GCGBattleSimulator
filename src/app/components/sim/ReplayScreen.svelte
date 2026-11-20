<script lang="ts">
  import type { CardPool } from "../../../data/cards";
  import { Engine } from "../../../engine/engine";
  import { gameHash } from "../../../sim/gamehash";
  import { recordGame, type GameSummary, type SimJob } from "../../../sim/runner";
  import { GameSession } from "../../../sim/session";
  import { cardLib } from "../../lib/decks";
  import Board from "../game/Board.svelte";

  // Replay of one simulated game: it is played again from job and index (same result), then shown on the
  // board step by step, from the view of seat 0.

  let {
    pool,
    job,
    index,
    names,
    expected,
    onclose,
  }: {
    pool: CardPool;
    job: SimJob;
    index: number;
    names: Record<string, string>;
    /** The game as the simulator recorded it (to notice a replay that runs differently now). */
    expected?: GameSummary;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const engine = new Engine(cardLib(pool));
  // svelte-ignore state_referenced_locally
  const recorded = recordGame(engine, job, index);
  const total = recorded.actions.length;
  let step = $state(total);
  let playing = $state(false);

  // svelte-ignore state_referenced_locally
  const hash = gameHash(job, index);
  /** Own decks (id "u-…") by name only, the others by id and name. */
  const label = (id: string) => (id.startsWith("u-") ? (names[id] ?? id) : `${id} ${names[id] ?? ""}`.trim());
  const deckNames: [string, string] = [label(recorded.spec.decks[0]), label(recorded.spec.decks[1])];
  // svelte-ignore state_referenced_locally
  const match = {
    hash,
    job,
    index,
    decks: recorded.spec.decks,
    ai: recorded.spec.ai,
  };
  // The replay is played again with today's engine and AI: after changes it can run differently.
  const final = new GameSession(
    engine,
    { decks: recorded.decks, options: recorded.options, human: 0, deckNames },
    recorded.actions,
  ).state;
  // svelte-ignore state_referenced_locally
  const differs =
    !!expected &&
    !expected.error &&
    (final.result?.winner !== expected.winner || final.turn !== expected.turns);

  // Speed and open hands are kept (localStorage, a convenience).
  const SPEEDS = [
    { label: "0,5×", ms: 900 },
    { label: "1×", ms: 450 },
    { label: "2×", ms: 225 },
    { label: "4×", ms: 110 },
    { label: "8×", ms: 50 },
  ];
  const SETTINGS_KEY = "gcg-battle-simulator.replay";
  function loadSettings(): { speed: number; reveal: boolean } {
    try {
      const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
        speed?: number;
        reveal?: boolean;
      };
      return {
        speed: SPEEDS.some((sp) => sp.ms === v.speed) ? v.speed! : 450,
        reveal: v.reveal === true,
      };
    } catch {
      return { speed: 450, reveal: false };
    }
  }
  const settings = loadSettings();
  let speed = $state(settings.speed);
  let reveal = $state(settings.reveal);
  $effect(() => {
    const value = JSON.stringify({ speed, reveal });
    try {
      localStorage.setItem(SETTINGS_KEY, value);
    } catch {
      // only a convenience
    }
  });
  const session = $derived(
    new GameSession(
      engine,
      { decks: recorded.decks, options: recorded.options, human: 0, deckNames },
      recorded.actions.slice(0, step),
    ),
  );

  $effect(() => {
    if (!playing) return;
    if (step >= total) {
      playing = false;
      return;
    }
    const timer = setTimeout(() => (step += 1), speed);
    return () => clearTimeout(timer);
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "ArrowRight") step = Math.min(total, step + 1);
    else if (e.key === "ArrowLeft") step = Math.max(0, step - 1);
  }
</script>

<svelte:window {onkeydown} />

<div class="bar">
  <strong>Replay Spiel {index}</strong>
  <span class="dim">{deckNames[0]} ({recorded.spec.ai[0]}) gegen {deckNames[1]} ({recorded.spec.ai[1]})</span>
  <span class="dim" title="Spiel-Hash: im Simulator suchbar">#<code>{hash}</code></span>
  {#if differs}
    <span
      class="warn"
      title="Engine oder KI haben sich seit dem Lauf geändert; das Replay zeigt, wie das Spiel heute verliefe."
      >⚠ Läuft heute anders als im Lauf (damals {expected!.winner === null
        ? "unentschieden"
        : `Sitz ${expected!.winner + 1} gewinnt`}, Zug {expected!.turns})</span
    >
  {/if}
  <span class="controls">
    <button onclick={() => (step = 0)} title="Anfang">⏮</button>
    <button onclick={() => (step = Math.max(0, step - 1))} title="Zurück (←)">◀</button>
    <button onclick={() => (playing = !playing)}>{playing ? "⏸" : "▶ Abspielen"}</button>
    <button onclick={() => (step = Math.min(total, step + 1))} title="Weiter (→)">▶</button>
    <button onclick={() => (step = total)} title="Ende">⏭</button>
    <label class="dim" title="Tempo beim Abspielen">
      Tempo
      <select bind:value={speed}>
        {#each SPEEDS as sp (sp.ms)}<option value={sp.ms}>{sp.label}</option>{/each}
      </select>
    </label>
    <label
      class="dim check"
      title="Handkarten von Sitz 2 offen zeigen (Überfahren zeigt die Karte im Detail)"
    >
      <input type="checkbox" bind:checked={reveal} /> Hand des Gegners
    </label>
    <input type="range" min="0" max={total} bind:value={step} aria-label="Entscheidung" />
    <span class="dim">{step} / {total}</span>
  </span>
</div>

<!-- The bar above takes about 48 px more than the app's header alone. -->
<div style="--chrome: 112px">
  {#key step}
    <Board {engine} {pool} {session} replay revealHands={reveal} {match} onsave={() => {}} onnew={onclose} />
  {/key}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line);
  }
  .dim {
    color: var(--text-dim);
    font-size: 13px;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .controls button {
    min-height: 30px;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
  }
  .controls select {
    min-height: 30px;
    margin-left: 4px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    color: var(--text);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .warn {
    color: #f5c451;
    font-size: 13px;
  }
  input[type="range"] {
    width: min(320px, 40vw);
  }
</style>
