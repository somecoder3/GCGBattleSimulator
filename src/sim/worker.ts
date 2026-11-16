// Web Worker for the simulator in the browser: loads the cards once, then plays the chunks it receives.

import { CardPool } from "../data/cards";
import type { RawCardsDoc } from "../data/types";
import { CardLib } from "../engine/cardlib";
import { Engine } from "../engine/engine";
import type { WorkerRequest, WorkerResponse } from "./pool";
import { runRange } from "./runner";

const scope = self as unknown as {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let engine: Engine | undefined;

scope.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === "init") {
    fetch(msg.cardsUrl)
      .then((response) => response.json() as Promise<RawCardsDoc>)
      .then((doc) => {
        engine = new Engine(CardLib.fromPool(new CardPool(doc)));
        scope.postMessage({ type: "ready" });
      })
      .catch((error: unknown) => scope.postMessage({ type: "error", id: -1, message: String(error) }));
    return;
  }
  try {
    if (!engine) throw new Error("worker not initialized");
    scope.postMessage({ type: "result", id: msg.id, games: runRange(engine, msg.job, msg.from, msg.to) });
  } catch (error) {
    scope.postMessage({
      type: "error",
      id: msg.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
