<script lang="ts">
  // "Passt zu": cards that go well with a card, from the effects and the tournament lists
  // (src/app/lib/partners.ts). In the card detail of the Cards tab and the deck builder.
  import { cardImageUrl, type CardPool } from "../../data/cards";
  import type { CardDef } from "../../data/types";
  import { MAX_COPIES } from "../../engine/deck";
  import { cardLib, SNAPSHOT } from "../lib/decks";
  import { partners, type PartnerGroup } from "../lib/partners";
  import CardImage from "./CardImage.svelte";

  let {
    card,
    pool,
    deckColors,
    count,
    onadd,
    onpick,
  }: {
    card: CardDef;
    pool: CardPool;
    /** Colours of the deck being built: offered as a filter, on when the deck has two. */
    deckColors?: ReadonlySet<string>;
    /** Copies in the deck being built. */
    count?: (no: string) => number;
    onadd?: (no: string) => void;
    /** Shows another card in the detail. */
    onpick: (card: CardDef) => void;
  } = $props();

  const STEP = 8;
  // Default only (from the deck when the detail opens); the user can change it.
  // svelte-ignore state_referenced_locally
  let onlyDeck = $state((deckColors?.size ?? 0) >= 2);
  let open = $state<Record<string, boolean>>({});
  $effect(() => {
    void card;
    open = {};
  });

  const groups = $derived.by((): PartnerGroup[] => {
    const colors = onlyDeck && deckColors?.size ? deckColors : undefined;
    return partners(cardLib(pool), card.no, { snapshot: SNAPSHOT, ...(colors ? { colors } : {}) });
  });
  const key = (g: PartnerGroup, i: number) => `${i}:${g.title}`;
</script>

<section class="partners" aria-label="Passt zu">
  <div class="head">
    <h3>Passt zu</h3>
    {#if deckColors?.size}
      <label class="only">
        <input type="checkbox" bind:checked={onlyDeck} />
        Nur Farben des Decks ({[...deckColors].join("/")})
      </label>
    {/if}
  </div>
  {#each groups as g, i (key(g, i))}
    {@const all = open[key(g, i)]}
    <div class="group">
      <h4>
        <span class="kind {g.kind}"
          >{g.kind === "link"
            ? "Link"
            : g.kind === "wants"
              ? "Effekt"
              : g.kind === "wanted"
                ? "Effekt"
                : "Turniere"}</span
        >
        {g.title}
        <small>{g.cards.length}</small>
      </h4>
      <ul>
        {#each all ? g.cards : g.cards.slice(0, STEP) as p (p.no)}
          {@const c = pool.get(p.no)}
          {#if c}
            {@const n = count?.(p.no) ?? 0}
            <li title={p.note ? `${c.name} – ${p.note}` : c.name}>
              <button class="img" onclick={() => onpick(c)} aria-label={`${c.no} ${c.name}`}>
                <CardImage card={c} src={cardImageUrl(c, "small")} />
                {#if n}<span class="badge">{n}×</span>{/if}
              </button>
              <span class="name">{c.name}</span>
              {#if p.note}<small class="note">{p.note}</small>{/if}
              {#if onadd}
                <button class="add" onclick={() => onadd(p.no)} disabled={n >= MAX_COPIES} title="Ins Deck"
                  >+</button
                >
              {/if}
            </li>
          {/if}
        {/each}
      </ul>
      {#if g.cards.length > STEP}
        <button class="more" onclick={() => (open = { ...open, [key(g, i)]: !all })}>
          {all ? "Weniger anzeigen" : `Alle ${g.cards.length} anzeigen`}
        </button>
      {/if}
    </div>
  {:else}
    <p class="hint">
      Keine Partner gefunden: kein Link, keine Effekte mit Bezug auf bestimmte Karten, in keiner Turnierliste.
    </p>
  {/each}
  <p class="hint">
    Effekt und Link aus den Kartentexten; Turniere: im Meta-Snapshot öfter zusammen als zufällig ({SNAPSHOT
      ?.decks.length ?? 0} Listen). Allgemeines wie Kurve oder Farbe steht hier nicht.
  </p>
</section>

<style>
  .partners {
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin-bottom: 8px;
  }
  h3 {
    margin: 0;
    font-size: 16px;
  }
  .only {
    font-size: 13px;
    color: var(--text-dim);
  }
  .group {
    margin-bottom: 12px;
  }
  h4 {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px;
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }
  h4 small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .kind {
    padding: 0 6px;
    border-radius: 4px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent);
  }
  .kind.link {
    background: color-mix(in srgb, #ffd166 22%, transparent);
    color: #ffd166;
  }
  .kind.played {
    background: color-mix(in srgb, #7bd88f 22%, transparent);
    color: #7bd88f;
  }
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .img {
    position: relative;
    display: block;
    padding: 0;
    border: 0;
    background: none;
    border-radius: var(--radius-card);
    transition: transform 0.15s;
  }
  .img:hover {
    transform: translateY(-2px);
  }
  .badge {
    position: absolute;
    top: 4px;
    left: 4px;
    padding: 0 5px;
    border-radius: 6px;
    background: rgb(0 0 0 / 75%);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
  }
  .name {
    font-size: 12px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note {
    color: var(--text-dim);
    font-size: 11px;
    line-height: 1.2;
  }
  .add {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--bg-raised);
    font-weight: 700;
  }
  .add:disabled {
    opacity: 0.4;
  }
  .more {
    margin-top: 6px;
    padding: 2px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 12px;
  }
  .hint {
    margin: 4px 0 0;
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
