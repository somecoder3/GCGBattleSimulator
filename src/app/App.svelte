<script lang="ts">
  import { onMount } from "svelte";
  import type { CardPool } from "../data/cards";
  import CardBrowser from "./components/CardBrowser.svelte";
  import PlayScreen from "./components/game/PlayScreen.svelte";
  import SimScreen from "./components/sim/SimScreen.svelte";
  import { loadCardPool } from "./lib/cardpool";

  type Tab = "play" | "sim" | "cards";
  const tabFromHash = (): Tab =>
    location.hash === "#cards" ? "cards" : location.hash === "#sim" ? "sim" : "play";
  let tab = $state<Tab>(tabFromHash());

  let pool = $state<CardPool>();
  let error = $state<string>();

  onMount(() => {
    const onHash = () => (tab = tabFromHash());
    addEventListener("hashchange", onHash);
    loadCardPool().then(
      (p) => (pool = p),
      (e: unknown) => (error = String(e)),
    );
    return () => removeEventListener("hashchange", onHash);
  });

  const sections = ["Decks", "Meta"];
</script>

<header class="top">
  <div class="brand">
    <span class="logo" aria-hidden="true"></span>
    <span>GCG Battle Simulator</span>
  </div>
  <nav aria-label="Bereiche">
    <a href="#play" class:current={tab === "play"} aria-current={tab === "play" ? "page" : undefined}
      >Spielen</a
    >
    <a href="#sim" class:current={tab === "sim"} aria-current={tab === "sim" ? "page" : undefined}
      >Simulator</a
    >
    <a href="#cards" class:current={tab === "cards"} aria-current={tab === "cards" ? "page" : undefined}
      >Karten</a
    >
    {#each sections as name (name)}
      <span class="soon" title="Kommt in einem späteren Meilenstein">{name}</span>
    {/each}
  </nav>
</header>

<main class:wide={tab === "play"}>
  {#if error}
    <p class="message error">Kartendaten konnten nicht geladen werden: {error}</p>
  {:else if pool && tab === "play"}
    <PlayScreen {pool} />
  {:else if tab === "sim"}
    <SimScreen />
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
  nav a,
  nav span {
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
  .soon {
    color: var(--text-dim);
    opacity: 0.6;
  }
  main {
    padding: 16px max(16px, env(safe-area-inset-right)) 32px max(16px, env(safe-area-inset-left));
    max-width: 1600px;
    margin: 0 auto;
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
