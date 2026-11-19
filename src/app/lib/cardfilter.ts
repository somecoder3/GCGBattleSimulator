// Card filters for the card list and the deck builder, modelled on ExBurst's card list
// (exburst.dev/gundam/cardlist): filter sections (colour, type, set, rarity, level, cost, trait, link,
// pilot, HP, AP, keywords, link type, zones, source), each a multi-select (any of the chosen values),
// an ordering, and a search field with field syntax ("trait:zeon ap>=4", "type:unit OR type:pilot",
// "kw<>blocker", quotes, parentheses).

import { CARD_TYPES, COLORS, type CardDef } from "../../data/types";

/** The value of a missing number (level of a Resource, AP of a Pilot …), shown as "–". */
export const NONE = "–";

/** Rarities in the order of the printed cards; the first four are the usual ones. */
export const RARITY_ORDER = [
  "C",
  "U",
  "R",
  "LR",
  "P",
  "C+",
  "U+",
  "R+",
  "LR+",
  "LR++",
  "C++",
  "P+",
  "LKC+",
  "LKU+",
  "LKR+",
];

/** Order and spelling of the type filter on gundam-gcg.com. */
export const TYPE_ORDER = [
  "UNIT",
  "PILOT",
  "COMMAND",
  "BASE",
  "RESOURCE",
  "EX BASE",
  "EX RESOURCE",
  "UNIT TOKEN",
] as const satisfies readonly (typeof CARD_TYPES)[number][];

export const LINK_TYPES = { name: "Name", trait: "Trait", none: "Kein Link" } as const;

/** Values of a card that the filters and the search look at (computed once per card). */
export interface CardFacts {
  rarities: string[];
  keywords: string[];
  /** Pilot names: the name of a Pilot card, and the 【Pilot】[name] of a Command. */
  pilots: string[];
  /** Link conditions as printed: "[Amuro Ray]", "(Newtype)". */
  links: string[];
  linkTypes: string[];
  /** Everything the free-text search looks through, lower case. */
  text: string;
}

const facts = new WeakMap<CardDef, CardFacts>();

/** 【Activate･Main】 stays one keyword; 【When Paired･(Zeon) Pilot】 and 【Deploy・Development 2】 count as
 * 【When Paired】 and 【Deploy】 (plus "Development"). <Repair 2> counts as <Repair>. */
function keywordsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/【([^】]+)】/g)) {
    const kw = m[1]!.trim();
    if (/^Activate[･・]/.test(kw)) {
      out.add(kw.replace("・", "･"));
      continue;
    }
    const [head, ...rest] = kw.split(/[･・]/);
    out.add(head!.trim());
    if (rest.some((r) => /^Development/.test(r))) out.add("Development");
  }
  for (const m of text.matchAll(/<([^>]+)>/g)) out.add(m[1]!.replace(/\s*\d+$/, "").trim());
  return [...out];
}

export function cardFacts(card: CardDef): CardFacts {
  let f = facts.get(card);
  if (f) return f;
  const pilots = new Set<string>();
  if (card.type === "PILOT") pilots.add(card.name);
  for (const m of card.text.matchAll(/【Pilot】\s*\[([^\]]+)\]/g)) pilots.add(m[1]!.trim());
  const links = card.link.map((l) => ("pilotName" in l ? `[${l.pilotName}]` : `(${l.trait})`));
  const linkTypes = card.link.length
    ? [...new Set(card.link.map((l) => ("pilotName" in l ? "name" : "trait")))]
    : ["none"];
  const rarities = [...new Set(card.printings.map((p) => p.rarity))];
  const keywords = keywordsOf(card.text);
  const text = [
    card.no,
    card.name,
    card.type,
    card.color ?? "",
    card.traits.join(" "),
    links.join(" "),
    card.sourceTitle,
    card.text,
  ]
    .join(" ")
    .toLowerCase();
  f = { rarities, keywords, pilots: [...pilots], links, linkTypes, text };
  facts.set(card, f);
  return f;
}

const num = (n: number | null) => (n === null ? NONE : String(n));

// ------------------------------------------------------------------------------------------------
// Sections

export type SectionKey =
  | "colors"
  | "type"
  | "set"
  | "rarity"
  | "level"
  | "cost"
  | "trait"
  | "link"
  | "pilot"
  | "hp"
  | "ap"
  | "keywords"
  | "linktype"
  | "zones"
  | "source";

export interface Section {
  key: SectionKey;
  label: string;
  /** "chips": all values as buttons; "pick": a searchable list (many values), the most common as chips. */
  kind: "chips" | "pick";
  values: (card: CardDef) => string[];
  /** Label of a value (default: the value). */
  show?: (value: string) => string;
  /** Fixed order of the values (else numbers ascending, then alphabetical). */
  order?: readonly string[];
  /** In the quick filter bar: show this many values as buttons, the rest behind "+n". */
  inline?: number;
}

