// Hand-written scripts for cards whose text the compiler (parse.ts) can't read or reads wrongly.
// An entry replaces the compiled script of that card completely. Keep the printed text as a comment.

import type { CardScript, Effect } from "./dsl";

export type ManualScript = Pick<CardScript, "effects" | "granted">;

const SHIELD_TO_HAND = { op: "shieldToHand", n: 1 } as const;
const BASE_BURST: Effect = { kind: "burst", segments: [[{ op: "deploySelf" }]] };
const PILOT_BURST: Effect = { kind: "burst", segments: [[{ op: "selfToHand" }]] };

const UNITS = ["UNIT", "UNIT TOKEN"] as const;
const SPECIAL_MOVE = { traits: ["Special Move"], types: ["COMMAND" as const] };

const ENEMY_UNIT = { side: "enemy" as const, types: [...UNITS] };

export const MANUAL: Record<string, ManualScript> = {
  // Unicorn Gundam 02 Banshee (Destroy Mode): 【During Link】【Attack】Choose 12 cards from your trash. Return
  // them to their owner's deck and shuffle it. If you do, set this Unit as active. It gains <First Strike>
  // during this turn. (12 cards or nothing.)
  "GD01-003": {
    effects: [
      {
        kind: "trigger",
        on: "attack",
        cond: { selfLinked: true },
        segments: [
          [
            { op: "choose", filter: { side: "friendly", zone: "trash" }, count: 12, exact: true, as: "t" },
            { op: "shuffleIntoDeck", t: "t" },
            { op: "ready", t: "self" },
            { op: "grant", t: "self", keyword: "firstStrike", until: "turn" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Legend Gundam: While you have a (ZAFT) Link Unit in play, this card in your trash gets Lv. -3 and
  // cost -3. 【Deploy】Choose 1 enemy Unit that is Lv.3 or lower. Destroy it. If you deploy this Unit from
  // your trash, choose 1 to 2 enemy Units that are Lv.3 or lower instead.
  "GD06-050": {
    effects: [
      {
        kind: "handCost",
        zone: "trash",
        fixed: 3,
        when: { count: { side: "friendly", traits: ["ZAFT"], linked: true, types: [...UNITS] }, min: 1 },
      },
      {
        kind: "trigger",
        on: "deploy",
        segments: [
          [
            {
              op: "if",
              cond: { selfFrom: "trash" },
              then: [
                { op: "choose", filter: { ...ENEMY_UNIT, lvMax: 3 }, count: 2, upTo: true, as: "t" },
                { op: "destroy", t: "t" },
              ],
              else: [
                { op: "choose", filter: { ...ENEMY_UNIT, lvMax: 3 }, count: 1, as: "t" },
                { op: "destroy", t: "t" },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Improved Technique: 【Burst】Activate this card's 【Main】. 【Main】/【Action】Choose 1 enemy Unit that is
  // Lv.4 or lower. Deal 3 damage to it. If there are 2 or more cards with "Improved Technique" in their
  // card name in your trash, choose 1 enemy Unit instead.
  "GD03-109": {
    effects: [
      { kind: "burst", segments: [[{ op: "runMain" }]] },
      {
        kind: "command",
        timing: ["main", "action"],
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly", zone: "trash", names: ["Improved Technique"] }, min: 2 },
              then: [{ op: "choose", filter: ENEMY_UNIT, count: 1, as: "t" }],
              else: [{ op: "choose", filter: { ...ENEMY_UNIT, lvMax: 4 }, count: 1, as: "t" }],
            },
            { op: "damage", t: "t", amount: 3 },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Teaching New Techniques: 【Main】Choose 1 enemy Unit that is Lv.4 or lower. Destroy it. Then, deploy 1
  // [Sazabi] (AP4/HP4) Unit token. The destroyed Unit's owner deploys 1 [Nu Gundam] (AP3/HP3/<First Strike>).
  "GD06-115": {
    effects: [
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            { op: "choose", filter: { ...ENEMY_UNIT, lvMax: 4 }, count: 1, as: "t" },
            { op: "destroy", t: "t" },
          ],
          [
            { op: "token", no: "T-033" },
            { op: "token", no: "T-034", forOwnerOf: "t" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Shamblo: If another friendly (Marine) Unit is in play at the start of your opponent's turn, during this
  // turn, when a friendly shield area card receives enemy effect damage, reduce it by 5.
  // 【Deploy】Choose 1 (Marine) Unit card from your trash. Add it to your hand.
  "ST11-006": {
    effects: [
      {
        kind: "trigger",
        on: "opponentTurnStart",
        cond: { count: { side: "friendly", other: true, traits: ["Marine"], types: [...UNITS] }, min: 1 },
        segments: [
          [{ op: "flag", t: "you", flag: "reduceShieldAreaEffectDamage", amount: 5, until: "turn" }],
        ],
      },
      {
        kind: "trigger",
        on: "deploy",
        segments: [
          [
            {
              op: "choose",
              filter: { side: "friendly", zone: "trash", traits: ["Marine"], types: ["UNIT"] },
              count: 1,
              as: "t",
            },
            { op: "toHand", t: "t" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Ple-Twelve: name also [Marida Cruz] (card library). 【Burst】Add this card to your hand. 【When Linked】Look
  // at the top 2 cards of your deck and return 1 to the top. Place the remaining card into your trash. If
  // there is a player with 3 or less Shields, add the card to your hand instead of returning it to your deck.
  "ST12-012": {
    effects: [PILOT_BURST],
    granted: [
      {
        kind: "trigger",
        on: "whenLinked",
        segments: [
          [
            {
              op: "if",
              cond: { shields: { max: 3 }, side: "any" },
              then: [{ op: "lookTopArrange", n: 2, keep: "hand", rest: "trash" }],
              else: [{ op: "lookTopArrange", n: 2, rest: "trash" }],
            },
          ],
        ],
      },
    ],
  },

  // The Final Victor: 【Burst】Choose 1 enemy Unit. Deal 1 damage to it. 【Main】Choose 1 enemy player. You and
  // that player each choose 1 of your own Units. Begin a battle between them and only perform the damage
  // step. (You choose first, then your opponent.)
  "ST12-013": {
    effects: [
      {
        kind: "burst",
        segments: [
          [
            { op: "choose", filter: ENEMY_UNIT, count: 1, as: "t" },
            { op: "damage", t: "t", amount: 1 },
          ],
        ],
      },
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            { op: "choose", filter: { side: "friendly", types: [...UNITS] }, count: 1, as: "a" },
            { op: "choose", filter: ENEMY_UNIT, count: 1, as: "b", by: "opponent" },
            { op: "fight", a: "a", b: "b" },
          ],
        ],
      },
    ],
    granted: [],
  },

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
