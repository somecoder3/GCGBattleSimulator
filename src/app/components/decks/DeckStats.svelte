<script lang="ts">
  import type { CardDef } from "../../../data/types";
  import type { Selection } from "../../lib/cardfilter";
  import { deckStats, handOdds, type DeckEntry, type Histogram, type Tally } from "../../lib/deckstats";
  import SampleHand from "./SampleHand.svelte";

  // Deck statistics like ExBurst's (curves, Unit values, composition, tags, opening hand odds) plus link
  // pairs. With `onpick` (deck builder), a click on a column or tag filters the card search, again undoes it;
  // without (meta view) the statistics are only shown.

  let {
    entries,
    links,
    selection = {},
    onpick,
    ondetail,
  }: {
    entries: readonly DeckEntry[];
    links: (unit: CardDef, pilot: CardDef) => boolean;
    /** The card search's current selection (to mark the picked column or tag). */
    selection?: Selection;
    onpick?: (pick: Selection) => void;
    ondetail: (card: CardDef) => void;
  } = $props();

  const stats = $derived(deckStats(entries, links));
  let second = $state(false);
  const odds = $derived(handOdds(entries, second));
  let sample = $state(false);

  /** Rounded percent; never "100 %" or "0 %" for what is only almost sure or almost impossible. */
  const pct = (x: number) =>
    x > 0.995 && x < 1 ? "> 99 %" : x > 0 && x < 0.005 ? "< 1 %" : `${Math.round(x * 100)} %`;
  const avg = (x: number | null) => (x === null ? "–" : x.toFixed(2).replace(".", ","));
  const same = (a: readonly string[] | undefined, b: readonly string[]) =>
    !!a && a.length === b.length && a.every((v, i) => v === b[i]);
  /** Is `pick` the current selection for its keys? */
  const picked = (pick: Selection) =>
    Object.entries(pick).every(([k, v]) => same(selection[k as keyof Selection], v ?? []));

  const COLOR_VAR: Record<string, string> = {
    Blue: "var(--c-blue)",
    Green: "var(--c-green)",
    Red: "var(--c-red)",
    White: "var(--c-white)",
    Purple: "var(--c-purple)",
  };
  const COLOR_NAMES: Record<string, string> = {
    Blue: "Blau",
    Green: "Grün",
    Red: "Rot",
    White: "Weiß",
    Purple: "Lila",
  };
  const TYPE_NAMES: Record<string, string> = {
    UNIT: "Units",
    PILOT: "Piloten",
    COMMAND: "Commands",
    BASE: "Bases",
  };
  const linkedUnits = $derived(
    stats.linkPairs.filter((p) => p.pilots.length).reduce((s, p) => s + p.unit.n, 0),
  );
  const linkUnits = $derived(stats.linkPairs.reduce((s, p) => s + p.unit.n, 0));
</script>

