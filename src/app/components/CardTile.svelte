<script lang="ts">
  import { cardImageUrl } from "../../data/cards";
  import type { CardDef } from "../../data/types";
  import CardImage from "./CardImage.svelte";

  let { card, onselect }: { card: CardDef; onselect: () => void } = $props();
</script>

<button class="tile" onclick={onselect} aria-label={`${card.no} ${card.name}`}>
  <CardImage {card} src={cardImageUrl(card, "small")} />
</button>

<style>
  .tile {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    border-radius: var(--radius-card);
    transition:
      transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.18s;
  }
  .tile:hover {
    transform: translateY(-4px) scale(1.03);
    box-shadow: var(--shadow);
  }
  .tile:active {
    transform: scale(0.98);
  }
</style>
