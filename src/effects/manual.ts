// Hand-written scripts for cards whose text the compiler (parse.ts) can't read or reads wrongly.
// An entry replaces the compiled script of that card completely. Keep the printed text as a comment.

import type { CardScript, Effect, Filter, Step } from "./dsl";

export type ManualScript = Pick<CardScript, "effects" | "granted">;

const SHIELD_TO_HAND = { op: "shieldToHand", n: 1 } as const;
const BASE_BURST: Effect = { kind: "burst", segments: [[{ op: "deploySelf" }]] };
const PILOT_BURST: Effect = { kind: "burst", segments: [[{ op: "selfToHand" }]] };

const UNITS = ["UNIT", "UNIT TOKEN"] as const;
const SPECIAL_MOVE = { traits: ["Special Move"], types: ["COMMAND" as const] };

const ENEMY_UNIT = { side: "enemy" as const, types: [...UNITS] };

const LOOK_TOP_OR_BOTTOM: Step = {
  op: "if",
  cond: { not: { varCount: { var: "taken", min: 1 } } },
  then: [
    { op: "peek", n: 1 },
    {
      op: "choice",
      options: [
        { label: "Oben lassen", do: [{ op: "unpeek" }] },
        { label: "Unter das Deck", do: [{ op: "topToBottom", n: 1 }] },
      ],
    },
  ],
};

/**
 * "All players each look at the top card of their deck. If it is a …, they may reveal it and add it to their
 * hand. They return any remaining card to the top or bottom of their deck." The opponent takes a matching
 * card and otherwise leaves it on top.
 */
