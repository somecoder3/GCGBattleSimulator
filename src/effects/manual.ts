// Hand-written scripts for cards whose text the compiler (parse.ts) can't read or reads wrongly.
// An entry replaces the compiled script of that card completely. Keep the printed text as a comment.

import type { CardScript, Effect } from "./dsl";

export type ManualScript = Pick<CardScript, "effects" | "granted">;

const SHIELD_TO_HAND = { op: "shieldToHand", n: 1 } as const;
const BASE_BURST: Effect = { kind: "burst", segments: [[{ op: "deploySelf" }]] };
const PILOT_BURST: Effect = { kind: "burst", segments: [[{ op: "selfToHand" }]] };

const UNITS = ["UNIT", "UNIT TOKEN"] as const;
const SPECIAL_MOVE = { traits: ["Special Move"], types: ["COMMAND" as const] };

export const MANUAL: Record<string, ManualScript> = {
  // Sazabi: <Suppression> 【Attack】You may choose 1 of your Units. Destroy it. If you do, all enemy players
  // each choose 1 of their non-battling Units. Destroy them. (The keyword comes from the card library.)
  "GD05-049": {
    effects: [
      {
        kind: "trigger",
        on: "attack",
        segments: [
          [
            { op: "choose", filter: { side: "friendly", types: [...UNITS] }, count: 1, may: true, as: "own" },
            { op: "destroy", t: "own" },
            {
              op: "choose",
              filter: { side: "enemy", types: [...UNITS], notBattling: true },
              count: 1,
              as: "theirs",
              by: "opponent",
            },
            { op: "destroy", t: "theirs" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Master Asia: 【Burst】Add this card to your hand. If there are 3 or more (MF) cards in your trash, you may
  // deploy it as an (AP3･HP3) Unit instead. (Don't treat it as a Pilot.)
  // 【During Link】【Attack】If you have activated a (Special Move) Command card's 【Main】/【Action】 during this
  // turn, choose 1 enemy Unit. Deal 2 damage to it.
  "GD05-089": {
    effects: [
      {
        kind: "burst",
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly", zone: "trash", traits: ["MF"] }, min: 3 },
              then: [
                {
                  op: "choice",
                  options: [
                    { label: "Als Unit (AP3/HP3) einsetzen", do: [{ op: "deploySelfAsUnit", ap: 3, hp: 3 }] },
                    { label: "Auf die Hand nehmen", do: [{ op: "selfToHand" }] },
                  ],
                },
              ],
              else: [{ op: "selfToHand" }],
            },
          ],
        ],
      },
    ],
    granted: [
      {
        kind: "trigger",
        on: "attack",
        cond: { selfLinked: true },
        segments: [
          [
            {
              op: "if",
              cond: { played: SPECIAL_MOVE },
              then: [
                { op: "choose", filter: { side: "enemy", types: [...UNITS] }, count: 1, as: "t" },
                { op: "damage", t: "t", amount: 2 },
              ],
            },
          ],
        ],
      },
    ],
  },

  // Domon Kasshu: 【Burst】Add this card to your hand. 【When Paired】Draw 1. Then, discard 1. If you discard a
  // (Special Move) Command card with this effect, you may activate its 【Main】.
  "GD05-097": {
    effects: [PILOT_BURST],
    granted: [
      {
        kind: "trigger",
        on: "whenPaired",
        segments: [
          [{ op: "draw", n: 1 }],
          [
            { op: "discard", n: 1, as: "d" },
            {
              op: "if",
              cond: { varMatches: "d", filter: SPECIAL_MOVE },
              then: [{ op: "may", do: [{ op: "runMainOf", t: "d" }] }],
            },
          ],
        ],
      },
    ],
  },

  // Cyclone Punch: 【Main】Choose 1 enemy Unit. It gets AP-2 during this turn. After activating this card's
  // 【Main】, you may pair this card from your trash with one of your (MF) Units. 【Pilot】[Chibodee Crocket]
  "GD05-121": {
    effects: [
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            { op: "choose", filter: { side: "enemy", types: [...UNITS] }, count: 1, as: "t" },
            { op: "mod", t: "t", ap: -2, until: "turn" },
          ],
          [
            {
              op: "may",
              do: [
                {
                  op: "choose",
                  filter: { side: "friendly", types: ["UNIT"], traits: ["MF"], paired: false },
                  count: 1,
                  as: "u",
                },
                { op: "pairSelf", t: "u" },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // White Base: 【Burst】Deploy this card. 【Deploy】Add 1 of your Shields to your hand.
  // 【Activate･Main】【Once per Turn】②：Deploy 1 [Gundam] (AP3/HP3) Unit token if you have no Units in play,
  // deploy 1 [Guncannon] (AP2/HP2) if you have only 1 Unit in play, or deploy 1 [Guntank] (AP1/HP1) if you
  // have 2 or more Units in play.
  "ST01-015": {
    effects: [
      BASE_BURST,
      { kind: "trigger", on: "deploy", segments: [[SHIELD_TO_HAND]] },
      {
        kind: "activated",
        timing: "main",
        cost: { resources: 2 },
        once: true,
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly" }, max: 0 },
              then: [{ op: "token", no: "T-001" }],
              else: [
                {
                  op: "if",
                  cond: { count: { side: "friendly" }, max: 1 },
                  then: [{ op: "token", no: "T-002" }],
                  else: [{ op: "token", no: "T-003" }],
                },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Corsica Base: 【Burst】Deploy this card. 【Deploy】Add 1 of your Shields to your hand. Then, if it is your
  // turn, deploy 1 [Tallgeese] (AP4/HP2) Unit token. If it is your turn and a card with "Corsica Base" in its
  // card name is in your trash, deploy 2 [Leo] (AP1/HP1) Unit tokens instead.
  "ST02-016": {
    effects: [
      BASE_BURST,
      {
        kind: "trigger",
        on: "deploy",
        segments: [
          [SHIELD_TO_HAND],
          [
            {
              op: "if",
              cond: { yourTurn: true },
              then: [
                {
                  op: "if",
                  cond: { nameInTrash: "Corsica Base" },
                  then: [{ op: "token", no: "T-004", count: 2 }],
                  else: [{ op: "token", no: "T-005" }],
                },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Char Aznable: 【Burst】Add this card to your hand. 【Attack】During this turn, this Unit gets AP+1 and,
  // if it is a Link Unit, it gains <High-Maneuver>.
  "ST03-011": {
    effects: [PILOT_BURST],
    granted: [
      {
        kind: "trigger",
        on: "attack",
        segments: [
          [
            { op: "mod", t: "self", ap: 1, until: "turn" },
            {
              op: "if",
              cond: { selfLinked: true },
              then: [{ op: "grant", t: "self", keyword: "highManeuver", until: "turn" }],
            },
          ],
        ],
      },
    ],
  },

  // Striker Pack: 【Burst】If you have no (Earth Alliance) Unit tokens in play, deploy 1 [Aile Strike Gundam]
  // (AP3/HP3/<Blocker>) Unit token. 【Main】If you have no (Earth Alliance) Unit tokens in play, deploy
  // 1 [Sword Strike Gundam] (AP4/HP2/<Blocker>) or 1 [Launcher Strike Gundam] (AP2/HP4/<Blocker>) Unit token.
  "ST04-012": {
    effects: [
      {
        kind: "burst",
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly", token: true, traits: ["Earth Alliance"] }, max: 0 },
              then: [{ op: "token", no: "T-008" }],
            },
          ],
        ],
      },
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly", token: true, traits: ["Earth Alliance"] }, max: 0 },
              then: [
                {
                  op: "choice",
                  options: [
                    { label: "Sword Strike Gundam", do: [{ op: "token", no: "T-010" }] },
                    { label: "Launcher Strike Gundam", do: [{ op: "token", no: "T-009" }] },
                  ],
                },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },
};
