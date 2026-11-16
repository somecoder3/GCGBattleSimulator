// Compiles the printed English card text into effect scripts (dsl.ts). The texts follow a strict
// template, so common sentences are recognised exactly; any line with an unknown sentence is reported
// as unsupported instead of being guessed. Manual scripts (manual.ts) override or complete it.

import type { CardDef, Color } from "../data/types";
import type { Cond, Cost, Duration, Effect, Filter, KeywordName, Step, TriggerKind } from "./dsl";

export class ParseError extends Error {}

export interface TokenInfo {
  no: string;
  name: string;
  ap: number;
  hp: number;
}

export interface ParseContext {
  /** Unit token cards (set T) to resolve "[Name]((Trait)･AP3･HP3) Unit token". */
  tokens: TokenInfo[];
}

const KEYWORDS: Record<string, KeywordName> = {
  Blocker: "blocker",
  "First Strike": "firstStrike",
  "High-Maneuver": "highManeuver",
  Suppression: "suppression",
  Breach: "breach",
  Repair: "repair",
  Support: "support",
};
const COLOR_WORDS: Record<string, Color> = {
  blue: "Blue",
  green: "Green",
  red: "Red",
  white: "White",
  purple: "Purple",
};

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Removes reminder text: whole "( … )" lines and the parenthesis after a keyword. */
export function cleanLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim().replace(/\s+/g, " ");
    if (!line || line === "-" || line.startsWith("(")) continue;
    // "<Blocker> (Rest this Unit …)" — the reminder may contain nested parentheses.
    const kw = line.match(/^((?:【[^】]+】)*<[^>]+>)\s*\(/);
    if (kw) line = kw[1]!;
    out.push(line.replace(/[・]/g, "･").replace(/' /g, "'"));
  }
  return out;
}

/** Splits a body into sentences; "Lv." does not end a sentence. */
function sentences(body: string): string[] {
  const protectedBody = body.replace(/Lv\.\s?/g, "Lv§");
  return protectedBody
    .split(/(?<=\.)\s+/)
    .map((s) => s.replace(/Lv§/g, "Lv.").trim())
    .filter(Boolean);
}

const num = (s: string) => {
  if (/^an?$|^one$/i.test(s)) return 1;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new ParseError(`not a number: ${s}`);
  return n;
};

// ---------------------------------------------------------------------------------------------
// Noun phrases: "1 rested enemy Unit with 3 or less HP", "all enemy Units that are Lv.3 or lower"

interface NounPhrase {
  count: number | "all";
  /** "1 to 2 enemy Units": choose at least one, at most `count`. */
  upTo?: boolean;
  filter: Filter;
}

function qualifiers(rest: string, filter: Filter): void {
  let r = rest.trim();
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = r.match(re);
    if (!m) return false;
    fn(m);
    r = r.slice(m[0].length).trim();
    return true;
  };
  for (let guard = 0; r && guard < 6; guard++) {
    const ok =
      take(/^(?:with|that has) (\d+) or less HP/, (m) => (filter.hpMax = num(m[1]!))) ||
      take(/^(?:with|that has) (\d+) or more HP/, (m) => (filter.hpMin = num(m[1]!))) ||
      take(/^(?:with|that has) (\d+) or less AP/, (m) => (filter.apMax = num(m[1]!))) ||
      take(/^(?:with|that has) (\d+) or more AP/, (m) => (filter.apMin = num(m[1]!))) ||
      take(/^that (?:is|are) Lv\.(\d+) or lower/, (m) => (filter.lvMax = num(m[1]!))) ||
      take(/^that (?:is|are) Lv\.(\d+) or higher/, (m) => (filter.lvMin = num(m[1]!))) ||
      take(/^with <([^>]+?)>/, (m) => (filter.keyword = keyword(m[1]!))) ||
      take(/^with (\d+) HP/, (m) => (filter.hpMin = filter.hpMax = num(m[1]!))) ||
      take(/^that (?:is|are) Lv\.(\d+)(?! or)/, (m) => (filter.lvMin = filter.lvMax = num(m[1]!))) ||
      take(/^(?:card )?from your trash/, () => {
        filter.zone = "trash";
        filter.side = "friendly";
      }) ||
      take(/^with no paired Pilot/, () => (filter.paired = false)) ||
      take(/^in play/, () => undefined) ||
      take(/^(?:and|,)/, () => undefined);
    if (!ok) throw new ParseError(`unknown qualifier "${r}"`);
  }
}