export const SECTIONS: readonly Section[] = [
  { key: "colors", label: "Farbe", kind: "chips", values: (c) => (c.color ? [c.color] : []), order: COLORS },
  { key: "type", label: "Typ", kind: "chips", values: (c) => [c.type], order: TYPE_ORDER, inline: 3 },
  { key: "set", label: "Set", kind: "pick", values: (c) => [c.set] },
  {
    key: "rarity",
    label: "Seltenheit",
    kind: "chips",
    values: (c) => cardFacts(c).rarities,
    order: RARITY_ORDER,
    inline: 4,
  },
  { key: "level", label: "Level", kind: "chips", values: (c) => [num(c.level)] },
  { key: "cost", label: "Kosten", kind: "chips", values: (c) => [num(c.cost)] },
  { key: "trait", label: "Trait", kind: "pick", values: (c) => c.traits },
  { key: "link", label: "Link", kind: "pick", values: (c) => cardFacts(c).links },
  { key: "pilot", label: "Pilot", kind: "pick", values: (c) => cardFacts(c).pilots },
  { key: "hp", label: "HP", kind: "chips", values: (c) => [num(c.hp)] },
  { key: "ap", label: "AP", kind: "chips", values: (c) => [num(c.ap)] },
  { key: "keywords", label: "Keywords", kind: "pick", values: (c) => cardFacts(c).keywords },
  {
    key: "linktype",
    label: "Link-Art",
    kind: "chips",
    values: (c) => cardFacts(c).linkTypes,
    order: Object.keys(LINK_TYPES),
    show: (v) => LINK_TYPES[v as keyof typeof LINK_TYPES] ?? v,
  },
  { key: "zones", label: "Zonen", kind: "chips", values: (c) => c.zones, order: ["Earth", "Space"] },
  { key: "source", label: "Serie", kind: "pick", values: (c) => (c.sourceTitle ? [c.sourceTitle] : []) },
];

export const SECTION = Object.fromEntries(SECTIONS.map((s) => [s.key, s])) as Record<SectionKey, Section>;

/** Quick filters shown in the bar by default (as on ExBurst, plus colours and search, which are always there). */
export const DEFAULT_QUICK: SectionKey[] = ["type", "rarity", "level", "trait", "set"];

export interface Facet {
  value: string;
  count: number;
}

/** All values of a section in `cards` with their counts, in display order. */
export function facets(section: Section, cards: readonly CardDef[]): Facet[] {
  const counts = new Map<string, number>();
  for (const card of cards) for (const v of section.values(card)) counts.set(v, (counts.get(v) ?? 0) + 1);
  const list = [...counts].map(([value, count]) => ({ value, count }));
  const rank = (v: string) => {
    const i = section.order?.indexOf(v) ?? -1;
    return i < 0 ? Infinity : i;
  };
  return list.sort((a, b) => {
    const r = rank(a.value) - rank(b.value);
    if (r && Number.isFinite(r)) return r;
    if (rank(a.value) !== rank(b.value)) return rank(a.value) - rank(b.value);
    const na = a.value === NONE ? -1 : Number(a.value);
    const nb = b.value === NONE ? -1 : Number(b.value);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.value.localeCompare(b.value);
  });
}

/** The most common values of a section (the "Beliebt" chips of a pick section). */
export function popular(list: readonly Facet[], n = 6): Facet[] {
  return [...list].sort((a, b) => b.count - a.count).slice(0, n);
}

// ------------------------------------------------------------------------------------------------
// Filter state

export type Selection = Partial<Record<SectionKey, string[]>>;

export interface CardFilter {
  query: string;
  selection: Selection;
}

export const emptyFilter = (): CardFilter => ({ query: "", selection: {} });

export function activeSections(f: CardFilter): SectionKey[] {
  return SECTIONS.filter((s) => (f.selection[s.key]?.length ?? 0) > 0).map((s) => s.key);
}

export function isActive(f: CardFilter): boolean {
  return f.query.trim() !== "" || activeSections(f).length > 0;
}

/** A filter test for many cards (the query is parsed once). Throws nothing: a broken query matches as text. */
export function cardMatcher(f: CardFilter): (card: CardDef) => boolean {
  const query = parseQuery(f.query);
  const chosen = SECTIONS.flatMap((s) => {
    const values = f.selection[s.key];
    return values?.length ? [{ s, set: new Set(values) }] : [];
  });
  return (card) => {
    for (const { s, set } of chosen) if (!s.values(card).some((v) => set.has(v))) return false;
    return query ? evaluate(query, card) : true;
  };
}

// ------------------------------------------------------------------------------------------------
// Ordering

