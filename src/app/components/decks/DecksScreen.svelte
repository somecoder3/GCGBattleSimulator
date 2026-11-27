<script lang="ts">
  import { onMount } from "svelte";
  // GCGDB's list formats (plain JS module, no types).
  import { formatList, parseList, resolveNames } from "../../../../gcgdb/js/lists.js";
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import { cardSrc } from "../../lib/cardimages";
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
  import {
    SNAPSHOT,
    cardLib,
    deckChoices,
    deckColors,
    pickDeck,
    preset,
    setUserDecks,
    sharedId,
    type DeckChoice,
  } from "../../lib/decks";
  import { groupDecks } from "../../lib/deckgroups";
  import { modal } from "../../lib/modal";
  import DeckPicker from "../DeckPicker.svelte";
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
    /** Not an own deck (another user's, meta, starter …): view, play and copy only. */
    readonly?: boolean;
    /** What a read-only deck is ("von Max", "Meta-Archetyp", "Starter-Deck" …). */
    source?: string;
    /** Its id among the deck choices (for "Gegen die KI spielen"). */
    choiceId?: string;
    copiedFrom?: string;
  } | null>(null);
  /** The start page's choices: the deck picker or the import page. */
  let picking = $state(false);
  let importing = $state(false);
  /** A question before leaving unsaved changes or deleting. */
  let confirming = $state<"leave" | "delete" | null>(null);
  /** Decks of the other signed-in users (cloud sync). */
  let shared = $state.raw<SyncDeck[]>([]);
  let dirty = $state(false);
  let filter = $state<CardFilter>(emptyFilter());
  let ordering = $state<Ordering>({ key: "level", desc: false });
  /** Only cards in the colours already in the deck (and colourless ones). */
  let deckColorsOnly = $state(false);
  let shown = $state(SHOW_STEP);
  let importText = $state("");
  let importInfo = $state<string>();
  /** For a meta archetype: its consensus list or one of its real lists (index, best first). */
  let copyList = $state("consensus");
  let detail = $state<CardDef>();
  let message = $state<string>();
  /** Left column of the editor: the list or its statistics. */
  let view = $state<"list" | "stats">("list");

  /** All decks for "Deck öffnen" (own ones from `decks`, the rest from the deck choices). */
  // svelte-ignore state_referenced_locally
  const others = deckChoices(pool).filter((d) => d.group !== "user" && d.group !== "shared");
  const META_LABEL = SNAPSHOT ? `Meta (Turniere bis ${SNAPSHOT.to})` : "Meta";
  const pickerGroups = $derived.by(() => {
    const own: DeckChoice[] = decks.map((d) => ({
      id: d.id,
      name: d.name,
      colors: deckColors(lib, d.deck.main),
      deck: d.deck,
      group: "user",
      supported: true,
    }));
    const theirs: DeckChoice[] = shared.map((d) => ({
      id: sharedId(d.id),
      name: `${d.name} (${d.ownerName})`,
      title: d.name,
      owner: d.ownerName,
      colors: deckColors(lib, d.deck.main),
      deck: d.deck,
      group: "shared",
      supported: true,
    }));
    return groupDecks([...own, ...theirs, ...others], META_LABEL);
  });
  /** The meta archetype of the deck being viewed (its lists can be chosen). */
  let archetype = $state.raw<(MetaDeck & { group: "meta" })["archetype"]>();

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

  function opened() {
    picking = false;
    importing = false;
    view = "list";
    archetype = undefined;
    copyList = "consensus";
    message = undefined;
    scrollTo({ top: 0, behavior: "instant" });
  }

  function newDeck(name = "Neues Deck", counts: Record<string, number> = {}, copiedFrom?: string) {
    opened();
    editing = { id: `u-${Date.now().toString(36)}`, name, counts, ...(copiedFrom ? { copiedFrom } : {}) };
    dirty = true;
  }

  /** A deck chosen in the picker. */
  function open(d: DeckChoice) {
    if (d.group === "user") {
      const own = decks.find((x) => x.id === d.id);
      if (own) edit(own);
      return;
    }
    if (d.group === "shared") {
      const theirs = shared.find((x) => sharedId(x.id) === d.id);
      if (theirs) viewShared(theirs);
      return;
    }
    opened();
    const SOURCES: Record<string, string> = {
      meta: "Meta-Archetyp",
      starter: "Starter-Deck",
      test: "Testdeck",
      lab: "Labor-Deck",
    };
    editing = {
      id: d.id,
      name: d.name,
      counts: countsOf(d.deck.main),
      readonly: true,
      source: [d.group === "lab" ? "" : d.id, SOURCES[d.group], d.share !== undefined ? pct(d.share) : ""]
        .filter(Boolean)
        .join(" · "),
      choiceId: d.id,
    };
    archetype = d.group === "meta" ? (d as MetaDeck & { group: "meta" }).archetype : undefined;
    dirty = false;
  }
  const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} % der Meta`;

  /** A meta archetype's list: the consensus or a real one. */
  function showList(value: string) {
    copyList = value;
    if (!editing || !archetype) return;
    const entry = value === "consensus" ? undefined : archetype.entries[Number(value)];
    editing.counts = entry ? { ...entry.cards } : countsOf(archetype.consensus.main);
  }

  /** Back to the start page (asks first about unsaved changes). */
  function back(force = false) {
    if (!force && dirty && editing && !editing.readonly) {
      confirming = "leave";
      return;
    }
    editing = null;
    dirty = false;
    archetype = undefined;
    message = undefined;
  }

  function edit(d: UserDeck) {
    opened();
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
    opened();
    editing = {
      id: d.id,
      name: d.name,
      counts: countsOf(d.deck.main),
      readonly: true,
      source: `von ${d.ownerName}`,
      choiceId: sharedId(d.id),
      copiedFrom: d.id,
    };
    dirty = false;
    message = undefined;
  }

  /** A read-only deck as a new own deck. */
  function copyViewed() {
    if (!editing?.readonly) return;
    const entry = archetype && copyList !== "consensus" ? archetype.entries[Number(copyList)] : undefined;
    const name = entry
      ? `${editing.name} – Platz ${entry.placing} ${entry.tournament.name}`
      : editing.source === "Labor-Deck"
        ? editing.name
        : `${editing.name} (Kopie)`;
    // Only another user's deck remembers where it came from (cloud sync).
    newDeck(name, { ...editing.counts }, editing.choiceId?.startsWith("s:") ? editing.copiedFrom : undefined);
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
    message = unknown.length ? `Nicht erkannt: ${unknown.slice(0, 8).join("; ")}` : undefined;
    importInfo = undefined;
    importText = "";
  }

  /** The clipboard into the import field (phones: no long-press needed). */
  let canPaste = $state(typeof navigator !== "undefined" && !!navigator.clipboard?.readText);
  async function paste() {
    try {
      importText = await navigator.clipboard.readText();
      importInfo = undefined;
    } catch {
      canPaste = false;
      importInfo = "Kein Zugriff auf die Zwischenablage – bitte selbst einfügen.";
    }
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
    confirming = null;
    if (!editing || editing.readonly) return;
    const deck = decks.find((d) => d.id === editing?.id);
    await db.decks.delete(editing.id).catch(() => undefined);
    if (deck) deckDeleted(deck);
    editing = null;
    dirty = false;
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
    let id = editing.readonly ? (editing.choiceId ?? editing.id) : editing.id;
    // A meta archetype's real list: as a picked deck "M03T5" (until the page is reloaded).
    const entry = archetype && copyList !== "consensus" ? archetype.entries[Number(copyList)] : undefined;
    if (entry) {
      id = `${id}T${Number(copyList) + 1}`;
      const deck = toList(editing.counts);
      pickDeck({
        id,
        name: `${editing.name} – Platz ${entry.placing} ${entry.tournament.name}`,
        colors: deckColors(lib, deck.main),
        deck,
        group: "meta",
        supported: deck.main.every((no) => lib.has(no) && lib.get(no).script.status !== "partial"),
      });
    }
    if (where === "play") preset.play = id;
    else preset.gauntlet = id;
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
  {#if !editing && !importing}
    <div class="start">
      <h1>Decks</h1>
      <p class="lead">
        Eigene Decks bauen, ansehen und exportieren; gespeichert im Browser{syncAvailable
          ? " und nach der Anmeldung (oben rechts) auf allen Geräten"
          : ""}. Sie stehen im Spiel unter „Eigene Decks“.
      </p>
      <div class="tiles">
        <button class="tile new" onclick={() => newDeck()}>
          <span class="icon" aria-hidden="true">＋</span>
          <span class="label">Neues Deck</span>
          <small>Leeres Deck, Karten aus der Suche hinzufügen</small>
        </button>
        <button class="tile open" onclick={() => (picking = true)}>
          <span class="icon" aria-hidden="true">▤</span>
          <span class="label">Deck öffnen</span>
          <small
            >{decks.length
              ? `${decks.length} eigene${shared.length ? `, ${shared.length} von anderen` : ""}, dazu Meta- und Starter-Decks`
              : "Meta-, Starter- und Testdecks ansehen und kopieren"}</small
          >
        </button>
        <button class="tile import" onclick={() => (importing = true)}>
          <span class="icon" aria-hidden="true">⇩</span>
          <span class="label">Deck importieren</span>
          <small>Liste einfügen: ExBurst, Limitless, TTS, Namen …</small>
        </button>
      </div>
    </div>
  {:else if importing && !editing}
    <div class="panel page">
      <button class="back" onclick={() => ((importing = false), (importInfo = undefined))}
        ><span aria-hidden="true">←</span> Decks</button
      >
      <h2 class="page-title">Deck importieren</h2>
      <p class="hint">
        Eine Liste aus ExBurst, Limitless, Tabletop Simulator, der Scanner-App oder einfach Anzahl und
        Kartennummer bzw. Name je Zeile.
      </p>
      <textarea bind:value={importText} rows="12" placeholder={IMPORT_EXAMPLE} aria-label="Deckliste"
      ></textarea>
      <div class="actions">
        <button class="btn primary" onclick={importList} disabled={!importText.trim()}>Importieren</button>
        {#if canPaste}<button class="btn" onclick={paste}>Aus Zwischenablage einfügen</button>{/if}
      </div>
      {#if importInfo}<p class="hint warn-text">{importInfo}</p>{/if}
    </div>
  {/if}

  {#if editing}
    <div class="panel main">
      <header>
        <div class="titlebar">
          <button class="back" onclick={() => back()}><span aria-hidden="true">←</span> Decks</button>
          {#if editing.readonly}
            <h2 class="name readonly">
              {editing.name}
              {#if editing.source}<small>{editing.source}</small>{/if}
            </h2>
          {:else}
            <input
              class="name"
              bind:value={editing.name}
              oninput={() => (dirty = true)}
              aria-label="Name des Decks"
            />
          {/if}
        </div>
        {#if archetype}
          <select
            class="lists"
            value={copyList}
            onchange={(e) => showList(e.currentTarget.value)}
            aria-label="Liste des Archetyps"
          >
            <option value="consensus">Konsensliste (aus {archetype.entries.length} Listen)</option>
            {#each archetype.entries as e, i (i)}<option value={String(i)}>{entryLabel(e)}</option>{/each}
          </select>
        {/if}
        <div class="actions">
          {#if editing.readonly}
            <button class="btn primary" onclick={copyViewed}>Kopieren und bearbeiten</button>
          {:else}
            <button class="btn primary" onclick={save} disabled={!dirty}
              >{dirty ? "Speichern" : "Gespeichert"}</button
            >
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
          {#if !editing.readonly}<button class="btn danger" onclick={() => (confirming = "delete")}
              >Löschen</button
            >{/if}
        </div>
      </header>
      {#if message}<p class="hint" role="status">{message}</p>{/if}

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
                          <!-- use:cardSrc: in the build the images are encrypted (cardimages.ts). -->
                          <img
                            use:cardSrc={cardImageUrl(c.card, "small")}
                            alt=""
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
                {@const n = editing.counts[c.no] ?? 0}
                <div class="result" class:in={n > 0}>
                  <button class="img" onclick={() => (detail = c)} title={c.name}>
                    <CardImage card={c} src={cardImageUrl(c, "small")} />
                  </button>
                  <div class="step" role="group" aria-label="{c.name}: Anzahl im Deck">
                    <button onclick={() => change(c.no, -1)} disabled={n === 0} aria-label="Eine weniger"
                      >−</button
                    >
                    <span class="count" aria-live="polite">{n}</span>
                    <button onclick={() => change(c.no, 1)} disabled={n >= MAX_COPIES} aria-label="Eine mehr"
                      >+</button
                    >
                  </div>
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
    </div>
  {/if}
</section>

{#if picking}
  <DeckPicker
    title="Deck öffnen"
    {pool}
    groups={pickerGroups}
    open={decks.length ? ["user"] : []}
    onpick={open}
    onclose={() => (picking = false)}
  />
{/if}

{#if confirming}
  <dialog
    class="confirm"
    use:modal
    {@attach (node: HTMLDialogElement) => node.showModal()}
    onclose={() => (confirming = null)}
    aria-labelledby="confirm-title"
  >
    {#if confirming === "leave"}
      <h2 id="confirm-title">Änderungen speichern?</h2>
      <p>„{editing?.name}“ hat ungespeicherte Änderungen.</p>
      <div class="actions">
        <button
          class="btn primary"
          onclick={async () => {
            confirming = null;
            await save();
            if (!dirty) back(true);
          }}>Speichern</button
        >
        <button
          class="btn danger"
          onclick={() => {
            confirming = null;
            back(true);
          }}>Verwerfen</button
        >
        <button class="btn" onclick={() => (confirming = null)}>Abbrechen</button>
      </div>
    {:else}
      <h2 id="confirm-title">Deck löschen?</h2>
      <p>
        „{editing?.name}“ wird gelöscht{syncAvailable ? ", auch auf deinen anderen Geräten" : ""}. Das lässt
        sich nicht rückgängig machen.
      </p>
      <div class="actions">
        <button class="btn danger solid" onclick={remove}>Löschen</button>
        <button class="btn" onclick={() => (confirming = null)}>Abbrechen</button>
      </div>
    {/if}
  </dialog>
{/if}

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
          onremove: (no: string) => change(no, -1),
        }
      : {}}
  />
{/if}

<style>
  .decks {
    min-width: 0;
  }
  .start {
    max-width: 880px;
    margin: 4vh auto 0;
  }
  .start h1 {
    font-size: 26px;
  }
  .start .lead {
    margin-bottom: 20px;
    font-size: 14px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
  }
  .tile {
    --tone: 79 195 255;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    min-height: 170px;
    padding: 20px;
    border: 1px solid rgb(var(--tone) / 35%);
    border-radius: 16px;
    background:
      radial-gradient(ellipse 90% 70% at 0% 0%, rgb(var(--tone) / 14%), transparent 70%), var(--bg-raised);
    text-align: left;
    transition:
      transform 0.15s,
      border-color 0.15s,
      box-shadow 0.15s;
  }
  .tile:hover {
    transform: translateY(-2px);
    border-color: rgb(var(--tone) / 70%);
    box-shadow: 0 10px 30px rgb(var(--tone) / 12%);
  }
  .tile:active {
    transform: none;
  }
  .tile.open {
    --tone: 255 209 102;
  }
  .tile.import {
    --tone: 63 191 111;
  }
  .tile .icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    margin-bottom: auto;
    border-radius: 14px;
    background: rgb(var(--tone) / 16%);
    color: rgb(var(--tone));
    font-size: 26px;
    line-height: 1;
  }
  .tile .label {
    margin-top: 14px;
    font-size: 18px;
    font-weight: 700;
  }
  .tile small {
    color: var(--text-dim);
    font-size: 13px;
    line-height: 1.35;
  }
  .page {
    max-width: 720px;
    margin: 2vh auto 0;
  }
  .page-title {
    margin: 12px 0 4px;
    font-size: 20px;
  }
  .warn-text {
    color: #ffd166;
  }
  .back {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 36px;
    padding: 4px 12px 4px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--text-dim);
    font-size: 14px;
  }
  .back:hover {
    color: var(--text);
  }
  .titlebar {
    flex: 1 1 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .lists {
    flex: 1 1 100%;
    min-height: 38px;
  }
  .confirm {
    width: min(420px, calc(100vw - 32px));
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .confirm[open] {
    animation: pop 0.18s ease-out;
  }
  .confirm::backdrop {
    background: rgb(0 0 0 / 60%);
  }
  .confirm h2 {
    margin: 0 0 8px;
    font-size: 18px;
  }
  .confirm p {
    margin: 0 0 16px;
    color: var(--text-dim);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }
  .btn.danger.solid {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
    font-weight: 600;
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
    min-width: 0;
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
  .name.readonly {
    margin: 0;
    font-size: 18px;
    line-height: 1.25;
  }
  .name.readonly small {
    display: block;
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
    position: relative;
    padding: 0;
    border: 0;
    background: none;
  }
  .result.in .img {
    outline: 2px solid rgb(79 195 255 / 70%);
    outline-offset: 1px;
    border-radius: var(--radius-card);
  }
  .step {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .step button {
    min-height: 32px;
    border: 0;
    background: none;
    font-size: 18px;
    line-height: 1;
  }
  .step button:hover:not(:disabled) {
    background: rgb(79 195 255 / 14%);
  }
  .step button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .step .count {
    min-width: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .result:not(.in) .step .count {
    color: var(--text-dim);
    font-weight: 400;
  }
  @media (max-width: 960px) {
    .editor {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  @media (max-width: 700px) {
    .start {
      margin-top: 8px;
    }
    .tiles {
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
    }
    .tile {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: auto auto;
      column-gap: 14px;
      row-gap: 2px;
      align-items: center;
      min-height: 0;
      padding: 14px 16px;
    }
    .tile .icon {
      grid-row: 1 / 3;
      margin: 0;
    }
    .tile .label {
      margin: 0;
      font-size: 16px;
    }
    .panel {
      padding: 14px;
    }
    .results {
      grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      max-height: none;
      overflow: visible;
    }
    .step button {
      min-height: 36px;
    }
  }
</style>
