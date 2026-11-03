// QA helper: render a list of frames as PNG stills with one bundle/browser,
// then tile them into contact sheets for review.
// Usage: node scripts/stills.mjs 10 60 100 ...   (defaults to a review set)
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "out", "stills");
mkdirSync(outDir, { recursive: true });

const frames = process.argv.slice(2).map(Number);
const list = frames.length
  ? frames
  : [10, 60, 100, 114, 126, 140, 160, 190, 215, 240, 262, 280, 300, 330, 352, 364, 395, 430, 470, 500, 540, 575, 600, 625, 648, 668, 686, 705, 730, 752, 790, 830, 899];

const serveUrl = await bundle({ entryPoint: path.join(root, "src", "index.ts") });
const browser = await openBrowser("chrome");
const composition = await selectComposition({ serveUrl, id: "StafforaPromo", puppeteerInstance: browser });

const files = [];
for (const frame of list) {
  const output = path.join(outDir, `f${String(frame).padStart(3, "0")}.png`);
  await renderStill({ composition, serveUrl, frame, output, puppeteerInstance: browser, scale: 1 });
  files.push(output);
  process.stdout.write(`${frame} `);
}
await browser.close({ silent: true });

execFileSync("python", [path.join(root, "scripts", "sheet.py")], { stdio: "inherit" });
console.log("\ndone →", outDir);
