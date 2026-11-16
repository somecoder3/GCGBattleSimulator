<script lang="ts">
  import { cardImageUrl } from "../../../data/cards";
  import type { CardDef } from "../../../data/types";
  import CardImage from "../CardImage.svelte";

  // A card on the board: image (or card back if hidden), rested rotation, current AP/HP and markers.
  let {
    card,
    rested = false,
    stats = null,
    pilot = null,
    state = "",
    flash = false,
    label = "",
    onclick,
    onhover,
  }: {
    card: CardDef | undefined;
    rested?: boolean;
    /** Current values and the values without effects, for Units and Bases in play. */
    stats?: {
      ap: number;
      hp: number;
      damage: number;
      baseAp: number;
      baseHp: number;
      showAp: boolean;
    } | null;
    /** Paired Pilot, shown offset under the Unit so its AP/HP bonus stays visible. */
    pilot?: { card: CardDef | undefined; link: boolean; onhover?: (on: boolean) => void } | null;
    /** "legal" (can be used), "selected", "target" (completes the selected option) or "". */
    state?: "" | "legal" | "selected" | "target";
    flash?: boolean;
    label?: string;
    onclick?: () => void;
    onhover?: (on: boolean) => void;
  } = $props();

  const hpLeft = $derived(stats ? stats.hp - stats.damage : 0);
  const trend = (now: number, base: number) => (now > base ? "up" : now < base ? "down" : "");
</script>

<button
  type="button"
  class="slot {state}"
  class:rested
  class:paired={!!pilot}
  class:flash
  class:clickable={!!onclick}
  aria-label={label || card?.name || "Verdeckte Karte"}
  onclick={() => onclick?.()}
  onpointerenter={() => onhover?.(true)}
  onpointerleave={() => onhover?.(false)}
  onfocus={() => onhover?.(true)}
  onblur={() => onhover?.(false)}
>
  <div class="stack">
    {#if pilot}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="pilot-card"
        onpointerenter={() => pilot.onhover?.(true)}
        onpointerleave={() => pilot.onhover?.(false)}
      >
        {#if pilot.card}<CardImage card={pilot.card} src={cardImageUrl(pilot.card, "small")} eager />{/if}
      </div>
    {/if}
    <div class="card">
      {#if pilot?.link}<span class="link-badge">LINK</span>{/if}
      {#if card}
        <CardImage {card} src={cardImageUrl(card, "small")} eager />
      {:else}
        <div class="back" aria-hidden="true"><span></span></div>
      {/if}
      {#if stats}
        <div class="stats">
          {#if stats.showAp}<span class="ap {trend(stats.ap, stats.baseAp)}">{stats.ap}</span>{/if}
          <span class="hp {stats.damage ? 'hurt' : trend(stats.hp, stats.baseHp)}">{hpLeft}</span>
        </div>
      {/if}
    </div>
  </div>
</button>

<style>
  .slot {
    position: relative;
    display: block;
    width: var(--cw, 84px);
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
    touch-action: manipulation;
  }
  .slot.clickable {
    cursor: pointer;
  }
  .slot.paired {
    padding-bottom: calc(var(--cw, 84px) * 1.395 * 0.28);
  }
  .stack {
    position: relative;
    transition: transform 0.25s cubic-bezier(0.3, 0.7, 0.4, 1);
  }
  .card {
    position: relative;
    z-index: 1;
    border-radius: var(--radius-card);
    transition: box-shadow 0.2s;
    box-shadow: 0 2px 8px rgb(0 0 0 / 50%);
  }
  /* The Pilot lies under the Unit, shifted down so its bottom edge with AP+/HP+ shows. */
  .pilot-card {
    position: absolute;
    inset: 0;
    transform: translateY(28%);
    border-radius: var(--radius-card);
    box-shadow: 0 2px 8px rgb(0 0 0 / 50%);
  }
  .pilot-card:hover {
    filter: brightness(1.15);
  }
  .rested .stack {
    transform: rotate(90deg) scale(0.92);
  }
  .rested .card :global(img) {
    filter: brightness(0.78);
  }
  .legal .card {
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 14px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .clickable.legal:hover .stack {
    transform: translateY(-4px);
  }
  .clickable.legal.rested:hover .stack {
    transform: rotate(90deg) scale(0.92) translateX(-4px);
  }
  .selected .card {
    box-shadow:
      0 0 0 3px #ffd166,
      0 0 20px rgb(255 209 102 / 60%);
  }
  .target .card {
    box-shadow:
      0 0 0 3px var(--danger),
      0 0 18px color-mix(in srgb, var(--danger) 60%, transparent);
    animation: pulse 1s ease-in-out infinite;
  }
  .flash .card {
    animation: flash 0.9s ease-out;
  }
  @keyframes pulse {
    50% {
      box-shadow:
        0 0 0 3px var(--danger),
        0 0 4px transparent;
    }
  }
  @keyframes flash {
    0% {
      box-shadow:
        0 0 0 3px #fff,
        0 0 30px #fff;
    }
  }
  .back {
    aspect-ratio: 600 / 837;
    border-radius: var(--radius-card);
    border: 1px solid #2f4466;
    background:
      repeating-linear-gradient(45deg, transparent 0 6px, rgb(79 195 255 / 6%) 6px 7px),
      linear-gradient(160deg, #1a2a44, #0b1220);
    display: grid;
    place-items: center;
  }
  .back span {
    width: 38%;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid rgb(79 195 255 / 35%);
    box-shadow: inset 0 0 12px rgb(79 195 255 / 25%);
  }
  .stats {
    position: absolute;
    right: 3px;
    bottom: 3px;
    display: flex;
    gap: 2px;
    font-size: 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stats span {
    min-width: 20px;
    padding: 0 4px;
    border-radius: 4px;
    text-align: center;
    background: rgb(8 12 20 / 88%);
    border: 1px solid var(--line);
  }
  .ap {
    color: #ffb36b;
  }
  .hp {
    color: #7fe0a0;
  }
  .stats .up {
    color: #fff;
    background: #1f7a45;
  }
  .stats .down,
  .stats .hurt {
    color: #fff;
    background: #a3283a;
  }
  .link-badge {
    position: absolute;
    z-index: 2;
    top: 3px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0 6px;
    border-radius: 4px;
    background: rgb(8 12 20 / 88%);
    border: 1px solid #8a6d2b;
    color: #ffd166;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
  }
</style>
