// Splits printed effect text into plain text and highlighted keywords for display
// (【Deploy】 timing keywords and <Blocker> keyword effects), without using HTML.

export type TextPart = { kind: "text" | "timing" | "keyword"; value: string };

export function splitCardText(text: string): TextPart[][] {
  return text.split(/\r?\n/).map((line) => {
    const parts: TextPart[] = [];
    let last = 0;
    for (const match of line.matchAll(/【([^】]+)】|<([^<>]+)>/g)) {
      if (match.index > last) parts.push({ kind: "text", value: line.slice(last, match.index) });
      parts.push(
        match[1] !== undefined ? { kind: "timing", value: match[1] } : { kind: "keyword", value: match[2]! },
      );
      last = match.index + match[0].length;
    }
    if (last < line.length) parts.push({ kind: "text", value: line.slice(last) });
    return parts;
  });
}