{#snippet chart(title: string, h: Histogram, units: boolean)}
  {@const peak = Math.max(1, ...h.buckets.map((b) => b.count))}
  <section class="chart">
    <h4>{title} <small>Ø {avg(h.mean)}</small></h4>
    <ol style="--columns: {h.buckets.length}">
      {#each h.buckets as b (b.label)}
        {@const pick = units ? { type: ["UNIT"], [h.key]: b.values } : { [h.key]: b.values }}
        <li>
          <button
            class:peak={b.count === peak && b.count > 0}
            class:on={picked(pick)}
            title="{title} {b.label}: {b.count} Karten{onpick ? ' – anklicken filtert die Suche' : ''}"
            aria-label="{title} {b.label}: {b.count} Karten"
            disabled={!b.count || !onpick}
            onclick={() => onpick?.(pick)}
          >
            <span class="value">{b.count || ""}</span>
            <span class="well"><span class="bar" style="--share: {b.count / peak}"></span></span>
            <span class="label">{b.label}</span>
          </button>
        </li>
      {/each}
    </ol>
  </section>
{/snippet}

{#snippet tags(title: string, key: "trait" | "link" | "keywords", list: Tally[])}
  {#if list.length}
    <h4>{title}</h4>
    <div class="tags">
      {#each list as t (t.value)}
        <button
          class:on={picked({ [key]: [t.value] })}
          disabled={!onpick}
          onclick={() => onpick?.({ [key]: [t.value] })}
        >
          {t.value} <b>{t.count}</b>
        </button>
      {/each}
    </div>
  {/if}
{/snippet}

<div class="stats">
  <div class="summary">
    <div><b>{stats.total}</b><small>Karten</small></div>
    <div><b>{avg(stats.curve.cost.mean)}</b><small>Ø Kosten</small></div>
    <div><b>{avg(stats.curve.level.mean)}</b><small>Ø Level</small></div>
    <div title="Unit-Kopien mit Link-Bedingung, für die das Deck einen passenden Piloten hat">
      <b>{linkedUnits}/{linkUnits}</b><small>Link-Units mit Pilot</small>
    </div>
  </div>

  <h3>Kurve</h3>
  <div class="charts">
    {@render chart("Kosten", stats.curve.cost, false)}
    {@render chart("Level", stats.curve.level, false)}
  </div>

  <h3>Units <small>{stats.units.count}</small></h3>
  <div class="charts">
    {@render chart("HP", stats.units.hp, true)}
    {@render chart("AP", stats.units.ap, true)}
    {@render chart("Kosten", stats.units.cost, true)}
    {@render chart("Level", stats.units.level, true)}
  </div>

  <h3>Zusammensetzung</h3>
  <div class="bars">
    <div>
      <h4>Farbe</h4>
      {#each stats.colors as c (c.value)}
        <button
          class="row"
          class:on={picked({ colors: [c.value] })}
          disabled={!onpick}
          onclick={() => onpick?.({ colors: [c.value] })}
        >
          <span>{COLOR_NAMES[c.value] ?? c.value}</span>
          <span class="track"
            ><span class="fill" style="--share: {c.count / stats.total}; --fill: {COLOR_VAR[c.value]}"
            ></span></span
          >
          <b>{c.count}</b>
        </button>
      {/each}
    </div>
    <div>
      <h4>Kartentypen</h4>
      {#each stats.types as t (t.value)}
        <button
          class="row"
          class:on={picked({ type: [t.value] })}
          disabled={!onpick}
          onclick={() => onpick?.({ type: [t.value] })}
        >
          <span>{TYPE_NAMES[t.value] ?? t.value}</span>
          <span class="track"><span class="fill" style="--share: {t.count / stats.total}"></span></span>
          <b>{t.count}</b>
        </button>
      {/each}
    </div>
  </div>

  <h3>Tags</h3>
  {@render tags("Traits", "trait", stats.traits)}
  {@render tags("Link-Bedingungen", "link", stats.links)}
  {@render tags("Keywords", "keywords", stats.keywords)}

  {#if stats.linkPairs.length || stats.lonelyPilots.length}
    <h3>Links</h3>
    <ul class="pairs">
      {#each stats.linkPairs as p (p.unit.card.no)}
        <li class:missing={!p.pilots.length}>
          <button class="name" onclick={() => ondetail(p.unit.card)}>{p.unit.n}× {p.unit.card.name}</button>
          <span class="arrow">←</span>
          {#if p.pilots.length}
            {#each p.pilots as pilot, i (pilot.card.no)}
              {#if i}<span class="sep">,&nbsp;</span>{/if}<button
                class="name"
                onclick={() => ondetail(pilot.card)}>{pilot.n}× {pilot.card.name}</button
              >
            {/each}
          {:else}
            <span
              >kein passender Pilot im Deck ({p.unit.card.link
                .map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`))
                .join(" oder ")})</span
            >
          {/if}
        </li>
      {/each}
      {#each stats.lonelyPilots as p (p.card.no)}
        <li class="missing">
          <button class="name" onclick={() => ondetail(p.card)}>{p.n}× {p.card.name}</button>
          <span>linkt keine Unit des Decks</span>
        </li>
      {/each}
    </ul>
  {/if}

  <h3>Starthand</h3>
  <div class="seg" role="radiogroup" aria-label="Startspieler oder Nachziehender">
    <button role="radio" aria-checked={!second} class:on={!second} onclick={() => (second = false)}
      >Startspieler</button
    >
    <button role="radio" aria-checked={second} class:on={second} onclick={() => (second = true)}
      >Als Zweiter (EX Resource)</button
    >
  </div>
  {#if stats.total >= 15}
    <table class="odds">
      <thead>
        <tr><th></th><th>Unit spielbar</th><th>irgendeine Karte</th></tr>
      </thead>
      <tbody>
        {#each odds as o (o.turn)}
          <tr>
            <th>Zug {o.turn}<small>Lv./Kosten ≤ {o.level}</small></th>
            {#each [o.unit, o.any] as x, i (i)}
              <td>
                <span class="track"><span class="fill" style="--share: {x.keep}"></span></span>
                <b>{pct(x.keep)}</b>
                <small>{pct(x.redraw)} mit Mulligan</small>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="hint">
      Genau gerechnet: 5 Karten Starthand, eine Karte pro Zug (auch im ersten), als Zweiter ein Level mehr
      durch die EX Resource. „Mit Mulligan“: neue Hand, wenn die erste keine passende Karte hat (Hand unter
      das Deck, 5 ziehen, mischen).
    </p>
  {:else}
    <p class="hint">Ab 15 Karten.</p>
  {/if}
  <button class="btn" onclick={() => (sample = true)} disabled={stats.total < 11}>Probehand ziehen</button>
</div>

{#if sample}
  <SampleHand {entries} onclose={() => (sample = false)} />
{/if}

<style>
  .stats {
    font-size: 13px;
  }
  h3 {
    margin: 16px 0 8px;
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  h3 small {
    font-weight: 400;
  }
  h4 {
    margin: 0 0 6px;
    font-size: 13px;
    font-weight: 600;
  }
  h4 small {
    color: var(--text-dim);
    font-weight: 400;
  }
  .summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
  }
  .summary div {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
    text-align: center;
  }
  .summary b {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }
  .summary small {
    color: var(--text-dim);
    font-size: 11px;
  }
  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(var(--chart-min, 132px), 100%), 1fr));
    gap: 8px;
  }
  .chart {
    padding: 8px 8px 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .chart ol {
    display: grid;
    grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .chart button {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: none;
    color: inherit;
  }
  .chart button:disabled {
    cursor: default;
  }
  .chart button:not(:disabled):hover,
  .chart button.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .value {
    height: 14px;
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .well {
    width: 70%;
    height: 48px;
    display: flex;
    align-items: flex-end;
  }
  .bar {
    width: 100%;
    height: calc(var(--share) * 100%);
    min-height: 0;
    border-radius: 3px 3px 0 0;
    background: color-mix(in srgb, var(--accent) 45%, var(--line));
  }
  .peak .bar,
  .on .bar {
    background: var(--accent);
  }
  .label {
    color: var(--text-dim);
    font-size: 11px;
  }
  .bars {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 8px;
  }
  .bars > div {
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 70px minmax(0, 1fr) 24px;
    align-items: center;
    gap: 8px;
    padding: 2px 4px;
    border: 0;
    border-radius: 4px;
    background: none;
    color: inherit;
    text-align: left;
  }
  .row:not(:disabled):hover,
  .row.on {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .row b {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .track {
    height: 8px;
    border-radius: 4px;
    background: var(--bg-raised);
    overflow: hidden;
  }
  .fill {
    display: block;
    width: calc(var(--share) * 100%);
    height: 100%;
    border-radius: 4px;
    background: var(--fill, var(--accent));
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 10px;
  }
  .tags button {
    padding: 3px 9px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg-sunken);
    color: inherit;
    font-size: 12px;
  }
  .tags button:not(:disabled):hover,
  .tags button.on {
    border-color: var(--accent);
  }
  .row:disabled,
  .tags button:disabled,
  .chart button:disabled {
    opacity: 1;
    cursor: default;
  }
  .tags b {
    color: var(--accent);
    font-weight: 600;
  }
  .pairs {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .pairs li {
    padding: 3px 0;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
  }
  .pairs li.missing {
    color: #ffd166;
  }
  .pairs .name {
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
  }
  .pairs .name:hover {
    text-decoration: underline;
  }
  .arrow {
    color: var(--text-dim);
    margin: 0 4px;
  }
  .seg {
    display: inline-flex;
    margin-bottom: 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    overflow: hidden;
  }
  .seg button {
    padding: 4px 12px;
    border: 0;
    background: var(--bg-sunken);
    color: var(--text-dim);
    font-size: 12px;
  }
  .seg button.on {
    background: var(--accent-strong);
    color: #fff;
  }
  .odds {
    width: 100%;
    border-collapse: collapse;
  }
  .odds th,
  .odds td {
    padding: 5px 4px;
    border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent);
    text-align: left;
    vertical-align: top;
  }
  .odds thead th {
    color: var(--text-dim);
    font-weight: 400;
    font-size: 12px;
  }
  .odds tbody th {
    font-weight: 600;
    white-space: nowrap;
  }
  .odds small {
    display: block;
    color: var(--text-dim);
    font-size: 11px;
    font-weight: 400;
  }
  .odds .track {
    display: block;
    margin-bottom: 3px;
  }
  .odds b {
    font-variant-numeric: tabular-nums;
  }
  .hint {
    margin: 8px 0;
    color: var(--text-dim);
    font-size: 12px;
  }
  .btn {
    min-height: 34px;
    padding: 6px 14px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
