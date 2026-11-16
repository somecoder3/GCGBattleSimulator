<script lang="ts">
  import { onMount } from "svelte";
  // GCGDB's list formats (plain JS module, no types).
  import { formatList, parseList, resolveNames } from "../../../../gcgdb/js/lists.js";
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import {
    DEFAULT_RESOURCE,
    DECK_SIZE,
    MAX_COPIES,
    RESOURCE_DECK_SIZE,
    validateDeck,
  } from "../../../engine/deck";
  import type { DeckList } from "../../../engine/types";
  import { banlistProblems } from "../../../meta/banlist";
  import { db, download, type UserDeck } from "../../lib/db";
  import { cardLib, deckChoices, deckColors, preset, setUserDecks } from "../../lib/decks";
  import CardImage from "../CardImage.svelte";
  import CardDetail from "../CardDetail.svelte";

  // Own decks: import, build, check, save (IndexedDB), export, and use them in the game and simulator.

  let { pool }: { pool: CardPool } = $props();

  // svelte-ignore state_referenced_locally
  const lib = cardLib(pool);
  const MAIN_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);

  let decks = $state.raw<UserDeck[]>([]);
  let editing = $state<{ id: string; name: string; counts: Record<string, number> } | null>(null);
  let dirty = $state(false);
  let query = $state("");
  let importText = $state("");
  let importInfo = $state<string>();
  let copyFrom = $state("");
  let detail = $state<CardDef>();
  let message = $state<string>();

  // svelte-ignore state_referenced_locally
  const templates = deckChoices(pool).filter((d) => d.group !== "user");

  onMount(load);

  async function load() {
    try {
      decks = (await db.decks.all()).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      decks = [];
    }
    setUserDecks(decks);
  }

  const countsOf = (main: readonly string[]) =>
    main.reduce<Record<string, number>>((m, no) => ((m[no] = (m[no] ?? 0) + 1), m), {});
  const toList = (counts: Record<string, number>): DeckList => ({
    main: Object.entries(counts).flatMap(([no, n]) => Array<string>(n).fill(no)),
    resources: Array<string>(RESOURCE_DECK_SIZE).fill(DEFAULT_RESOURCE),
  });

  function newDeck(name = "Neues Deck", counts: Record<string, number> = {}) {
    editing = { id: `u-${Date.now().toString(36)}`, name, counts };
    dirty = true;
    message = undefined;
  }

  function edit(d: UserDeck) {
    editing = { id: d.id, name: d.name, counts: countsOf(d.deck.main) };
    dirty = false;
    message = undefined;
  }

  function copyTemplate() {
    const t = templates.find((d) => d.id === copyFrom);
    if (t) newDeck(`${t.name} (Kopie)`, countsOf(t.deck.main));
  }

  function importList() {
    const parsed = parseList(importText) as {
      entries: { id: string; count: number }[];
      names: { name: string; count: number; line: number }[];
      errors: { line: number; text: string }[];
    };
    const byName = resolveNames(parsed.names, {
      cards: pool.cards.map((c) => ({ cardNo: c.no, name: c.name })),
    }) as {
      entries: { id: string; count: number }[];
      unknown: { name: string }[];
    };
    const counts: Record<string, number> = {};
    const unknown: string[] = [...byName.unknown.map((u) => u.name), ...parsed.errors.map((e) => e.text)];
    for (const e of [...parsed.entries, ...byName.entries]) {
      const card = pool.get(e.id);
      if (!card) unknown.push(e.id);
      else if (MAIN_TYPES.has(card.type)) counts[card.no] = (counts[card.no] ?? 0) + e.count;
    }
    if (!Object.keys(counts).length) {
      importInfo = "Keine Karten erkannt.";
      return;
    }
    newDeck("Importiertes Deck", counts);
    importInfo = unknown.length ? `Nicht erkannt: ${unknown.slice(0, 8).join("; ")}` : undefined;
    importText = "";
  }

  function change(no: string, delta: number) {
    if (!editing) return;
    const n = Math.max(0, Math.min(MAX_COPIES, (editing.counts[no] ?? 0) + delta));
    const counts = { ...editing.counts };
    if (n) counts[no] = n;
    else delete counts[no];
    editing.counts = counts;
    dirty = true;
  }

  async function save() {
    if (!editing) return;
    const deck: UserDeck = {
      id: editing.id,
      name: editing.name.trim() || "Ohne Namen",
      deck: toList(editing.counts),
      updatedAt: new Date().toISOString(),
    };
    try {
      await db.decks.put(deck);
      dirty = false;
      message = "Gespeichert.";
      await load();
    } catch (e) {
      message = `Speichern fehlgeschlagen: ${String(e)}`;
    }
  }

  async function remove() {
    if (!editing) return;
    await db.decks.delete(editing.id).catch(() => undefined);
    editing = null;
    await load();
  }

  function exportList() {
    if (!editing) return;
    const entries = Object.entries(editing.counts).map(([id, count]) => ({
      id,
      count,
      name: pool.get(id)?.name,
    }));
    download(`${editing.name || "deck"}.txt`, formatList(entries, "simple") as string, "text/plain");
  }

  async function useIn(where: "play" | "sim") {
    if (dirty) await save();
    if (!editing) return;
    if (where === "play") preset.play = editing.id;
    else preset.gauntlet = editing.id;
    location.hash = where === "play" ? "#play" : "#sim";
  }

  /** The engine's deck checks (6-1) in German. */
  function german(problem: string): string {
    return problem
      .replace(/^deck has (\d+) cards, needs (\d+)$/, "$1 Karten statt $2")
      .replace(/^resource deck has (\d+) cards, needs (\d+)$/, "Ressourcen-Deck mit $1 statt $2 Karten")
      .replace(/^(\d+) copies of (\S+), at most (\d+)$/, "$1× $2, höchstens $3")
      .replace(/^deck has (\d+) colors \((.+)\), at most 2$/, "$1 Farben ($2), höchstens 2")
      .replace(/^(\S+) \((.+)\) cannot be in the deck$/, "$1 ($2) darf nicht ins Deck")
      .replace(/^unknown card (\S+)$/, "Unbekannte Karte $1");
  }

  const list = $derived(editing ? toList(editing.counts) : null);
  const total = $derived(list?.main.length ?? 0);
  const problems = $derived.by(() => {
    if (!list || !editing) return [];
    const get = (no: string) => (lib.has(no) ? lib.get(no) : undefined);
    return [...validateDeck(lib, list).map(german), ...banlistProblems(editing.counts, get)];
  });
  const partial = $derived(
    editing
      ? Object.keys(editing.counts).filter((no) => lib.has(no) && lib.get(no).script.status === "partial")
      : [],
  );
  const grouped = $derived.by(() => {
    if (!editing) return [];
    const entries = Object.entries(editing.counts)
      .map(([no, n]) => ({ no, n, card: pool.get(no)! }))
      .filter((e) => e.card)
      .sort((a, b) => (a.card.level ?? 0) - (b.card.level ?? 0) || a.no.localeCompare(b.no));
    return ["UNIT", "PILOT", "COMMAND", "BASE"].map((type) => ({
      type,
      cards: entries.filter((e) => e.card.type === type),
    }));
  });
  const results = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return pool.cards
      .filter((c) => MAIN_TYPES.has(c.type) && !c.token)
      .filter((c) => {
        const hay = `${c.no} ${c.name} ${c.traits.join(" ")} ${c.color ?? ""} ${c.text}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 60);
  });
  const TYPE_NAMES: Record<string, string> = {
    UNIT: "Units",
    PILOT: "Piloten",
    COMMAND: "Commands",
    BASE: "Bases",
  };
  const IMPORT_EXAMPLE = [
    "4x GD05-066",
    "2 Shining Gundam GD05-066",
    "…",
    "(ExBurst, Limitless, TTS, Namen …)",
  ].join("\n");
</script>

<section class="decks">
  <div class="panel side">
    <h1>Decks</h1>
    <p class="lead">
      Eigene Decks, im Browser gespeichert. Sie stehen in Spiel und Simulator unter „Eigene Decks“.
    </p>
    <div class="actions">
      <button class="btn primary" onclick={() => newDeck()}>Neues Deck</button>
    </div>
    {#if decks.length}
      <ul class="list">
        {#each decks as d (d.id)}
          <li>
            <button class:active={editing?.id === d.id} onclick={() => edit(d)}>
              {d.name}
              <small>{deckColors(lib, d.deck.main) || "–"} · {d.deck.main.length} Karten</small>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="hint">Noch keine eigenen Decks.</p>
    {/if}

    <details>
      <summary>Aus Meta- oder Starter-Deck kopieren</summary>
      <div class="row">
        <select bind:value={copyFrom}>
          <option value="">Deck wählen …</option>
          {#each templates as t (t.id)}<option value={t.id}>{t.id} {t.name}</option>{/each}
        </select>
        <button class="btn" onclick={copyTemplate} disabled={!copyFrom}>Kopieren</button>
      </div>
    </details>

    <details>
      <summary>Liste importieren</summary>
      <textarea bind:value={importText} rows="8" placeholder={IMPORT_EXAMPLE}></textarea>
      <button class="btn" onclick={importList} disabled={!importText.trim()}>Importieren</button>
      {#if importInfo}<p class="hint">{importInfo}</p>{/if}
    </details>
  </div>

  <div class="panel main">
    {#if editing}
      <header>
        <input
          class="name"
          bind:value={editing.name}
          oninput={() => (dirty = true)}
          aria-label="Name des Decks"
        />
        <div class="actions">
          <button class="btn primary" onclick={save} disabled={!dirty}>Speichern</button>
          <button class="btn" onclick={() => useIn("play")} disabled={problems.length > 0}
            >Gegen die KI spielen</button
          >
          <button class="btn" onclick={() => useIn("sim")} disabled={problems.length > 0}
            >Gegen das Feld simulieren</button
          >
          <button class="btn" onclick={exportList}>Exportieren</button>
          <button class="btn danger" onclick={remove}>Löschen</button>
        </div>
      </header>
      {#if message}<p class="hint">{message}</p>{/if}

      <div class="status" class:ok={!problems.length}>
        <strong>{total} / {DECK_SIZE} Karten</strong> · {deckColors(lib, list?.main ?? []) || "keine Farbe"} · Ressourcen-Deck
        {RESOURCE_DECK_SIZE}× Resource
        {#if problems.length}
          <ul>
            {#each problems as p (p)}<li>{p}</li>{/each}
          </ul>
        {:else}
          · regelkonform
        {/if}
        {#if partial.length}
          <p class="warn">
            Nicht vollständig verstanden (Effekte wirken teilweise nicht): {partial.join(", ")}
          </p>
        {/if}
      </div>

      <div class="editor">
        <div class="deck">
          {#each grouped as g (g.type)}
            {#if g.cards.length}
              <h3>{TYPE_NAMES[g.type]} <small>{g.cards.reduce((s, c) => s + c.n, 0)}</small></h3>
              <ul>
                {#each g.cards as c (c.no)}
                  <li>
                    <button class="minus" onclick={() => change(c.no, -1)} aria-label="Eine weniger">−</button
                    >
                    <span class="n">{c.n}</span>
                    <button
                      class="plus"
                      onclick={() => change(c.no, 1)}
                      aria-label="Eine mehr"
                      disabled={c.n >= MAX_COPIES}>+</button
                    >
                    <button class="cardname" onclick={() => (detail = c.card)}>
                      <span class="lv">Lv.{c.card.level ?? "–"}</span>
                      {c.card.name} <small>{c.no}</small>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/each}
        </div>
        <div class="search">
          <input
            type="search"
            bind:value={query}
            placeholder="Karte suchen: Name, Nummer, Trait, Farbe, Text …"
            aria-label="Karte suchen"
          />
          <div class="results">
            {#each results as c (c.no)}
              <div class="result">
                <button class="img" onclick={() => (detail = c)} title={c.name}>
                  <CardImage card={c} src={cardImageUrl(c, "small")} />
                </button>
                <button
                  class="add"
                  onclick={() => change(c.no, 1)}
                  disabled={(editing.counts[c.no] ?? 0) >= MAX_COPIES}
                >
                  + {editing.counts[c.no] ? `(${editing.counts[c.no]})` : ""}
                </button>
              </div>
            {:else}
              {#if query}<p class="hint">Keine Treffer.</p>{:else}<p class="hint">
                  Suchbegriff eingeben, um Karten hinzuzufügen.
                </p>{/if}
            {/each}
          </div>
        </div>
      </div>
    {:else}
      <p class="hint">Ein Deck auswählen, neu anlegen, kopieren oder importieren.</p>
    {/if}
  </div>
</section>

{#if detail}
  <CardDetail card={detail} onclose={() => (detail = undefined)} />
{/if}

<style>
  .decks {
    display: grid;
    grid-template-columns: 320px minmax(0, 1fr);
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
  h3 {
    margin: 12px 0 6px;
    font-size: 14px;
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
  .list {
    margin: 10px 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .list button {
    width: 100%;
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    text-align: left;
  }
  .list button.active,
  .list button:hover {
    border-color: var(--line);
    background: var(--bg-sunken);
  }
  .list small {
    color: var(--text-dim);
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
  .row {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  select,
  input,
  textarea {
    min-height: 34px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    min-width: 0;
    font: inherit;
  }
  select {
    flex: 1;
  }
  textarea {
    width: 100%;
    margin: 8px 0;
    font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
  .btn.danger {
    color: var(--danger);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: space-between;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 200px;
    font-size: 18px;
    font-weight: 600;
  }
  .status {
    margin: 12px 0;
    padding: 10px 12px;
    border: 1px solid color-mix(in srgb, var(--danger) 60%, var(--line));
    border-radius: 10px;
    font-size: 14px;
  }
  .status.ok {
    border-color: color-mix(in srgb, #3fbf6f 60%, var(--line));
  }
  .status ul {
    margin: 6px 0 0;
    padding-left: 18px;
    color: var(--danger);
    font-size: 13px;
  }
  .warn {
    margin: 6px 0 0;
    color: #ffd166;
    font-size: 13px;
  }
  .editor {
    display: grid;
    grid-template-columns: minmax(260px, 380px) minmax(0, 1fr);
    gap: 16px;
  }
  .deck ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .deck li {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
  }
  .minus,
  .plus {
    width: 26px;
    height: 26px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg-sunken);
  }
  .n {
    width: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .cardname {
    flex: 1;
    padding: 2px 6px;
    border: 0;
    background: none;
    text-align: left;
    font-size: 14px;
  }
  .cardname small,
  .lv {
    color: var(--text-dim);
    font-size: 12px;
  }
  .search input {
    width: 100%;
  }
  .results {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 10px;
    margin-top: 10px;
    max-height: 70vh;
    overflow: auto;
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .img {
    padding: 0;
    border: 0;
    background: none;
  }
  .add {
    min-height: 28px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--bg-sunken);
  }
  @media (max-width: 960px) {
    .decks,
    .editor {
      grid-template-columns: 1fr;
    }
  }
</style>
