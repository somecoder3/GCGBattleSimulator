<script lang="ts">
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import { AI_LABELS, DIFFICULTIES, type AiName } from "../../../ai/registry";
  import { Engine } from "../../../engine/engine";
  import { SNAPSHOT, cardLib, deckChoices, deckLabel, preset } from "../../lib/decks";
  import type { PlayerId } from "../../../engine/types";
  import { GameSession, type SavedSession } from "../../../sim/session";
  import { rollForStart, type StartRoll } from "../../../sim/start";
  import { aiWantsFirst } from "../../../ai/turnorder";
  import { parseSavedGame } from "../../lib/gameexport";
  import Board from "./Board.svelte";

  let { pool }: { pool: CardPool } = $props();

  const STORAGE_KEY = "gcg-battle-simulator.game";
  // svelte-ignore state_referenced_locally
  const engine = new Engine(cardLib(pool));
  // svelte-ignore state_referenced_locally
  const DECKS = deckChoices(pool);
  const groups = [
    { key: "meta", label: SNAPSHOT ? `Meta (Turniere bis ${SNAPSHOT.to})` : "Meta" },
    { key: "starter", label: "Starter-Decks" },
    { key: "test", label: "Testdecks" },
    { key: "user", label: "Eigene Decks" },
    { key: "lab", label: "Labor-Decks" },
  ] as const;

  let session = $state.raw<GameSession>();
  let saved = $state.raw<SavedSession | undefined>(load());

  // A deck chosen in the Meta or Decks tab ("play against the AI").
  let myDeck = $state(preset.play && DECKS.some((d) => d.id === preset.play) ? preset.play : DECKS[0]!.id);
  preset.play = null;
  let aiDeck = $state(DECKS[1]!.id);
  let starter = $state<"roll" | "me" | "ai">("roll");
  /** The die roll before the game, while the winner chooses who goes first. */
  let roll = $state.raw<StartRoll>();
  let aiName = $state<AiName>("search");
  // What the AI expects you to play: the meta by share, starter decks a little.
  const field = DECKS.map((d) => ({ deck: d.deck, weight: d.share ?? 0.01 }));
  let seed = $state(randomSeed());

  function randomSeed(): number {
    return Math.floor(Math.random() * 1_000_000_000);
  }

  function load(): SavedSession | undefined {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? (JSON.parse(raw) as SavedSession) : undefined;
      return data?.version === 1 ? data : undefined;
    } catch {
      return undefined;
    }
  }

  function save() {
    if (!session) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session.save()));
    } catch {
      // Storage may be unavailable (private window); the game still works without it.
    }
  }

  // The human plays in seat 0, the AI in seat 1.
  const HUMAN: PlayerId = 0;
  const AI: PlayerId = 1;

  function start() {
    if (starter === "roll") roll = rollForStart(seed >>> 0);
    else launch(starter === "me" ? HUMAN : AI);
  }

  /** The AI's choice after winning the roll (src/ai/turnorder.ts). */
  function aiChoice(): PlayerId {
    return aiWantsFirst(DECKS.find((d) => d.id === aiDeck)!.deck) ? AI : HUMAN;
  }

  function launch(firstPlayer: PlayerId) {
    const mine = DECKS.find((d) => d.id === myDeck)!;
    const theirs = DECKS.find((d) => d.id === aiDeck)!;
    session = new GameSession(engine, {
      decks: [mine.deck, theirs.deck],
      options: { seed: seed >>> 0, firstPlayer },
      human: HUMAN,
      ai: aiName,
      deckNames: [`${mine.id} ${mine.name}`, `${theirs.id} ${theirs.name}`],
      ...(roll ? { start: { ...roll, first: firstPlayer } } : {}),
    });
    roll = undefined;
  }

  const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  const LEVEL_TEXT: Partial<Record<AiName, string>> = {
    "heuristic-v0": "Spielt nach Regeln und Kartenwert, ohne vorauszudenken.",
    "heuristic-v1": "Probiert jede Möglichkeit und rechnet bis zum nächsten eigenen Zug.",
    search: "Simuliert viele mögliche Verläufe, sucht Auswege und Siegzüge.",
    "search-strong": "Wie Schwer, mit mehr Stichproben: stärker, denkt länger.",
  };

  const STARTERS = [
    { value: "roll", label: "Würfeln, Gewinner wählt" },
    { value: "me", label: "Du" },
    { value: "ai", label: "KI" },
  ] as const;

  /** The deck's face: its highest-level Unit (the most copies first). */
  function faceCard(main: readonly string[]) {
    // A local tally, not state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const counts = new Map<string, number>();
    for (const no of main) counts.set(no, (counts.get(no) ?? 0) + 1);
    let best: { card: NonNullable<ReturnType<CardPool["get"]>>; score: number } | undefined;
    for (const [no, n] of counts) {
      const card = pool.get(no);
      if (!card || card.type !== "UNIT") continue;
      const score = (card.level ?? 0) * 10 + n;
      if (!best || score > best.score) best = { card, score };
    }
    return best?.card;
  }

  const sides = $derived(
    [
      { who: "Du", side: "mine", deck: DECKS.find((d) => d.id === myDeck) },
      { who: "KI", side: "theirs", deck: DECKS.find((d) => d.id === aiDeck) },
    ].map((s) => ({ ...s, face: s.deck ? faceCard(s.deck.deck.main) : undefined })),
  );

  function resume() {
    if (!saved) return;
    try {
      session = GameSession.restore(engine, saved);
    } catch (e) {
      console.error("saved game could not be restored", e);
      saved = undefined;
    }
  }

  // A game saved with "Partie speichern" (JSON): continues where it was saved.
  let loadError = $state<string>();
  async function loadFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    loadError = undefined;
    try {
      session = GameSession.restore(engine, parseSavedGame(await file.text()));
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }

  function newGame() {
    saved = load();
    session = undefined;
    seed = randomSeed();
  }
