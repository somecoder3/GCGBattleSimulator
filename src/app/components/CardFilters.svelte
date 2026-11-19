<script lang="ts">
  // Filter bar for card lists (card list and deck builder), modelled on ExBurst: search with field syntax,
  // ordering, colours and quick filters in the bar, all sections in the "Filter" panel. Every section can be
  // reset, locked (kept by "Alles zurücksetzen" and after a reload) and shown in the bar or not.
  import { onMount, untrack } from "svelte";
  import { COLORS, type CardDef } from "../../data/types";
  import {
    DEFAULT_QUICK,
    SECTION,
    SECTIONS,
    SORTS,
    activeSections,
    facets,
    popular,
    type CardFilter,
    type Facet,
    type Ordering,
    type Section,
    type SectionKey,
    type Selection,
  } from "../lib/cardfilter";

  let {
    cards,
    filter = $bindable(),
    ordering = $bindable(),
    count,
    id,
  }: {
    /** The cards the filters choose from (their values and counts fill the sections). */
    cards: readonly CardDef[];
    filter: CardFilter;
    ordering: Ordering;
    /** Number of cards after filtering. */
    count: number;
    /** Name of the list, for its stored ordering ("cards", "deck"). */
    id: string;
  } = $props();

  const PREFS_KEY = "gcg-battle-simulator.card-filters";
  // svelte-ignore state_referenced_locally
  const SORT_KEY = `gcg-battle-simulator.card-sort.${id}`;

  interface Prefs {
    quick: SectionKey[];
    locks: SectionKey[];
    locked: Selection;
  }

  function readPrefs(): Prefs {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
      const known = (keys: unknown) =>
        Array.isArray(keys) ? keys.filter((k): k is SectionKey => k in SECTION) : undefined;
      return {
        quick: known(p?.quick) ?? DEFAULT_QUICK,
        locks: known(p?.locks) ?? [],
        locked: p?.locked && typeof p.locked === "object" ? p.locked : {},
      };
    } catch {
      return { quick: DEFAULT_QUICK, locks: [], locked: {} };
    }
  }

  let prefs = $state<Prefs>(readPrefs());
  let panel = $state(false);
  let help = $state(false);
  /** Section whose popover is open in the quick filter bar. */
  let pop = $state<SectionKey | null>(null);
  /** Search text of the pick sections. */
  let picks = $state<Partial<Record<SectionKey, string>>>({});

  function savePrefs() {
    // Locked sections keep their selection across reloads.
    const locked: Selection = {};
    for (const k of prefs.locks) if (filter.selection[k]?.length) locked[k] = filter.selection[k];
    prefs.locked = locked;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage unavailable: the settings last for this page only
    }
  }

  onMount(() => {
    if (Object.keys(prefs.locked).length) filter.selection = { ...prefs.locked, ...filter.selection };
    try {
      const o = JSON.parse(localStorage.getItem(SORT_KEY) ?? "null") as Ordering | null;
      if (o && SORTS.some((s) => s.key === o.key)) ordering = { key: o.key, desc: !!o.desc };
    } catch {
      // keep the default ordering
    }
  });

  function setOrdering(o: Ordering) {
    ordering = o;
    try {
      localStorage.setItem(SORT_KEY, JSON.stringify(o));
    } catch {
      // ignore
    }
  }

  const allFacets = $derived(
    Object.fromEntries(SECTIONS.map((s) => [s.key, facets(s, cards)])) as Record<SectionKey, Facet[]>,
  );
  const active = $derived(activeSections(filter));
  // Sections with only one value don't help (e.g. link type in a list of Commands).
  const shownSections = $derived(SECTIONS.filter((s) => s.key !== "colors" && allFacets[s.key].length > 1));
  const quick = $derived(shownSections.filter((s) => prefs.quick.includes(s.key)));

  const chosen = (key: SectionKey) => filter.selection[key] ?? [];
  const label = (s: Section, v: string) => s.show?.(v) ?? v;

  function toggle(key: SectionKey, value: string) {
    const list = chosen(key);
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    filter.selection = { ...filter.selection, [key]: next };
    if (prefs.locks.includes(key)) savePrefs();
  }

  function reset(key: SectionKey) {
    const { [key]: _, ...rest } = filter.selection;
    filter.selection = rest;
    picks[key] = "";
    if (prefs.locks.includes(key)) savePrefs();
  }

  function resetAll() {
    const kept: Selection = {};
    for (const k of prefs.locks) if (filter.selection[k]) kept[k] = filter.selection[k];
    filter.selection = kept;
    filter.query = "";
    picks = {};
  }

  function toggleLock(key: SectionKey) {
    prefs.locks = prefs.locks.includes(key) ? prefs.locks.filter((k) => k !== key) : [...prefs.locks, key];
    savePrefs();
  }

  function toggleQuick(key: SectionKey) {
    prefs.quick = prefs.quick.includes(key) ? prefs.quick.filter((k) => k !== key) : [...prefs.quick, key];
    savePrefs();
  }

  function summary(s: Section): string {
    const list = chosen(s.key);
    if (!list.length) return "Alle";
    const text = list.map((v) => label(s, v)).join(", ");
    return text.length > 18 ? `${list.length} gewählt` : text;
  }

  /** Dropdown that is open: "panel:trait" (in the filter panel) or "pop:trait" (quick filter popover). */
  let openPick = $state<string | null>(null);
  /** Highlighted entry of the open dropdown (arrow keys, Enter). */
  let hi = $state(0);

  /** Values chosen when the dropdown opened: they come first, and entries don't jump while checking. */
  let openedWith = $state<string[]>([]);
  $effect(() => {
    const key = (openPick ?? (pop ? `pop:${pop}` : "")).split(":")[1] as SectionKey | undefined;
    openedWith = key ? untrack(() => chosen(key)) : [];
  });

  /** Entries of a pick dropdown: the chosen ones first, then by frequency; filtered by the typed text. */
  function pickOptions(s: Section): Facet[] {
    const q = (picks[s.key] ?? "").trim().toLowerCase();
    const list = q
      ? allFacets[s.key].filter((f) => label(s, f.value).toLowerCase().includes(q))
      : [...allFacets[s.key]];
    const on = new Set(openedWith);
    return list.sort((a, b) => Number(on.has(b.value)) - Number(on.has(a.value)) || b.count - a.count);
  }

  function pickKey(e: KeyboardEvent, s: Section, id: string) {
    const options = pickOptions(s);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openPick = id;
      hi = Math.max(0, Math.min(options.length - 1, hi + (e.key === "ArrowDown" ? 1 : -1)));
      document.getElementById(`${id}:${hi}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const f = options[hi];
      if (f) toggle(s.key, f.value);
    }
  }

  /** Focuses the search field of a quick filter popover when it opens. */
  function autofocus(el: HTMLInputElement) {
    el.focus();
  }

  // Close popovers on a click outside and on Escape.
  function outside(e: PointerEvent) {
    const el = e.target as Element | null;
    if (pop && !el?.closest(`[data-pop="${pop}"]`)) pop = null;
    if (help && !el?.closest("[data-help]")) help = false;
    if (openPick && !el?.closest(`[data-pick="${openPick}"]`)) openPick = null;
  }
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (openPick?.startsWith("panel:")) openPick = null;
      else pop = null;
      help = false;
    }
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={key} />

{#snippet chip(s: Section, f: Facet)}
  <button
    class="chip"
    aria-pressed={chosen(s.key).includes(f.value)}
    title={`${f.count} Karten`}
    onclick={() => toggle(s.key, f.value)}>{label(s, f.value)}</button
  >
{/snippet}

{#snippet body(s: Section, where: "panel" | "pop")}
  {@const id = `${where}:${s.key}`}
  {#if s.kind === "chips"}
    <div class="chips">
      {#each allFacets[s.key] as f (f.value)}{@render chip(s, f)}{/each}
    </div>
  {:else}
    {@const open = where === "pop" || openPick === id}
    <div class="pickbox" data-pick={id}>
      {#if where === "pop"}
        <input
          class="pick"
          type="search"
          placeholder={`${s.label} filtern (${allFacets[s.key].length}) …`}
          aria-label={`${s.label} filtern`}
          aria-controls={`${id}:list`}
          bind:value={picks[s.key]}
          oninput={() => (hi = 0)}
          onkeydown={(e) => pickKey(e, s, id)}
          use:autofocus
        />
      {:else}
        <input
          class="pick"
          type="search"
          placeholder={chosen(s.key).length
            ? `${chosen(s.key).length} gewählt – filtern …`
            : `Alle (${allFacets[s.key].length}) – filtern …`}
          aria-label={`${s.label} filtern`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}:list`}
          bind:value={picks[s.key]}
          onfocus={() => ((openPick = id), (hi = 0))}
          onclick={() => (openPick = id)}
          oninput={() => ((openPick = id), (hi = 0))}
          onkeydown={(e) => pickKey(e, s, id)}
        />
      {/if}
      {#if open}
        <ul
          id={`${id}:list`}
          class="matches"
          class:drop={where === "panel"}
          role="listbox"
          aria-multiselectable="true"
          aria-label={s.label}
        >
          {#each pickOptions(s) as f, i (f.value)}
            <li id={`${id}:${i}`} role="option" aria-selected={chosen(s.key).includes(f.value)}>
              <label class="opt" class:hi={i === hi} onpointerenter={() => (hi = i)}>
                <input
                  type="checkbox"
                  tabindex="-1"
                  checked={chosen(s.key).includes(f.value)}
                  onchange={() => toggle(s.key, f.value)}
                />
                <span>{label(s, f.value)}</span><small>{f.count}</small>
              </label>
            </li>
          {:else}
            <li class="none">Nichts gefunden.</li>
          {/each}
        </ul>
      {/if}
    </div>
    {#if where === "panel"}
      {#if chosen(s.key).length}
        <div class="chips">
          {#each chosen(s.key) as v (v)}
            <button class="chip" aria-pressed="true" onclick={() => toggle(s.key, v)}>{label(s, v)} ×</button>
          {/each}
        </div>
      {:else}
        <div class="chips popular">
          <span class="hint">Häufig</span>
          {#each popular(allFacets[s.key]) as f (f.value)}{@render chip(s, f)}{/each}
        </div>
      {/if}
    {/if}
  {/if}
{/snippet}

<section class="filters" aria-label="Filter">
  <div class="row">
    <button class="btn" class:on={panel} aria-expanded={panel} onclick={() => (panel = !panel)}>
      ☰ Filter{active.length ? ` (${active.length})` : ""}
    </button>
    <div class="search" data-help>
      <input
        type="search"
        placeholder="Suche: Name, Nummer, Text … oder trait:zeon ap>=4"
        bind:value={filter.query}
        aria-label="Suche"
      />
      <button
        class="help-btn"
        aria-label="Hilfe zur Suche"
        aria-expanded={help}
        onclick={() => (help = !help)}>?</button
      >
      {#if help}
        <div class="pop help" role="dialog" aria-label="Hilfe zur Suche">
          <h3>Erweiterte Suche</h3>
          <dl>
            <dt>wort</dt>
            <dd>Karten, die das Wort irgendwo enthalten (Name, Nummer, Traits, Link, Serie, Text).</dd>
            <dt>"genaue Phrase"</dt>
            <dd>Die Phrase am Stück (Groß-/Kleinschreibung und Akzente egal).</dd>
            <dt>feld:wert</dt>
            <dd>Das Feld enthält den Wert, z. B. <code>trait:zeon</code>.</dd>
            <dt>feld="wert"</dt>
            <dd>Das Feld ist genau der Wert, z. B. <code>name="Gundam"</code>.</dd>
            <dt>feld&lt;&gt;wert, -wort</dt>
            <dd>Ausschluss, z. B. <code>kw&lt;&gt;blocker</code> oder <code>-zaku</code>.</dd>
            <dt>ap&gt;=4, level&lt;3</dt>
            <dd>Vergleiche bei Level, Kosten, AP, HP (<code>&gt; &lt; &gt;= &lt;=</code>).</dd>
            <dt>a b, a AND b</dt>
            <dd>Beides muss passen.</dd>
            <dt>a OR b, (a OR b) c</dt>
            <dd>Eines von beiden; Klammern gruppieren.</dd>
          </dl>
          <p class="fields">
            Felder: <code>name n</code> · <code>no id</code> · <code>color c</code> · <code>type t</code> ·
            <code>set s</code> · <code>rarity r</code> · <code>level lv</code> · <code>cost o</code> ·
            <code>trait x</code> · <code>link l</code> · <code>pilot pi</code> · <code>ap a</code> ·
            <code>hp h</code> · <code>kw</code> · <code>linktype lt</code> (name/trait/none) ·
            <code>zone z</code> · <code>source gi</code> · <code>text</code>
          </p>
        </div>
      {/if}
    </div>
    <div class="order">
      <select
        aria-label="Sortierung"
        value={ordering.key}
        onchange={(e) =>
          setOrdering({
            key: (e.currentTarget as HTMLSelectElement).value as Ordering["key"],
            desc: ordering.desc,
          })}
      >
        {#each SORTS as s (s.key)}<option value={s.key}>{s.label}</option>{/each}
      </select>
      <button
        class="btn dir"
        aria-label={ordering.desc ? "absteigend" : "aufsteigend"}
        title={ordering.desc ? "absteigend" : "aufsteigend"}
        onclick={() => setOrdering({ ...ordering, desc: !ordering.desc })}>{ordering.desc ? "↓" : "↑"}</button
      >
    </div>
    <div class="chips" role="group" aria-label="Farbe">
      {#each COLORS as c (c)}
        <button
          class="chip color"
          style:--chip={`var(--c-${c.toLowerCase()})`}
          aria-pressed={chosen("colors").includes(c)}
          aria-label={c}
          title={c}
          onclick={() => toggle("colors", c)}
        ></button>
      {/each}
    </div>
    <span class="count">{count} Karten</span>
  </div>

  {#if quick.length}
    <div class="row quick" role="group" aria-label="Schnellfilter">
      {#each quick as s (s.key)}
        <div class="q" data-pop={s.key}>
          {#if s.inline}
            <span class="q-label">{s.label}</span>
            {#each allFacets[s.key].slice(0, s.inline) as f (f.value)}{@render chip(s, f)}{/each}
            {#if allFacets[s.key].length > s.inline}
              {@const hidden = chosen(s.key).filter(
                (v) => !allFacets[s.key].slice(0, s.inline).some((f) => f.value === v),
              ).length}
              <button
                class="chip more"
                aria-pressed={hidden > 0}
                aria-expanded={pop === s.key}
                title={`Alle ${allFacets[s.key].length}`}
                onclick={() => (pop = pop === s.key ? null : s.key)}
                >+{allFacets[s.key].length - s.inline}{hidden ? ` (${hidden})` : ""}</button
              >
            {/if}
          {:else}
            <button
              class="btn drop"
              class:on={chosen(s.key).length > 0}
              aria-expanded={pop === s.key}
              onclick={() => (pop = pop === s.key ? null : s.key)}
            >
              <span class="q-label">{s.label}</span>
              {summary(s)} ▾
            </button>
          {/if}
          {#if pop === s.key}
            <div class="pop" role="dialog" aria-label={s.label}>
              <div class="pop-head">
                <strong>{s.label}</strong>
                {#if chosen(s.key).length}<button class="link" onclick={() => reset(s.key)}
                    >zurücksetzen</button
                  >{/if}
              </div>
              {@render body(s, "pop")}
            </div>
          {/if}
        </div>
      {/each}
      {#if active.length || filter.query}
        <button class="link" onclick={resetAll}>Alles zurücksetzen</button>
      {/if}
    </div>
  {/if}

  {#if panel}
    <div class="panel">
      <div class="panel-head">
        <strong>Filter</strong>
        <span class="hint">{count} Karten · 🔒 hält einen Filter fest, ★ zeigt ihn in der Leiste</span>
        <button class="link" onclick={resetAll}>Alles zurücksetzen</button>
        <button class="btn" onclick={() => (panel = false)}>Schließen</button>
      </div>
      <div class="sections">
        {#each shownSections as s (s.key)}
          <div class="section" class:active={chosen(s.key).length > 0}>
            <div class="section-head">
              <strong>{s.label}</strong>
              <span class="tools">
                <button
                  class="icon"
                  aria-pressed={prefs.locks.includes(s.key)}
                  title={prefs.locks.includes(s.key)
                    ? `${s.label} nicht mehr festhalten`
                    : `${s.label} festhalten (bleibt beim Zurücksetzen und Neuladen)`}
                  aria-label={`${s.label} festhalten`}
                  onclick={() => toggleLock(s.key)}>{prefs.locks.includes(s.key) ? "🔒" : "🔓"}</button
                >
                <button
                  class="icon"
                  aria-pressed={prefs.quick.includes(s.key)}
                  title={prefs.quick.includes(s.key)
                    ? `${s.label} aus der Schnellfilter-Leiste nehmen`
                    : `${s.label} in die Schnellfilter-Leiste`}
                  aria-label={`${s.label} in der Schnellfilter-Leiste`}
                  onclick={() => toggleQuick(s.key)}>{prefs.quick.includes(s.key) ? "★" : "☆"}</button
                >
                <button
                  class="icon"
                  title={`${s.label} zurücksetzen`}
                  aria-label={`${s.label} zurücksetzen`}
                  disabled={!chosen(s.key).length}
                  onclick={() => reset(s.key)}>↺</button
                >
              </span>
            </div>
            {@render body(s, "panel")}
          </div>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .search {
    position: relative;
    flex: 1 1 260px;
    min-width: 0;
    display: flex;
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding-right: 36px;
  }
  .help-btn {
    position: absolute;
    right: 5px;
    top: 50%;
    transform: translateY(-50%);
    width: 26px;
    height: 26px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--bg-sunken);
    color: var(--text-dim);
    font-size: 13px;
  }
  input[type="search"],
  select {
    height: 36px;
    padding: 0 12px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .order {
    display: flex;
    gap: 4px;
  }
  .btn {
    height: 36px;
    padding: 0 12px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    white-space: nowrap;
  }
  .btn.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-raised));
  }
  .btn.dir {
    width: 36px;
    padding: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }
  .chip {
    min-height: 30px;
    padding: 0 10px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 13px;
    letter-spacing: 0.02em;
    white-space: nowrap;
    transition:
      background 0.15s,
      border-color 0.15s;
  }
  .chip[aria-pressed="true"] {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-raised));
    border-color: var(--accent);
  }
  .chip.color {
    width: 30px;
    padding: 0;
    background: color-mix(in srgb, var(--chip) 35%, var(--bg-raised));
    border-color: color-mix(in srgb, var(--chip) 50%, transparent);
  }
  .chip.color[aria-pressed="true"] {
    background: var(--chip);
    border-color: var(--text);
    box-shadow: 0 0 10px color-mix(in srgb, var(--chip) 70%, transparent);
  }
  .chip.more {
    color: var(--text-dim);
  }
  .count {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 14px;
  }
  .quick {
    gap: 6px 14px;
  }
  .q {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }
  .q-label {
    color: var(--text-dim);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 2px;
  }
  .btn.drop {
    height: 30px;
    font-size: 13px;
  }
  .pop {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: min(340px, calc(100vw - 32px));
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .pop-head,
  .section-head,
  .panel-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pop-head .link,
  .section-head .tools {
    margin-left: auto;
  }
  .help {
    width: min(440px, calc(100vw - 32px));
    font-size: 13px;
  }
  .help h3 {
    margin: 0;
    font-size: 15px;
  }
  .help dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 12px;
    margin: 0;
  }
  .help dt {
    font-family: ui-monospace, monospace;
    color: var(--accent);
  }
  .help dd {
    margin: 0;
    color: var(--text-dim);
  }
  .help .fields {
    margin: 0;
    color: var(--text-dim);
    line-height: 1.7;
  }
  code {
    font-family: ui-monospace, monospace;
    color: var(--text);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: 13px;
    white-space: nowrap;
  }
  .panel {
    padding: 12px;
    background: var(--bg-sunken);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .panel-head {
    flex-wrap: wrap;
  }
  .panel-head .hint {
    flex: 1;
  }
  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 10px;
  }
  .section {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    min-width: 0;
  }
  .section.active {
    border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
  }
  .tools {
    display: flex;
    gap: 2px;
  }
  .icon {
    width: 28px;
    height: 26px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--text-dim);
    font-size: 14px;
  }
  .icon[aria-pressed="true"] {
    color: var(--accent);
    border-color: var(--line);
  }
  .icon:disabled {
    opacity: 0.35;
  }
  .pick {
    width: 100%;
    height: 32px;
  }
  .pickbox {
    position: relative;
  }
  .matches {
    list-style: none;
    margin: 6px 0 0;
    padding: 4px;
    max-height: 260px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
  .matches.drop {
    position: absolute;
    z-index: 25;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 4px;
    box-shadow: var(--shadow);
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 13px;
    cursor: pointer;
  }
  .opt span {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .opt input {
    margin: 0;
    accent-color: var(--accent);
  }
  .opt.hi {
    background: var(--bg-sunken);
  }
  [aria-selected="true"] > .opt span {
    color: var(--accent);
  }
  .matches small,
  .none,
  .hint {
    color: var(--text-dim);
    font-size: 12px;
  }
  .popular .hint {
    margin-right: 2px;
  }
  @media (max-width: 600px) {
    .count {
      margin-left: 0;
    }
    /* Popovers span the bar instead of starting at their button (which may sit at the right edge). */
    .quick {
      position: relative;
    }
    .q {
      position: static;
    }
    .quick .pop {
      width: auto;
      right: 0;
    }
    .sections {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
