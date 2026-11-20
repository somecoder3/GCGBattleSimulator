import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// docs/keyword-icons.html shows the symbol files from src/app/assets/keywords/ by double click, so it cannot list
// the folder or read the colors itself and names them in KEYS. This keeps KEYS in line with the files and the app.
const ROOT = resolve(import.meta.dirname, "../..");
const DIR = resolve(ROOT, "src/app/assets/keywords");

function fileColors(): Record<string, string> {
  return Object.fromEntries(
    readdirSync(DIR)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => {
        const svg = readFileSync(resolve(DIR, f), "utf8");
        return [f.slice(0, -4), /<svg[^>]*\scolor="([^"]+)"/.exec(svg)?.[1] ?? ""];
      }),
  );
}

function docKeys(): Record<string, string> {
  const html = readFileSync(resolve(ROOT, "docs/keyword-icons.html"), "utf8");
  const block = /const KEYS = \{([\s\S]*?)\n\s*\};/.exec(html)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/(\w+): \[[^\]]*"(#[0-9a-fA-F]+)"\]/g)].map((m) => [m[1]!, m[2]!]),
  );
}

describe("keyword symbol files", () => {
  it("every file has its color on the root element", () => {
    for (const [key, color] of Object.entries(fileColors())) expect(color, key).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the app knows every file", async () => {
    const { KEYWORD_LABEL } = await import("../../src/app/components/game/KeywordIcon.svelte");
    expect(Object.keys(fileColors()).sort()).toEqual(Object.keys(KEYWORD_LABEL).sort());
  });

  it("docs/keyword-icons.html lists every file with its color", () => {
    expect(docKeys()).toEqual(fileColors());
  });
});
