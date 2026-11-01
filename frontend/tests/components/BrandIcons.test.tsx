import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { Icon } from "../../src/components/Icon";

const publicFile = (name: string) =>
  readFileSync(resolve(import.meta.dirname, "../../public", name));

describe("horse-head identity", () => {
  test("uses the local canonical horse head without an extra accessible name", () => {
    const { container } = render(<Icon name="horses" />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector("use")).toHaveAttribute(
      "href",
      "/horse-head.svg#horse-head",
    );
    expect(publicFile("horse-head.svg").toString()).toContain(
      'id="horse-head"',
    );
  });

  test("declares browser, touch, and app assets", () => {
    const html = readFileSync(
      resolve(import.meta.dirname, "../../index.html"),
      "utf8",
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const [selector, attribute, value] of [
      ['link[rel="icon"][type="image/svg+xml"]', "href", "/favicon.svg"],
      ['link[rel="icon"][sizes="16x16 32x32 48x48"]', "href", "/favicon.ico"],
      ['link[rel="apple-touch-icon"]', "href", "/apple-touch-icon.png"],
      ['link[rel="manifest"]', "href", "/site.webmanifest"],
      ['meta[name="theme-color"]', "content", "#285843"],
    ]) {
      expect(doc.querySelector(selector)?.getAttribute(attribute)).toBe(value);
    }
  });

  test("ships correctly sized device icons and a multi-size ICO fallback", () => {
    for (const [name, size] of [
      ["apple-touch-icon.png", 180],
      ["icon-192.png", 192],
      ["icon-512.png", 512],
    ] as const) {
      const png = publicFile(name);
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        size,
        size,
      ]);
    }
    const ico = publicFile("favicon.ico");
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
    const manifest = JSON.parse(publicFile("site.webmanifest").toString());
    expect(manifest.icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
    const config = JSON.parse(
      publicFile("staticwebapp.config.json").toString(),
    );
    expect(config.navigationFallback.exclude).toContain("/*.webmanifest");
  });
});
