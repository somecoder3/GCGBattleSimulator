import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const IMAGE_DIR = resolve(import.meta.dirname, "build/images");

// Serves the official card images from build/images (prepared by `npm run images`, never committed or
// bundled) under /cards/<size>/<file>.webp in the dev and preview servers.
function localCardImages(): Plugin {
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const match = req.url?.match(/^\/(?:[^?#]*\/)?cards\/(small|full)\/([A-Za-z0-9_-]+\.webp)(?:[?#].*)?$/);
    if (!match) return next();
    const file = resolve(IMAGE_DIR, match[1]!, match[2]!);
    if (!file.startsWith(IMAGE_DIR + sep) || !existsSync(file)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Content-Length", statSync(file).size);
    res.setHeader("Cache-Control", "public, max-age=86400");
    createReadStream(file).pipe(res);
  };
  return {
    name: "local-card-images",
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

export default defineConfig({
  base: "./",
  // Version of the service worker cache (public/sw.js): a new one with every build.
  // __LAB__: the lab build with simulator and lab tabs (tools/lab.ts sets it); the PWA leaves them out.
  define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)), __LAB__: "false" },
  plugins: [svelte(), localCardImages()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: "es2023", sourcemap: true },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Several tests play hundreds of games. The GitHub runner (2 cores, all test files in parallel) is
    // 2–3× slower than a desktop: the 1000-game fuzz test took 5.8 s there (2.4 s locally) and hit the
    // default limit of 5 s.
    testTimeout: 30_000,
  },
});
