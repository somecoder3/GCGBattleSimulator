<script lang="ts">
  import type { CardPool } from "../../data/cards";
  import { COLORS, type CardDef, type CardType, type Color } from "../../data/types";
  import CardDetail from "./CardDetail.svelte";
  import CardTile from "./CardTile.svelte";

  let { pool }: { pool: CardPool } = $props();

  // Same order and spelling as the type filter on gundam-gcg.com.
  const TYPES: CardType[] = [
    "UNIT",
    "PILOT",
    "COMMAND",
    "BASE",
    "RESOURCE",
    "EX BASE",
    "EX RESOURCE",
    "UNIT TOKEN",
  ];

  let query = $state("");
  // Not named `set`: Svelte 5.57 names the generated bind:value setter `set`, which shadows such a
  // variable and makes the select do nothing.
  let setCode = $state("");
  let types = $state<CardType[]>([]);
  let colors = $state<Color[]>([]);
  let selected = $state<CardDef>();

  const sets = $derived(pool.sets());

  const filtered = $derived.by(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return pool.cards.filter((card) => {
      if (setCode && card.set !== setCode) return false;
      if (types.length && !types.includes(card.type)) return false;
      if (colors.length && (!card.color || !colors.includes(card.color))) return false;
      if (words.length) {
        const haystack = `${card.no} ${card.name} ${card.traits.join(" ")} ${card.text}`.toLowerCase();
        if (!words.every((w) => haystack.includes(w))) return false;
      }
      return true;
    });
  });

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }
</script>

<section class="filters" aria-label="Filter">
  <input
    class="search"
    type="search"
    placeholder="Suche nach Name, Nummer, Trait, Text …"
    bind:value={query}
    aria-label="Suche"
  />
  <select bind:value={setCode} aria-label="Set">
    <option value="">Alle Sets</option>
    {#each sets as code (code)}
      <option value={code}>{code}</option>
    {/each}
  </select>
  <div class="chips" role="group" aria-label="Kartentyp">
    {#each TYPES as type (type)}
      <button class="chip" aria-pressed={types.includes(type)} onclick={() => (types = toggle(types, type))}
        >{type}</button
      >
    {/each}
  </div>
  <div class="chips" role="group" aria-label="Farbe">
    {#each COLORS as c (c)}
      <button
        class="chip color"
        style:--chip={`var(--c-${c.toLowerCase()})`}
        aria-pressed={colors.includes(c)}
        aria-label={c}
        title={c}
        onclick={() => (colors = toggle(colors, c))}
      ></button>
    {/each}
  </div>
  <span class="count">{filtered.length} Karten</span>
</section>

<ul class="grid">
  {#each filtered as card (card.no)}
    <li><CardTile {card} onselect={() => (selected = card)} /></li>
  {/each}
</ul>

{#if selected}
  <CardDetail card={selected} onclose={() => (selected = undefined)} />
{/if}

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }
  .search {
    flex: 1 1 260px;
    min-width: 0;
  }
  .search,
  select {
    height: 38px;
    padding: 0 12px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    height: 34px;
    padding: 0 12px;
    background: var(--bg-raised);
    border: 1px solid var(--line);
    border-radius: 999px;
    font-size: 13px;
    letter-spacing: 0.03em;
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
    width: 34px;
    padding: 0;
    background: color-mix(in srgb, var(--chip) 35%, var(--bg-raised));
    border-color: color-mix(in srgb, var(--chip) 50%, transparent);
  }
  .chip.color[aria-pressed="true"] {
    background: var(--chip);
    border-color: var(--text);
    box-shadow: 0 0 10px color-mix(in srgb, var(--chip) 70%, transparent);
  }
  .count {
    margin-left: auto;
    color: var(--text-dim);
    font-size: 14px;
  }
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 14px;
  }
  @media (max-width: 600px) {
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      gap: 8px;
    }
    .count {
      margin-left: 0;
    }
  }
</style>
