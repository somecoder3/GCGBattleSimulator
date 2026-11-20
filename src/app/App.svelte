<script lang="ts">
  import { onMount } from "svelte";
  import type { CardPool } from "../data/cards";
  import CardBrowser from "./components/CardBrowser.svelte";
  import PlayScreen from "./components/game/PlayScreen.svelte";
  import DecksScreen from "./components/decks/DecksScreen.svelte";
  import MetaScreen from "./components/meta/MetaScreen.svelte";
  import ReplayScreen from "./components/sim/ReplayScreen.svelte";
  import SimScreen from "./components/sim/SimScreen.svelte";
  import type { GameSummary, SimJob } from "../sim/runner";
  import { loadCardPool } from "./lib/cardpool";
  import { db } from "./lib/db";
  import { BUNDLED_SNAPSHOT, setSnapshot, setUserDecks } from "./lib/decks";

  const TABS = [
    ["play", "Spielen"],
    ["sim", "Simulator"],
    ["meta", "Meta"],
    ["decks", "Decks"],
    ["cards", "Karten"],
  ] as const;
  type Tab = (typeof TABS)[number][0];
  const tabFromHash = (): Tab => {
    const key = location.hash.slice(1);
    return TABS.some(([k]) => k === key) ? (key as Tab) : "play";
  };
  let tab = $state<Tab>(tabFromHash());

  let pool = $state<CardPool>();
  let error = $state<string>();

  // A new version took over (service worker update): offer a reload, since the page still runs the old code.
  let updated = $state(false);
  // A simulated game being watched (from the simulator's game list).
  let replay = $state.raw<{
    job: SimJob;
    index: number;
    names: Record<string, string>;
    expected?: GameSummary;
  } | null>(null);

  onMount(() => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.addEventListener("controllerchange", () => (updated = true));
    }
    const onHash = () => (tab = tabFromHash());
    addEventListener("hashchange", onHash);
    // Cards, a meta snapshot loaded earlier in the browser (if newer than the bundled one) and own decks.
    Promise.all([loadCardPool(), loadStored()]).then(
      ([p]) => (pool = p),
      (e: unknown) => (error = String(e)),
    );
    return () => removeEventListener("hashchange", onHash);
  });

  async function loadStored() {
    try {
      const cached = await db.meta.get();
      if (cached && (!BUNDLED_SNAPSHOT || cached.to > BUNDLED_SNAPSHOT.to)) setSnapshot(cached);
      setUserDecks(await db.decks.all());
    } catch {
      // IndexedDB unavailable: bundled data only.
    }
  }
</script>

<header class="top">
  <div class="brand">
    <span class="logo" aria-hidden="true"></span>
    <span>GCG Battle Simulator</span>
  </div>
  <nav aria-label="Bereiche">
    {#each TABS as [key, label] (key)}
      <a href="#{key}" class:current={tab === key} aria-current={tab === key ? "page" : undefined}>{label}</a>
    {/each}
  </nav>
</header>

{#if updated}
  <div class="update" role="status">
    Neue Version geladen.
    <button onclick={() => location.reload()}>Neu laden</button>
  </div>
{/if}

<main class:wide={tab === "play" || (tab === "sim" && replay !== null)}>
  {#if error}
    <p class="message error">Kartendaten konnten nicht geladen werden: {error}</p>
  {:else if pool && tab === "play"}
    <PlayScreen {pool} />
  {:else if pool && tab === "sim" && replay}
    <ReplayScreen
      {pool}
      job={replay.job}
      index={replay.index}
      names={replay.names}
      expected={replay.expected}
      onclose={() => (replay = null)}
    />
  {:else if pool && tab === "sim"}
    <SimScreen
      {pool}
      onreplay={(job, index, names, expected) => (replay = { job, index, names, expected })}
    />
  {:else if pool && tab === "meta"}
    <MetaScreen {pool} />
  {:else if pool && tab === "decks"}
    <DecksScreen {pool} />
  {:else if pool}
    <CardBrowser {pool} />
  {:else}
    <p class="message">Lade Karten …</p>
  {/if}
</main>

<style>
  .top {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 10px max(16px, env(safe-area-inset-right)) 10px max(16px, env(safe-area-inset-left));
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 650;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .logo {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    background: linear-gradient(135deg, var(--accent) 0%, var(--c-purple) 100%);
    box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 50%, transparent);
  }
  nav {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  nav a {
    padding: 5px 12px;
    border-radius: 999px;
    white-space: nowrap;
    font-size: 14px;
  }
  nav a {
    color: var(--text-dim);
    text-decoration: none;
    border: 1px solid transparent;
  }
  nav a:hover {
    color: var(--text);
  }
  nav .current {
    color: var(--text);
    background: var(--bg-raised);
    border-color: var(--line);
  }
  main {
    padding: 16px max(16px, env(safe-area-inset-right)) 32px max(16px, env(safe-area-inset-left));
    max-width: 1600px;
    margin: 0 auto;
  }
  .update {
    position: fixed;
    z-index: 50;
    left: 50%;
    bottom: 16px;
    translate: -50% 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-raised);
    box-shadow: var(--shadow);
  }
  .update button {
    padding: 4px 12px;
    border: 0;
    border-radius: 8px;
    background: var(--accent-strong);
    color: #fff;
  }
  main.wide {
    max-width: none;
    padding: 0;
  }
  .message {
    color: var(--text-dim);
    text-align: center;
    margin-top: 20vh;
  }
  .error {
    color: var(--danger);
  }
  @media (max-width: 600px) {
    .top {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
  }
</style>