</script>

{#snippet deckOptions()}
  {#each groups.filter((g) => DECKS.some((d) => d.group === g.key)) as g (g.key)}
    <optgroup label={g.label}>
      {#each DECKS.filter((d) => d.group === g.key) as d (d.id)}<option value={d.id}>{deckLabel(d)}</option
        >{/each}
    </optgroup>
  {/each}
{/snippet}

{#if session}
  <Board {engine} {pool} {session} opponentField={field} onsave={save} onnew={newGame} />
{:else}
  <section class="setup" aria-labelledby="setup-title">
    <h1 id="setup-title">Spiel gegen die KI</h1>
    <p class="lead">
      Meta-Decks (Konsenslisten der Turnierdecks), Starter- oder eigene Decks gegen eine KI. Alle
      Entscheidungen lassen sich zurücknehmen; dieselben Karten kommen wieder.
    </p>

    <div class="versus">
      {#each sides as v, i (v.side)}
        {#if i === 1}<span class="vs" aria-hidden="true">VS</span>{/if}
        <div class="deck-panel {v.side}">
          <div class="art">
            {#if v.face}<img src={cardImageUrl(v.face, "full")} alt="" />{/if}
            <span class="who">{v.who}</span>
          </div>
          <div class="deck-info">
            <strong
              >{v.deck
                ? v.deck.group === "user" || v.deck.group === "lab"
                  ? v.deck.name
                  : `${v.deck.id} ${v.deck.name}`
                : ""}</strong
            >
            <span class="colors">
              {#each (v.deck?.colors ?? "").split("/").filter(Boolean) as c (c)}
                <i class="dot" data-color={c.trim().toLowerCase()}></i>{c.trim()}
              {/each}
              {#if v.deck?.share !== undefined}<span>· {(v.deck.share * 100).toFixed(1)} % der Meta</span
                >{/if}
            </span>
            {#if v.side === "mine"}
              <select bind:value={myDeck} aria-label="Dein Deck">{@render deckOptions()}</select>
            {:else}
              <select bind:value={aiDeck} aria-label="Deck der KI">{@render deckOptions()}</select>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <h2>Schwierigkeit</h2>
    <div class="levels" role="radiogroup" aria-label="Schwierigkeit">
      {#each DIFFICULTIES as d (d.ai)}
        <button
          role="radio"
          aria-checked={aiName === d.ai}
          class:on={aiName === d.ai}
          onclick={() => (aiName = d.ai)}
          title={AI_LABELS[d.ai]}
        >
          <strong>{d.label}</strong>
          <small>{LEVEL_TEXT[d.ai] ?? AI_LABELS[d.ai]}</small>
        </button>
      {/each}
    </div>

    <h2>Wer beginnt</h2>
    <div class="seg" role="radiogroup" aria-label="Wer beginnt">
      {#each STARTERS as o (o.value)}
        <button
          role="radio"
          aria-checked={starter === o.value}
          class:on={starter === o.value}
          onclick={() => (starter = o.value)}>{o.label}</button
        >
      {/each}
    </div>

    <details class="advanced">
      <summary>Erweitert</summary>
      <label>
        Seed (gleicher Seed = gleiche Karten)
        <span class="seed">
          <input type="number" min="0" bind:value={seed} />
          <button type="button" onclick={() => (seed = randomSeed())} title="Neuer Seed">⟳</button>
        </span>
      </label>
    </details>

    {#if roll}
      {@const last = roll.rolls[roll.rolls.length - 1]!}
      <div class="roll" role="status">
        {#if roll.rolls.length > 1}
          <p class="ties">
            Gleichstand: {roll.rolls
              .slice(0, -1)
              .map((r) => r[0])
              .join(", ")} – noch einmal gewürfelt.
          </p>
        {/if}
        <div class="dice">
          <figure class:win={roll.winner === HUMAN}>
            <span class="die" aria-hidden="true">{FACES[last[HUMAN] - 1]}</span>
            <figcaption>Du: {last[HUMAN]}</figcaption>
          </figure>
          <figure class:win={roll.winner === AI}>
            <span class="die" aria-hidden="true">{FACES[last[AI] - 1]}</span>
            <figcaption>KI: {last[AI]}</figcaption>
          </figure>
        </div>
        {#if roll.winner === HUMAN}
          <p>Du hast gewonnen und wählst, wer beginnt.</p>
          <div class="actions">
            <button class="btn primary" onclick={() => launch(HUMAN)}>Ich beginne</button>
            <button class="btn" onclick={() => launch(AI)}>Die KI beginnt</button>
          </div>
        {:else}
          {@const first = aiChoice()}
          <p>
            Die KI hat gewonnen und wählt: <strong>{first === AI ? "Sie beginnt." : "Du beginnst."}</strong>
          </p>
          <div class="actions">
            <button class="btn primary" onclick={() => launch(first)}>Weiter</button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="actions">
        <button class="btn primary big" onclick={start}>Spiel starten</button>
        {#if saved}
          <button class="btn resume" onclick={resume}>
            <strong>Partie fortsetzen</strong>
            <small
              >{saved.deckNames?.join(" gegen ") ?? "gespeichert"} · {saved.actions.length} Entscheidungen</small
            >
          </button>
        {/if}
        <label class="btn file">
          Partie laden …
          <input type="file" accept=".json,application/json" onchange={loadFile} />
        </label>
      </div>
      {#if loadError}<p class="error" role="alert">{loadError}</p>{/if}
    {/if}
  </section>
{/if}

<style>
  .file {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
  }
  .file input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .error {
    color: var(--danger);
    font-size: 13px;
  }
  .setup {
    max-width: 880px;
    margin: 4vh auto;
    padding: 26px 28px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background:
      radial-gradient(ellipse 80% 40% at 50% 0%, rgb(79 195 255 / 8%), transparent), var(--bg-raised);
  }
  h1 {
    margin: 0 0 6px;
    font-size: 24px;
  }
  h2 {
    margin: 22px 0 8px;
    font-size: 12px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-dim);
  }
  .lead {
    margin: 0 0 18px;
    color: var(--text-dim);
  }
  .versus {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 14px;
  }
  .vs {
    font-size: 32px;
    font-weight: 900;
    font-style: italic;
    background: linear-gradient(180deg, #fff, #ffd166);
    background-clip: text;
    color: transparent;
    filter: drop-shadow(0 2px 10px rgb(255 209 102 / 40%));
  }
  .deck-panel {
    --tone: 79 195 255;
    overflow: hidden;
    border: 1px solid rgb(var(--tone) / 40%);
    border-radius: 14px;
    background: var(--bg-sunken);
    box-shadow: 0 0 30px rgb(var(--tone) / 8%);
  }
  .deck-panel.theirs {
    --tone: 255 93 108;
  }
  .art {
    position: relative;
    height: 150px;
    overflow: hidden;
    background: linear-gradient(160deg, rgb(var(--tone) / 25%), #0b1220);
  }
  .art img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 26%;
    mask-image: linear-gradient(180deg, #000 55%, transparent);
  }
  .who {
    position: absolute;
    left: 12px;
    bottom: 8px;
    padding: 2px 12px;
    border-radius: 999px;
    background: rgb(var(--tone));
    color: #05080e;
    font-weight: 800;
    letter-spacing: 0.06em;
  }
  .deck-info {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px 12px;
  }
  .deck-info strong {
    font-size: 15px;
    line-height: 1.25;
  }
  .colors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .dot {
    width: 9px;
    height: 9px;
    margin-left: 4px;
    border-radius: 50%;
    background: var(--line);
  }
  .dot[data-color="blue"] {
    background: var(--c-blue);
  }
  .dot[data-color="green"] {
    background: var(--c-green);
  }
  .dot[data-color="red"] {
    background: var(--c-red);
  }
  .dot[data-color="white"] {
    background: var(--c-white);
  }
  .dot[data-color="purple"] {
    background: var(--c-purple);
  }
  .levels {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 8px;
  }
  .levels button {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
    text-align: left;
  }
  .levels small {
    color: var(--text-dim);
    font-size: 12px;
    line-height: 1.35;
  }
  .levels button.on {
    border-color: var(--accent);
    background: rgb(79 195 255 / 10%);
    box-shadow: 0 0 0 1px rgb(79 195 255 / 30%);
  }
  .seg {
    display: inline-flex;
    flex-wrap: wrap;
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .seg button {
    padding: 8px 14px;
    border: 0;
    background: var(--bg-sunken);
    color: var(--text-dim);
  }
  .seg button.on {
    background: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
  .advanced {
    margin-top: 16px;
    font-size: 13px;
    color: var(--text-dim);
  }
  .advanced summary {
    cursor: pointer;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 340px;
    margin-top: 8px;
    font-size: 13px;
    color: var(--text-dim);
  }
  select,
  input {
    min-width: 0;
    min-height: 36px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-raised);
    font-size: 14px;
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input {
    flex: 1;
    min-width: 0;
  }
  .seed button {
    width: 40px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
  }
  .roll {
    margin-top: 22px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-sunken);
    text-align: center;
  }
  .roll p {
    margin: 10px 0 0;
  }
  .roll .ties {
    margin: 0 0 8px;
    color: var(--text-dim);
    font-size: 13px;
  }
  .roll .actions {
    justify-content: center;
  }
  .dice {
    display: flex;
    justify-content: center;
    gap: 40px;
  }
  .dice figure {
    margin: 0;
    opacity: 0.55;
    transition: opacity 0.3s 0.7s;
  }
  .dice figure.win {
    opacity: 1;
  }
  .die {
    display: block;
    font-size: 64px;
    line-height: 1;
    animation: tumble 0.7s ease-out;
  }
  .dice figure.win .die {
    color: var(--accent, currentColor);
  }
  figcaption {
    font-size: 13px;
    color: var(--text-dim);
  }
  @keyframes tumble {
    0% {
      transform: translateY(-24px) rotate(-200deg) scale(0.6);
      opacity: 0;
    }
    70% {
      transform: translateY(4px) rotate(10deg) scale(1.05);
      opacity: 1;
    }
    100% {
      transform: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .die {
      animation: none;
    }
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 22px;
  }
  .btn {
    min-height: 40px;
    padding: 8px 18px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg-sunken);
  }
  .btn.primary {
    border-color: #4fc3ff;
    background: linear-gradient(180deg, #2aa8ff, #1677d9);
    box-shadow: 0 4px 16px rgb(31 155 255 / 30%);
    color: #fff;
    font-weight: 700;
  }
  .btn.big {
    min-height: 48px;
    padding: 10px 28px;
    font-size: 16px;
  }
  .btn.resume {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }
  .btn.resume small {
    color: var(--text-dim);
    font-size: 12px;
  }
  .btn.file {
    flex-direction: row;
    max-width: none;
    margin-top: 0;
    color: var(--text);
    font-size: 14px;
  }
  @media (max-width: 640px) {
    .setup {
      margin: 8px;
      padding: 16px;
    }
    .versus {
      grid-template-columns: minmax(0, 1fr);
    }
    .vs {
      justify-self: center;
      font-size: 22px;
    }
    .art {
      height: 100px;
    }
  }
</style>
