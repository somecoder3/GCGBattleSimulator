// The lab: `npm run lab` (or lab.bat) starts a local server on http://localhost:5180 with the whole app
// including the simulator, which runs on worker threads here (the page can be closed meanwhile), and keeps
// runs, decks and a reloaded meta snapshot in SQLite under data-lab/ (not in the repository).
// The PWA (dev server, GitHub Pages) reads the lab's decks over the same API when the lab runs.
//
// Options: --open (open the browser), --port N, --data <file> (default data-lab/lab.db).

import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";
import { handleApi, LAB_PORT } from "../src/lab/api";
import { JobManager } from "../src/lab/jobs";
import { LabStore } from "../src/lab/store";
import { codeVersion } from "../src/lab/version";
import { ROOT } from "./lib";
import { threadWorker } from "./node-pool";

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(option("port") ?? LAB_PORT);
const dataFile = resolve(ROOT, option("data") ?? process.env.GCG_LAB_DATA ?? "data-lab/lab.db");

const store = new LabStore(dataFile);
const version = () => codeVersion(ROOT);
const jobs = new JobManager(store, threadWorker, version, Math.max(1, availableParallelism() - 1));

const http = createHttpServer();
const vite = await createViteServer({
  root: ROOT,
  // The lab build of the app: with the simulator and the other lab tabs (src/app/env.d.ts).
  define: { __LAB__: "true" },
  // Own cache, so the lab and the normal dev server (other constants) can run at the same time.
  cacheDir: "node_modules/.vite-lab",
  server: { middlewareMode: true, ws: { server: http } },
  appType: "spa",
});
http.on("request", (req, res) => {
  if (!handleApi({ store, jobs, version }, req, res)) vite.middlewares(req, res);
});

http.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}/`;
  console.log(`Labor läuft: ${url}  (Daten: ${dataFile}, Code-Version ${version()})`);
  console.log("Beenden mit Strg+C.");
  if (args.includes("--open")) {
    const [cmd, cmdArgs] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
    spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
  }
});

const shutdown = () => {
  jobs.stop();
  void vite.close();
  http.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