function keyword(name: string): KeywordName {
  const k = KEYWORDS[name.replace(/ \d+$/, "")];
  if (!k) throw new ParseError(`unknown keyword ${name}`);
  return k;
}

function traitsOf(s: string): string[] {
  return [...s.matchAll(/\(([^()]+)\)/g)].map((m) => m[1]!);
}

const NP = new RegExp(
  "^(?<count>\\d+ to \\d+|\\d+|all|an?)\\s+(?:(?<ofYour>of your|of the enemy's|of your opponent's)\\s+)?" +
    "(?<adjs>(?:(?:rested|active|damaged|enemy|friendly|other|blue|green|red|white|purple|token|Link|\\([^()]+\\)(?:/\\([^()]+\\))*)\\s+)*)" +
    "(?<noun>Unit tokens?|Unit cards?|Units?|Bases?|Resources?|Pilots?|Command cards?|cards?|Shields?)" +
    "(?<rest>(?:\\s.*)?)$",
);

export function nounPhrase(text: string): NounPhrase {
  const m = text.trim().match(NP);
  if (!m?.groups) throw new ParseError(`unknown noun phrase "${text}"`);
  const g = m.groups;
  const filter: Filter = {};
  if (g.ofYour === "of your") filter.side = "friendly";
  else if (g.ofYour) filter.side = "enemy";
  for (const word of (g.adjs ?? "")
    .trim()
    .split(/\s+(?![^(]*\))/)
    .filter(Boolean)) {
    if (word === "rested") filter.rested = true;
    else if (word === "active") filter.rested = false;
    else if (word === "damaged") filter.damaged = true;
    else if (word === "enemy") filter.side = "enemy";
    else if (word === "friendly") filter.side = "friendly";
    else if (word === "other") filter.other = true;
    else if (word === "token") filter.token = true;
    else if (word === "Link") filter.linked = true;
    else if (COLOR_WORDS[word]) filter.colors = [...(filter.colors ?? []), COLOR_WORDS[word]];
    else if (word.startsWith("(")) filter.traits = traitsOf(word);
    else throw new ParseError(`unknown adjective ${word}`);
  }
  const noun = g.noun!;
  if (/^Unit token/.test(noun)) {
    filter.token = true;
    filter.types = ["UNIT TOKEN"];
  } else if (/^Unit card/.test(noun)) filter.types = ["UNIT"];
  else if (/^Unit/.test(noun)) filter.types = ["UNIT", "UNIT TOKEN"];
  else if (/^Base/.test(noun)) {
    filter.types = ["BASE", "EX BASE"];
    filter.zone = "base";
  } else if (/^Resource/.test(noun)) {
    filter.zone = "resources";
    filter.types = ["RESOURCE", "EX RESOURCE"];
  } else if (/^Pilot/.test(noun)) filter.types = ["PILOT"];
  else if (/^Command/.test(noun)) filter.types = ["COMMAND"];
  else if (/^Shield/.test(noun)) filter.zone = "shieldArea";
  qualifiers(g.rest ?? "", filter);
  if (/ to /.test(g.count!)) return { count: num(g.count!.split(" to ")[1]!), upTo: true, filter };
  return { count: g.count === "all" ? "all" : num(g.count!), filter };
}

// ---------------------------------------------------------------------------------------------
// Sentences

const DURATION: Record<string, Duration> = { turn: "turn", battle: "battle" };

interface Scope {
  /** Steps of the current segment (or of an open "if"/"may"). */
  steps: Step[];
  /** Variable that "it"/"them" refers to. */
  it: string | null;
  vars: number;
}

