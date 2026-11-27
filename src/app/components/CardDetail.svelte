<script lang="ts">
  import { cardImageUrl, type CardPool } from "../../data/cards";
  import type { CardDef } from "../../data/types";
  import { splitCardText } from "../lib/cardtext";
  import CardImage from "./CardImage.svelte";
  import CardPartners from "./CardPartners.svelte";
  import { MAX_COPIES } from "../../engine/deck";
  import { modal } from "../lib/modal";

  let {
    card: start,
    onclose,
    pool,
    deckColors,
    count,
    onadd,
    onremove,
  }: {
    card: CardDef;
    onclose: () => void;
    /** With the pool: "Passt zu" (partner cards; clicking one shows it here, "Zurück" returns). */
    pool?: CardPool;
    deckColors?: ReadonlySet<string>;
    count?: (no: string) => number;
    onadd?: (no: string) => void;
    /** With `onadd`: "−" next to the count. */
    onremove?: (no: string) => void;
  } = $props();

  /** Cards opened from "Passt zu", the last one is shown. */
  let trail = $state<CardDef[]>([]);
  const card = $derived(trail.at(-1) ?? start);

  let alt = $state(0);
  let dialog: HTMLDialogElement;

  $effect(() => {
    void start;
    trail = [];
  });

  $effect(() => {
    alt = card.printings[0]?.alt ?? 0;
    if (!dialog.open) {
      dialog.showModal();
      // No focus ring on the first button (and no scrolling to it); Esc and the close button still work.
      dialog.focus({ preventScroll: true });
    }
  });

  function pick(c: CardDef) {
    trail = [...trail, c];
    dialog.scrollTo({ top: 0 });
  }

  const lines = $derived(splitCardText(card.text));
  const facts = $derived(
    [
      ["Typ", card.type],
      ["Farbe", card.color],
      ["Lv.", card.level],
      ["Kosten", card.cost],
      ["AP", card.ap],
      ["HP", card.hp],
      ["Zone", card.zones.join(" / ")],
      ["Traits", card.traits.join(", ")],
      ["Link", card.link.map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`)).join(" oder ")],
      ["Werk", card.sourceTitle],
    ].filter(([, v]) => v !== null && v !== ""),
  );
</script>

<dialog
  bind:this={dialog}
  use:modal
  tabindex="-1"
  {onclose}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <div class="layout">
    <div class="image">
      <CardImage {card} src={cardImageUrl(card, "full", alt)} eager />
      {#if card.printings.length > 1}
        <div class="printings" role="group" aria-label="Drucke">
          {#each card.printings as p (p.id)}
            <button aria-pressed={p.alt === alt} onclick={() => (alt = p.alt)} title={p.id}>
              {p.alt === 0 ? "Basis" : `ALT${p.alt}`}
              <small>{p.rarity}</small>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="info">
      <header>
        {#if trail.length}
          <button class="back" onclick={() => (trail = trail.slice(0, -1))}
            >← Zurück zu {(trail.at(-2) ?? start).name}</button
          >
        {/if}
        <span class="no">{card.no}</span>
        <h2>{card.name}</h2>
      </header>
      <dl>
        {#each facts as [label, value] (label)}
          <dt>{label}</dt>
          <dd>{value}</dd>
        {/each}
      </dl>
      {#if lines.length && card.text}
        <div class="text">
          {#each lines as parts, i (i)}
            <p>
              {#each parts as part, j (j)}
                {#if part.kind === "text"}{part.value}{:else}<span class={part.kind}>{part.value}</span>{/if}
              {/each}
            </p>
          {/each}
        </div>
      {/if}
      {#if onadd && count}
        {@const n = count(card.no)}
        <div class="deck-row">
          <span>Im Deck</span>
          {#if onremove}
            <span class="step" role="group" aria-label="Anzahl im Deck">
              <button onclick={() => onremove(card.no)} disabled={n === 0} aria-label="Eine weniger">−</button
              >
              <strong>{n}</strong>
              <button onclick={() => onadd(card.no)} disabled={n >= MAX_COPIES} aria-label="Eine mehr"
                >+</button
              >
            </span>
          {:else}
            <strong>{n}</strong>
            <button class="more" onclick={() => onadd(card.no)} disabled={n >= MAX_COPIES}>+ Ins Deck</button>
          {/if}
        </div>
      {/if}
    </div>
    {#if pool}
      <div class="wide">
        <CardPartners {card} {pool} {deckColors} {count} {onadd} onpick={pick} />
      </div>
    {/if}
  </div>
  <button class="close" onclick={() => dialog.close()} aria-label="Schließen">✕</button>
</dialog>

<style>
  dialog {
    width: min(960px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    padding: 0;
    overscroll-behavior: contain;
    outline: 0;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog[open] {
    animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 65%);
    backdrop-filter: blur(3px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.94) translateY(10px);
    }
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 380px) 1fr;
    gap: 24px;
    padding: 24px;
  }
  .printings {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .printings button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 13px;
  }
  .printings button[aria-pressed="true"] {
    border-color: var(--accent);
  }
  .printings small {
    color: var(--text-dim);
    margin-left: 4px;
  }
  header .no {
    color: var(--text-dim);
    font-size: 13px;
  }
  h2 {
    margin: 2px 0 14px;
    font-size: 22px;
    line-height: 1.2;
    padding-right: 32px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 14px;
    margin: 0 0 16px;
    font-size: 14px;
  }
  dt {
    color: var(--text-dim);
  }
  dd {
    margin: 0;
  }
  .text {
    padding: 12px 14px;
    background: var(--bg-sunken);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .text p {
    margin: 0 0 8px;
  }
  .text p:last-child {
    margin-bottom: 0;
  }
  .timing {
    display: inline-block;
    padding: 0 6px;
    margin-right: 3px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
  }
  .keyword {
    color: #ffd166;
    font-weight: 600;
  }
  .wide {
    grid-column: 1 / -1;
    min-width: 0;
  }
  .back {
    display: block;
    margin-bottom: 6px;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 13px;
  }
  .deck-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    font-size: 14px;
  }
  .deck-row .more {
    padding: 4px 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .deck-row .more:disabled {
    opacity: 0.4;
  }
  .step {
    display: inline-flex;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .step button {
    width: 38px;
    height: 34px;
    border: 0;
    background: none;
    font-size: 18px;
  }
  .step button:hover:not(:disabled) {
    background: rgb(79 195 255 / 14%);
  }
  .step button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .step strong {
    min-width: 24px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: var(--bg-sunken);
  }
  /* Phones: over the page from the top; it scrolls by itself, the page underneath stays as it was. */
  @media (max-width: 700px) {
    dialog {
      width: calc(100vw - 16px);
      max-width: none;
      max-height: calc(100dvh - 16px - env(safe-area-inset-top));
      margin: calc(8px + env(safe-area-inset-top)) auto auto;
    }
    dialog[open] {
      animation: drop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    @keyframes drop {
      from {
        opacity: 0;
        transform: translateY(-12px);
      }
    }
    /* Always reachable, also far down in the dialog. */
    .close {
      position: fixed;
      top: calc(16px + env(safe-area-inset-top));
      right: 16px;
      z-index: 2;
      box-shadow: 0 2px 10px rgb(0 0 0 / 50%);
    }
    .layout {
      grid-template-columns: 1fr;
      padding: 16px;
    }
    .image {
      max-width: 320px;
      margin: 0 auto;
      width: 100%;
    }
  }
</style>
