<script lang="ts">
  import type { Snippet } from "svelte";

  // A tooltip at a hovered element: above it ("above") or beside it ("side", e.g. a large card image),
  // kept inside the window. `anchor` is the hovered element's rectangle (getBoundingClientRect()).

  let {
    anchor,
    place = "above",
    children,
  }: { anchor: DOMRect; place?: "above" | "side"; children: Snippet } = $props();

  let el = $state<HTMLDivElement>();
  let pos = $state({ left: -9999, top: -9999 });

  const GAP = 8;

  $effect(() => {
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left: number;
    let top: number;
    if (place === "side") {
      left = anchor.right + GAP;
      if (left + w > vw - GAP) left = anchor.left - GAP - w; // no room on the right
      top = anchor.top + anchor.height / 2 - h / 2;
    } else {
      left = anchor.left + anchor.width / 2 - w / 2;
      top = anchor.top - GAP - h;
      if (top < GAP) top = anchor.bottom + GAP; // no room above
    }
    pos = {
      left: Math.max(GAP, Math.min(left, vw - w - GAP)),
      top: Math.max(GAP, Math.min(top, vh - h - GAP)),
    };
  });
</script>

<div
  class="hover-tip"
  class:side={place === "side"}
  bind:this={el}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  role="tooltip"
>
  {@render children()}
</div>

<style>
  .hover-tip {
    position: fixed;
    z-index: 50;
    pointer-events: none;
    max-width: min(320px, calc(100vw - 16px));
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    color: var(--text);
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.25);
    font-size: 0.85rem;
    line-height: 1.35;
  }
  .hover-tip.side {
    max-width: none;
    padding: 4px;
  }
</style>
