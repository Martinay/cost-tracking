import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../frontend/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const assets = new URL("../frontend/public/", import.meta.url);
const source = await readFile(new URL("horse-head.svg", assets), "utf8");
const group = source.match(/<g id="horse-head">[\s\S]*?<\/g>/)?.[0];
if (!group) throw new Error("Canonical SVG must contain the horse-head group.");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#285843"/>
  <g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${group}</g>
</svg>\n`;
await writeFile(new URL("favicon.svg", assets), svg);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const images = new Map();
  for (const size of [16, 32, 48, 180, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    const rasterSvg = svg.replace('rx="7"', 'rx="0"');
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${rasterSvg}`,
    );
    images.set(size, await page.screenshot({ type: "png" }));
  }
  for (const [size, name] of [
    [180, "apple-touch-icon.png"],
    [192, "icon-192.png"],
    [512, "icon-512.png"],
  ]) {
    await writeFile(new URL(name, assets), images.get(size));
  }
  const sizes = [16, 32, 48];
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + 16 * index;
    header[entry] = header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images.get(size).length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images.get(size).length;
  }
  await writeFile(
    new URL("favicon.ico", assets),
    Buffer.concat([header, ...sizes.map((size) => images.get(size))]),
  );
} finally {
  await browser.close();
}