/** Resolves "it", "them", "this Unit", "this Base", "this card". */
function ref(word: string, scope: Scope): string {
  const w = word.toLowerCase();
  if (w === "this unit" || w === "this base" || w === "this card") return "self";
  if (w === "it" || w === "them" || w === "that unit" || w === "those units") {
    if (!scope.it) throw new ParseError(`"${word}" without a chosen card`);
    return scope.it;
  }
  throw new ParseError(`unknown reference ${word}`);
}

const TARGET = "(it|them|this Unit|this Base|that Unit)";

function apHp(s: string): { ap?: number; hp?: number } {
  const out: { ap?: number; hp?: number } = {};
  for (const m of s.matchAll(/(AP|HP)([+-]\d+)/g)) out[m[1] === "AP" ? "ap" : "hp"] = Number(m[2]);
  if (out.ap === undefined && out.hp === undefined) throw new ParseError(`no AP/HP change in "${s}"`);
  return out;
}

/** Token text "[Zaku Ⅱ]((Zeon)･AP1･HP1)" -> token card number. */
function tokenNo(spec: string, ctx: ParseContext): string {
  const m = spec.match(/^\[([^\]]+)\]\((.*)\)$/);
  if (!m) throw new ParseError(`unknown token ${spec}`);
  const name = m[1]!;
  const ap = Number(m[2]!.match(/AP(\d+)/)?.[1]);
  const hp = Number(m[2]!.match(/HP(\d+)/)?.[1]);
  const token = ctx.tokens.find((t) => t.name === name && t.ap === ap && t.hp === hp);
  if (!token) throw new ParseError(`no token card for ${spec}`);
  return token.no;
}

const TOKEN_SPEC = "(\\[[^\\]]+\\]\\((?:[^()]|\\([^()]*\\))*\\))";