function allPlayersLookTop(pick: Filter): Step[] {
  return [
    { op: "if", cond: { topCard: pick }, then: [{ op: "may", do: [{ op: "takeTop", as: "taken" }] }] },
    LOOK_TOP_OR_BOTTOM,
    { op: "opponentLookTop", pick },
  ];
}

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

  // Setsuna F. Seiei: 【Burst】Add this card to your hand. 【Attack】This Unit gets AP+1 during this turn. If
  // there are 7 or more (CB) cards in your trash, all your (CB) Units get AP+1 instead.
  "ST07-009": {
    effects: [PILOT_BURST],
    granted: [
      {
        kind: "trigger",
        on: "attack",
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "friendly", zone: "trash", traits: ["CB"] }, min: 7 },
              then: [
                { op: "all", filter: { side: "friendly", traits: ["CB"], types: [...UNITS] }, as: "t" },
                { op: "mod", t: "t", ap: 1, until: "turn" },
              ],
              else: [{ op: "mod", t: "self", ap: 1, until: "turn" }],
            },
          ],
        ],
      },
    ],
  },

  // Wise Leader's Pride: 【Action】Choose 1 friendly Unit. It gains the following effect during this battle:
  // ■When this Unit destroys an enemy Unit with battle damage, choose 1 enemy Unit with 2 or less AP.
  // Destroy it. 【Pilot】[M'Quve]
  // Effect 1 is only ever used as the gained effect (the Command itself is never in play with it).
  "ST12-014": {
    effects: [
      {
        kind: "command",
        timing: ["action"],
        segments: [
          [
            { op: "choose", filter: { side: "friendly" }, count: 1, as: "t" },
            { op: "grantEffect", t: "t", idx: 1, until: "battle" },
          ],
        ],
      },
      {
        kind: "trigger",
        on: "destroysUnit",
        segments: [
          [
            { op: "choose", filter: { ...ENEMY_UNIT, apMax: 2 }, count: 1, as: "t" },
            { op: "destroy", t: "t" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Battlefield Emotions: 【Burst】Place 1 EX Resource. 【Main】Place 1 rested Resource. Then, if you have not
  // set one of your Resources as active with an effect this turn, choose a number of your Resources equal to
  // the number of enemy players. Set them as active.
  "ST14-015": {
    effects: [
      { kind: "burst", segments: [[{ op: "exResource", n: 1 }]] },
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [{ op: "placeResource", rested: true }],
          [
            {
              op: "if",
              cond: { not: { readiedResource: true } },
              then: [{ op: "readyResource", n: 1 }],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Narrative Gundam A-Packs (EX): <Repair 2> At the end of your turn, if this Unit is rested, rest all
  // Units. If this effect rested 3 or more Units, draw 1.
  "EB01-003": {
    effects: [
      {
        kind: "trigger",
        on: "turnEnd",
        cond: { selfIs: { rested: true } },
        segments: [
          [
            { op: "all", filter: { rested: false }, as: "r" },
            { op: "rest", t: "r" },
            { op: "if", cond: { varCount: { var: "r", min: 3 } }, then: [{ op: "draw", n: 1 }] },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Le Cygne (EX): 【Attack】All players each look at the top card of their deck. If it is a card that is
  // Lv.5 or higher, they may reveal it and add it to their hand. They return any remaining card to the top
  // or bottom of their deck.
  "EB01-023": {
    effects: [{ kind: "trigger", on: "attack", segments: [allPlayersLookTop({ lvMin: 5 })] }],
    granted: [],
  },

  // Psycho Zaku: 【During Link】【Attack】【Once per Turn】All players each choose 1 of their Resources. Set
  // them as active.
  "EB01-059": {
    effects: [
      {
        kind: "trigger",
        on: "attack",
        cond: { selfLinked: true },
        once: true,
        segments: [[{ op: "readyResource", n: 1, both: true }]],
      },
    ],
    granted: [],
  },

  // Jona Basta: 【Burst】Add this card to your hand. 【Attack】【Once per Turn】Choose 1 enemy player. They may
  // draw 1. If they draw with this effect, draw 1.
  "EB01-062": {
    effects: [PILOT_BURST],
    granted: [
      {
        kind: "trigger",
        on: "attack",
        once: true,
        segments: [
          [
            {
              op: "may",
              by: "opponent",
              do: [
                { op: "draw", n: 1, who: "opponent" },
                { op: "draw", n: 1 },
              ],
            },
          ],
        ],
      },
    ],
  },

  // Premium Unit Assembly: 【Main】All players each look at the top card of their deck. If it is a Unit card,
  // they may reveal it and add it to their hand. They return any remaining card to the top or bottom.
  "EB01-078": {
    effects: [{ kind: "command", timing: ["main"], segments: [allPlayersLookTop({ types: ["UNIT"] })] }],
    granted: [],
  },

  // Moebius (Peacemaker Team): 【Activate･Action】Destroy this Unit：Choose 1 enemy Base/enemy Shield this
  // Unit is battling. Deal 6 damage to it. (Only while it attacks the enemy player: then it battles the
  // first card of the shield area.)
  "GD02-011": {
    effects: [
      {
        kind: "activated",
        timing: "action",
        cost: { destroySelf: true },
        cond: { attackingPlayer: true },
        segments: [[{ op: "damageShieldArea", amount: 6 }]],
      },
    ],
    granted: [],
  },

  // Orga's Order: 【Main】If 1 to 4 enemy Units are in play, deploy 1 [Graze Custom] (AP2/HP2) Unit token. If
  // 5 or more are in play, deploy 1 [Gundam Barbatos 4th Form] (AP4/HP4) Unit token.
  "GD03-117": {
    effects: [
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            {
              op: "if",
              cond: { count: { side: "enemy" }, min: 5 },
              then: [{ op: "token", no: "T-017" }],
              else: [
                {
                  op: "if",
                  cond: { count: { side: "enemy" }, min: 1 },
                  then: [{ op: "token", no: "T-016" }],
                },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Gundam Throne Eins: 【Deploy】You may choose 1 to 2 of your other active (CB) Units. Rest them. If you do,
  // deal damage equal to the number of Units rested with this effect to all enemy Units that are Lv.6 or lower.
  "GD04-036": {
    effects: [
      {
        kind: "trigger",
        on: "deploy",
        segments: [
          [
            {
              op: "choose",
              filter: { side: "friendly", other: true, rested: false, traits: ["CB"], types: [...UNITS] },
              count: 2,
              upTo: true,
              may: true,
              as: "r",
            },
            { op: "rest", t: "r" },
            { op: "all", filter: { ...ENEMY_UNIT, lvMax: 6 }, as: "e" },
            { op: "damageByVar", t: "e", var: "r" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // ∀ Gundam: 【Activate･Main】【Once per Turn】①：Choose 1 Unit card with <Repair>/<Breach>/<First Strike>/
  // <Support>/<High-Maneuver>/<Suppression>/<Blocker> from your trash. During this turn, this Unit gets AP+1
  // and all <Repair>/<Breach>/… on that Unit card.
  "GD04-067": {
    effects: [
      {
        kind: "activated",
        timing: "main",
        cost: { resources: 1 },
        once: true,
        segments: [
          [
            {
              op: "choose",
              filter: { side: "friendly", zone: "trash", types: ["UNIT"], anyKeyword: true },
              count: 1,
              as: "t",
            },
            { op: "mod", t: "self", ap: 1, until: "turn" },
            { op: "copyKeywords", from: "t", into: "self", until: "turn" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Reliable Big Brother: 【Main】Place the top 2 cards of your deck into your trash. If you do, choose 1 enemy
  // Unit with 4 or less AP. Deal an amount of damage equal to the number of (Minerva Squad) cards placed
  // with this effect to that enemy Unit. 【Pilot】[Heine Westenfluss]
  "GD04-116": {
    effects: [
      {
        kind: "command",
        timing: ["main"],
        segments: [
          [
            { op: "mill", n: 2, as: "m" },
            { op: "choose", filter: { ...ENEMY_UNIT, apMax: 4 }, count: 1, as: "t" },
            { op: "damageByVar", t: "t", var: "m", filter: { traits: ["Minerva Squad"] } },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Gundam Aerial Rebuild: Count up the number of your Units with "Gundam Lfrith"/"Gundnode" in their card
  // name, plus this Unit. All enemy Units whose Lv. is equal to or lower than that number are deployed rested.
  "GD05-026": {
    effects: [
      {
        kind: "static",
        target: {
          ...ENEMY_UNIT,
          lvMaxPlus: {
            count: { side: "friendly", names: ["Gundam Lfrith", "Gundnode"], types: [...UNITS] },
            plus: 1,
          },
        },
        flag: "deployRested",
      },
    ],
    granted: [],
  },

  // Gaia Gundam: 【During Pair】【Once per Turn】When this Unit destroys an enemy shield area card with battle
  // damage, that enemy player may discard 1. If they don't discard with this effect, you may deploy 1
  // (Phantom Pain) Unit card that is Lv.4 or lower from your hand.
  "GD05-034": {
    effects: [
      {
        kind: "trigger",
        on: "destroysShieldAreaCard",
        cond: { selfPaired: true },
        once: true,
        segments: [
          [
            { op: "may", by: "opponent", do: [{ op: "discard", n: 1, who: "opponent", as: "d" }] },
            {
              op: "if",
              cond: { not: { varCount: { var: "d", min: 1 } } },
              then: [
                {
                  op: "deployFromHand",
                  filter: { traits: ["Phantom Pain"], types: ["UNIT"], lvMax: 4 },
                  may: true,
                },
              ],
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Elpeo Ple's Qubeley Mk-Ⅱ: <Breach 1> 【During Pair】【Activate･Action】【Once per Turn】Choose 1 of your (Neo
  // Zeon)/(Long-Range Weapon) Units or 1 of your (Neo Zeon) Bases. During this battle, battle damage this Unit
  // would receive is dealt to that Unit/Base instead.
  "GD06-018": {
    effects: [
      {
        kind: "activated",
        timing: "action",
        cost: {},
        cond: { selfPaired: true },
        once: true,
        segments: [
          [
            {
              op: "choose",
              filter: {
                side: "friendly",
                other: true,
                zone: "field",
                types: ["UNIT", "UNIT TOKEN", "BASE", "EX BASE"],
                anyOf: [
                  { types: [...UNITS], traits: ["Neo Zeon", "Long-Range Weapon"] },
                  { types: ["BASE", "EX BASE"], traits: ["Neo Zeon"] },
                ],
              },
              count: 1,
              as: "t",
            },
            { op: "flag", t: "self", flag: "redirectBattleDamage", link: "t", until: "battle" },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Neo Core Fighter: 【Activate･Main】Destroy 2 of your (Gundam Team) Units with unique card names that are
  // Lv.3 and this Unit：Deploy 1 (Gundam Team) Unit card that is Lv.8 or higher from your hand.
  "GD06-039": {
    effects: [
      {
        kind: "activated",
        timing: "main",
        cost: { destroySelf: true },
        segments: [
          [
            {
              op: "choose",
              filter: {
                side: "friendly",
                other: true,
                traits: ["Gundam Team"],
                lvMin: 3,
                lvMax: 3,
                types: [...UNITS],
              },
              count: 2,
              exact: true,
              unique: true,
              as: "c",
            },
            { op: "destroy", t: "c" },
            { op: "deployFromHand", filter: { traits: ["Gundam Team"], types: ["UNIT"], lvMin: 8 } },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Destroy Gundam (MA Mode): 【Deploy】Look at the top 4 cards of your deck. You may pair 1 (Biological CPU)
  // Pilot card among them with this Unit. Return the remaining cards randomly to the bottom of your deck.
  "GD06-042": {
    effects: [
      {
        kind: "trigger",
        on: "deploy",
        segments: [
          [
            {
              op: "lookTop",
              n: 4,
              pick: { types: ["PILOT"], traits: ["Biological CPU"] },
              pickCount: 1,
              may: true,
              pairToSelf: true,
            },
          ],
        ],
      },
    ],
    granted: [],
  },

  // Infinite Variations: 【Main】/【Action】Choose a number of enemy Units up to the number of white Units with
  // <Blocker> you have in play. They get AP-2 during this turn.
  "GD06-118": {
    effects: [
      {
        kind: "command",
        timing: ["main", "action"],
        segments: [
          [
            {
              op: "choose",
              filter: ENEMY_UNIT,
              countOf: { side: "friendly", colors: ["White"], keyword: "blocker", types: [...UNITS] },
              upTo: true,
              as: "t",
            },
            { op: "mod", t: "t", ap: -2, until: "turn" },
          ],
        ],
      },
    ],
    granted: [],
  },
};
