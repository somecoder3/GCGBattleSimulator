<script lang="ts">
  import { onMount, tick } from "svelte";
  import { slide } from "svelte/transition";
  import { cardImageUrl, type CardPool } from "../../data/cards";
  import { cardSrc } from "../lib/cardimages";
  import { faceCard, matchDeck, type DeckGroup } from "../lib/deckgroups";
  import { namedOnly, type DeckChoice } from "../lib/decks";
  import { modal } from "../lib/modal";

  // Choosing a deck (game and Decks tab): the decks in groups that open and close, a search over all of
  // them, the chosen deck marked. On phones it fills the screen.

  let {
    title,
    pool,
    groups,
    selected,
    open: initiallyOpen,
    unavailable,
    onpick,
    onclose,
    onrandom,
  }: {
    title: string;
    pool: CardPool;
    groups: DeckGroup[];
    selected?: string;
    /** Keys of the groups open at first. */
    open: readonly string[];
    /** Why a deck cannot be chosen here (undefined: it can). */
    unavailable?: (d: DeckChoice) => string | undefined;
    onpick: (d: DeckChoice) => void;
    onclose: () => void;
    /** Offers "Zufälliges Deck". */
    onrandom?: () => void;
  } = $props();

  let dialog: HTMLDialogElement;
  let body: HTMLDivElement;
  let search: HTMLInputElement;
  let query = $state("");
  // svelte-ignore state_referenced_locally
  let opened = $state<Record<string, boolean>>(Object.fromEntries(initiallyOpen.map((k) => [k, true])));

  const searching = $derived(query.trim().length > 0);
  const shown = $derived(
    searching
      ? groups
          .map((g) => ({ ...g, decks: g.decks.filter((d) => matchDeck(d, query)) }))
          .filter((g) => g.decks.length > 0)
      : groups,
  );

  onMount(() => {
    dialog.showModal();
    // A keyboard on phones would cover half the list: there the list gets the focus, not the search.
    if (matchMedia("(pointer: fine)").matches) search.focus();
    else body.focus({ preventScroll: true });
    // The chosen deck in the middle of the list (only the list scrolls, never the page underneath).
    void tick().then(() => {
      const row = body.querySelector<HTMLElement>("[aria-current='true']");
      if (!row) return;
      const top = row.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
      body.scrollTop = top - (body.clientHeight - row.offsetHeight) / 2;
    });
  });

  function pick(d: DeckChoice) {
    if (unavailable?.(d)) return;
    onpick(d);
    dialog.close();
  }

  const toggle = (key: string) => (opened[key] = !opened[key]);
  const pct = (x: number) => `${(x * 100).toFixed(1).replace(".", ",")} %`;
  const colorsOf = (d: DeckChoice) => d.colors.split("/").filter(Boolean);
  // A cache, not state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const faces = new Map<string, ReturnType<typeof faceCard>>();
  const face = (d: DeckChoice) => {
    if (!faces.has(d.id)) faces.set(d.id, faceCard(pool, d.deck.main));
    return faces.get(d.id);
  };
</script>

<dialog
  bind:this={dialog}
  use:modal
  class="picker"
  aria-labelledby="picker-title"
  {onclose}
  onclick={(e) => e.target === dialog && dialog.close()}