function parseSentence(s: string, scope: Scope, ctx: ParseContext): void {
  const push = (step: Step): void => void scope.steps.push(step);
  let m: RegExpMatchArray | null;
  const sentence = s.replace(/\.$/, "").trim();

  // Choosing.
  if ((m = sentence.match(/^[Cc]hoose (.+)$/))) {
    const np = nounPhrase(m[1]!);
    const as = `t${scope.vars++}`;
    if (np.count === "all") throw new ParseError("choose all");
    push({ op: "choose", filter: np.filter, count: np.count, ...(np.upTo ? { upTo: true } : {}), as });
    scope.it = as;
    return;
  }
  // "Deal 1 damage to all enemy Units that are Lv.3 or lower"
  if ((m = sentence.match(/^[Dd]eal (\d+) damage to all (.+)$/))) {
    const np = nounPhrase(`all ${m[2]!}`);
    const as = `t${scope.vars++}`;
    push({ op: "all", filter: np.filter, as });
    push({ op: "damage", t: as, amount: num(m[1]!) });
    return;
  }
  // "All friendly Link Units get AP+1 during this turn"
  if (
    (m = sentence.match(
      /^All (.+?) get ((?:AP|HP)[+-]\d+(?: and (?:AP|HP)[+-]\d+)?) during this (turn|battle)$/,
    ))
  ) {
    const np = nounPhrase(`all ${m[1]!.replace(/^your /, "friendly ")}`);
    const as = `t${scope.vars++}`;
    push({ op: "all", filter: np.filter, as });
    push({ op: "mod", t: as, ...apHp(m[2]!), until: DURATION[m[3]!]! });
    return;
  }

  // Actions on the chosen card(s) or this card.
  if ((m = sentence.match(new RegExp(`^[Rr]est ${TARGET}$`))))
    return push({ op: "rest", t: ref(m[1]!, scope) });
  if ((m = sentence.match(new RegExp(`^[Ss]et ${TARGET} as active$`))))
    return push({ op: "ready", t: ref(m[1]!, scope) });
  if ((m = sentence.match(new RegExp(`^[Dd]eal (\\d+) damage to ${TARGET}$`)))) {
    return push({ op: "damage", t: ref(m[2]!, scope), amount: num(m[1]!) });
  }
  if ((m = sentence.match(new RegExp(`^[Dd]estroy ${TARGET}$`))))
    return push({ op: "destroy", t: ref(m[1]!, scope) });
  if ((m = sentence.match(/^[Aa]dd (it|them) to your hand$/)))
    return push({ op: "toHand", t: ref(m[1]!, scope) });
  if ((m = sentence.match(/^[Ee]xile (it|them) from the game$/)))
    return push({ op: "exile", t: ref(m[1]!, scope) });
  if (
    (m = sentence.match(
      new RegExp(`^${TARGET} can't choose the enemy player as its attack target during this turn$`, "i"),
    ))
  ) {
    return push({ op: "flag", t: ref(m[1]!, scope), flag: "cantAttackPlayer", until: "turn" });
  }
  if ((m = sentence.match(new RegExp(`^[Rr]eturn ${TARGET} to (?:its|their) owners?'s? hands?$`)))) {
    return push({ op: "bounce", t: ref(m[1]!, scope) });
  }
  if ((m = sentence.match(new RegExp(`^${TARGET} recovers? (\\d+) HP$`, "i")))) {
    return push({ op: "recover", t: ref(m[1]!, scope), amount: num(m[2]!) });
  }
  if (
    (m = sentence.match(
      new RegExp(
        `^${TARGET} gets? ((?:AP|HP)[+-]\\d+(?: and (?:AP|HP)[+-]\\d+)?) during this (turn|battle)$`,
        "i",
      ),
    ))
  ) {
    return push({ op: "mod", t: ref(m[1]!, scope), ...apHp(m[2]!), until: DURATION[m[3]!.toLowerCase()]! });
  }
  if ((m = sentence.match(new RegExp(`^${TARGET} gains? <([^>]+)> during this (turn|battle)$`, "i")))) {
    const amount = Number(m[2]!.match(/ (\d+)$/)?.[1] ?? 0);
    return push({
      op: "grant",
      t: ref(m[1]!, scope),
      keyword: keyword(m[2]!),
      ...(amount ? { amount } : {}),
      until: DURATION[m[3]!.toLowerCase()]!,
    });
  }
  if ((m = sentence.match(new RegExp(`^${TARGET} can't attack during this turn$`, "i")))) {
    return push({ op: "flag", t: ref(m[1]!, scope), flag: "cantAttack", until: "turn" });
  }
  if (
    (m = sentence.match(
      new RegExp(
        `^${TARGET} won't be set as active during the start phase of your opponent's next turn$`,
        "i",
      ),
    ))
  ) {
    return push({ op: "flag", t: ref(m[1]!, scope), flag: "stayRested", until: "nextStart" });
  }
  if (
    (m = sentence.match(
      /^(?:During this turn, )?(it|this Unit) may choose an active enemy Unit ?(.*) as its attack target(?: during this turn)?$/i,
    ))
  ) {
    const np = nounPhrase(`1 enemy Unit ${m[2]!}`.trim());
    return push({ op: "flag", t: ref(m[1]!, scope), flag: "attackActive", filter: np.filter, until: "turn" });
  }

  // Player actions.
  if ((m = sentence.match(/^[Dd]raw (\d+)$/))) return push({ op: "draw", n: num(m[1]!) });
  if ((m = sentence.match(/^[Dd]iscard (\d+)$/))) return push({ op: "discard", n: num(m[1]!) });
  if ((m = sentence.match(/^[Aa]dd (\d+) of your Shields to your hand$/)))
    return push({ op: "shieldToHand", n: num(m[1]!) });
  if ((m = sentence.match(/^[Pp]lace (\d+) EX Resources?$/)))
    return push({ op: "exResource", n: num(m[1]!) });
  if ((m = sentence.match(/^[Pp]lace the top (\d+ cards|card) of your deck into your trash$/))) {
    return push({ op: "mill", n: m[1] === "card" ? 1 : num(m[1]!.split(" ")[0]!) });
  }
  if ((m = sentence.match(new RegExp(`^[Dd]eploy (\\d+) (rested )?${TOKEN_SPEC} Unit tokens?$`)))) {
    return push({
      op: "token",
      no: tokenNo(m[3]!, ctx),
      count: num(m[1]!),
      ...(m[2] ? { rested: true } : {}),
    });
  }
  if ((m = sentence.match(/^[Dd]eploy 1 (.+) from your hand$/))) {
    return push({ op: "deployFromHand", filter: { ...nounPhrase(`1 ${m[1]!}`).filter, zone: "hand" } });
  }
  if (
    (m = sentence.match(
      new RegExp(`^${TARGET} can't receive battle damage from enemy Units (.+) during this battle$`, "i"),
    ))
  ) {
    const np = nounPhrase(`1 enemy Unit ${m[2]!}`);
    return push({
      op: "flag",
      t: ref(m[1]!, scope),
      flag: "noBattleDamageFrom",
      filter: np.filter,
      until: "battle",
    });
  }
  if (
    (m = sentence.match(
      /^During this battle, your shield area cards can't receive damage from enemy Units (.+)$/,
    ))
  ) {
    const np = nounPhrase(`1 enemy Unit ${m[1]!}`);
    return push({ op: "flag", t: "you", flag: "protectShieldArea", filter: np.filter, until: "battle" });
  }
  if (/^[Aa]dd this card to your hand$/.test(sentence)) return push({ op: "selfToHand" });
  if (/^[Dd]eploy this card$/.test(sentence)) return push({ op: "deploySelf" });
  if (/^[Aa]ctivate this card's 【Main】$/.test(sentence)) return push({ op: "runMain" });

  throw new ParseError(`unknown sentence "${sentence}"`);
}

const COND_PATTERNS: [RegExp, (m: RegExpMatchArray) => Cond][] = [
  [/^it is your turn$/, () => ({ yourTurn: true })],
  [/^it is your opponent's turn$/, () => ({ yourTurn: false })],
  [/^this Unit has (\d+) or more AP$/, (m) => ({ selfAp: { min: num(m[1]!) } })],
  [/^this Unit is a Link Unit$/, () => ({ selfLinked: true })],
  [
    /^you have (\d+) or more (.+?) in play$/,
    (m) => ({ count: { ...nounPhrase(`1 friendly ${m[2]!.replace(/s$/, "")}`).filter }, min: num(m[1]!) }),
  ],
  [
    /^you have another (.+?) in play$/,
    (m) => ({ count: { ...nounPhrase(`1 friendly other ${m[1]!}`).filter }, min: 1 }),
  ],
  [
    /^an? (friendly|enemy) (.+?) is in play$/,
    (m) => ({ count: nounPhrase(`1 ${m[1]!} ${m[2]!}`).filter, min: 1 }),
  ],
  [
    /^you have no (.+?) in play$/,
    (m) => ({ count: { ...nounPhrase(`1 friendly ${m[1]!.replace(/s$/, "")}`).filter }, max: 0 }),
  ],
  [/^(\d+) or more enemy Units are in play$/, (m) => ({ count: { side: "enemy" }, min: num(m[1]!) })],
  [
    /^there are (\d+) or more (?:(\([^()]+\)(?:\/\([^()]+\))*) )?cards in your trash$/,
    (m) => ({
      count: { side: "friendly", zone: "trash", ...(m[2] ? { traits: traitsOf(m[2]) } : {}) },
      min: num(m[1]!),
    }),
  ],
  [/^there are (\d+) or less enemy Shields$/, (m) => ({ shields: { max: num(m[1]!) }, side: "enemy" })],
  [/^there is a player with (\d+) or less Shields$/, (m) => ({ shields: { max: num(m[1]!) }, side: "any" })],
  [
    /^an enemy player has (\d+) or more cards in their hand$/,
    (m) => ({ hand: { min: num(m[1]!) }, side: "enemy" }),
  ],
];

export function condition(text: string): Cond {
  const t = text.trim();
  for (const [re, fn] of COND_PATTERNS) {
    const m = t.match(re);
    if (m) return fn(m);
  }
  throw new ParseError(`unknown condition "${t}"`);
}

/** Parses an effect body into segments (split at "Then,"). */
export function parseBody(body: string, ctx: ParseContext): Step[][] {
  const segments: Step[][] = [[]];
  const scope: Scope = { steps: segments[0]!, it: null, vars: 0 };
  let lastMay: Step[] | null = null;

  let look: Extract<Step, { op: "lookTop" }> | null = null;
  for (let s of sentences(body)) {
    s = s.replace(/\.$/, "");
    if (/^Then, /.test(s)) {
      const segment: Step[] = [];
      segments.push(segment);
      scope.steps = segment;
      s = s.replace(/^Then, (.)/, (_, c: string) => c.toUpperCase());
      lastMay = null;
    }
    // "Look at the top 3 cards of your deck. You may reveal 1 … among them and add it to your hand.
    //  Return the remaining cards randomly to the bottom of your deck."
    let lm: RegExpMatchArray | null;
    if ((lm = s.match(/^[Ll]ook at the top (?:(\d+) cards|card) of your deck$/))) {
      look = { op: "lookTop", n: lm[1] ? num(lm[1]) : 1 };
      scope.steps.push(look);
      continue;
    }
    if (
      (lm = s.match(
        /^[Ll]ook at the top (\d+) cards of your deck and return 1 to the top and (?:1|the rest|the remaining cards) to the bottom$/,
      ))
    ) {
      scope.steps.push({ op: "lookTopArrange", n: num(lm[1]!) });
      continue;
    }
    if (look && (lm = s.match(/^You may reveal (\d+) (.+?) among them and add (?:it|them) to your hand$/))) {
      look.pick = nounPhrase(`1 ${lm[2]!}`).filter;
      look.pickCount = num(lm[1]!);
      look.may = true;
      continue;
    }
    if (look && /^Return the remaining cards randomly to the bottom of your deck$/.test(s)) {
      look = null;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = s.match(/^If you do, (.+)$/))) {
      if (lastMay) scope.steps = lastMay; // "You may X. If you do, Y" → Y only after yes
      s = m[1]!;
    } else if ((m = s.match(/^If (.+?), (.+)$/))) {
      // The condition covers the rest of the segment.
      const then: Step[] = [];
      scope.steps.push({ op: "if", cond: condition(m[1]!), then });
      scope.steps = then;
      s = m[2]!;
    }
    if ((m = s.match(/^You may (.+)$/))) {
      const inner = m[1]!;
      if (/^choose /.test(inner)) {
        parseSentence(inner, scope, ctx);
        const last = scope.steps[scope.steps.length - 1]!;
        if (last.op === "choose") last.may = true;
        continue;
      }
      if ((m = inner.match(/^deploy 1 (.+) from your hand$/))) {
        const np = nounPhrase(`1 ${m[1]!}`);
        scope.steps.push({ op: "deployFromHand", filter: { ...np.filter, zone: "hand" }, may: true });
        continue;
      }
      const block: Step[] = [];
      scope.steps.push({ op: "may", do: block });
      const outer = scope.steps;
      scope.steps = block;
      parseSentence(inner.charAt(0).toUpperCase() + inner.slice(1), scope, ctx);
      scope.steps = outer;
      lastMay = block;
      continue;
    }
    parseSentence(s, scope, ctx);
  }
  return segments.filter((seg) => seg.length);
}

// ---------------------------------------------------------------------------------------------
// Lines

const TRIGGERS: Record<string, TriggerKind> = {
  Deploy: "deploy",
  Attack: "attack",
  Destroyed: "destroyed",
  "When Paired": "whenPaired",
  "When Linked": "whenLinked",
};

/** "(White Base Team) Pilot", "Lv.4 or Higher Pilot", "Red Pilot" -> pilot filter. */
function pilotQualifier(q: string): Filter {
  let m: RegExpMatchArray | null;
  if ((m = q.match(/^Lv\.(\d+) or Higher Pilot$/i))) return { lvMin: num(m[1]!) };
  if ((m = q.match(/^Lv\.(\d+) or Lower Pilot$/i))) return { lvMax: num(m[1]!) };
  if ((m = q.match(/^((?:\([^()]+\)\/?)+) Pilot$/))) return { traits: traitsOf(m[1]!) };
  if ((m = q.match(/^(Blue|Green|Red|White|Purple) Pilot$/))) return { colors: [m[1] as Color] };
  throw new ParseError(`unknown pilot qualification ${q}`);
}

function parseCost(text: string): Cost {
  const cost: Cost = {};
  for (const part of text
    .split(/、|,\s*/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^([①-⑩])$/))) cost.resources = "①②③④⑤⑥⑦⑧⑨⑩".indexOf(m[1]!) + 1;
    else if (/^Rest this (Unit|Base)$/.test(part)) cost.restSelf = true;
    else if (/^Destroy this (Unit|Base)$/.test(part)) cost.destroySelf = true;
    else throw new ParseError(`unknown cost "${part}"`);
  }
  return cost;
}

