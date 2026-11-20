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
</script>

<script lang="ts">
  // A small round symbol for a keyword (or Link) on a card; the amount (Breach 3 …) sits beside it.
  let { kw, amount = 0 }: { kw: KeywordKey; amount?: number } = $props();
</script>

<span class="kw" data-kw={kw}>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {#if kw === "blocker"}
      <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />
    {:else if kw === "firstStrike"}
      <path class="fill" d="M13.5 2 5 13.5h6L10 22l9-12h-6.2z" />
    {:else if kw === "highManeuver"}
      <path d="M4 18l6-6-6-6M12 18l6-6-6-6" />
    {:else if kw === "suppression"}
      <path d="M20 6.5l-9 5.5M20 17.5l-9-5.5M11 12H9" /><circle class="fill" cx="6" cy="12" r="3" />
    {:else if kw === "breach"}
      <path d="M4 20 18 6M13 6h5v5" /><path class="wall" d="M10 2v7M10 18v4" />
    {:else if kw === "repair"}
      <path d="M12 5v14M5 12h14" />
    {:else if kw === "support"}
      <path d="M12 20V7M6.5 12.5 12 7l5.5 5.5M7 4h10" />
    {:else}
      <path
        d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"
      />
    {/if}
  </svg>
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
  svg {
    width: calc(var(--kw-size, 18px) - 6px);
    height: calc(var(--kw-size, 18px) - 6px);
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .fill {
    fill: currentColor;
    stroke: none;
  }
  .wall {
    stroke-width: 2;
    opacity: 0.6;
  }
  b {
    padding-right: 2px;
    font-size: calc(var(--kw-size, 18px) * 0.62);
    line-height: 1;
    font-weight: 800;
    color: #fff;
  }
  [data-kw="blocker"] {
    --c: #5fb4ff;
  }
  [data-kw="firstStrike"] {
    --c: #ffd166;
  }
  [data-kw="highManeuver"] {
    --c: #5ee6d0;
  }
  [data-kw="suppression"] {
    --c: #c79bff;
  }
  [data-kw="breach"] {
    --c: #ff6b7d;
  }
  [data-kw="repair"] {
    --c: #7fe0a0;
  }
  [data-kw="support"] {
    --c: #ffb36b;
  }
  [data-kw="link"] {
    --c: #ffd166;
  }
</style>
