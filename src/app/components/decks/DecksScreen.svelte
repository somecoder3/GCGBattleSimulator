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
  import { entryLabel } from "../../../meta/archetypes";
  import { banlistProblems } from "../../../meta/banlist";
  import type { MetaDeck } from "../../../meta/decks";
  import { db, type UserDeck } from "../../lib/db";
  import { cardLib, deckChoices, deckColors, preset, setUserDecks, sharedId } from "../../lib/decks";
  import { deckDeleted, onSync, sync, syncAvailable } from "../../lib/sync";
  import type { SyncDeck } from "../../../sync/types";
  import CardImage from "../CardImage.svelte";
  import HoverTip from "../HoverTip.svelte";
  import CardDetail from "../CardDetail.svelte";
  import CardFilters from "../CardFilters.svelte";
  import {
    cardMatcher,
    emptyFilter,
    sortCards,
    type CardFilter,
    type Ordering,
    type Selection,
  } from "../../lib/cardfilter";
  import { satisfiesLink } from "../../../engine/cardlib";
  import DeckStats from "./DeckStats.svelte";

  // Own decks: import, build, check, save (IndexedDB, synced with the cloud when signed in), export, and
  // use them in the game and simulator. Decks of other signed-in users can be viewed and copied.

  let { pool }: { pool: CardPool } = $props();

  // svelte-ignore state_referenced_locally
  const lib = cardLib(pool);
  const MAIN_TYPES = new Set(["UNIT", "PILOT", "COMMAND", "BASE"]);
  const SHOW_STEP = 120;
  // svelte-ignore state_referenced_locally
  const deckCards = pool.cards.filter((c) => MAIN_TYPES.has(c.type) && !c.token);

  let decks = $state.raw<UserDeck[]>([]);
  let editing = $state<{
    id: string;
    name: string;
    counts: Record<string, number>;
    /** Another user's deck: view, play and copy only. */
    readonly?: boolean;
    ownerName?: string;
    copiedFrom?: string;
  } | null>(null);
  /** Decks of the other signed-in users (cloud sync). */
  let shared = $state.raw<SyncDeck[]>([]);
  const sharedByOwner = $derived(
    [...new Set(shared.map((d) => d.ownerName))].map((owner) => ({
      owner,
      decks: shared.filter((d) => d.ownerName === owner),
    })),
  );
  let dirty = $state(false);
  let filter = $state<CardFilter>(emptyFilter());
  let ordering = $state<Ordering>({ key: "level", desc: false });
  /** Only cards in the colours already in the deck (and colourless ones). */
  let deckColorsOnly = $state(false);
  let shown = $state(SHOW_STEP);
  let importText = $state("");
  let importInfo = $state<string>();
  let copyFrom = $state("");
  /** For a meta archetype: its consensus list or one of its real lists (index, best first). */
  let copyList = $state("consensus");
  let detail = $state<CardDef>();
  let message = $state<string>();
  /** Left column of the editor: the list or its statistics. */
  let view = $state<"list" | "stats">("list");

  // svelte-ignore state_referenced_locally
  const templates = deckChoices(pool).filter((d) => d.group !== "user");
  const metaTemplates = templates.filter((d) => d.group === "meta");
  const starterTemplates = templates.filter((d) => d.group === "starter");
  const testTemplates = templates.filter((d) => d.group === "test");
  /** Decks of a running lab (PWA): copied as own decks. */
  const labTemplates = templates.filter((d) => d.group === "lab");
  const archetype = $derived(
    (metaTemplates.find((d) => d.id === copyFrom) as (MetaDeck & { group: "meta" }) | undefined)?.archetype,
  );

  onMount(() => {
    void load();
    // After each cloud sync: own decks may have come from another device.
    let seen: Date | null = null;
    return onSync((s) => {
      shared = s.shared;
      if (s.lastSync !== seen) {
        seen = s.lastSync;
        if (seen) void load();
      }
    });
  });

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

  function newDeck(name = "Neues Deck", counts: Record<string, number> = {}, copiedFrom?: string) {
    editing = { id: `u-${Date.now().toString(36)}`, name, counts, ...(copiedFrom ? { copiedFrom } : {}) };
    dirty = true;
    message = undefined;
  }

  function edit(d: UserDeck) {
    editing = {
      id: d.id,
      name: d.name,
      counts: countsOf(d.deck.main),
      ...(d.copiedFrom ? { copiedFrom: d.copiedFrom } : {}),
    };
    dirty = false;
    message = undefined;
  }

  function viewShared(d: SyncDeck) {
    editing = {
      id: d.id,
      name: d.name,
      counts: countsOf(d.deck.main),
      readonly: true,
      ownerName: d.ownerName,
    };
    dirty = false;
    message = undefined;
  }

  function copyShared() {
    if (!editing?.readonly) return;
    newDeck(`${editing.name} (Kopie)`, { ...editing.counts }, editing.id);
  }

  function copyTemplate() {
    const t = templates.find((d) => d.id === copyFrom);
    if (!t) return;
    const entry = archetype && copyList !== "consensus" ? archetype.entries[Number(copyList)] : undefined;
    if (entry) newDeck(`${t.name} – Platz ${entry.placing} ${entry.tournament.name}`, { ...entry.cards });
    else newDeck(t.group === "lab" ? t.name : `${t.name} (Kopie)`, countsOf(t.deck.main));
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
    if (!editing || editing.readonly) return;
    const n = Math.max(0, Math.min(MAX_COPIES, (editing.counts[no] ?? 0) + delta));
    const counts = { ...editing.counts };
    if (n) counts[no] = n;
    else delete counts[no];
    editing.counts = counts;
    dirty = true;
  }

  async function save() {
    if (!editing || editing.readonly) return;
    const before = decks.find((d) => d.id === editing?.id);
    const deck: UserDeck = {
      id: editing.id,
      name: editing.name.trim() || "Ohne Namen",
      deck: toList(editing.counts),
      updatedAt: new Date().toISOString(),
      ...(before?.owner ? { owner: before.owner } : {}),
      ...(editing.copiedFrom ? { copiedFrom: editing.copiedFrom } : {}),
    };
    try {
      await db.decks.put(deck);
      dirty = false;
      message = "Gespeichert.";
      await load();
      void sync();
    } catch (e) {
      message = `Speichern fehlgeschlagen: ${String(e)}`;
    }
  }

  async function remove() {
    if (!editing || editing.readonly) return;
    const deck = decks.find((d) => d.id === editing?.id);
    await db.decks.delete(editing.id).catch(() => undefined);
    if (deck) deckDeleted(deck);
    editing = null;
    await load();
  }

  // Export like the Scanner app: the list in a chosen format to the clipboard (GCGDB formatList). ExBurst
  // CSV is left out: its "Owned" column registers a collection, not a deck.
  const EXPORT_FORMATS = [
    { id: "simple", label: "Einfach (2x GD06-004)" },
    { id: "limitless", label: "Limitless (2 Name GD06-004)" },
    { id: "names", label: "Nur Namen (2x Name)" },
    { id: "msa", label: "MSA Shuffle Fixer (by captsetitoff)" },
    { id: "tts", label: "Tabletop Simulator" },
  ] as const;
  const EXPORT_KEY = "gcg-battle-simulator.deck-export";
  let exportFormat = $state<string>(readExportFormat());
  function readExportFormat(): string {
    try {
      const f = localStorage.getItem(EXPORT_KEY);
      if (f && EXPORT_FORMATS.some((x) => x.id === f)) return f;
    } catch {
      // Storage may be unavailable (private window).
    }
    return "simple";
  }
  function setExportFormat(f: string) {
    exportFormat = f;
    try {
      localStorage.setItem(EXPORT_KEY, f);
    } catch {
      // Not remembered then.
    }
  }

  async function copyExport() {
    if (!editing) return;
    const entries = Object.entries(editing.counts).map(([id, count]) => ({
      id,
      count,
      name: pool.get(id)?.name,
    }));
    const format = EXPORT_FORMATS.find((f) => f.id === exportFormat) ?? EXPORT_FORMATS[0];
    try {
      await navigator.clipboard.writeText(formatList(entries, format.id) as string);
      message = `Liste kopiert (${format.label.replace(/ \(.*$/, "")}).`;
    } catch (e) {
      message = `Kopieren fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async function useIn(where: "play" | "sim") {
    if (dirty) await save();
    if (!editing) return;
    if (editing.readonly) preset.play = sharedId(editing.id);
    else if (where === "play") preset.play = editing.id;
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
  const colorsInDeck = $derived(
    new Set(
      Object.keys(editing?.counts ?? {}).flatMap((no) => {
        const color = pool.get(no)?.color;
        return color ? [color] : [];
      }),
    ),
  );
  const results = $derived.by(() => {
    const match = cardMatcher(filter);
    const colors = colorsInDeck;
    return sortCards(
      deckCards.filter(
        (c) => match(c) && (!deckColorsOnly || !colors.size || !c.color || colors.has(c.color)),
      ),
      ordering,
    );
  });
  // Back to the first cards when the filter changes.
  $effect(() => {
    void [filter.query, filter.selection, ordering, deckColorsOnly];
    shown = SHOW_STEP;
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

  const entries = $derived(grouped.flatMap((g) => g.cards.map((c) => ({ card: c.card, n: c.n }))));
  const links = (unit: CardDef, pilot: CardDef) =>
    lib.has(unit.no) && lib.has(pilot.no) && satisfiesLink(lib.get(unit.no), lib.get(pilot.no));
  /** A column or tag of the statistics filters the card search; the same one again undoes it. */
  function pick(p: Selection) {
    const keys = Object.keys(p) as (keyof Selection)[];
    const same = keys.every((k) => {
      const a = filter.selection[k] ?? [];
      const b = p[k] ?? [];
      return a.length === b.length && a.every((v, i) => v === b[i]);
    });
    const selection = { ...filter.selection };
    for (const k of keys) {
      if (same) delete selection[k];
      else selection[k] = p[k];
    }
    filter = { ...filter, selection };
  }

  // Card shown large beside a hovered row of the deck list (mouse only; touch opens the detail).
  let hovered = $state<{ card: CardDef; anchor: DOMRect } | null>(null);
  function hover(e: PointerEvent, card: CardDef) {
    if (e.pointerType !== "mouse") return;
    hovered = { card, anchor: (e.currentTarget as HTMLElement).getBoundingClientRect() };
  }
</script>

<section class="decks">
  <div class="panel side">
    <h1>Decks</h1>
    <p class="lead">
      Eigene Decks, im Browser gespeichert{syncAvailable
        ? " und nach der Anmeldung (oben rechts) auf allen Geräten"
        : ""}. Sie stehen in Spiel und Simulator unter „Eigene Decks“.
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

    {#each sharedByOwner as g (g.owner)}
      <h2 class="owner">Decks von {g.owner}</h2>
      <ul class="list">
        {#each g.decks as d (d.id)}
          <li>
            <button class:active={editing?.id === d.id} onclick={() => viewShared(d)}>
              {d.name}
              <small>{deckColors(lib, d.deck.main) || "–"} · {d.deck.main.length} Karten</small>
            </button>
          </li>
        {/each}
      </ul>
    {/each}

    <details>
      <summary>Aus Meta-, Starter-{labTemplates.length ? " oder Labor-" : " "}Deck kopieren</summary>
      <div class="copy">
        <select
          bind:value={copyFrom}
          onchange={() => (copyList = "consensus")}
          aria-label="Archetyp oder Deck"
        >
          <option value="">Archetyp oder Deck wählen …</option>
          {#if labTemplates.length}
            <optgroup label="Labor-Decks">
              {#each labTemplates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
            </optgroup>
          {/if}
          {#if metaTemplates.length}
            <optgroup label="Meta-Archetypen">
              {#each metaTemplates as t (t.id)}<option value={t.id}>{t.id} {t.name}</option>{/each}
            </optgroup>
          {/if}
          <optgroup label="Starter-Decks">
            {#each starterTemplates as t (t.id)}<option value={t.id}>{t.id} {t.name}</option>{/each}
          </optgroup>
          <optgroup label="Testdecks">
            {#each testTemplates as t (t.id)}<option value={t.id}>{t.id} {t.name}</option>{/each}
          </optgroup>
        </select>
        {#if archetype}
          <select bind:value={copyList} aria-label="Liste des Archetyps">
            <option value="consensus">Konsensliste (aus {archetype.entries.length} Listen)</option>
            {#each archetype.entries as e, i (i)}<option value={String(i)}>{entryLabel(e)}</option>{/each}
          </select>
          <p class="hint">
            Turnierlisten nach Ergebnis sortiert: Platz und Turniergröße (log2 Spieler / √Platz).
          </p>
        {/if}
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
        {#if editing.readonly}
          <h2 class="name readonly">{editing.name} <small>von {editing.ownerName}</small></h2>
        {:else}
          <input
            class="name"
            bind:value={editing.name}
            oninput={() => (dirty = true)}
            aria-label="Name des Decks"
          />
        {/if}
        <div class="actions">
          {#if editing.readonly}
            <button class="btn primary" onclick={copyShared}>Kopieren und bearbeiten</button>
          {:else}
            <button class="btn primary" onclick={save} disabled={!dirty}>Speichern</button>
          {/if}
          <button class="btn" onclick={() => useIn("play")} disabled={problems.length > 0}
            >Gegen die KI spielen</button
          >
          {#if __LAB__}
            <button class="btn" onclick={() => useIn("sim")} disabled={problems.length > 0}
              >Gegen das Feld simulieren</button
            >
          {/if}
          <span class="export">
            <select
              value={exportFormat}
              onchange={(e) => setExportFormat(e.currentTarget.value)}
              aria-label="Format der Liste"
            >
              {#each EXPORT_FORMATS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
            </select>
            <button class="btn" onclick={copyExport}>Liste kopieren</button>
          </span>
          {#if !editing.readonly}<button class="btn danger" onclick={remove}>Löschen</button>{/if}
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

      <div class="editor" class:single={editing.readonly}>
        <div class="deck">
          <div class="tabs" role="tablist" aria-label="Ansicht des Decks">
            <button role="tab" aria-selected={view === "list"} onclick={() => (view = "list")}>Liste</button>
            <button role="tab" aria-selected={view === "stats"} onclick={() => (view = "stats")}
              >Statistik</button
            >
          </div>
          {#if view === "stats"}
            <DeckStats
              {entries}
              {links}
              selection={filter.selection}
              onpick={pick}
              ondetail={(c) => (detail = c)}
            />
          {:else}
            {#each grouped as g (g.type)}
              {#if g.cards.length}
                <h3>{TYPE_NAMES[g.type]} <small>{g.cards.reduce((s, c) => s + c.n, 0)}</small></h3>
                <ul>
                  {#each g.cards as c (c.no)}
                    <li>
                      {#if editing.readonly}
                        <span class="n">{c.n}×</span>
                      {:else}
                        <button class="minus" onclick={() => change(c.no, -1)} aria-label="Eine weniger"
                          >−</button
                        >
                        <span class="n">{c.n}</span>
                        <button
                          class="plus"
                          onclick={() => change(c.no, 1)}
                          aria-label="Eine mehr"
                          disabled={c.n >= MAX_COPIES}>+</button
                        >
                      {/if}
                      <button
                        class="cardname"
                        onclick={() => (detail = c.card)}
                        onpointerenter={(e) => hover(e, c.card)}
                        onpointerleave={() => (hovered = null)}
                      >
                        <span class="thumb" data-color={c.card.color?.toLowerCase() ?? "none"}>
                          <img
                            src={cardImageUrl(c.card, "small")}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onerror={(e) =>
                              ((e.currentTarget as HTMLImageElement).style.visibility = "hidden")}
                          />
                        </span>
                        <span class="lv">Lv.{c.card.level ?? "–"}</span>
                        <span class="title">{c.card.name} <small>{c.no}</small></span>
                      </button>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/each}
          {/if}
          {#if hovered}
            <HoverTip anchor={hovered.anchor} place="side">
              <div class="preview">
                <CardImage card={hovered.card} src={cardImageUrl(hovered.card, "small")} eager />
              </div>
            </HoverTip>
          {/if}
        </div>
        {#if !editing.readonly}<div class="search">
            <CardFilters cards={deckCards} bind:filter bind:ordering count={results.length} id="deck" />
            <label class="only">
              <input type="checkbox" bind:checked={deckColorsOnly} />
              Nur Farben des Decks{colorsInDeck.size ? ` (${[...colorsInDeck].join("/")})` : ""}
            </label>
            <div class="results">
              {#each results.slice(0, shown) as c (c.no)}
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
                <p class="hint">Keine Treffer.</p>
              {/each}
            </div>
            {#if results.length > shown}
              <button class="more" onclick={() => (shown += SHOW_STEP)}>
                Weitere anzeigen ({results.length - shown})
              </button>
            {/if}
          </div>{/if}
      </div>
    {:else}
      <p class="hint">Ein Deck auswählen, neu anlegen, kopieren oder importieren.</p>
    {/if}
  </div>
</section>

{#if detail}
  <CardDetail
    card={detail}
    {pool}
    onclose={() => (detail = undefined)}
    {...editing && !editing.readonly
      ? {
          deckColors: colorsInDeck,
          count: (no: string) => editing?.counts[no] ?? 0,
          onadd: (no: string) => change(no, 1),
        }
      : {}}
  />
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
  .copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
  }
  .copy .btn {
    align-self: flex-start;
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
  .export {
    display: inline-flex;
    gap: 6px;
    min-width: 0;
  }
  .export select {
    min-width: 0;
    max-width: 220px;
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
  .editor.single {
    grid-template-columns: minmax(0, 560px);
  }
  .owner {
    margin: 14px 0 0;
    font-size: 14px;
    color: var(--text-dim);
  }
  .name.readonly {
    margin: 0;
  }
  .name.readonly small {
    color: var(--text-dim);
    font-size: 13px;
    font-weight: 400;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    padding: 6px 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--text-dim);
  }
  .tabs button[aria-selected="true"] {
    border-bottom-color: var(--accent);
    color: var(--text);
    font-weight: 600;
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
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
    border: 0;
    border-radius: 6px;
    background: none;
    text-align: left;
    font-size: 14px;
  }
  .cardname:hover {
    background: var(--bg-sunken);
  }
  .cardname .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* The artwork part of the card as a small strip. */
  .thumb {
    flex: none;
    width: 48px;
    height: 30px;
    overflow: hidden;
    border-radius: 4px;
    background: color-mix(in srgb, var(--tint, var(--line)) 35%, var(--bg-sunken));
  }
  .thumb[data-color="blue"] {
    --tint: var(--c-blue);
  }
  .thumb[data-color="green"] {
    --tint: var(--c-green);
  }
  .thumb[data-color="red"] {
    --tint: var(--c-red);
  }
  .thumb[data-color="white"] {
    --tint: var(--c-white);
  }
  .thumb[data-color="purple"] {
    --tint: var(--c-purple);
  }
  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 28%;
  }
  .preview {
    width: 240px;
  }
  .cardname small,
  .lv {
    color: var(--text-dim);
    font-size: 12px;
  }
  .only {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .more {
    margin-top: 10px;
    width: 100%;
    min-height: 34px;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--bg-raised);
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
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
