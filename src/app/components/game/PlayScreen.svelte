<script lang="ts">
  import type { CardPool } from "../../../data/cards";
  import { AI_LABELS, AI_NAMES, type AiName } from "../../../ai/registry";
  import { STARTER_DECKS } from "../../../data/decks";
  import { CardLib } from "../../../engine/cardlib";
  import { Engine } from "../../../engine/engine";
  import type { PlayerId } from "../../../engine/types";
  import { GameSession, type SavedSession } from "../../../sim/session";
  import Board from "./Board.svelte";

  let { pool }: { pool: CardPool } = $props();

  const STORAGE_KEY = "gcg-battle-simulator.game";
  // svelte-ignore state_referenced_locally
  const engine = new Engine(CardLib.fromPool(pool));

  let session = $state.raw<GameSession>();
  let saved = $state.raw<SavedSession | undefined>(load());

  let myDeck = $state(STARTER_DECKS[0]!.id);
  let aiDeck = $state(STARTER_DECKS[2]!.id);
  let starter = $state<"random" | "me" | "ai">("random");
  let aiName = $state<AiName>("heuristic-v1");
  let seed = $state(randomSeed());

  function randomSeed(): number {
    return Math.floor(Math.random() * 1_000_000_000);
  }

  function load(): SavedSession | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? (JSON.parse(raw) as SavedSession) : undefined;
      return data?.version === 1 ? data : undefined;
    } catch {
      return undefined;
    }
  }

  function save() {
    if (!session) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session.save()));
    } catch {
      // Storage may be unavailable (private window); the game still works without it.
    }
  }

  function start() {
    const mine = STARTER_DECKS.find((d) => d.id === myDeck)!;
    const theirs = STARTER_DECKS.find((d) => d.id === aiDeck)!;
    const human: PlayerId = 0;
    const s = seed >>> 0;
    const firstPlayer: PlayerId = starter === "me" ? human : starter === "ai" ? 1 : ((s % 2) as PlayerId);
    session = new GameSession(engine, {
      decks: [mine.deck, theirs.deck],
      options: { seed: s, firstPlayer },
      human,
      ai: aiName,
      deckNames: [`${mine.id} ${mine.name}`, `${theirs.id} ${theirs.name}`],
    });
  }

  function resume() {
    if (!saved) return;
    try {
      session = GameSession.restore(engine, saved);
    } catch (e) {
      console.error("saved game could not be restored", e);
      saved = undefined;
    }
  }

  function newGame() {
    saved = load();
    session = undefined;
    seed = randomSeed();
  }
</script>

{#if session}
  <Board {engine} {pool} {session} onsave={save} onnew={newGame} />
{:else}
  <section class="setup" aria-labelledby="setup-title">
    <h1 id="setup-title">Spiel gegen die KI</h1>
    <p class="lead">
      Starter-Decks gegen eine KI (Standard: Heuristik v1). Alle Entscheidungen lassen sich zurücknehmen;
      dieselben Karten kommen wieder.
    </p>
    <div class="grid">
      <label>
        Dein Deck
        <select bind:value={myDeck}>
          {#each STARTER_DECKS as d (d.id)}<option value={d.id}>{d.id} {d.name} ({d.colors})</option>{/each}
        </select>
      </label>
      <label>
        Deck der KI
        <select bind:value={aiDeck}>
          {#each STARTER_DECKS as d (d.id)}<option value={d.id}>{d.id} {d.name} ({d.colors})</option>{/each}
        </select>
      </label>
      <label>
        Gegner-KI
        <select bind:value={aiName}>
          {#each AI_NAMES as n (n)}<option value={n}>{AI_LABELS[n]}</option>{/each}
        </select>
      </label>
      <label>
        Wer beginnt
        <select bind:value={starter}>
          <option value="random">Zufall</option>
          <option value="me">Du</option>
          <option value="ai">KI</option>
        </select>
      </label>
      <label>
        Seed
        <span class="seed">
          <input type="number" min="0" bind:value={seed} />
          <button type="button" onclick={() => (seed = randomSeed())} title="Neuer Seed">⟳</button>
        </span>
      </label>
    </div>
    <div class="actions">
      <button class="btn primary" onclick={start}>Spiel starten</button>
      {#if saved}
        <button class="btn" onclick={resume}>
          Partie fortsetzen ({saved.deckNames?.join(" gegen ") ?? "gespeichert"}, {saved.actions.length} Entscheidungen)
        </button>
      {/if}
    </div>
  </section>
{/if}

<style>
  .setup {
    max-width: 720px;
    margin: 6vh auto;
    padding: 28px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-raised);
  }
  h1 {
    margin: 0 0 6px;
    font-size: 24px;
  }
  .lead {
    margin: 0 0 20px;
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dim);
  }
  select,
  input {
    min-height: 38px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 15px;
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input {
    flex: 1;
    min-width: 0;
  }
  .seed button {
    width: 40px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 22px;
  }
  .btn {
    min-height: 40px;
    padding: 8px 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .btn.primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
</style>
