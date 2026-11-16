<script lang="ts">
  import { onDestroy } from "svelte";
  import { AI_LABELS, AI_NAMES, type AiName } from "../../../ai/registry";
  import { STARTER_DECKS } from "../../../data/decks";
  import { runPool } from "../../../sim/pool";
  import type { DeckEntry, GameSummary, SimJob } from "../../../sim/runner";
  import { computeStats, type Rate, type SimStats } from "../../../sim/stats";
  import { createWorkers, defaultWorkerCount, type BrowserWorker } from "../../lib/simworkers";

  // Simulator: many AI games in Web Workers, with live statistics.

  const DECKS: DeckEntry[] = STARTER_DECKS.map((d) => ({ id: d.id, name: d.name, deck: d.deck }));

  let selectedDecks = $state<string[]>(DECKS.map((d) => d.id));
  let randomDecks = $state(false);
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
  let lastJob = $state.raw<SimJob>();

  let workers: BrowserWorker[] = [];
  let abort: AbortController | undefined;
  let started = 0;

  const deckName = (id: string) => DECKS.find((d) => d.id === id)?.name ?? id;
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  const interval = (r: Rate) => `${pct(r.low)} – ${pct(r.high)}, ${r.games} Spiele`;

  function toggleDeck(id: string) {
    selectedDecks = selectedDecks.includes(id)
      ? selectedDecks.filter((d) => d !== id)
      : [...selectedDecks, id];
  }

  async function start() {
    const job: SimJob = {
      decks: randomDecks ? [] : DECKS.filter((d) => selectedDecks.includes(d.id)),
      ai: [aiA, aiB],
      games: Math.max(1, Math.floor(games)),
      seed: Math.floor(seed) >>> 0,
    };
    if (!randomDecks && !job.decks.length) {
      error = "Mindestens ein Deck auswählen.";
      return;
    }
    error = undefined;
    lastJob = job;
    running = true;
    done = 0;
    total = job.games;
    results = [];
    stats = undefined;
    started = performance.now();
    abort = new AbortController();
    workers = createWorkers(Math.min(workerCount, job.games));
    let collected: GameSummary[] = [];
    let lastStats = 0;
    try {
      await runPool(job, workers, {
        signal: abort.signal,
        onProgress: (n, _total, latest) => {
          done = n;
          elapsed = (performance.now() - started) / 1000;
          collected = [...collected, ...latest];
          if (performance.now() - lastStats > 400 || n === job.games) {
            lastStats = performance.now();
            results = collected;
            stats = computeStats(collected);
          }
        },
      });
      results = collected;
      stats = computeStats(collected);
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

  onDestroy(stop);

  function download() {
    const blob = new Blob([JSON.stringify({ job: lastJob, games: results }, null, 1)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `simulation-${lastJob?.seed ?? 0}-${results.length}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const matrixDecks = $derived(stats ? Object.keys(stats.matrix).sort() : []);
  const rate = $derived(elapsed > 0 ? done / elapsed : 0);
  const eta = $derived(rate > 0 ? (total - done) / rate : 0);

  /** Red (0 %) over grey (50 %) to green (100 %). */
  function heat(r: number): string {
    const d = Math.min(1, Math.abs(r - 0.5) * 2.2);
    const hue = r >= 0.5 ? "63 191 111" : "255 75 85";
    return `rgb(${hue} / ${(0.12 + d * 0.6).toFixed(2)})`;
  }
</script>

<section class="sim">
  <div class="panel settings">
    <h1>Simulator</h1>
    <p class="lead">KI gegen KI in Web Workern auf allen Kernen. Jedes Spiel folgt aus Seed und Nummer.</p>

    <fieldset disabled={running}>
      <legend>Decks</legend>
      <label class="check"
        ><input type="checkbox" bind:checked={randomDecks} /> Zufallsdecks aus allen Karten</label
      >
      {#if !randomDecks}
        {#each DECKS as d (d.id)}
          <label class="check">
            <input type="checkbox" checked={selectedDecks.includes(d.id)} onchange={() => toggleDeck(d.id)} />
            {d.id}
            {d.name}
          </label>
        {/each}
        <p class="hint">Jedes Paar einmal, auch Spiegelspiele.</p>
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
    </fieldset>

    <div class="actions">
      {#if running}
        <button class="btn" onclick={stop}>Abbrechen</button>
      {:else}
        <button class="btn primary" onclick={start}>Simulation starten</button>
      {/if}
      {#if results.length && !running}
        <button class="btn" onclick={download}>Ergebnisse als JSON</button>
      {/if}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  <div class="panel results">
    {#if total}
      <div class="progress" role="progressbar" aria-valuenow={done} aria-valuemax={total}>
        <div class="bar" style="width: {(done / total) * 100}%"></div>
      </div>
      <p class="meta">
        {done} / {total} Spiele · {elapsed.toFixed(1)} s · {rate.toFixed(0)} Spiele/s
        {#if running && eta}· noch ~{eta.toFixed(0)} s{/if}
      </p>
    {:else}
      <p class="hint">Noch keine Ergebnisse. Einstellungen wählen und starten.</p>
    {/if}

    {#if stats}
      {#if stats.errors}<p class="error">{stats.errors} Spiele mit Fehler.</p>{/if}
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
          <small
            >durch Schaden{stats.reasons.deckOut ? `, ${stats.reasons.deckOut}× Deck leer` : ""}{stats.reasons
              .turnLimit
              ? `, ${stats.reasons.turnLimit}× Zuglimit`
              : ""}</small
          >
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
          <thead><tr><th>Deck</th><th>Siegquote</th><th>95-%-Intervall</th></tr></thead>
          <tbody>
            {#each Object.entries(stats.byDeck).sort((a, b) => b[1].rate - a[1].rate) as [deck, r] (deck)}
              <tr><td>{deck} {deckName(deck)}</td><td>{pct(r.rate)}</td><td>{interval(r)}</td></tr>
            {/each}
          </tbody>
        </table>

        <h2>Matchups <small>(Zeile gegen Spalte)</small></h2>
        <table class="matrix">
          <thead>
            <tr
              ><th></th>{#each matrixDecks as b (b)}<th title={deckName(b)}>{b}</th>{/each}</tr
            >
          </thead>
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
      {/if}
      <p class="hint">
        Die Werte spiegeln das Spiel der KI wider, nicht das von Menschen. Intervalle: 95 % (Wilson).
      </p>
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
  .panel {
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
  }
  h2 {
    margin: 22px 0 8px;
    font-size: 16px;
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
  .row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
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
  .btn.primary {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
  .error {
    color: var(--danger);
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
  }
  thead th {
    color: var(--text-dim);
    font-weight: 500;
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
