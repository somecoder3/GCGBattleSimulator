// When the AI redraws its starting hand (6-2-1-6). The rules only look at the AI's own hand, which it
// sees in its view. "units" is the rule used since 17 Nov 2026 (measured with tools/mulligan.ts, see
// docs/AI.md "Mulligan"); "basic" was used from M5 on; "never" is for studies.

import type { Engine } from "../engine/engine";
import type { CardId, GameState, PlayerId } from "../engine/types";
import { HIDDEN } from "../engine/view";
import type { Policy } from "./types";

export const MULLIGAN_RULES = ["units", "basic", "never"] as const;
export type MulliganRule = (typeof MULLIGAN_RULES)[number];

/** The rule the AIs use. */
export const DEFAULT_MULLIGAN: MulliganRule = "units";

/** Should the player keep the starting hand? */
export function keepHand(engine: Engine, view: GameState, me: PlayerId, rule: MulliganRule): boolean {
  const hand = view.players[me].hand.filter((id) => view.cards[id]!.no !== HIDDEN);
  const card = (id: CardId) => engine.card(view, id);
  switch (rule) {
    case "never":
      return true;
    case "units":
      // At least two Units up to Lv.4 (measured best of the tried rules, docs/AI.md "Mulligan").
      return hand.filter((id) => card(id).type === "UNIT" && card(id).level <= 4).length >= 2;
    case "basic":
      // A hand that can do something in the first turns: a Unit up to Lv.3 or two cards up to Lv.4.
      return (
        hand.some((id) => card(id).type === "UNIT" && card(id).level <= 3) ||
        hand.filter((id) => card(id).level <= 4).length >= 2
      );
  }
}

/** A policy that decides mulligans by `rule` and everything else like `inner`. */
export function withMulligan(inner: Policy, engine: Engine, rule: MulliganRule): Policy {
  return {
    name: inner.name,
    ...(inner.usesView === undefined ? {} : { usesView: inner.usesView }),
    choose(view, decision) {
      if (decision.kind !== "mulligan") return inner.choose(view, decision);
      const keep = keepHand(engine, view, decision.player, rule);
      return decision.options.find((o) => o.type === (keep ? "keepHand" : "redraw")) ?? decision.options[0]!;
    },
  };
}