export type SortKey = "no" | "level" | "name" | "cost" | "ap" | "hp" | "rarity";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "no", label: "Nummer" },
  { key: "level", label: "Level" },
  { key: "name", label: "Name" },
  { key: "cost", label: "Kosten" },
  { key: "ap", label: "AP" },
  { key: "hp", label: "HP" },
  { key: "rarity", label: "Seltenheit" },
];

export interface Ordering {
  key: SortKey;
  desc: boolean;
}

const rarityRank = (c: CardDef) => {
  const ranks = cardFacts(c)
    .rarities.map((r) => RARITY_ORDER.indexOf(r))
    .filter((i) => i >= 0);
  // Base rarity: C < U < R < LR (P = promo after them).
  return ranks.length ? Math.min(...ranks) : RARITY_ORDER.length;
};

/** Sorted copy. Missing numbers come last either way; ties by card number. */
export function sortCards(cards: readonly CardDef[], o: Ordering): CardDef[] {
  const dir = o.desc ? -1 : 1;
  const numeric = (get: (c: CardDef) => number | null) => (a: CardDef, b: CardDef) => {
    const x = get(a);
    const y = get(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return (x - y) * dir;
  };
  const cmp: Record<SortKey, (a: CardDef, b: CardDef) => number> = {
    no: (a, b) => a.no.localeCompare(b.no) * dir,
    name: (a, b) => a.name.localeCompare(b.name) * dir,
    level: numeric((c) => c.level),
    cost: numeric((c) => c.cost),
    ap: numeric((c) => c.ap),
    hp: numeric((c) => c.hp),
    rarity: numeric(rarityRank),
  };
  return [...cards].sort((a, b) => cmp[o.key](a, b) || a.no.localeCompare(b.no));
}

// ------------------------------------------------------------------------------------------------
// Search syntax

type Op = ":" | "=" | "<>" | ">" | "<" | ">=" | "<=";

export type QueryNode =
  | { kind: "text"; value: string; exact: boolean }
  | { kind: "field"; field: FieldKey; op: Op; value: string }
  | { kind: "not"; node: QueryNode }
  | { kind: "and"; nodes: QueryNode[] }
  | { kind: "or"; nodes: QueryNode[] };

type FieldKey =
  | "name"
  | "no"
  | "colors"
  | "type"
  | "set"
  | "rarity"
  | "level"
  | "cost"
  | "trait"
  | "link"
  | "pilot"
  | "hp"
  | "ap"
  | "keywords"
  | "linktype"
  | "zones"
  | "source"
  | "text";

/** Field names and their short forms (ExBurst's, plus German ones). */
export const FIELDS: Record<FieldKey, string[]> = {
  name: ["name", "n"],
  no: ["cardno", "no", "nr", "id"],
  colors: ["colors", "color", "c", "farbe"],
  type: ["type", "t", "typ"],
  set: ["set", "s", "series"],
  rarity: ["rarity", "r", "seltenheit"],
  level: ["level", "lv", "v"],
  cost: ["cost", "o", "kosten"],
  trait: ["trait", "traits", "x"],
  link: ["link", "links", "l"],
  pilot: ["pilot", "pilots", "pi"],
  hp: ["hp", "h"],
  ap: ["ap", "a"],
  keywords: ["keywords", "keyword", "kw", "effect"],
  linktype: ["linktype", "linktypes", "lt"],
  zones: ["zones", "zone", "z"],
  source: ["source", "gi", "serie"],
  text: ["text", "effekt"],
};

const FIELD_BY_NAME = new Map(
  Object.entries(FIELDS).flatMap(([key, names]) => names.map((n) => [n, key as FieldKey])),
);

const NUMERIC = new Set<FieldKey>(["level", "cost", "hp", "ap"]);

function fieldValues(card: CardDef, field: FieldKey): (string | number | null)[] {
  const f = cardFacts(card);
  switch (field) {
    case "name":
      return [card.name];
    case "no":
      return [card.no, ...card.printings.map((p) => p.id)];
    case "colors":
      return card.color ? [card.color] : [];
    case "type":
      return [card.type];
    case "set":
      return [card.set];
    case "rarity":
      return f.rarities;
    case "level":
      return [card.level];
    case "cost":
      return [card.cost];
    case "hp":
      return [card.hp];
    case "ap":
      return [card.ap];
    case "trait":
      return card.traits;
    case "link":
      return f.links;
    case "pilot":
      return f.pilots;
    case "keywords":
      return f.keywords;
    case "linktype":
      return f.linkTypes.flatMap((t) => [t, LINK_TYPES[t as keyof typeof LINK_TYPES]]);
    case "zones":
      return card.zones;
    case "source":
      return [card.sourceTitle];
    case "text":
      return [card.text];
  }
}

/** Folds case and accents ("Zéta" = "zeta"). */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function evaluate(node: QueryNode, card: CardDef): boolean {
  switch (node.kind) {
    case "and":
      return node.nodes.every((n) => evaluate(n, card));
    case "or":
      return node.nodes.some((n) => evaluate(n, card));
    case "not":
      return !evaluate(node.node, card);
    case "text": {
      const hay = fold(cardFacts(card).text);
      return hay.includes(fold(node.value));
    }
    case "field": {
      const values = fieldValues(card, node.field);
      const want = fold(node.value);
      if (NUMERIC.has(node.field)) {
        const n = Number(node.value);
        const nums = values as (number | null)[];
        if (want === "" || want === "-" || want === NONE || want === "none") {
          const missing = nums.some((v) => v === null);
          return node.op === "<>" ? !missing : missing;
        }
        if (Number.isNaN(n)) return false;
        const test = (v: number | null) => {
          if (v === null) return false;
          switch (node.op) {
            case ">":
              return v > n;
            case "<":
              return v < n;
            case ">=":
              return v >= n;
            case "<=":
              return v <= n;
            default:
              return v === n;
          }
        };
        return node.op === "<>" ? !nums.some(test) : nums.some(test);
      }
      const strs = values.map((v) => fold(String(v ?? "")));
      switch (node.op) {
        case "=":
          return strs.some((v) => v === want);
        case "<>":
          return !strs.some((v) => v.includes(want));
        default:
          return strs.some((v) => v.includes(want));
      }
    }
  }
}

type Token = { t: "(" } | { t: ")" } | { t: "or" } | { t: "and" } | { t: "not" } | { t: "term"; s: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ t: ch });
      i++;
      continue;
    }
    if (ch === "-" && i + 1 < input.length && !/\s/.test(input[i + 1]!)) {
      tokens.push({ t: "not" });
      i++;
      continue;
    }
    // A term runs to the next space or parenthesis outside quotes.
    let s = "";
    let quoted = false;
    while (i < input.length) {
      const c = input[i]!;
      if (c === '"') quoted = !quoted;
      else if (!quoted && (/\s/.test(c) || c === "(" || c === ")")) break;
      s += c;
      i++;
    }
    if (s === "OR" || s === "ODER" || s === "|") tokens.push({ t: "or" });
    else if (s === "AND" || s === "UND") tokens.push({ t: "and" });
    else if (s === "NOT" || s === "NICHT") tokens.push({ t: "not" });
    else tokens.push({ t: "term", s });
  }
  return tokens;
}

