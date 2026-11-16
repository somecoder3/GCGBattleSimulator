<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { AI_LABELS, AI_NAMES, type AiName } from "../../../ai/registry";
  import type { CardPool } from "../../../data/cards";
  import { runPool } from "../../../sim/pool";
  import type { DeckEntry, GameSummary, SimJob } from "../../../sim/runner";
  import {
    cardStats,
    computeStats,
    gamesCsv,
    metaWeighted,
    type CardStat,
    type Rate,
    type SimStats,
  } from "../../../sim/stats";
  import { db, download, type SavedRun } from "../../lib/db";
  import { SNAPSHOT, deckChoices, preset, type DeckChoice } from "../../lib/decks";
  import { createWorkers, defaultWorkerCount, type BrowserWorker } from "../../lib/simworkers";

  // Simulator: many AI games in Web Workers, live statistics, saved runs, card performance, replays.

  let {
    pool,
    userDecks = [],
    onreplay,
  }: {
    pool: CardPool;
    userDecks?: DeckChoice[];
    onreplay: (job: SimJob, index: number, names: Record<string, string>) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const CHOICES = [...deckChoices(pool), ...userDecks];

  let selectedDecks = $state<string[]>(
    CHOICES.filter((d) => d.group === "meta")
      .slice(0, 8)
      .map((d) => d.id),
  );
  let randomDecks = $state(false);
  // A deck chosen in the Meta or Decks tab ("simulate against the field").
  let mode = $state<"pairs" | "gauntlet">(preset.gauntlet ? "gauntlet" : "pairs");
  let focus = $state(preset.gauntlet ?? CHOICES[0]?.id ?? "");
  preset.gauntlet = null;
  let aiA = $state<AiName>("heuristic-v1");
  let aiB = $state<AiName>("heuristic-v1");
  let games = $state(1000);
  let seed = $state(1);
  let workerCount = $state(defaultWorkerCount());

  let running = $state(false);
  let done = $state(0);
  let total = $state(0);
  let elapsed = $state(0);
  let error = $state<string>();
  let results = $state.raw<GameSummary[]>([]);
  let stats = $state.raw<SimStats>();
  let job = $state.raw<SimJob>();
  let names = $state.raw<Record<string, string>>({});
  let runs = $state.raw<SavedRun[]>([]);
  let view = $state<"overview" | "matrix" | "cards" | "games">("overview");
  let cardDeck = $state("");
  let gameFilter = $state("");

  let workers: BrowserWorker[] = [];
  let abort: AbortController | undefined;
  let started = 0;

  onMount(() => void loadRuns());
  onDestroy(stop);

  async function loadRuns() {
    try {
      runs = (await db.runs.all()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      runs = [];
    }
  }

  const deckName = (id: string) => names[id] ?? CHOICES.find((d) => d.id === id)?.name ?? id;
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const interval = (r: Rate) => `${pct(r.low)} – ${pct(r.high)}, ${r.games} Spiele`;

  function toggleDeck(id: string) {
    selectedDecks = selectedDecks.includes(id)
      ? selectedDecks.filter((d) => d !== id)
      : [...selectedDecks, id];
  }

  async function start() {
    const gauntlet = mode === "gauntlet" && !randomDecks;
    const chosen = randomDecks
      ? []
      : CHOICES.filter((d) => selectedDecks.includes(d.id) || (gauntlet && d.id === focus));
    const decks: DeckEntry[] = chosen.map((d) => ({ id: d.id, name: d.name, deck: d.deck }));
    const shares = Object.fromEntries(chosen.filter((d) => d.share).map((d) => [d.id, d.share!]));
    const next: SimJob = {
      decks,
      ai: [aiA, aiB],
      games: Math.max(1, Math.floor(games)),
      seed: Math.floor(seed) >>> 0,
      cardStats: true,
      shares,
      ...(gauntlet ? { mode: "gauntlet" as const, focus } : {}),
    };
    if (!randomDecks && decks.length < (gauntlet ? 2 : 1)) {
      error = gauntlet
        ? "Für Gauntlet mindestens ein Gegner-Deck auswählen."
        : "Mindestens ein Deck auswählen.";
      return;
    }
    error = undefined;
    job = next;
    names = Object.fromEntries(chosen.map((d) => [d.id, d.name]));
    running = true;
    done = 0;
    total = next.games;
    results = [];
    stats = undefined;
    view = "overview";
    started = performance.now();
    abort = new AbortController();
    workers = createWorkers(Math.min(workerCount, next.games));
    let collected: GameSummary[] = [];
    let lastStats = 0;
    try {
      await runPool(next, workers, {
        signal: abort.signal,
        onProgress: (n, _total, latest) => {
          done = n;
          elapsed = (performance.now() - started) / 1000;
          collected = [...collected, ...latest];
          if (performance.now() - lastStats > 500 || n === next.games) {
            lastStats = performance.now();
            results = collected;
            stats = computeStats(collected);
          }
        },
      });
      results = collected.sort((a, b) => a.index - b.index);
      stats = computeStats(results);
      cardDeck = gauntlet ? focus : (decks[0]?.id ?? "");
      await save();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      stop();
    }
  }

  function stop() {
    abort?.abort();
    for (const w of workers) w.terminate();
    workers = [];
    running = false;
    elapsed = (performance.now() - started) / 1000;
  }

  async function save() {
    if (!job || !results.length) return;
    const label = !job.decks.length
      ? "Zufallsdecks"
      : `${job.decks.length} Decks${job.mode === "gauntlet" ? ` · Gauntlet ${job.focus}` : ""}`;
    try {
      await db.runs.put({
        name: `${label} · ${job.ai.join(" / ")} · ${results.length} Spiele`,
        createdAt: new Date().toISOString(),
        job,
        games: results,
        deckNames: names,
      });
      await loadRuns();
    } catch {
      // Saving is optional (e.g. private browsing).
    }
  }

  function openRun(r: SavedRun) {
    job = r.job;
    names = r.deckNames;
    results = r.games;
    stats = computeStats(r.games);
    total = done = r.games.length;
    elapsed = 0;
    cardDeck = r.job.mode === "gauntlet" ? (r.job.focus ?? "") : (r.job.decks[0]?.id ?? "");
    view = "overview";
  }

  async function deleteRun(r: SavedRun) {
    if (r.id === undefined) return;
    await db.runs.delete(r.id);
    await loadRuns();
  }

  const fileBase = $derived(`simulation-${job?.seed ?? 0}-${results.length}`);
  const matrixDecks = $derived(stats ? Object.keys(stats.matrix).sort() : []);
  const weighted = $derived(stats && job?.shares ? metaWeighted(stats, job.shares) : {});
  const rate = $derived(elapsed > 0 ? done / elapsed : 0);
  const eta = $derived(rate > 0 ? (total - done) / rate : 0);
  const deckIds = $derived([...new Set(results.flatMap((g) => g.decks))].sort());

  let sortKey = $state<"drawn" | "played" | "opening" | "delta">("delta");
  const cards = $derived.by((): (CardStat & { delta: number; name: string })[] => {
    if (view !== "cards" || !cardDeck) return [];
    return cardStats(results, cardDeck)
      .map((c) => ({ ...c, delta: c.drawn.rate - c.notDrawn.rate, name: pool.get(c.no)?.name ?? c.no }))
      .filter((c) => c.drawn.games >= 10)
      .sort((a, b) => (sortKey === "delta" ? b.delta - a.delta : b[sortKey].rate - a[sortKey].rate));
  });

  const shownGames = $derived(
    view === "games" ? results.filter((g) => !gameFilter || g.decks.includes(gameFilter)).slice(0, 300) : [],
  );

  const TABS = [
    ["overview", "Übersicht"],
    ["matrix", "Matchups"],
    ["cards", "Karten"],
    ["games", "Spiele"],
  ] as const;

  /** Red (0 %) over grey (50 %) to green (100 %). */
  function heat(r: number): string {
    const d = Math.min(1, Math.abs(r - 0.5) * 2.2);
    const hue = r >= 0.5 ? "63 191 111" : "255 75 85";
    return `rgb(${hue} / ${(0.12 + d * 0.6).toFixed(2)})`;
  }
  const outcome = (g: GameSummary) =>
    g.error ? "Fehler" : g.winner === null ? "Unentschieden" : `${g.decks[g.winner]} gewinnt`;
  const groupLabel = (g: DeckChoice["group"]) =>
    g === "meta"
      ? `Meta${SNAPSHOT ? ` (bis ${SNAPSHOT.to})` : ""}`
      : g === "user"
        ? "Eigene Decks"
        : "Starter-Decks";
</script>

<section class="sim">
  <div class="left">
    <div class="panel settings">
      <h1>Simulator</h1>
      <p class="lead">KI gegen KI in Web Workern auf allen Kernen. Jedes Spiel folgt aus Seed und Nummer.</p>

      <fieldset disabled={running}>
        <legend>Decks</legend>
        <label class="check"
          ><input type="checkbox" bind:checked={randomDecks} /> Zufallsdecks aus allen Karten</label
        >
        {#if !randomDecks}
          <div class="modes" role="radiogroup" aria-label="Paarungen">
            <label class="check"
              ><input type="radio" bind:group={mode} value="pairs" /> Jeder gegen jeden</label
            >
            <label class="check"
              ><input type="radio" bind:group={mode} value="gauntlet" /> Gauntlet: ein Deck gegen das Feld</label
            >
          </div>
          {#if mode === "gauntlet"}
            <label>
              Deck
              <select bind:value={focus}>
                {#each CHOICES as d (d.id)}<option value={d.id}>{d.id} {d.name}</option>{/each}
              </select>
            </label>
          {/if}
          {#each CHOICES as d, i (d.id)}
            {#if i === 0 || CHOICES[i - 1]!.group !== d.group}
              <span class="group">{groupLabel(d.group)}</span>
            {/if}
            <label class="check" class:partial={!d.supported}>
              <input
                type="checkbox"
                checked={selectedDecks.includes(d.id)}
                onchange={() => toggleDeck(d.id)}
              />
              <span>
                {d.id}
                {d.name}
                {#if d.share !== undefined}<small>{pct(d.share)}</small>{/if}
                {#if !d.supported}<small title="Nicht alle Kartentexte werden verstanden">unvollständig</small
                  >{/if}
              </span>
            </label>
          {/each}
          <p class="hint">
            {mode === "gauntlet"
              ? "Das gewählte Deck spielt gegen jedes angehakte Deck."
              : "Jedes Paar einmal, auch Spiegelspiele."}
          </p>
        {/if}
      </fieldset>

      <fieldset disabled={running}>
        <legend>Einstellungen</legend>
        <label>
          KI A
          <select bind:value={aiA}>
            {#each AI_NAMES as n (n)}<option value={n}>{AI_LABELS[n]}</option>{/each}
          </select>
        </label>
        <label>
          KI B
          <select bind:value={aiB}>
            {#each AI_NAMES as n (n)}<option value={n}>{AI_LABELS[n]}</option>{/each}
          </select>
        </label>
        <div class="row">
          <label>Spiele <input type="number" min="1" step="100" bind:value={games} /></label>
          <label>Seed <input type="number" min="0" bind:value={seed} /></label>
          <label>Worker <input type="number" min="1" max="64" bind:value={workerCount} /></label>
        </div>
        <p class="hint">Genauigkeit einer Siegquote: 200 Spiele ≈ ±7 %, 1000 ≈ ±3 % (95 %).</p>
      </fieldset>

      <div class="actions">
        {#if running}
          <button class="btn" onclick={stop}>Abbrechen</button>
        {:else}
          <button class="btn primary" onclick={start}>Simulation starten</button>
        {/if}
      </div>
      {#if error}<p class="error">{error}</p>{/if}
    </div>

    {#if runs.length}
      <div class="panel runs">
        <h2>Gespeicherte Läufe</h2>
        <ul>
          {#each runs as r (r.id)}
            <li>
              <button class="link" onclick={() => openRun(r)} disabled={running}>
                {r.name}
                <small>{new Date(r.createdAt).toLocaleString("de-DE")}</small>
              </button>
              <button class="icon" onclick={() => deleteRun(r)} title="Löschen" aria-label="Lauf löschen"
                >✕</button
              >
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  <div class="panel results">
    {#if total}
      <div class="progress" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
        <div class="bar" style="width: {(done / total) * 100}%"></div>
      </div>
      <p class="meta">
        {done} / {total} Spiele
        {#if elapsed}· {elapsed.toFixed(1)} s · {rate.toFixed(0)} Spiele/s{/if}
        {#if running && eta}· noch ~{eta.toFixed(0)} s{/if}
      </p>
    {:else}
      <p class="hint">
        Noch keine Ergebnisse. Einstellungen wählen und starten, oder einen gespeicherten Lauf öffnen.
      </p>
    {/if}

    {#if stats}
      <div class="tabs" role="tablist">
        {#each TABS as [key, label] (key)}
          <button
            role="tab"
            aria-selected={view === key}
            class:active={view === key}
            onclick={() => (view = key)}
          >
            {label}
          </button>
        {/each}
        <span class="spacer"></span>
        {#if !running && results.length}
          <button
            class="btn small"
            onclick={() => download(`${fileBase}.json`, JSON.stringify({ job, games: results }, null, 1))}
            >JSON</button
          >
          <button class="btn small" onclick={() => download(`${fileBase}.csv`, gamesCsv(results), "text/csv")}
            >CSV</button
          >
        {/if}
      </div>

      {#if stats.errors}<p class="error">{stats.errors} Spiele mit Fehler.</p>{/if}

      {#if view === "overview"}
        <div class="facts">
          <div>
            <span>Startspieler gewinnt</span><strong>{pct(stats.firstPlayer.rate)}</strong><small
              >{interval(stats.firstPlayer)}</small
            >
          </div>
          <div>
            <span>Ø Züge</span><strong>{stats.turns.toFixed(1)}</strong><small
              >{stats.decisions.toFixed(0)} Entscheidungen</small
            >
          </div>
          <div>
            <span>Mulligan</span><strong>{pct(stats.mulliganRate)}</strong><small>der Starthände</small>
          </div>
          <div>
            <span>Spielende</span>
            <strong>{pct((stats.reasons.damage ?? 0) / Math.max(1, stats.games))}</strong>
            <small>
              durch Schaden{stats.reasons.deckOut ? `, ${stats.reasons.deckOut}× Deck leer` : ""}{stats
                .reasons.turnLimit
                ? `, ${stats.reasons.turnLimit}× Zuglimit`
                : ""}
            </small>
          </div>
        </div>

        {#if Object.keys(stats.byAi).length}
          <h2>KI</h2>
          <table>
            <thead><tr><th>KI</th><th>Siegquote</th><th>95-%-Intervall</th></tr></thead>
            <tbody>
              {#each Object.entries(stats.byAi).sort((a, b) => b[1].rate - a[1].rate) as [ai, r] (ai)}
                <tr><td>{AI_LABELS[ai as AiName] ?? ai}</td><td>{pct(r.rate)}</td><td>{interval(r)}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if matrixDecks.length > 1}
          <h2>Decks</h2>
          <table>
            <thead>
              <tr>
                <th>Deck</th><th>Siegquote</th><th>95-%-Intervall</th>
                {#if Object.keys(weighted).length}<th title="Gegen das Feld, gewichtet nach Meta-Anteil"
                    >Meta-gewichtet</th
                  >{/if}
              </tr>
            </thead>
            <tbody>
              {#each Object.entries(stats.byDeck).sort((a, b) => b[1].rate - a[1].rate) as [deck, r] (deck)}
                <tr>
                  <td>{deck} {deckName(deck)}</td><td>{pct(r.rate)}</td><td>{interval(r)}</td>
                  {#if Object.keys(weighted).length}<td
                      >{weighted[deck] !== undefined ? pct(weighted[deck]) : "–"}</td
                    >{/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
        <p class="hint">
          Die Werte spiegeln das Spiel der KI wider, nicht das von Menschen. Intervalle: 95 % (Wilson).
        </p>
      {:else if view === "matrix"}
        {#if matrixDecks.length > 1}
          <h2>Matchups <small>(Zeile gegen Spalte)</small></h2>
          <div class="scroll">
            <table class="matrix">
              <thead
                ><tr
                  ><th></th>{#each matrixDecks as b (b)}<th title={deckName(b)}>{b}</th>{/each}</tr
                ></thead
              >
              <tbody>
                {#each matrixDecks as a (a)}
                  <tr>
                    <th title={deckName(a)}>{a}</th>
                    {#each matrixDecks as b (b)}
                      {@const r = stats.matrix[a]?.[b]}
                      {#if r && a !== b}
                        <td
                          style="background: {heat(r.rate)}"
                          title="{deckName(a)} gegen {deckName(b)}: {interval(r)}"
                        >
                          {pct(r.rate)}
                        </td>
                      {:else}
                        <td class="mirror">–</td>
                      {/if}
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <p class="hint">Für eine Matrix braucht es mindestens zwei Decks.</p>
        {/if}
      {:else if view === "cards"}
        <div class="row-inline">
          <label>
            Deck
            <select bind:value={cardDeck}>
              {#each deckIds as id (id)}<option value={id}>{id} {deckName(id)}</option>{/each}
            </select>
          </label>
          <label>
            Sortieren
            <select bind:value={sortKey}>
              <option value="delta">Unterschied gezogen / nicht gezogen</option>
              <option value="drawn">Siegquote gezogen</option>
              <option value="played">Siegquote gespielt</option>
              <option value="opening">Siegquote in Starthand</option>
            </select>
          </label>
        </div>
        {#if cards.length}
          <div class="scroll">
            <table class="cards">
              <thead>
                <tr>
                  <th>Karte</th><th>Gezogen</th><th>Gespielt</th><th>Starthand</th><th>Nicht gezogen</th>
                  <th title="Siegquote gezogen minus nicht gezogen">Δ</th>
                </tr>
              </thead>
              <tbody>
                {#each cards as c (c.no)}
                  <tr>
                    <td><span class="no">{c.no}</span> {c.name}</td>
                    <td title={interval(c.drawn)}>{pct(c.drawn.rate)} <small>{c.drawn.games}</small></td>
                    <td title={interval(c.played)}
                      >{c.played.games ? pct(c.played.rate) : "–"} <small>{c.played.games}</small></td
                    >
                    <td title={interval(c.opening)}
                      >{c.opening.games ? pct(c.opening.rate) : "–"} <small>{c.opening.games}</small></td
                    >
                    <td title={interval(c.notDrawn)}
                      >{c.notDrawn.games ? pct(c.notDrawn.rate) : "–"} <small>{c.notDrawn.games}</small></td
                    >
                    <td style="color: {c.delta >= 0 ? '#7fe0a0' : '#ff8a8a'}"
                      >{c.delta >= 0 ? "+" : ""}{(c.delta * 100).toFixed(1)}</td
                    >
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <p class="hint">
            Wie bei 17lands: Siegquote des Decks in Spielen, in denen die Karte gezogen, gespielt oder in der
            Starthand war (ab 10 Spielen). Kleine Zahl = Spiele.
          </p>
        {:else}
          <p class="hint">
            Keine Kartendaten für dieses Deck (ältere Läufe ohne Kartenstatistik oder zu wenige Spiele).
          </p>
        {/if}
      {:else if view === "games"}
        <div class="row-inline">
          <label>
            Deck
            <select bind:value={gameFilter}>
              <option value="">alle</option>
              {#each deckIds as id (id)}<option value={id}>{id} {deckName(id)}</option>{/each}
            </select>
          </label>
        </div>
        <div class="scroll">
          <table class="games">
            <thead
              ><tr
                ><th>#</th><th>Decks</th><th>KI</th><th>Beginnt</th><th>Ergebnis</th><th>Züge</th><th
                ></th></tr
              ></thead
            >
            <tbody>
              {#each shownGames as g (g.index)}
                <tr>
                  <td>{g.index}</td>
                  <td>{g.decks[0]} – {g.decks[1]}</td>
                  <td>{g.ai[0] === g.ai[1] ? g.ai[0] : `${g.ai[0]} – ${g.ai[1]}`}</td>
                  <td>{g.decks[g.firstPlayer]}</td>
                  <td>{outcome(g)}</td>
                  <td>{g.turns}</td>
                  <td>
                    {#if job}<button class="btn small" onclick={() => onreplay(job!, g.index, names)}
                        >Replay</button
                      >{/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="hint">Bis zu 300 Spiele. Ein Replay spielt das Spiel aus Seed und Nummer exakt nach.</p>
      {/if}
    {/if}
  </div>
</section>

<style>
  .sim {
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .left {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .panel {
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
  }
  .results {
    min-width: 0;
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
  }
  h2 {
    margin: 20px 0 8px;
    font-size: 16px;
  }
  .runs h2 {
    margin-top: 0;
  }
  h2 small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .lead,
  .hint,
  .meta {
    margin: 0 0 12px;
    color: var(--text-dim);
    font-size: 13px;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 0 14px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  legend {
    padding: 0 6px;
    color: var(--text-dim);
    font-size: 13px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--text-dim);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    color: var(--text);
  }
  label.check small {
    margin-left: 6px;
    color: var(--text-dim);
  }
  label.check.partial {
    opacity: 0.7;
  }
  .modes {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .group {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .row-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 10px;
  }
  select,
  input[type="number"] {
    min-height: 34px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    min-width: 0;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .btn {
    min-height: 38px;
    padding: 6px 16px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .btn.small {
    min-height: 28px;
    padding: 2px 10px;
    font-size: 13px;
  }
  .btn.primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
  .error {
    color: var(--danger);
  }
  .runs ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 320px;
    overflow: auto;
  }
  .runs li {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .link {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    text-align: left;
    font-size: 13px;
  }
  .link:hover {
    border-color: var(--line);
    background: var(--bg-sunken);
  }
  .link small {
    color: var(--text-dim);
  }
  .icon {
    width: 28px;
    height: 28px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .progress {
    height: 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    overflow: hidden;
    margin-bottom: 8px;
  }
  .bar {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-strong), var(--accent));
    transition: width 0.3s;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    margin: 6px 0 14px;
  }
  .tabs [role="tab"] {
    padding: 5px 12px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: none;
    color: var(--text-dim);
  }
  .tabs [role="tab"].active {
    color: var(--text);
    border-color: var(--line);
    background: var(--bg-sunken);
  }
  .spacer {
    flex: 1;
  }
  .facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }
  .facts div {
    display: flex;
    flex-direction: column;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .facts span,
  .facts small {
    color: var(--text-dim);
    font-size: 12px;
  }
  .facts strong {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .scroll {
    overflow: auto;
    max-height: 70vh;
  }
  table {
    border-collapse: collapse;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 5px 12px;
    border-bottom: 1px solid var(--line);
    text-align: left;
    white-space: nowrap;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--bg-raised);
    color: var(--text-dim);
    font-weight: 500;
  }
  td small,
  .no {
    color: var(--text-dim);
    font-size: 12px;
  }
  .matrix td {
    text-align: center;
    min-width: 70px;
  }
  .matrix .mirror {
    color: var(--text-dim);
  }
  @media (max-width: 860px) {
    .sim {
      grid-template-columns: 1fr;
    }
  }
</style>
