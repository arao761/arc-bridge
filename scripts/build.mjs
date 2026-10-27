import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile, cp } from "node:fs/promises";
await mkdir("dist-main", { recursive: true });
await mkdir("dist-extension", { recursive: true });
await build({
  entryPoints: ["desktop/main.mjs"],
  outfile: "dist-main/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  define: { "import.meta.url": "__filenameURL" },
  banner: {
    js: "const __filenameURL = require('node:url').pathToFileURL(__filename).href;",
  },
});
await copyFile("desktop/preload.cjs", "dist-main/preload.cjs");
await copyFile("desktop/host.cjs", "dist-main/host.cjs");
await build({
  entryPoints: ["extension/background.mjs"],
  outfile: "dist-extension/background.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "firefox128",
});
for (const name of ["manifest.json", "popup.html", "popup.js", "popup.css"])
  await copyFile(`extension/${name}`, `dist-extension/${name}`);
await mkdir("artifacts", { recursive: true });
console.log("Desktop code and Firefox companion built.");
