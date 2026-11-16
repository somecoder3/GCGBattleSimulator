import { mount } from "svelte";
import App from "./App.svelte";
import "./styles.css";

mount(App, { target: document.getElementById("app")! });

// Offline support (public/sw.js), only in the built app: the dev server always serves fresh files.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register(`./sw.js?v=${__BUILD_ID__}`).catch((error: unknown) => {
    console.warn("service worker not registered", error);
  });
}
