// Where the app gets a card image from (src/data/imagecrypt.ts).
//
// Development servers (dev, lab) serve the plain images from build/images (vite.config.ts). A build
// (preview, GitHub Pages) only has the encrypted originals public/cards/<name>.bin (one size for small and
// full): they are fetched, decrypted with the app's key and shown as blob URLs; the browser scales them. The service worker caches the encrypted files, so
// the images work offline after they were seen once.

import { decryptImage, encryptedPath } from "../../data/imagecrypt";

const ENCRYPTED = !import.meta.env.DEV;
const decrypted = new Map<string, Promise<string>>();

/** URL to show for an image path (`cards/small/GD01-001.webp`): the path itself, or a blob URL later. */
export function imageSource(path: string): string | Promise<string> {
  if (!ENCRYPTED || !path.startsWith("cards/")) return path;
  const file = encryptedPath(path);
  let url = decrypted.get(file);
  if (!url) {
    url = fetch(file)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then(decryptImage)
      .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/webp" })));
    // A failed image may work later (e.g. back online): don't keep the failure.
    url.catch(() => decrypted.delete(file));
    decrypted.set(file, url);
  }
  return url;
}

/** Svelte action for a plain <img> (art crops): `<img use:cardSrc={path} alt="" />`. */
export function cardSrc(node: HTMLImageElement, path: string) {
  let current = path;
  const show = (p: string) => {
    current = p;
    const source = imageSource(p);
    if (typeof source === "string") node.src = source;
    else
      source.then(
        (url) => current === p && (node.src = url),
        () => undefined,
      );
  };
  show(path);
  return { update: show };
}
