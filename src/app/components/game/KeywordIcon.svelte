<script lang="ts" module>
  /** Keywords as the engine names them, plus "link" for the Link symbol. */
  export type KeywordKey =
    "blocker" | "firstStrike" | "highManeuver" | "suppression" | "breach" | "repair" | "support" | "link";

  export interface KeywordBadge {
    key: KeywordKey;
    /** Breach/Repair/Support amount, 0 otherwise. */
    amount: number;
    /** Not printed on the card (Pilot, Link, other cards' effects). */
    granted: boolean;
    /** Given by an effect with an end ("during this turn/battle"). */
    temporary: boolean;
  }

  export const KEYWORD_LABEL: Record<KeywordKey, string> = {
    blocker: "Blocker",
    firstStrike: "First Strike",
    highManeuver: "High-Maneuver",
    suppression: "Suppression",
    breach: "Breach",
    repair: "Repair",
    support: "Support",
    link: "Link",
  };

  // The symbols are files of their own (src/app/assets/keywords/<key>.svg), so docs/keyword-icons.html can show
  // the same files without the app. Each file carries its color as `color="#…"` on the root and draws with
  // currentColor; the chip's border takes the same color.
  const FILES = import.meta.glob<string>("../../assets/keywords/*.svg", {
    query: "?raw",
    import: "default",
    eager: true,
  });
  const ICONS = new Map(
    Object.entries(FILES).map(([path, svg]) => [
      path.replace(/^.*\/(\w+)\.svg$/, "$1"),
      { svg, color: /\scolor="([^"]+)"/.exec(svg)?.[1] ?? "#9fb3c8" },
    ]),
  );
</script>

<script lang="ts">
  // A small round symbol for a keyword (or Link) on a card; the amount (Breach 3 …) sits beside it.
  let { kw, amount = 0 }: { kw: KeywordKey; amount?: number } = $props();
  const icon = $derived(ICONS.get(kw));
</script>

<span class="kw" data-kw={kw} style:--c={icon?.color}>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own SVG files from src/app/assets -->
  <span class="glyph" aria-hidden="true">{@html icon?.svg ?? ""}</span>
  {#if amount > 0}<b>{amount}</b>{/if}
</span>

<style>
  .kw {
    --c: #9fb3c8;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    height: var(--kw-size, 18px);
    min-width: var(--kw-size, 18px);
    padding: 0 2px;
    border-radius: 999px;
    border: 1.5px solid var(--c);
    background: rgb(8 12 20 / 90%);
    color: var(--c);
    box-shadow: 0 1px 4px rgb(0 0 0 / 60%);
  }
  .glyph {
    display: inline-flex;
    line-height: 0;
  }
  .glyph :global(svg) {
    width: calc(var(--kw-size, 18px) - 6px);
    height: calc(var(--kw-size, 18px) - 6px);
  }
  b {
    padding-right: 2px;
    font-size: calc(var(--kw-size, 18px) * 0.62);
    line-height: 1;
    font-weight: 800;
    color: #fff;
  }
</style>