const unquote = (s: string) => s.replace(/^"(.*)"?$/, "$1").replace(/"$/, "");

function term(s: string): QueryNode {
  const m = s.match(/^([a-zA-Z]+)(<>|!=|>=|<=|:|=|>|<)(.*)$/);
  const field = m ? FIELD_BY_NAME.get(m[1]!.toLowerCase()) : undefined;
  if (m && field) {
    const op = (m[2] === "!=" ? "<>" : m[2]) as Op;
    return { kind: "field", field, op, value: unquote(m[3]!) };
  }
  const exact = s.startsWith('"');
  return { kind: "text", value: unquote(s), exact };
}

/** Parses the search field; undefined for an empty one. Unbalanced parentheses are forgiven. */
export function parseQuery(input: string): QueryNode | undefined {
  const tokens = tokenize(input);
  let pos = 0;
  const peek = () => tokens[pos];

  function orExpr(): QueryNode | undefined {
    const nodes: QueryNode[] = [];
    const first = andExpr();
    if (first) nodes.push(first);
    while (peek()?.t === "or") {
      pos++;
      const next = andExpr();
      if (next) nodes.push(next);
    }
    return nodes.length > 1 ? { kind: "or", nodes } : nodes[0];
  }
  function andExpr(): QueryNode | undefined {
    const nodes: QueryNode[] = [];
    for (;;) {
      const tok = peek();
      if (!tok || tok.t === "or" || tok.t === ")") break;
      if (tok.t === "and") {
        pos++;
        continue;
      }
      const node = unary();
      if (node) nodes.push(node);
    }
    return nodes.length > 1 ? { kind: "and", nodes } : nodes[0];
  }
  function unary(): QueryNode | undefined {
    const tok = peek();
    if (tok?.t === "not") {
      pos++;
      const node = unary();
      return node ? { kind: "not", node } : undefined;
    }
    return primary();
  }
  function primary(): QueryNode | undefined {
    const tok = tokens[pos++];
    if (!tok) return undefined;
    if (tok.t === "(") {
      const node = orExpr();
      if (peek()?.t === ")") pos++;
      return node;
    }
    if (tok.t === "term") return term(tok.s);
    return undefined;
  }

  const nodes: QueryNode[] = [];
  while (pos < tokens.length) {
    const node = orExpr();
    if (node) nodes.push(node);
    if (peek()?.t === ")") pos++; // a stray ")"
  }
  return nodes.length > 1 ? { kind: "and", nodes } : nodes[0];
}
