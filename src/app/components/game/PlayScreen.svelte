<script lang="ts">
  import { cardSrc } from "../../lib/cardimages";
  import { cardImageUrl, type CardPool } from "../../../data/cards";
  import { AI_LABELS, DIFFICULTIES, type AiName } from "../../../ai/registry";
  import { Engine } from "../../../engine/engine";
  import { onMount } from "svelte";
  import { SNAPSHOT, cardLib, deckChoices, deckTitle, preset, type DeckChoice } from "../../lib/decks";
  import { faceCard, groupDecks, groupOf, playable, randomDeck } from "../../lib/deckgroups";
  import { onSync } from "../../lib/sync";
  import DeckPicker from "../DeckPicker.svelte";
  import type { PlayerId } from "../../../engine/types";
  import { GameSession, type SavedSession } from "../../../sim/session";
  import { rollForStart, type StartRoll } from "../../../sim/start";
  import { aiWantsFirst } from "../../../ai/turnorder";
  import { parseSavedGame } from "../../lib/gameexport";
  import Board from "./Board.svelte";

  let { pool }: { pool: CardPool } = $props();

  const STORAGE_KEY = "gcg-battle-simulator.game";
  const DECK_KEY = "gcg-battle-simulator.play-deck";
  // svelte-ignore state_referenced_locally
  const lib = cardLib(pool);
  const engine = new Engine(lib);
  // svelte-ignore state_referenced_locally
  let DECKS = $state.raw<DeckChoice[]>(deckChoices(pool));
  const META_LABEL = SNAPSHOT ? `Meta (Turniere bis ${SNAPSHOT.to})` : "Meta";
  const groups = $derived(groupDecks(DECKS, META_LABEL));
  const find = (id: string) => DECKS.find((d) => d.id === id);
  const canPlay = (d: DeckChoice) => playable(lib, d);
  /** Why a deck cannot be played (picker). */
  function unavailable(d: DeckChoice): string | undefined {
    if (canPlay(d)) return undefined;
    if (!d.supported) return "Effekte nicht vollständig";
    return `${d.deck.main.length} von 50 Karten`;
  }

  let session = $state.raw<GameSession>();
  let saved = $state.raw<SavedSession | undefined>(load());

  // A deck chosen in the Meta or Decks tab ("play against the AI"), else the last one played, else the
  // first own deck, else the first playable one.
  let myDeck = $state(firstDeck());
  preset.play = null;
  /** The AI's deck: random (a group, then a deck in it) until chosen. */
  // svelte-ignore state_referenced_locally
  let aiDeck = $state(randomDeck(groupDecks(DECKS), canPlay)?.id ?? DECKS[0]!.id);
  /** The open deck picker. */
  let picking = $state<"mine" | "theirs" | null>(null);
  /** Counts new random decks (the dice on the AI's panel turn). */
  let rolled = $state(0);

  function firstDeck(): string {
    if (preset.play && find(preset.play)) return preset.play;
    let last: string | null = null;
    try {
      last = localStorage.getItem(DECK_KEY);
    } catch {
      // Storage may be unavailable (private window).
    }
    const usable = DECKS.filter(canPlay);
    const d =
      (last ? usable.find((x) => x.id === last) : undefined) ??
      usable.find((x) => x.group === "user") ??
      usable[0] ??
      DECKS[0]!;
    return d.id;
  }

  function chooseMine(d: DeckChoice) {
    myDeck = d.id;
    try {
      localStorage.setItem(DECK_KEY, d.id);
    } catch {
      // Not remembered then.
    }
  }

  function rollAiDeck() {
    const d = randomDeck(groups, canPlay);
    if (d) aiDeck = d.id;
    rolled++;
  }

  // Own and shared decks may arrive later (cloud sync).
  onMount(() =>
    onSync(() => {
      const next = deckChoices(pool);
      if (next.length !== DECKS.length || next.some((d, i) => d.id !== DECKS[i]?.id)) DECKS = next;
    }),
  );
  let starter = $state<"roll" | "me" | "ai">("roll");
  /** The die roll before the game, while the winner chooses who goes first. */
  let roll = $state.raw<StartRoll>();
  let aiName = $state<AiName>("search");
  // What the AI expects you to play: the meta by share, starter decks a little.
  const field = $derived(DECKS.map((d) => ({ deck: d.deck, weight: d.share ?? 0.01 })));
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
    return aiWantsFirst(find(aiDeck)!.deck) ? AI : HUMAN;
  }

  function launch(firstPlayer: PlayerId) {
    const mine = find(myDeck)!;
    const theirs = find(aiDeck)!;
    session = new GameSession(engine, {
      decks: [mine.deck, theirs.deck],
      options: { seed: seed >>> 0, firstPlayer },
      human: HUMAN,
      ai: aiName,
      deckNames: [deckTitle(mine), deckTitle(theirs)],
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

  const sides = $derived(
    [
      { who: "Du", side: "mine" as const, deck: find(myDeck) },
      { who: "KI", side: "theirs" as const, deck: find(aiDeck) },
    ].map((s) => ({ ...s, face: s.deck ? faceCard(pool, s.deck.deck.main) : undefined })),
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
    rollAiDeck();
  }
</script>

{#if picking}
  {@const mine = picking === "mine"}
  {@const current = mine ? myDeck : aiDeck}
  <DeckPicker
    title={mine ? "Dein Deck" : "Deck der KI"}
    {pool}
    {groups}
    selected={current}
    open={mine && groups.some((g) => g.key === "user") ? ["user"] : [groupOf(groups, current) ?? ""]}
    {unavailable}
    onpick={(d) => (mine ? chooseMine(d) : (aiDeck = d.id))}
    onclose={() => (picking = null)}
    {...mine ? {} : { onrandom: rollAiDeck }}
  />
{/if}

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
          <button
            class="pick"
            onclick={() => (picking = v.side)}
            aria-label={v.side === "mine" ? "Dein Deck wählen" : "Deck der KI wählen"}
          >
            <span class="art">
              {#key v.face?.no}
                {#if v.face}<img use:cardSrc={cardImageUrl(v.face, "full")} alt="" />{/if}
              {/key}
              <span class="who">{v.who}</span>
            </span>
            <span class="deck-info">
              <strong>{v.deck ? deckTitle(v.deck) : ""}</strong>
              <span class="colors">
                {#each (v.deck?.colors ?? "").split("/").filter(Boolean) as c (c)}
                  <i class="dot" data-color={c.trim().toLowerCase()}></i>{c.trim()}
                {/each}
                {#if v.deck?.share !== undefined}<span
                    >· {(v.deck.share * 100).toFixed(1).replace(".", ",")} % der Meta</span
                  >{/if}
              </span>
              <span class="change">Deck ändern <span aria-hidden="true">›</span></span>
            </span>
          </button>
          {#if v.side === "theirs"}
            {#key rolled}
              <button
                class="reroll"
                class:spin={rolled > 0}
                onclick={rollAiDeck}
                title="Zufälliges Deck für die KI"
                aria-label="Zufälliges Deck für die KI">🎲</button
              >
            {/key}
          {/if}
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
    position: relative;
    overflow: hidden;
    border: 1px solid rgb(var(--tone) / 40%);
    border-radius: 14px;
    background: var(--bg-sunken);
    box-shadow: 0 0 30px rgb(var(--tone) / 8%);
  }
  .deck-panel.theirs {
    --tone: 255 93 108;
  }
  .pick {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    text-align: left;
  }
  .pick:hover .change {
    color: rgb(var(--tone));
  }
  .pick:hover .art img {
    transform: scale(1.04);
  }
  .change {
    align-self: flex-start;
    margin-top: 2px;
    padding: 4px 10px;
    border: 1px solid rgb(var(--tone) / 45%);
    border-radius: 999px;
    background: rgb(var(--tone) / 8%);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    transition: color 0.15s;
  }
  .reroll {
    position: absolute;
    top: 10px;
    right: 10px;
    width: 42px;
    height: 42px;
    border: 1px solid rgb(var(--tone) / 50%);
    border-radius: 12px;
    background: rgb(5 8 14 / 70%);
    backdrop-filter: blur(4px);
    font-size: 22px;
    line-height: 1;
  }
  .reroll:hover {
    background: rgb(var(--tone) / 25%);
  }
  .reroll.spin {
    animation: tumble 0.6s ease-out;
  }
  .art {
    display: block;
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
    transition: transform 0.3s;
    animation: fade 0.35s ease-out;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
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
