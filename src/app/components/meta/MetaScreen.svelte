<script lang="ts">
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import { validateDeck } from "../../../engine/deck";
  import type { DeckList } from "../../../engine/types";
  import { archetypeProblems, entryProblems, toDeckList } from "../../../meta/archetypes";
  import { BANLIST_DATE, BANNED, BANNED_PAIRS, RESTRICTED, VANILLA_TWO_TWO } from "../../../meta/banlist";
  import { metaDecks, type MetaDeck } from "../../../meta/decks";
  import { egmanPart, sameEvent, withEgman } from "../../../meta/egman";
  import { fetchSnapshot } from "../../../meta/limitless";
  import type { MetaSnapshot } from "../../../meta/types";
  import { db } from "../../lib/db";
  import { BUNDLED_SNAPSHOT, SNAPSHOT, cardLib, pickDeck, preset, setSnapshot } from "../../lib/decks";
  import CardImage from "../CardImage.svelte";
  import CardDetail from "../CardDetail.svelte";

  // Meta: archetypes of the active snapshot with share, lists and support; consensus and best list;
  // reloading from Limitless in the browser; the banlist.

  let { pool }: { pool: CardPool } = $props();

  // svelte-ignore state_referenced_locally
  const lib = cardLib(pool);
  let snapshot = $state.raw<MetaSnapshot | undefined>(SNAPSHOT);
  const decks = $derived(snapshot ? metaDecks(snapshot, lib) : []);
  let selectedId = $state<string>();
  /** Shown list: the consensus list or a real list (index into the archetype's entries, best first). */
  let shown = $state<"consensus" | number>("consensus");
  let detail = $state<ReturnType<CardPool["get"]>>();

  let weeks = $state(8);
  let minPlayers = $state(8);
  let topN = $state(16);
  let loading = $state(false);
  let log = $state<string[]>([]);
  let error = $state<string>();

  const selected = $derived(decks.find((d) => d.id === selectedId) ?? decks[0]);
  const entry = $derived(typeof shown === "number" ? selected?.archetype.entries[shown] : undefined);
  const list = $derived(
    selected ? (entry ? toDeckList(entry.cards) : selected.archetype.consensus) : undefined,
  );
  const entryCount = $derived(entry ? Object.values(entry.cards).reduce((a, b) => a + b, 0) : 0);
  function choose(id: string) {
    selectedId = id;
    shown = "consensus";
  }

  const TYPE_ORDER = ["UNIT", "PILOT", "COMMAND", "BASE"] as const;
  const TYPE_NAMES: Record<string, string> = {
    UNIT: "Units",
    PILOT: "Piloten",
    COMMAND: "Commands",
    BASE: "Bases",
  };

  function grouped(deck: DeckList) {
    const counts: Record<string, number> = {};
    for (const no of deck.main) counts[no] = (counts[no] ?? 0) + 1;
    return TYPE_ORDER.map((type) => ({
      type,
      cards: Object.entries(counts)
        .filter(([no]) => lib.has(no) && lib.get(no).type === type)
        .map(([no, n]) => ({ no, n, card: pool.get(no)!, partial: lib.get(no).script.status === "partial" }))
        .sort((a, b) => (a.card.level ?? 0) - (b.card.level ?? 0) || a.no.localeCompare(b.no)),
    })).filter((g) => g.cards.length);
  }

  async function reload() {
    loading = true;
    error = undefined;
    log = [];
    try {
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - weeks * 7 * 86_400_000).toISOString().slice(0, 10);
      const fresh = await fetchSnapshot(pool, {
        from,
        to,
        minPlayers,
        topN,
        onProgress: (text) => (log = [...log, text]),
      });
      // Egman is only asked by the weekly snapshot; its tournaments come from the bundled one.
      const known = new Set(fresh.tournaments.map((t) => sameEvent(t.date, t.name)));
      const egman = egmanPart(BUNDLED_SNAPSHOT, from, to);
      const keep = new Set(
        egman.tournaments
          .filter((t) => t.players >= minPlayers && !known.has(sameEvent(t.date, t.name)))
          .map((t) => t.id),
      );
      const next = withEgman(fresh, {
        tournaments: egman.tournaments.filter((t) => keep.has(t.id)),
        decks: egman.decks.filter((d) => keep.has(d.tournament) && d.placing <= topN),
      });
      if (keep.size) log = [...log, `Egman (mitgeliefert): ${keep.size} Turniere übernommen`];
      if (!next.decks.length) throw new Error("Keine Turniere mit Decklisten in diesem Zeitraum.");
      snapshot = next;
      setSnapshot(next);
      await db.meta.put(next).catch(() => undefined);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function useBundled() {
    snapshot = BUNDLED_SNAPSHOT;
    setSnapshot(undefined);
    await db.meta.clear().catch(() => undefined);
  }

  /** The list on screen can be played: the consensus list always, a real list if it is legal. */
  const shownIllegal = $derived(
    entry && list ? validateDeck(lib, list).length > 0 || entryProblems(entry, lib).length > 0 : false,
  );

  /** Id of the list on screen for the game or the simulator: M03 (consensus) or M03T5 (5th real list). */
  function shownId(d: MetaDeck): string {
    if (!entry || typeof shown !== "number" || !list) return d.id;
    const id = `${d.id}T${shown + 1}`;
    pickDeck({
      id,
      name: `${d.name} – Platz ${entry.placing} ${entry.tournament.name}`,
      colors: d.colors,
      deck: list,
      group: "meta",
      supported: list.main.every((no) => lib.has(no) && lib.get(no).script.status !== "partial"),
    });
    return id;
  }
  function play(d: MetaDeck) {
    preset.play = shownId(d);
    location.hash = "#play";
  }
  function gauntlet(d: MetaDeck) {
    preset.gauntlet = shownId(d);
    location.hash = "#sim";
  }
  const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
  /** Tournaments of a source that contributed deck lists (Limitless also lists ones without). */
  const withLists = (source: "limitless" | "egman") => {
    const used = new Set(snapshot?.decks.map((d) => d.tournament));
    return (snapshot?.tournaments ?? []).filter((t) => (t.source ?? "limitless") === source && used.has(t.id))
      .length;
  };
</script>

<section class="meta">
  <div class="panel side">
    <h1>Meta</h1>
    {#if snapshot}
      <p class="lead">
        Turniere {snapshot.from} bis {snapshot.to} (ab {snapshot.minPlayers} Spielern, Top {snapshot.topN}):
        {snapshot.decks.length} Listen aus {new Set(snapshot.decks.map((d) => d.tournament)).size} Turnieren.
        {snapshot === BUNDLED_SNAPSHOT ? "Mitgelieferter Stand." : "Im Browser geladen."}
      </p>
      <p class="hint sources">
        Quellen: <a href="https://play.limitlesstcg.com" target="_blank" rel="noopener">Limitless</a>
        ({withLists("limitless")} Turniere)
        {#if snapshot.tournaments.some((t) => t.source === "egman")}
          und <a href="https://deckbuilder.egmanevents.com/gundam/tournaments" target="_blank" rel="noopener"
            >Egman Deck Builder</a
          >
          ({withLists("egman")} Turniere, vor allem große Regionals)
        {/if}.
      </p>
    {/if}
    <ol class="archetypes">
      {#each decks as d (d.id)}
        <li>
          <button class:active={selected?.id === d.id} onclick={() => choose(d.id)}>
            <span class="bar" style="width: {Math.min(100, d.share * 300)}%"></span>
            <span class="row1"><span class="id">{d.id}</span> {d.name}</span>
            <span class="row2">
              {pct(d.share)} · {d.archetype.lists} Listen · {d.colors}
              {#if !d.supported}<em>unvollständig</em>{/if}
            </span>
          </button>
        </li>
      {/each}
    </ol>

    <details class="reload">
      <summary>Neu von Limitless laden</summary>
      <div class="form">
        <label>Wochen <input type="number" min="1" max="52" bind:value={weeks} /></label>
        <label>ab Spielern <input type="number" min="2" bind:value={minPlayers} /></label>
        <label>Top <input type="number" min="1" bind:value={topN} /></label>
      </div>
      <div class="actions">
        <button class="btn primary" onclick={reload} disabled={loading}>{loading ? "Lade …" : "Laden"}</button
        >
        {#if snapshot !== BUNDLED_SNAPSHOT}<button class="btn" onclick={useBundled}
            >Mitgelieferten Stand nutzen</button
          >{/if}
      </div>
      <p class="hint">
        Fragt play.limitlesstcg.com ab (ein Abruf pro Turnier, gedrosselt). Die Turniere von Egman kommen aus
        dem mitgelieferten Stand (wöchentlich aktualisiert). Spielernamen werden nicht gespeichert.
      </p>
      {#if error}<p class="error">{error}</p>{/if}
      {#if log.length}<pre class="log">{log.join("\n")}</pre>{/if}
    </details>

    <details class="banlist">
      <summary>Bannliste (Stand {BANLIST_DATE})</summary>
      <ul>
        <li>Verboten: {BANNED.map((no) => `${no} ${pool.get(no)?.name ?? ""}`).join(", ")}</li>
        {#each Object.entries(RESTRICTED) as [no, n] (no)}<li>
            Höchstens {n}×: {no}
            {pool.get(no)?.name ?? ""}
          </li>{/each}
        {#each BANNED_PAIRS as pair, i (i)}
          <li>
            Nicht zusammen: {pair.a.map((no) => pool.get(no)?.name ?? no).join(", ")} und
            {pair.b.map((no) => pool.get(no)?.name ?? no).join(", ")}
          </li>
        {/each}
        <li>
          Units Lv.2/Kosten 1/2 AP/2 HP ohne Effekt ({VANILLA_TWO_TWO.length} Karten, z. B. GM, Jegan): je zwei
          verschiedene sind ein Bann-Paar, also nur eine Sorte (höchstens 4)
        </li>
      </ul>
    </details>
  </div>

  <div class="panel main">
    {#if selected && list}
      <header>
        <div>
          <span class="id">{selected.id}</span>
          <h2>{selected.name}</h2>
          <p class="hint">
            {pct(selected.share)} der Meta · {selected.archetype.lists} Listen · bestes Ergebnis Platz {selected
              .archetype.bestPlacing.placing} von {selected.archetype.entries[0]?.tournament.players}.
            {#if selected.archetype.partial.length}
              Nicht vollständig verstanden: {selected.archetype.partial.join(", ")}.
            {/if}
            {#if archetypeProblems(selected.archetype, lib).length}
              Bannliste: {archetypeProblems(selected.archetype, lib).join("; ")}.
            {/if}
          </p>
        </div>
        <div class="actions">
          <button class="btn primary" onclick={() => play(selected!)} disabled={shownIllegal}
            >Gegen die KI spielen</button
          >
          <button class="btn" onclick={() => gauntlet(selected!)} disabled={shownIllegal}
            >Gegen das Feld simulieren</button
          >
          <p class="hint plays">
            {#if shownIllegal}
              Diese Liste ist nicht turnierlegal und kann nicht gespielt werden.
            {:else if entry && typeof shown === "number"}
              Mit dieser Turnierliste ({selected.id}T{shown + 1}, Platz {entry.placing})
            {:else}
              Mit der Konsensliste ({selected.id})
            {/if}
          </p>
        </div>
      </header>
      <div class="switch" role="tablist">
        <button
          role="tab"
          aria-selected={shown === "consensus"}
          class:active={shown === "consensus"}
          onclick={() => (shown = "consensus")}>Konsensliste</button
        >
        <button
          role="tab"
          aria-selected={shown !== "consensus"}
          class:active={shown !== "consensus"}
          onclick={() => (shown = 0)}>Turnierlisten ({selected.archetype.entries.length})</button
        >
      </div>
      {#if entry}
        <ol class="entries">
          {#each selected.archetype.entries as e, i (i)}
            <li>
              <button class:active={shown === i} onclick={() => (shown = i)}>
                <span class="place">{e.placing}.</span>
                <span class="tname">{e.tournament.name}</span>
                <span class="meta-info"
                  >{e.tournament.players} Spieler · {e.tournament.date}{e.record.wins +
                  e.record.losses +
                  e.record.ties
                    ? ` · ${e.record.wins}-${e.record.losses}${e.record.ties ? `-${e.record.ties}` : ""}`
                    : ""}{e.tournament.source === "egman" ? " · Egman" : ""}</span
                >
              </button>
            </li>
          {/each}
        </ol>
        <p class="hint">
          Echte Turnierliste, unverändert. Sortiert nach Ergebnis: Platz und Turniergröße (log2 Spieler /
          √Platz), bei Gleichstand neuere zuerst.
          {#if entryCount !== 50}{entryCount} Karten.{/if}
          {#if entryProblems(entry, lib).length}
            Bannliste: {entryProblems(entry, lib).join("; ")}.
          {/if}
          Ressourcen-Deck: 10 Resource-Karten.
        </p>
      {:else}
        <p class="hint">
          Häufigste Anzahl jeder Karte über alle Listen (gewichtet nach Aktualität, Turniergröße, Platz),
          legal gemacht: zwei Hauptfarben, Bannliste. Ressourcen-Deck: 10 Resource-Karten (Limitless führt
          keines).
        </p>
      {/if}
      {#each grouped(list) as g (g.type)}
        <h3>{TYPE_NAMES[g.type]} <small>{g.cards.reduce((s, c) => s + c.n, 0)}</small></h3>
        <div class="cards">
          {#each g.cards as c (c.no)}
            <button
              class="card"
              class:partial={c.partial}
              onclick={() => (detail = c.card)}
              title="{c.no} {c.card.name}"
            >
              <CardImage card={c.card} src={cardImageUrl(c.card, "small")} />
              <span class="count">{c.n}×</span>
            </button>
          {/each}
        </div>
      {/each}
    {:else}
      <p class="hint">Kein Meta-Snapshot vorhanden.</p>
    {/if}
  </div>
</section>

{#if detail}
  <CardDetail card={detail} onclose={() => (detail = undefined)} />
{/if}

<style>
  .meta {
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }
  .panel {
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
  }
  h1 {
    margin: 0 0 4px;
    font-size: 22px;
  }
  h2 {
    margin: 0 0 4px;
    font-size: 20px;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 15px;
  }
  h3 small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .lead,
  .hint {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .archetypes {
    margin: 0 0 12px;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .archetypes button {
    position: relative;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    text-align: left;
    overflow: hidden;
  }
  .archetypes button.active,
  .archetypes button:hover {
    border-color: var(--line);
    background: var(--bg-sunken);
  }
  .bar {
    position: absolute;
    inset: auto auto 0 0;
    height: 3px;
    background: var(--accent);
    opacity: 0.6;
  }
  .row1 {
    font-size: 14px;
  }
  .row2 {
    font-size: 12px;
    color: var(--text-dim);
  }
  .row2 em {
    color: #ffd166;
    font-style: normal;
    margin-left: 6px;
  }
  .id {
    color: var(--text-dim);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  details {
    margin-top: 10px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  summary {
    cursor: pointer;
    font-size: 14px;
  }
  .form {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin: 10px 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  input {
    min-height: 32px;
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
    margin-bottom: 8px;
  }
  .btn {
    min-height: 36px;
    padding: 6px 14px;
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
  .plays {
    flex-basis: 100%;
    margin: 0;
    text-align: right;
    font-size: 12px;
  }
  .btn:disabled {
    opacity: 0.5;
  }
  .error {
    color: var(--danger);
    font-size: 13px;
  }
  .log {
    max-height: 160px;
    overflow: auto;
    font-size: 11px;
    color: var(--text-dim);
    white-space: pre-wrap;
  }
  .banlist ul {
    margin: 8px 0 0;
    padding-left: 18px;
    font-size: 13px;
    color: var(--text-dim);
  }
  header {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 12px;
  }
  .switch {
    display: flex;
    gap: 6px;
    margin: 12px 0 6px;
  }
  .switch button {
    padding: 5px 12px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: none;
    color: var(--text-dim);
  }
  .switch button.active {
    color: var(--text);
    border-color: var(--line);
    background: var(--bg-sunken);
  }
  .entries {
    max-height: 260px;
    overflow: auto;
    margin: 0 0 8px;
    padding: 0;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 10px;
  }
  .entries button {
    width: 100%;
    display: grid;
    grid-template-columns: 2.5em minmax(0, 1fr) auto;
    gap: 8px;
    align-items: baseline;
    padding: 5px 10px;
    border: 0;
    background: none;
    text-align: left;
    font-size: 13px;
  }
  .entries li + li button {
    border-top: 1px solid var(--line);
  }
  .entries button.active,
  .entries button:hover {
    background: var(--bg-sunken);
  }
  .entries button.active .tname {
    color: var(--accent);
  }
  .place {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .tname {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta-info {
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
  }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 10px;
  }
  .card {
    position: relative;
    padding: 0;
    border: 0;
    background: none;
  }
  .card.partial {
    outline: 2px solid #ffd166;
    border-radius: var(--radius-card);
  }
  .count {
    position: absolute;
    right: 4px;
    bottom: 4px;
    padding: 0 6px;
    border-radius: 6px;
    background: rgb(8 12 20 / 88%);
    font-weight: 700;
    font-size: 13px;
  }
  @media (max-width: 860px) {
    .meta {
      grid-template-columns: 1fr;
    }
  }
</style>
