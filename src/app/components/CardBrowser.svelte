<script lang="ts">
  import type { CardPool } from "../../data/cards";
  import type { CardDef } from "../../data/types";
  import { cardMatcher, emptyFilter, sortCards, type CardFilter, type Ordering } from "../lib/cardfilter";
  import CardDetail from "./CardDetail.svelte";
  import CardFilters from "./CardFilters.svelte";
  import CardTile from "./CardTile.svelte";

  let { pool }: { pool: CardPool } = $props();

  let filter = $state<CardFilter>(emptyFilter());
  let ordering = $state<Ordering>({ key: "no", desc: false });
  let selected = $state<CardDef>();

  const filtered = $derived(sortCards(pool.cards.filter(cardMatcher(filter)), ordering));
</script>

<CardFilters cards={pool.cards} bind:filter bind:ordering count={filtered.length} id="cards" />

<ul class="grid">
  {#each filtered as card (card.no)}
    <li><CardTile {card} onselect={() => (selected = card)} /></li>
  {/each}
</ul>

{#if selected}
  <CardDetail card={selected} {pool} onclose={() => (selected = undefined)} />
{/if}

<style>
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
  }
</style>
