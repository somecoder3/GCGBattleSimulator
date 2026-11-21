// Version of the code that decides simulated games: a checksum over engine, effects, AI, simulation and
// card data. Stored with every run, so results of an older engine or AI stay recognizable. Node only.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PARTS = ["src/engine", "src/effects", "src/ai", "src/sim", "src/data", "gcgdb/data/cards.json"];

function files(root: string, path: string): string[] {
  const full = join(root, path);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(root, join(path, e.name)) : [join(full, e.name)]))
    .filter((f) => /\.(ts|json)$/.test(f));
}

/** 10 hex characters; changes whenever one of the files changes. Read freshly each time (cheap). */
export function codeVersion(root: string): string {
  const hash = createHash("sha1");
  for (const file of PARTS.flatMap((p) => files(root, p)).sort()) {
    hash.update(relative(root, file).replaceAll("\\", "/"));
    hash.update(readFileSync(file));
  }
  return hash.digest("hex").slice(0, 10);
}