function staticSentence(sentence: string): Effect | Effect[] {
  const s = sentence.replace(/\.$/, "");
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^This Unit gets ((?:AP|HP)[+-]\d+(?: and (?:AP|HP)[+-]\d+)?)$/))) {
    return { kind: "static", target: "self", ...apHp(m[1]!) };
  }
  if ((m = s.match(/^This Unit gains <([^>]+)>$/))) {
    const amount = Number(m[1]!.match(/ (\d+)$/)?.[1] ?? 0);
    return { kind: "static", target: "self", keyword: keyword(m[1]!), ...(amount ? { amount } : {}) };
  }
  if ((m = s.match(/^(During your turn, )?[Aa]ll (.+?) get ((?:AP|HP)[+-]\d+(?: and (?:AP|HP)[+-]\d+)?)$/))) {
    const np = nounPhrase(`all ${m[2]!.replace(/^your /, "friendly ")}`);
    return {
      kind: "static",
      target: np.filter,
      ...apHp(m[3]!),
      ...(m[1] ? { cond: { yourTurn: true } } : {}),
    };
  }
  if (s === "This Unit can't choose the enemy player as its attack target") {
    return { kind: "static", target: "self", flag: "cantAttackPlayer" };
  }
  if (s === "This Unit can't be paired with a Pilot") {
    return { kind: "static", target: "self", flag: "cantBePaired" };
  }
  if (s === "This Unit can't be paired with a Pilot or attack") {
    return [
      { kind: "static", target: "self", flag: "cantBePaired" },
      { kind: "static", target: "self", flag: "cantAttack" },
    ];
  }
  if ((m = s.match(/^This Unit may choose an active enemy Unit (.+) as its attack target$/))) {
    return {
      kind: "static",
      target: "self",
      flag: "attackActive",
      flagFilter: nounPhrase(`1 enemy Unit ${m[1]!}`).filter,
    };
  }
  throw new ParseError(`unknown static sentence "${s}"`);
}

