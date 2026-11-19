<script lang="ts">
  import { cardImageUrl } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import { HAND, type DeckEntry } from "../../lib/deckstats";
  import CardImage from "../CardImage.svelte";

  // Draw test like ExBurst's: shuffle, hand of five, one redraw (6-2-1-6-1), then the six shields from the
  // top (6-2-1-7) and a card per turn. A click on a hand card discards it.

  let { entries, onclose }: { entries: readonly DeckEntry[]; onclose: () => void } = $props();

  const SHIELDS = 6;
  let dialog: HTMLDialogElement;
  let deck = $state.raw<CardDef[]>([]);
  let hand = $state.raw<CardDef[]>([]);
  let trash = $state.raw<CardDef[]>([]);
  let shields = $state(0);
  let turn = $state(0);
  let redrawn = $state(false);
  /** Cards drawn this turn (highlighted). */
  let fresh = $state(0);

  function shuffled(cards: CardDef[]): CardDef[] {
    const a = [...cards];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  function newHand() {
    const all = shuffled(entries.flatMap((e) => Array<CardDef>(e.n).fill(e.card)));
    hand = all.slice(0, HAND);
    deck = all.slice(HAND);
    trash = [];
    shields = 0;
    turn = 0;
    redrawn = false;
    fresh = 0;
  }

  /** Hand to the bottom, draw five, then shuffle the deck. */
  function redraw() {
    const rest = [...deck, ...hand];
    hand = rest.slice(0, HAND);
    deck = shuffled(rest.slice(HAND));
    redrawn = true;
  }

  function drawForTurn() {
    let d = deck;
    if (turn === 0) {
      shields = Math.min(SHIELDS, d.length);
      d = d.slice(shields);
    }
    if (!d.length) return;
    hand = [...hand, d[0]!];
    deck = d.slice(1);
    turn++;
    fresh = 1;
  }

  function discard(i: number) {
    trash = [...trash, hand[i]!];
    hand = hand.filter((_, j) => j !== i);
    fresh = 0;
  }

  newHand();
  $effect(() => {
    if (!dialog.open) dialog.showModal();
  });
</script>

<dialog bind:this={dialog} {onclose} onclick={(e) => e.target === dialog && dialog.close()}>
  <header>
    <h2>Probehand</h2>
    <p class="hint">
      {turn ? `Zug ${turn}` : "Starthand"} · {deck.length} Karten im Deck{shields
        ? ` · ${shields} Schilde`
        : ""}{trash.length ? ` · ${trash.length} abgeworfen` : ""} · {redrawn
        ? "Mulligan genutzt"
        : turn
          ? "ohne Mulligan"
          : "1 Mulligan frei"}
    </p>
  </header>
  <div class="hand">
    {#each hand as card, i (i)}
      <button
        class="card"
        class:fresh={fresh && i >= hand.length - fresh}
        onclick={() => discard(i)}
        title="{card.name} – anklicken zum Abwerfen"
      >
        <CardImage {card} src={cardImageUrl(card, "small")} eager />
      </button>
    {/each}
  </div>
  <p class="hint">
    Eine Karte anklicken, um sie abzuwerfen. Vor dem ersten Ziehen kommen die {SHIELDS} Schilde vom Deck.
  </p>
  <div class="actions">
    <button class="btn" onclick={newHand}>Neue Hand</button>
    <button class="btn" onclick={redraw} disabled={redrawn || turn > 0}>Mulligan</button>
    <button class="btn primary" onclick={drawForTurn} disabled={!deck.length}>Zug {turn + 1}: ziehen</button>
  </div>
  <button class="close" onclick={() => dialog.close()} aria-label="Schließen">✕</button>
</dialog>

<style>
  dialog {
    width: min(900px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg-raised);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 65%);
    backdrop-filter: blur(3px);
  }
  h2 {
    margin: 0 0 4px;
    font-size: 18px;
  }
  .hint {
    margin: 0 0 10px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .hand {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
    margin: 12px 0;
  }
  .card {
    padding: 0;
    border: 2px solid transparent;
    border-radius: 8px;
    background: none;
    transition: transform 0.12s;
  }
  .card:hover {
    transform: translateY(-4px);
  }
  .card.fresh {
    border-color: var(--accent);
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
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
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
  @media (max-width: 700px) {
    .hand {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
