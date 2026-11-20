<script lang="ts">
  import type { CardPool } from "../../../data/cards";
  import { Engine } from "../../../engine/engine";
  import { recordGame, type SimJob } from "../../../sim/runner";
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
    onclose,
  }: {
    pool: CardPool;
    job: SimJob;
    index: number;
    names: Record<string, string>;
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
  const deckNames: [string, string] = [
    `${recorded.spec.decks[0]} ${names[recorded.spec.decks[0]] ?? ""}`,
    `${recorded.spec.decks[1]} ${names[recorded.spec.decks[1]] ?? ""}`,
  ];
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
    const timer = setTimeout(() => (step += 1), 450);
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
  <span class="controls">
    <button onclick={() => (step = 0)} title="Anfang">⏮</button>
    <button onclick={() => (step = Math.max(0, step - 1))} title="Zurück (←)">◀</button>
    <button onclick={() => (playing = !playing)}>{playing ? "⏸" : "▶ Abspielen"}</button>
    <button onclick={() => (step = Math.min(total, step + 1))} title="Weiter (→)">▶</button>
    <button onclick={() => (step = total)} title="Ende">⏭</button>
    <input type="range" min="0" max={total} bind:value={step} aria-label="Entscheidung" />
    <span class="dim">{step} / {total}</span>
  </span>
</div>

<!-- The bar above takes about 48 px more than the app's header alone. -->
<div style="--chrome: 112px">
  {#key step}
    <Board {engine} {pool} {session} replay onsave={() => {}} onnew={onclose} />
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
  input[type="range"] {
    width: min(320px, 40vw);
  }
</style>
