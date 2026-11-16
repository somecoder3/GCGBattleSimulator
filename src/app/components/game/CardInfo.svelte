<script lang="ts">
  import { cardImageUrl } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import { splitCardText } from "../../lib/cardtext";
  import CardImage from "../CardImage.svelte";

  // Card details in the side panel: image, current values and text, and the paired Pilot.
  let {
    card,
    stats = null,
    pilot,
    linked = false,
    pairedTo,
  }: {
    card: CardDef;
    stats?: { ap: number; hp: number; damage: number; showAp: boolean } | null;
    pilot?: CardDef;
    /** The Unit is linked with its Pilot. */
    linked?: boolean;
    /** For a paired Pilot: its Unit. */
    pairedTo?: CardDef;
  } = $props();

  const links = $derived(card.link.map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`)));

  const lines = $derived(splitCardText(card.text));
  const pilotLines = $derived(pilot ? splitCardText(pilot.text) : []);
</script>

{#snippet text(parts: ReturnType<typeof splitCardText>)}
  {#each parts as line, i (i)}
    <p>
      {#each line as part, j (j)}
        {#if part.kind === "text"}{part.value}{:else}<span class={part.kind}>{part.value}</span>{/if}
      {/each}
    </p>
  {/each}
{/snippet}

<div class="info">
  <div class="image"><CardImage {card} src={cardImageUrl(card, "full")} eager /></div>
  <div class="facts">
    <span class="no">{card.no} · {card.type}</span>
    <strong class="name">{card.name}</strong>
    <span class="meta">
      {#if card.level !== null}Lv. {card.level} · Kosten {card.cost}{/if}
      {#if stats}
        · {#if stats.showAp}AP {stats.ap} ·
        {/if}HP {stats.hp - stats.damage}/{stats.hp}
      {:else if card.ap !== null}
        · AP {card.ap} · HP {card.hp}
      {/if}
    </span>
    {#if card.traits.length}<span class="meta">{card.traits.join(" · ")}</span>{/if}
    {#if links.length}
      <span class="links" class:active={linked} title="Link-Bedingung: Pilot mit diesem Namen oder Trait">
        Link: {links.join(" oder ")}{linked ? " ✓" : ""}
      </span>
    {/if}
    {#if pairedTo}<span class="meta">Pilot in {pairedTo.name}</span>{/if}
  </div>
</div>
{#if card.text}
  <div class="text">{@render text(lines)}</div>
{/if}
{#if pilot}
  <div class="text">
    <strong>Pilot: {pilot.name}</strong> (AP+{pilot.ap ?? 0}, HP+{pilot.hp ?? 0})
    {@render text(pilotLines)}
  </div>
{/if}

<style>
  .info {
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 10px;
  }
  .facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .no,
  .meta {
    color: var(--text-dim);
  }
  .name {
    font-size: 15px;
    line-height: 1.25;
  }
  .links {
    color: var(--text-dim);
  }
  .links.active {
    color: #ffd166;
  }
  .text {
    margin-top: 8px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 13px;
  }
  .text p {
    margin: 4px 0 0;
  }
  .timing {
    padding: 0 5px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
    font-weight: 600;
  }
  .keyword {
    color: #ffd166;
    font-weight: 600;
  }
</style>
