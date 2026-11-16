// Renders public/icon.svg to the PNG icons of the web app manifest (committed; run after changing the SVG).
//
//   npm run icons

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { ROOT } from "./lib";

const svg = readFileSync(resolve(ROOT, "public/icon.svg"));
for (const size of [192, 512]) {
  await sharp(svg, { density: 300 })
    .resize(size, size)
    .png()
    .toFile(resolve(ROOT, `public/icon-${size}.png`));
}
// Maskable: the icon with a safe margin on the background colour (Android crops to a circle or shape).
const inner = await sharp(svg, { density: 300 }).resize(360, 360).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0b0f17" } })
  .composite([{ input: inner, left: 76, top: 76 }])
  .png()
  .toFile(resolve(ROOT, "public/icon-maskable.png"));
console.log("public/icon-192.png, icon-512.png, icon-maskable.png");
