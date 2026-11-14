#!/usr/bin/env node
// Assemble the deployable site: exactly the files the service worker caches
// (sw.js ASSETS) plus sw.js itself. Tests, scripts and docs are not published.
//   node scripts/build-site.cjs [outDir=_site]
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  out = path.resolve(root, process.argv[2] || "_site"),
  worker = fs.readFileSync(path.join(root, "sw.js"), "utf8"),
  match = /const ASSETS = (\[.*?\]);/s.exec(worker);
if (!match) throw new Error("sw.js has no ASSETS list.");
const assets = JSON.parse(match[1]).filter((file) => file !== "./");
fs.rmSync(out, { recursive: true, force: true });
let bytes = 0;
for (const file of [...assets, "sw.js"]) {
  const source = path.join(root, file),
    target = path.join(out, file);
  if (!source.startsWith(root + path.sep))
    throw new Error("Asset outside the project: " + file);
  if (!fs.existsSync(source)) throw new Error("Missing asset: " + file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  bytes += fs.statSync(source).size;
}
if (!fs.existsSync(path.join(out, "index.html")))
  throw new Error("index.html is not among the assets.");
console.log(
  `Site: ${assets.length + 1} files, ${(bytes / 1048576).toFixed(1)} MB -> ${path.relative(root, out) || "."}`,
);
