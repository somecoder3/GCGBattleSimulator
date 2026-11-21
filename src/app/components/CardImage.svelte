<script lang="ts">
  import type { CardDef } from "../../data/types";
  import { imageSource } from "../lib/cardimages";

  // Official image with a placeholder (number, name, stats) while it loads or if it is missing.
  // In a build the images are encrypted (src/app/lib/cardimages.ts): `src` is the image path, `shown` the
  // URL the <img> gets. Lazy images are only fetched near the viewport (as `loading="lazy"` did before).
  let { card, src, eager = false }: { card: CardDef; src: string; eager?: boolean } = $props();

  // Keyed by src, so switching printings never shows a stale state.
  let loaded = $state<string>();
  let failed = $state<string>();
  const status = $derived(failed === src ? "failed" : loaded === src ? "ok" : "loading");

  let near = $state(false);
  let shown = $state<{ src: string; url: string }>();

  function nearViewport(node: HTMLElement) {
    if (eager || typeof IntersectionObserver === "undefined") {
      near = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          near = true;
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  $effect(() => {
    const path = src;
    if (!path || !(near || eager)) return;
    const source = imageSource(path);
    if (typeof source === "string") {
      shown = { src: path, url: source };
      return;
    }
    let alive = true;
    source.then(
      (url) => alive && (shown = { src: path, url }),
      () => alive && (failed = path),
    );
    return () => (alive = false);
  });
</script>

<div class="card" data-color={card.color?.toLowerCase() ?? "none"} use:nearViewport>
  {#if status !== "ok"}
    <div class="placeholder" class:failed={status === "failed"}>
      <span class="no">{card.no}</span>
      <span class="name">{card.name}</span>
      {#if card.ap !== null || card.hp !== null}
        <span class="stats">{card.ap ?? "–"} / {card.hp ?? "–"}</span>
      {/if}
    </div>
  {/if}
  {#if src && status !== "failed" && shown?.src === src}
    <img
      src={shown.url}
      alt={card.name}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      class:visible={status === "ok"}
      onload={() => (loaded = src)}
      onerror={() => (failed = src)}
    />
  {/if}
</div>

<style>
  .card {
    position: relative;
    aspect-ratio: 600 / 837;
    border-radius: var(--radius-card);
    overflow: hidden;
    background: var(--bg-sunken);
    --tint: var(--line);
  }
  .card[data-color="blue"] {
    --tint: var(--c-blue);
  }
  .card[data-color="green"] {
    --tint: var(--c-green);
  }
  .card[data-color="red"] {
    --tint: var(--c-red);
  }
  .card[data-color="white"] {
    --tint: var(--c-white);
  }
  .card[data-color="purple"] {
    --tint: var(--c-purple);
  }
  img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.25s;
  }
  img.visible {
    opacity: 1;
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 10px;
    text-align: center;
    border: 1px solid color-mix(in srgb, var(--tint) 45%, transparent);
    border-radius: inherit;
    background: linear-gradient(
      160deg,
      color-mix(in srgb, var(--tint) 18%, var(--bg-raised)),
      var(--bg-sunken)
    );
    font-size: 12px;
  }
  .no {
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .name {
    font-weight: 600;
  }
  .stats {
    color: var(--text-dim);
  }
</style>
