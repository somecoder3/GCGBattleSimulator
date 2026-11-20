<script lang="ts">
  // Small line icons for the game log, one per kind of event (drawn, so they look the same everywhere).

  let { event = "" }: { event?: string } = $props();

  const KIND: Record<string, string> = {
    draw: "draw",
    deploy: "deploy",
    token: "deploy",
    pair: "pair",
    play: "play",
    effect: "effect",
    modifier: "effect",
    look: "eye",
    reveal: "eye",
    attack: "attack",
    block: "block",
    damage: "hit",
    playerDamage: "hit",
    shieldBreak: "shield",
    destroyed: "destroy",
    removed: "destroy",
    toTrash: "trash",
    recover: "heal",
    burst: "burst",
    ready: "ready",
    toHand: "hand",
    toDeck: "deck",
    exResource: "resource",
    mulligan: "deck",
    gameStart: "flag",
    gameOver: "flag",
  };
  const kind = $derived(KIND[event] ?? "dot");
</script>

<span class="ico {kind}" aria-hidden="true">
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    stroke-width="1.6"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#if kind === "draw"}
      <rect x="4" y="2" width="8" height="11" rx="1.5" /><path d="M8 5v5M6 8l2 2 2-2" />
    {:else if kind === "deploy"}
      <path d="M8 3v10M3 8h10" />
    {:else if kind === "pair"}
      <path
        d="M6.5 9.5l3-3M5 7L3.6 8.4a2.5 2.5 0 003.5 3.5L8.5 10.5M11 9l1.4-1.4a2.5 2.5 0 00-3.5-3.5L7.5 5.5"
      />
    {:else if kind === "play"}
      <path d="M5 3l8 5-8 5z" />
    {:else if kind === "effect"}
      <path d="M9 2L4 9h4l-1 5 5-7H8z" />
    {:else if kind === "eye"}
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle
        cx="8"
        cy="8"
        r="1.8"
      />
    {:else if kind === "attack"}
      <path d="M3 13L11 5M9 3h4v4M3 10l3 3M2 14l2-2" />
    {:else if kind === "block"}
      <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" />
    {:else if kind === "hit"}
      <path d="M8 2l1.5 3.5L13 4l-1.8 3.4L14 9l-3.5.6L11 13l-3-2-3 2 .5-3.4L2 9l2.8-1.6L3 4l3.5 1.5z" />
    {:else if kind === "shield"}
      <path d="M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z" /><path d="M8 4.5L6.5 8 9 9l-1.5 3" />
    {:else if kind === "destroy"}
      <path d="M4 4l8 8M12 4l-8 8" />
    {:else if kind === "trash"}
      <path d="M3 5h10M6 5V3h4v2M4.5 5l.7 8h5.6l.7-8" />
    {:else if kind === "heal"}
      <path d="M8 13.5S2.5 10 2.5 6.3A2.8 2.8 0 018 4.5a2.8 2.8 0 015.5 1.8C13.5 10 8 13.5 8 13.5z" />
    {:else if kind === "burst"}
      <path d="M8 1.5l1.8 4.3 4.7.4-3.6 3 1.1 4.6L8 11.4l-4 2.4 1.1-4.6-3.6-3 4.7-.4z" />
    {:else if kind === "ready"}
      <path d="M13 8a5 5 0 11-1.5-3.5M13 2.5v3h-3" />
    {:else if kind === "hand"}
      <rect x="2.5" y="4" width="6" height="9" rx="1" /><rect x="7.5" y="3" width="6" height="9" rx="1" />
    {:else if kind === "deck"}
      <rect x="4" y="2" width="8" height="11" rx="1.5" /><path d="M8 10V5M6 7l2-2 2 2" />
    {:else if kind === "resource"}
      <path d="M8 2l5 3v6l-5 3-5-3V5z" />
    {:else if kind === "flag"}
      <path d="M4 14V2.5M4 3h8l-1.5 3L12 9H4" />
    {:else}
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    {/if}
  </svg>
</span>

<style>
  .ico {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    background: rgb(255 255 255 / 5%);
    color: var(--text-dim);
  }
  .attack,
  .hit {
    background: rgb(255 138 61 / 16%);
    color: #ffae70;
  }
  .shield,
  .destroy {
    background: rgb(255 93 108 / 16%);
    color: #ff8a95;
  }
  .block {
    background: rgb(127 224 160 / 14%);
    color: #8fe6ad;
  }
  .effect,
  .eye {
    background: rgb(166 107 255 / 16%);
    color: #c4a1ff;
  }
  .burst {
    background: rgb(255 209 102 / 18%);
    color: #ffd166;
  }
  .deploy,
  .play,
  .pair {
    background: rgb(79 195 255 / 14%);
    color: #8fd8ff;
  }
  .heal {
    background: rgb(127 224 160 / 14%);
    color: #8fe6ad;
  }
  .flag {
    background: rgb(255 209 102 / 18%);
    color: #ffd166;
  }
</style>
