<script lang="ts">
  import type { CardPool } from "../../../data/cards";
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
    { key: "user", label: "Eigene Decks" },
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
  {#each groups as g (g.key)}
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
      Aktuelle Meta-Decks (Konsenslisten der Turnierdecks) oder Starter-Decks gegen eine KI. Alle
      Entscheidungen lassen sich zurücknehmen; dieselben Karten kommen wieder.
    </p>
    <div class="grid">
      <label>
        Dein Deck
        <select bind:value={myDeck}>
          {@render deckOptions()}
        </select>
      </label>
      <label>
        Deck der KI
        <select bind:value={aiDeck}>
          {@render deckOptions()}
        </select>
      </label>
      <label>
        Schwierigkeit
        <select bind:value={aiName}>
          {#each DIFFICULTIES as d (d.ai)}<option value={d.ai}>{d.label} – {AI_LABELS[d.ai]}</option>{/each}
        </select>
      </label>
      <label>
        Wer beginnt
        <select bind:value={starter}>
          <option value="roll">Würfeln, Gewinner wählt</option>
          <option value="me">Du</option>
          <option value="ai">KI</option>
        </select>
      </label>
      <label>
        Seed
        <span class="seed">
          <input type="number" min="0" bind:value={seed} />
          <button type="button" onclick={() => (seed = randomSeed())} title="Neuer Seed">⟳</button>
        </span>
      </label>
    </div>
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
        <button class="btn primary" onclick={start}>Spiel starten</button>
        {#if saved}
          <button class="btn" onclick={resume}>
            Partie fortsetzen ({saved.deckNames?.join(" gegen ") ?? "gespeichert"}, {saved.actions.length} Entscheidungen)
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
    max-width: 720px;
    margin: 6vh auto;
    padding: 28px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--bg-raised);
  }
  h1 {
    margin: 0 0 6px;
    font-size: 24px;
  }
  .lead {
    margin: 0 0 20px;
    color: var(--text-dim);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 14px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 13px;
    color: var(--text-dim);
  }
  select,
  input {
    min-height: 38px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg-sunken);
    font-size: 15px;
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
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
    font-weight: 600;
  }
</style>