>
  <header>
    <div class="title">
      <h2 id="picker-title">{title}</h2>
      <button class="close" onclick={() => dialog.close()} aria-label="Schließen">✕</button>
    </div>
    <div class="tools">
      <label class="search">
        <span aria-hidden="true">⌕</span>
        <input
          bind:this={search}
          bind:value={query}
          type="search"
          placeholder="Deck suchen …"
          aria-label="Deck suchen"
          enterkeyhint="search"
        />
      </label>
      {#if onrandom}
        <button
          class="random"
          onclick={() => {
            onrandom();
            dialog.close();
          }}><span aria-hidden="true">🎲</span> Zufällig</button
        >
      {/if}
    </div>
  </header>

  <div class="body" bind:this={body} tabindex="-1">
    {#each shown as g (g.key)}
      {@const isOpen = searching || !!opened[g.key]}
      {@const chosen = g.decks.some((d) => d.id === selected)}
      <section class="group" class:open={isOpen}>
        <button class="head" aria-expanded={isOpen} onclick={() => toggle(g.key)} disabled={searching}>
          <span class="chevron" aria-hidden="true">›</span>
          <span class="label">{g.label}</span>
          {#if chosen && !isOpen}<span class="mark" title="Enthält das gewählte Deck">●</span>{/if}
          <span class="count">{g.decks.length}</span>
        </button>
        {#if isOpen}
          <ul transition:slide={{ duration: 180 }}>
            {#each g.decks as d (d.id)}
              {@const card = face(d)}
              {@const why = unavailable?.(d)}
              <li>
                <button
                  class="row"
                  class:current={d.id === selected}
                  aria-current={d.id === selected ? "true" : undefined}
                  disabled={!!why}
                  onclick={() => pick(d)}
                >
                  <span class="art" data-color={colorsOf(d)[0]?.toLowerCase() ?? "none"}>
                    {#if card}
                      <img use:cardSrc={cardImageUrl(card, "small")} alt="" loading="lazy" decoding="async" />
                    {/if}
                  </span>
                  <span class="text">
                    <span class="name">
                      {#if !namedOnly(d)}<span class="id">{d.id}</span>{/if}{d.title ?? d.name}
                    </span>
                    <span class="sub">
                      {#each colorsOf(d) as c (c)}
                        <span class="color"><i class="dot" data-color={c.toLowerCase()}></i>{c}</span>
                      {/each}
                      {#if d.share !== undefined}<span>{pct(d.share)} der Meta</span>{/if}
                      {#if why}<span class="why">{why}</span>
                      {:else if !d.supported}<span class="why">Effekte teilweise</span>{/if}
                    </span>
                  </span>
                  {#if d.id === selected}<span class="check" aria-label="gewählt">✓</span>{/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {:else}
      <p class="empty">Kein Deck gefunden.</p>
    {/each}
  </div>
</dialog>

<style>
  dialog {
    display: flex;
    flex-direction: column;
    width: min(620px, calc(100vw - 32px));
    height: min(760px, calc(100dvh - 48px));
    max-height: none;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-raised);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  dialog:not([open]) {
    display: none;
  }
  dialog[open] {
    animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.15);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 65%);
    backdrop-filter: blur(3px);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(8px);
    }
  }
  header {
    flex: none;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--line);
    background: linear-gradient(180deg, rgb(79 195 255 / 6%), transparent), var(--bg-raised);
  }
  .title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  .close {
    flex: none;
    width: 36px;
    height: 36px;
    border: 0;
    border-radius: 50%;
    background: var(--bg-sunken);
  }
  .tools {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .search {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
    color: var(--text-dim);
  }
  .search:focus-within {
    border-color: var(--accent);
  }
  .search input {
    flex: 1;
    min-width: 0;
    min-height: 40px;
    border: 0;
    outline: 0;
    background: none;
    font-size: 15px;
  }
  .random {
    flex: none;
    min-height: 42px;
    padding: 0 14px;
    border: 1px solid rgb(255 93 108 / 50%);
    border-radius: 10px;
    background: rgb(255 93 108 / 10%);
    font-weight: 600;
  }
  .random:hover {
    background: rgb(255 93 108 / 18%);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 8px 10px 16px;
    outline: 0;
  }
  .group + .group {
    margin-top: 4px;
  }
  .head {
    position: sticky;
    top: -8px;
    z-index: 1;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 46px;
    padding: 8px 10px;
    border: 0;
    border-radius: 10px;
    background: var(--bg-raised);
    text-align: left;
    font-weight: 600;
  }
  .head:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg-sunken) 60%, var(--bg-raised));
  }
  .head:disabled {
    cursor: default;
    color: inherit;
  }
  .chevron {
    display: inline-block;
    width: 14px;
    color: var(--text-dim);
    font-size: 20px;
    line-height: 1;
    transition: transform 0.18s;
  }
  .open .chevron {
    transform: rotate(90deg);
  }
  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark {
    color: var(--accent);
    font-size: 10px;
  }
  .count {
    min-width: 26px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
    text-align: center;
  }
  ul {
    margin: 0;
    padding: 2px 0 6px;
    list-style: none;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 58px;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: none;
    text-align: left;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .row:hover:not(:disabled) {
    background: var(--bg-sunken);
  }
  .row.current {
    border-color: rgb(79 195 255 / 55%);
    background: rgb(79 195 255 / 9%);
  }
  .row:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .art {
    flex: none;
    width: 64px;
    height: 44px;
    overflow: hidden;
    border-radius: 8px;
    background: color-mix(in srgb, var(--tint, var(--line)) 35%, var(--bg-sunken));
  }
  .art img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 26%;
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    font-weight: 600;
    line-height: 1.3;
  }
  .id {
    margin-right: 6px;
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
  .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 10px;
    color: var(--text-dim);
    font-size: 12px;
  }
  .color {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .why {
    color: #ffd166;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--tint, var(--line));
  }
  [data-color="blue"] {
    --tint: var(--c-blue);
  }
  [data-color="green"] {
    --tint: var(--c-green);
  }
  [data-color="red"] {
    --tint: var(--c-red);
  }
  [data-color="white"] {
    --tint: var(--c-white);
  }
  [data-color="purple"] {
    --tint: var(--c-purple);
  }
  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent-strong);
    color: #fff;
    font-size: 14px;
    font-weight: 700;
  }
  .empty {
    margin: 32px 0;
    color: var(--text-dim);
    text-align: center;
  }
  /* Phones: the whole screen, sliding up. */
  @media (max-width: 700px) {
    dialog {
      width: 100vw;
      max-width: 100vw;
      height: 100dvh;
      margin: 0;
      border: 0;
      border-radius: 0;
    }
    dialog[open] {
      animation: rise 0.26s cubic-bezier(0.2, 0.9, 0.3, 1);
    }
    @keyframes rise {
      from {
        transform: translateY(40px);
        opacity: 0;
      }
    }
    header {
      padding: calc(10px + env(safe-area-inset-top)) 12px 10px;
    }
    .body {
      padding: 6px 6px calc(16px + env(safe-area-inset-bottom));
    }
    .row {
      min-height: 62px;
      padding: 7px 8px;
    }
  }
</style>
