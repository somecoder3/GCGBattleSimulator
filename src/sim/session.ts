// A game between a human and an AI with unlimited rollback. The game is seed + decks + actions;
// going back replays a prefix of the actions (same random numbers, so the same cards come again).
// The log is rebuilt the same way, so it always matches the current state.

import { cloneState } from "../engine/clone";
import type { StartChoice } from "./start";
import type { AiName } from "../ai/registry";
import type { Policy } from "../ai/types";
import type { Engine } from "../engine/engine";
import type { Action, DeckList, GameEvent, GameOptions, GameState, PlayerId } from "../engine/types";
import { viewFor } from "../engine/view";

export interface SessionSetup {
  decks: [DeckList, DeckList];
  options: GameOptions;
  /** Seat of the human player. */
  human: PlayerId;
  /** Names for display, by seat. */
  deckNames?: [string, string];
  /** The opponent AI (default: the best heuristic). */
  ai?: AiName;
  /** The die roll for who goes first and the winner's choice (shown in the log; the engine uses options.firstPlayer). */
  start?: StartChoice;
}

export interface SavedSession extends SessionSetup {
  version: 1;
  actions: Action[];
  /** Indices of actions made automatically for the human (passing). */
  auto?: number[];
}

/** Events of one engine step: setup (action index -1) or the action with that index. */
export interface LogStep {
  index: number;
  player: PlayerId | null;
  action: Action | null;
  /** Turn and active player before the action. */
  turn: number;
  events: GameEvent[];
  /** State after the step, for describing the events with the cards' identities at that time. */
  after: GameState;
  /** Made automatically for the human (e.g. passing in an action step); not a rollback point. */
  auto?: boolean;
}

export class GameSession {
  state!: GameState;
  readonly actions: Action[] = [];
  steps: LogStep[] = [];

  constructor(
    readonly engine: Engine,
    readonly setup: SessionSetup,
    actions: readonly Action[] = [],
    auto: readonly number[] = [],
  ) {
    this.rebuild(actions, new Set(auto));
  }

  static restore(engine: Engine, saved: SavedSession): GameSession {
    // `match` holds the extras of an exported game (gameexport.ts); it isn't part of the setup.
    const {
      version: _version,
      actions,
      auto,
      match: _match,
      ...setup
    } = saved as SavedSession & { match?: unknown };
    return new GameSession(engine, setup, actions, auto);
  }

  save(): SavedSession {
    const auto = this.steps.filter((s) => s.auto).map((s) => s.index);
    return { version: 1, ...this.setup, actions: [...this.actions], ...(auto.length ? { auto } : {}) };
  }

  get human(): PlayerId {
    return this.setup.human;
  }

  /** The state as the human sees it (hidden cards replaced). */
  view(): GameState {
    return viewFor(this.state, this.human);
  }

  get over(): boolean {
    return this.state.result !== null;
  }

  /** Does the human have to decide now? */
  get humanToAct(): boolean {
    return this.state.pending?.player === this.human;
  }

  /** Does the AI have to decide now? */
  get aiToAct(): boolean {
    return this.state.pending !== null && this.state.pending.player !== this.human;
  }

  apply(action: Action, auto = false): LogStep {
    const pending = this.state.pending;
    if (!pending) throw new Error("no decision pending");
    const turn = this.state.turn;
    const events = this.engine.apply(this.state, action);
    const step: LogStep = {
      index: this.actions.length,
      player: pending.player,
      action,
      turn,
      events,
      after: cloneState(this.state),
      ...(auto ? { auto: true } : {}),
    };
    this.actions.push(action);
    this.steps.push(step);
    return step;
  }

  /** Lets the AI make its pending decision. It only sees its own view. */
  stepAI(policy: Policy): LogStep {
    const pending = this.state.pending;
    if (!pending || pending.player === this.human) throw new Error("the AI has nothing to decide");
    const view = policy.usesView === false ? this.state : viewFor(this.state, pending.player);
    return this.apply(policy.choose(view, pending));
  }

  /** Indices of the human's own decisions (rollback points); automatic passes don't count. */
  humanActions(): number[] {
    return this.steps.filter((s) => s.player === this.human && !s.auto).map((s) => s.index);
  }

  get canUndo(): boolean {
    return this.steps.some((s) => s.player === this.human && !s.auto);
  }

  /** Takes back the human's last decision together with everything that followed. */
  undo(): void {
    const last = this.humanActions().at(-1);
    if (last !== undefined) this.rollbackTo(last);
  }

  /** Goes back to the moment before action `index`, keeping actions 0..index-1. */
  rollbackTo(index: number): void {
    if (index < 0 || index > this.actions.length) throw new Error(`no action ${index}`);
    const auto = new Set(this.steps.filter((s) => s.auto && s.index < index).map((s) => s.index));
    this.rebuild(this.actions.slice(0, index), auto);
  }

  /** Index of the human's first decision in the given turn (for "back to the start of the turn"). */
  turnStart(turn: number): number | undefined {
    return this.steps.find((s) => s.turn === turn && s.player === this.human && !s.auto)?.index;
  }

  private rebuild(actions: readonly Action[], auto: ReadonlySet<number> = new Set()): void {
    const { state, events } = this.engine.newGame(this.setup.decks, this.setup.options);
    this.state = state;
    this.actions.length = 0;
    this.steps = [{ index: -1, player: null, action: null, turn: 0, events, after: cloneState(state) }];
    actions.forEach((action, i) => this.apply(action, auto.has(i)));
  }
}
