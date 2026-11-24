<script lang="ts">
  import { onMount } from "svelte";
  import type { CardPool } from "../data/cards";
  import CardBrowser from "./components/CardBrowser.svelte";
  import PlayScreen from "./components/game/PlayScreen.svelte";
  import DecksScreen from "./components/decks/DecksScreen.svelte";
  import MetaScreen from "./components/meta/MetaScreen.svelte";
  import type { GameSummary, SimJob } from "../sim/runner";
  import { loadCardPool } from "./lib/cardpool";
  import { db, type SavedRun } from "./lib/db";
  import { BUNDLED_SNAPSHOT, setLabDecks, setSnapshot, setUserDecks } from "./lib/decks";
  import { fetchLabDecks, lab, labConnect } from "./lib/lab";
  import { startSync, syncAvailable } from "./lib/sync";
  import AccountMenu from "./components/AccountMenu.svelte";

  // The simulator and replays of simulated games are part of the lab only (`npm run lab`).
  const labScreens = __LAB__ ? import("./labscreens") : undefined;

  const ALL_TABS = [
    ["play", "Spielen"],
    ["sim", "Simulator"],
    ["meta", "Meta"],
    ["decks", "Decks"],
    ["cards", "Karten"],
  ] as const;
  type Tab = (typeof ALL_TABS)[number][0];
  const TABS = ALL_TABS.filter(([key]) => __LAB__ || key !== "sim");
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
      // IndexedDB (or the lab) unavailable: bundled data only.
    }
    // Cloud sync of own decks (signed in with Google); runs in the background.
    startSync();
    if (labConnect()) {
      const decks = await fetchLabDecks();
      if (decks) {
        setLabDecks(decks);
        await offerOldRuns();
      }
    }
  }

  // Simulation runs of older versions stayed in this browser: offer to move them to the running lab.
  let oldRuns = $state.raw<SavedRun[]>([]);
  let moveNote = $state<string>();
  async function offerOldRuns() {
    try {
      oldRuns = await db.runs.all();
    } catch {
      oldRuns = [];
    }
  }
  const runsText = (n: number) => `${n} ${n === 1 ? "Simulationslauf" : "Simulationsläufe"}`;
  async function moveOldRuns() {
    try {
      const { imported, skipped } = await lab.runs.import(oldRuns);
      for (const r of oldRuns) if (r.id !== undefined) await db.runs.delete(r.id);
      moveNote = `${runsText(imported)} ins Labor übertragen${skipped ? `, ${skipped} waren schon dort` : ""}.`;
      oldRuns = [];
    } catch (e) {
      moveNote = `Übertragen fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
</script>

<header class="top">
  <div class="brand">
    <span class="logo" aria-hidden="true"></span>
    <span>GCG Battle Simulator</span>
    {#if __LAB__}<span class="lab-badge" title="Lokaler Labor-Server (npm run lab)">Labor</span>{/if}
  </div>
  <nav aria-label="Bereiche">
    {#each TABS as [key, label] (key)}
      <a href="#{key}" class:current={tab === key} aria-current={tab === key ? "page" : undefined}>{label}</a>
    {/each}
  </nav>
  {#if syncAvailable}<div class="account"><AccountMenu /></div>{/if}
</header>

{#if oldRuns.length || moveNote}
  <div class="update" role="status">
    {#if oldRuns.length}
      In diesem Browser {oldRuns.length === 1 ? "liegt" : "liegen"} noch {runsText(oldRuns.length)} aus älteren
      Versionen. Der Simulator ist jetzt im Labor.
      <button onclick={moveOldRuns}>Ins Labor übertragen</button>
    {:else}
      {moveNote}
      <button onclick={() => (moveNote = undefined)}>OK</button>
    {/if}
  </div>
{/if}

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
  {:else if pool && tab === "sim" && labScreens}
    {#await labScreens then screens}
      {#if replay}
        <screens.ReplayScreen
          {pool}
          job={replay.job}
          index={replay.index}
          names={replay.names}
          expected={replay.expected}
          onclose={() => (replay = null)}
        />
      {:else}
        <screens.SimScreen
          {pool}
          onreplay={(job, index, names, expected) => (replay = { job, index, names, expected })}
        />
      {/if}
    {/await}
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
  .lab-badge {
    padding: 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, #f5c451 22%, transparent);
    color: #f5c451;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
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
  .account {
    margin-left: auto;
  }
  @media (max-width: 600px) {
    .top {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    /* Beside the name of the app, top right. */
    .account {
      position: absolute;
      top: 6px;
      right: max(16px, env(safe-area-inset-right));
    }
  }
</style>
