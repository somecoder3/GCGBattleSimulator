<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import type { PlayerId } from "../../../engine/types";
  import type { Summary } from "../../lib/gamesummary";
  import CardImage from "../CardImage.svelte";

  // End screen: result, the turn and card that decided it, numbers, advantage and shields per turn, the
  // key moments; buttons to undo the last decision, start a new game and export.

  let {
    summary,
    human,
    pool,
    canUndo,
    replay = false,
    hash,
    exportNote,
    onundo,
    onnew,
    oncopy,
    onsave,
    onhide,
  }: {
    summary: Summary;
    human: PlayerId;
    pool: CardPool;
    canUndo: boolean;
    /** Watching a recorded game: only closing it. */
    replay?: boolean;
    /** Hash of a simulated game (searchable in the simulator). */
    hash?: string;
    exportNote?: string;
    onundo: () => void;
    onnew: () => void;
    oncopy: () => void;
    onsave: () => void;
    /** Hide the end screen to look at the final position. */
    onhide: () => void;
  } = $props();

  const ai = $derived((human === 0 ? 1 : 0) as PlayerId);
  const won = $derived(summary.winner === human);
  const draw = $derived(summary.winner === null);
  const title = $derived(draw ? "Unentschieden" : won ? "Sieg" : "Niederlage");
  const blow = $derived(summary.finalBlow ? pool.get(summary.finalBlow.no) : undefined);
  const mvp = $derived(summary.mvp ? pool.get(summary.mvp.no) : undefined);
  const headline = $derived(
    draw
      ? `Unentschieden nach ${summary.turns} Zügen.`
      : `${won ? "Gewonnen" : "Verloren"} in Zug ${summary.turns}${blow ? (won ? ` mit ${blow.name}` : ` gegen ${blow.name}`) : ""}.`,
  );
  const me = $derived(summary.sides[human]);
  const them = $derived(summary.sides[ai]);

  // Advantage chart: a bar per turn, up = the human leads (in shields' worth).
  const W = 520;
  const H = 150;
  const maxAdv = $derived(Math.max(3, ...summary.points.map((p) => Math.abs(p.advantage))));
  const step = $derived(W / Math.max(1, summary.points.length));
  const y = (v: number) => H / 2 - (v / maxAdv) * (H / 2 - 8);
  // Shields per turn: two lines.
  const SH = 90;
  const sy = (n: number) => SH - 6 - (n / 6) * (SH - 14);
  const line = (k: 0 | 1) =>
    summary.points.map((p, i) => `${i ? "L" : "M"} ${(i + 0.5) * step} ${sy(p.shields[k])}`).join(" ");
  let copied = $state(false);
  async function copyHash() {
    try {
      await navigator.clipboard.writeText(hash ?? "");
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      // the hash stays selectable
    }
  }
  const fmt = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1).replace(".", ",")}`;
</script>

<div class="overlay" transition:fade={{ duration: 250 }}>
  <div class="end" class:won class:draw in:fly={{ y: 30, duration: 400 }}>
    <header>
      <h2>{title}</h2>
      <p class="headline">{headline}</p>
      {#if hash}
        <p class="hash">
          Spiel-Hash <code>{hash}</code>
          <button class="copy" onclick={copyHash} title="Hash kopieren (im Simulator suchbar)"
            >{copied ? "✓" : "⧉"}</button
          >
        </p>
      {/if}
    </header>

    <div class="grid">
      <div class="left">
        <div class="tiles">
          <div><b>{summary.turns}</b><small>Züge</small></div>
          <div title="Zerstörte Schilde des Gegners">
            <b>{me.shields}<i>:</i>{them.shields}</b><small>Schilde zerstört</small>
          </div>
          <div title="Schaden an Units">
            <b>{me.toUnits}<i>:</i>{them.toUnits}</b><small>Schaden an Units</small>
          </div>
          <div title="Zerstörte gegnerische Units">
            <b>{me.destroyed}<i>:</i>{them.destroyed}</b><small>Units zerstört</small>
          </div>
          <div title="Eingesetzte Units und gespielte Commands/Bases">
            <b>{me.played}<i>:</i>{them.played}</b><small>Karten gespielt</small>
          </div>
        </div>
        <p class="legend"><span class="you">Du</span> : <span class="them">KI</span></p>

        {#if mvp || blow}
          <div class="cards">
            {#if mvp}
              <figure>
                <div class="img"><CardImage card={mvp} src={cardImageUrl(mvp, "small")} eager /></div>
                <figcaption>
                  <span class="tag">MVP</span>
                  <strong>{mvp.name}</strong>
                  <small
                    >{summary.mvp!.damage} Schaden{summary.mvp!.breaks
                      ? `, ${summary.mvp!.breaks} ${summary.mvp!.breaks === 1 ? "Schild" : "Schilde"}`
                      : ""}</small
                  >
                </figcaption>
              </figure>
            {/if}
            {#if blow}
              <figure>
                <div class="img"><CardImage card={blow} src={cardImageUrl(blow, "small")} eager /></div>
                <figcaption>
                  <span class="tag blow">Letzter Treffer</span>
                  <strong>{blow.name}</strong>
                  <small>{summary.finalBlow!.player === human ? "deine Karte" : "Karte der KI"}</small>
                </figcaption>
              </figure>
            {/if}
          </div>
        {/if}
      </div>

      <div class="right">
        <section>
          <h3>Vorteil <small>Bewertung der KI, in Schild-Werten</small></h3>
          <svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="Vorteil pro Zug">
            <line x1="0" x2={W} y1={H / 2} y2={H / 2} class="axis" />
            <text x="4" y="12" class="lbl">Du führst</text>
            <text x="4" y={H - 4} class="lbl">KI führt</text>
            {#each summary.points as p, i (i)}
              {@const top = Math.min(y(p.advantage), H / 2)}
              <rect
                x={i * step + step * 0.18}
                y={top}
                width={step * 0.64}
                height={Math.max(1.5, Math.abs(y(p.advantage) - H / 2))}
                rx="2"
                class:pos={p.advantage >= 0}
                class:neg={p.advantage < 0}
                style="--d: {i * 40}ms"
              >
                <title>Zug {p.turn} ({p.player === human ? "du" : "KI"}): {fmt(p.advantage)}</title>
              </rect>
              {#if summary.points.length <= 24}
                <text x={(i + 0.5) * step} y={H / 2 + (p.advantage >= 0 ? 11 : -4)} class="tn">{p.turn}</text>
              {/if}
            {/each}
          </svg>
        </section>
        <section>
          <h3>Schilde <small><span class="you">Du</span> · <span class="them">KI</span></small></h3>
          <svg viewBox="0 0 {W} {SH}" class="chart" role="img" aria-label="Schilde pro Zug">
            {#each [0, 3, 6] as n (n)}
              <line x1="0" x2={W} y1={sy(n)} y2={sy(n)} class="grid-line" />
              <text x="2" y={sy(n) - 2} class="lbl">{n}</text>
            {/each}
            <path d={line(human === 0 ? 0 : 1)} class="sl you" />
            <path d={line(human === 0 ? 1 : 0)} class="sl them" />
          </svg>
        </section>
        {#if summary.moments.length}
          <section>
            <h3>Schlüsselmomente</h3>
            <ol class="moments">
              {#each summary.moments.slice(-6) as m, i (i)}
                <li class:mine={m.player === human}><span class="t">Z{m.turn}</span>{m.text}</li>
              {/each}
            </ol>
          </section>
        {/if}
      </div>
    </div>

    <div class="actions">
      <button class="btn" onclick={onhide}>Spielfeld ansehen</button>
      {#if replay}
        <button class="btn" onclick={oncopy}>Verlauf kopieren</button>
        <button class="btn" onclick={onsave} title="Decks mit Karten, alle Entscheidungen, Ergebnis, Verlauf"
          >Match exportieren (.json)</button
        >
        <button class="btn primary" onclick={onnew}>Replay schließen</button>
      {:else}
        {#if canUndo}<button class="btn" onclick={onundo}>↶ Letzte Entscheidung zurück</button>{/if}
        <button class="btn" onclick={oncopy}>Verlauf kopieren</button>
        <button class="btn" onclick={onsave}>Partie speichern (.json)</button>
        <button class="btn primary" onclick={onnew}>Neues Spiel</button>
      {/if}
    </div>
    {#if exportNote}<p class="note" role="status">{exportNote}</p>{/if}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    padding: 16px;
    overflow: auto;
    background: radial-gradient(ellipse at 50% 30%, rgb(10 16 28 / 80%), rgb(3 5 10 / 94%));
    backdrop-filter: blur(4px);
  }
  .end {
    --res: 255 93 108;
    width: min(980px, 100%);
    padding: 22px 26px;
    border: 1px solid rgb(var(--res) / 40%);
    border-radius: 18px;
    background: linear-gradient(180deg, rgb(var(--res) / 10%), transparent 140px), var(--bg-raised);
    box-shadow:
      var(--shadow),
      0 0 60px rgb(var(--res) / 15%);
  }
  .end.won {
    --res: 79 195 255;
  }
  .end.draw {
    --res: 255 209 102;
  }
  header {
    text-align: center;
  }
  h2 {
    margin: 0;
    font-size: clamp(34px, 6vw, 58px);
    font-weight: 900;
    font-style: italic;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: linear-gradient(180deg, #fff 20%, rgb(var(--res)));
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 4px 18px rgb(var(--res) / 45%));
    animation: slam 0.6s cubic-bezier(0.2, 1.4, 0.4, 1) both;
  }
  @keyframes slam {
    from {
      opacity: 0;
      transform: scale(1.6);
    }
  }
  .hash {
    margin: -8px 0 12px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .hash code {
    padding: 1px 6px;
    border-radius: 4px;
    background: rgb(255 255 255 / 8%);
    color: var(--text);
    user-select: all;
  }
  .hash .copy {
    margin-left: 4px;
    padding: 0 6px;
    border: 1px solid var(--line);
    border-radius: 4px;
    background: none;
    color: var(--text-dim);
  }
  .headline {
    margin: 4px 0 14px;
    color: var(--text-dim);
    font-size: 15px;
  }
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
    gap: 18px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 8px;
  }
  .tiles div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 6px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
    text-align: center;
  }
  .tiles b {
    font-size: 22px;
    font-variant-numeric: tabular-nums;
  }
  .tiles b i {
    margin: 0 3px;
    color: var(--text-dim);
    font-style: normal;
  }
  .tiles small {
    color: var(--text-dim);
    font-size: 11px;
  }
  .legend {
    margin: 6px 0 10px;
    font-size: 12px;
    color: var(--text-dim);
    text-align: center;
  }
  .you {
    color: #8fd8ff;
    font-weight: 600;
  }
  .them {
    color: #ff9aa3;
    font-weight: 600;
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  figure {
    display: flex;
    gap: 10px;
    align-items: center;
    margin: 0;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
  }
  .img {
    flex: none;
    width: 70px;
  }
  figcaption {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    font-size: 13px;
  }
  figcaption small {
    color: var(--text-dim);
  }
  .tag {
    align-self: flex-start;
    padding: 1px 7px;
    border-radius: 999px;
    background: #ffd166;
    color: #1a1200;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tag.blow {
    background: #ff8a3d;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  h3 small {
    margin-left: 6px;
    letter-spacing: 0;
    text-transform: none;
    font-weight: 400;
  }
  section + section {
    margin-top: 10px;
  }
  .chart {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .axis {
    stroke: var(--line);
  }
  .grid-line {
    stroke: rgb(255 255 255 / 6%);
  }
  .lbl {
    fill: var(--text-dim);
    font-size: 10px;
  }
  .tn {
    fill: var(--text-dim);
    font-size: 9px;
    text-anchor: middle;
  }
  rect {
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: grow 0.5s ease-out backwards;
    animation-delay: var(--d);
  }
  rect.neg {
    transform-origin: 50% 0;
    fill: #ff5d6c;
  }
  rect.pos {
    fill: #4fc3ff;
  }
  @keyframes grow {
    from {
      transform: scaleY(0);
    }
  }
  .sl {
    fill: none;
    stroke-width: 2.5;
    stroke-linejoin: round;
  }
  .sl.you {
    stroke: #4fc3ff;
  }
  .sl.them {
    stroke: #ff5d6c;
  }
  .moments {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 13px;
  }
  .moments li {
    display: flex;
    gap: 8px;
    padding: 3px 0;
    color: #ffb3bb;
  }
  .moments li.mine {
    color: #a9e2ff;
  }
  .t {
    flex: none;
    min-width: 30px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
  }
  .btn {
    min-height: 38px;
    padding: 6px 16px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .btn:hover {
    border-color: var(--accent);
  }
  .btn.primary {
    border-color: #4fc3ff;
    background: linear-gradient(180deg, #2aa8ff, #1677d9);
    color: #fff;
    font-weight: 700;
  }
  .note {
    margin: 8px 0 0;
    text-align: center;
    font-size: 13px;
    color: var(--text-dim);
  }
  @media (max-width: 760px) {
    .end {
      padding: 16px 12px;
    }
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