/** One printed line -> one effect (or null for lines without game effect here). */
export function parseLine(line: string, card: Pick<CardDef, "type">, ctx: ParseContext): Effect[] {
  const effect = parseLineEffect(line, card, ctx);
  return effect === null ? [] : Array.isArray(effect) ? effect : [effect];
}

function parseLineEffect(
  line: string,
  card: Pick<CardDef, "type">,
  ctx: ParseContext,
): Effect | Effect[] | null {
  const heads: string[] = [];
  let rest = line;
  let alsoAction = false;
  for (;;) {
    const m = rest.match(/^【([^】]+)】(\/)?/);
    if (!m) break;
    heads.push(m[1]!);
    if (m[2]) alsoAction = true;
    rest = rest.slice(m[0].length);
  }
  rest = rest.trim();

  if (heads.includes("Pilot")) return null; // "【Pilot】[Name]" is read by the card library
  // Keyword lines: Units have them as base keywords (cardlib); Pilots give them to the Unit.
  const kwLine = rest.match(/^<([^>]+)>$/);
  if (kwLine && (heads.length === 0 || heads.join() === "Activate･Main")) {
    if (card.type === "UNIT" || card.type === "UNIT TOKEN") return null;
    const amount = Number(kwLine[1]!.match(/ (\d+)$/)?.[1] ?? 0);
    return { kind: "static", target: "self", keyword: keyword(kwLine[1]!), ...(amount ? { amount } : {}) };
  }

  const once = heads.includes("Once per Turn");
  const conds: Cond[] = [];
  let trigger: TriggerKind | null = null;
  let pilot: Filter | undefined;
  let activated: "main" | "action" | null = null;
  const command: ("main" | "action")[] = [];
  let burst = false;

  for (const h of heads) {
    if (h === "Once per Turn") continue;
    if (h === "Burst") burst = true;
    else if (h === "Main") command.push("main");
    else if (h === "Action") command.push("action");
    else if (h === "Activate･Main") activated = "main";
    else if (h === "Activate･Action") activated = "action";
    else if (h === "During Link") conds.push({ selfLinked: true });
    else if (h === "During Pair") conds.push({ selfPaired: true });
    else if (TRIGGERS[h]) trigger = TRIGGERS[h]!;
    else if (h.startsWith("When Paired･")) {
      trigger = "whenPaired";
      pilot = pilotQualifier(h.slice("When Paired･".length));
    } else throw new ParseError(`unsupported timing 【${h}】`);
  }
  if (alsoAction && !command.includes("action")) command.push("action");
  const cond: Cond | undefined =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : { and: conds };

  if (burst) return { kind: "burst", segments: parseBody(rest, ctx) };
  if (command.length) return { kind: "command", timing: command, segments: parseBody(rest, ctx) };
  if (activated) {
    const [costText, body] = rest.includes("：") ? rest.split("：", 2) : ["", rest];
    const kwBody = body!.match(/^<Support (\d+)>$/);
    if (kwBody) return null; // base keyword
    return {
      kind: "activated",
      timing: activated,
      cost: parseCost(costText!),
      ...(cond ? { cond } : {}),
      ...(once ? { once } : {}),
      segments: parseBody(body!, ctx),
    };
  }
  if (trigger) {
    return {
      kind: "trigger",
      on: trigger,
      ...(pilot ? { pilot } : {}),
      ...(cond ? { cond } : {}),
      ...(once ? { once } : {}),
      segments: parseBody(rest, ctx),
    };
  }

  // No timing keyword: an event trigger ("During your turn, when this Unit destroys …") or a constant effect.
  let m: RegExpMatchArray | null;
  if (
    (m = rest.match(
      /^(During your turn, )?when this Unit destroys an enemy (Unit|shield area card) with battle damage, (.+)$/,
    ))
  ) {
    const yourTurn: Cond = { yourTurn: true };
    const all = m[1] ? (cond ? { and: [cond, yourTurn] } : yourTurn) : cond;
    return {
      kind: "trigger",
      on: m[2] === "Unit" ? "destroysUnit" : "destroysShieldAreaCard",
      ...(all ? { cond: all } : {}),
      ...(once ? { once } : {}),
      segments: parseBody(m[3]!.charAt(0).toUpperCase() + m[3]!.slice(1), ctx),
    };
  }
  if ((m = rest.match(/^At the (start|end) of your turn, (.+)$/))) {
    return {
      kind: "trigger",
      on: m[1] === "start" ? "turnStart" : "turnEnd",
      ...(cond ? { cond } : {}),
      ...(once ? { once } : {}),
      segments: parseBody(m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1), ctx),
    };
  }
  const st = sentences(rest);
  if (st.length !== 1) throw new ParseError(`unknown text "${rest}"`);
  const effects = [staticSentence(st[0]!)].flat();
  for (const effect of effects) {
    if (cond && effect.kind === "static") effect.cond = effect.cond ? { and: [cond, effect.cond] } : cond;
  }
  return effects;
}

export interface ParsedCard {
  effects: Effect[];
  granted: Effect[];
  unsupported: string[];
}

/** Parses all lines of a card. Pilot lines other than 【Burst】 are given to the paired Unit (3-3-9-2). */
export function parseCard(card: CardDef, ctx: ParseContext): ParsedCard {
  const result: ParsedCard = { effects: [], granted: [], unsupported: [] };
  for (const line of cleanLines(card.text)) {
    try {
      for (const effect of parseLine(line, card, ctx)) {
        if (card.type === "PILOT" && effect.kind !== "burst") result.granted.push(effect);
        else result.effects.push(effect);
      }
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      result.unsupported.push(`${line}  ⟶ ${error.message}`);
    }
  }
  return result;
}
