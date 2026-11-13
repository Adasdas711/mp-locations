#!/usr/bin/env node
// Headless batch calibration: opens an archive in the real application,
// runs the calibration autopilot and writes a JSON report and, optionally,
// the calibrated project (.mpalace).
//
//   node scripts/auto-calibrate.cjs <archive.3dview|.mpalace|.mplace>
//     [--out calibrated.mpalace] [--report report.json] [--apply]
//     [--pairs auto|links|all] [--free] [--min-pair-matches 8]
//
// Exit status: 0 when every group solved (and applied with --apply),
// 2 when the run finished with unsolved groups or unmatched panoramas,
// 1 on errors.
"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".wasm": "application/wasm",
};
function parse(argv) {
  const options = { pairs: "auto", apply: false, orientationModel: "upright" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i],
      value = () => {
        if (i + 1 >= argv.length) throw new Error(arg + " needs a value");
        return argv[++i];
      };
    if (arg === "--out") options.out = value();
    else if (arg === "--report") options.report = value();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--free") options.orientationModel = "free";
    else if (arg === "--pairs") options.pairs = value();
    else if (arg === "--min-pair-matches")
      options.minPairMatches = Number(value());
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--")) throw new Error("Unknown option " + arg);
    else rest.push(arg);
  }
  if (!["auto", "links", "all"].includes(options.pairs))
    throw new Error("--pairs must be auto, links or all");
  options.input = rest[0];
  return options;
}
function serve() {
  const server = http.createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(
          new URL(request.url, "http://localhost").pathname,
        ),
        file = path.resolve(
          root,
          "." + pathname + (pathname.endsWith("/") ? "index.html" : ""),
        );
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(403);
        return response.end();
      }
      const data = fs.readFileSync(file);
      response.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      });
      response.end(data);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}
async function main() {
  const options = parse(process.argv.slice(2));
  if (options.help || !options.input) {
    console.log(
      fs
        .readFileSync(__filename, "utf8")
        .split("\n")
        .slice(1, 12)
        .map((l) => l.replace(/^\/\/ ?/, ""))
        .join("\n"),
    );
    return options.help ? 0 : 1;
  }
  const input = path.resolve(options.input);
  if (!fs.existsSync(input)) throw new Error("No such file: " + input);
  const { launchBrowser } = require("../test/support/browser.cjs");
  const server = await serve(),
    browser = await launchBrowser();
  try {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(0);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {
      waitUntil: "networkidle",
    });
    await page.locator("#fileOpen").setInputFiles(input);
    await page.waitForFunction(
      (name) => archiveContext?.name === name && !calibrationUI.importing,
      path.basename(input),
      { timeout: 300000 },
    );
    await page.evaluate(() => {
      if (state.mode !== "edit") {
        state.mode = "edit";
        applyMode();
      }
    });
    await page.exposeFunction("autoCalibrateProgress", (line) =>
      process.stderr.write(line + "\n"),
    );
    const report = await page.evaluate(
      (options) =>
        PalaceCalibrationAutopilot.run({
          ...options,
          onProgress: (info) => {
            if (info.phase === "matching")
              autoCalibrateProgress(
                `matching ${info.done + 1}/${info.total} ${info.pair.join(" ↔ ")}`,
              );
            else if (info.phase !== "sampling" && info.phase !== "done")
              autoCalibrateProgress(
                info.phase + (info.group ? " group " + info.group : ""),
              );
          },
        }),
      {
        pairs: options.pairs,
        apply: options.apply,
        orientationModel: options.orientationModel,
        minPairMatches: options.minPairMatches,
      },
    );
    report.input = path.basename(input);
    report.pageErrors = errors;
    if (
      options.out &&
      !(await page.evaluate(
        () =>
          state.levels.length > 0 && Object.keys(state.panoramas || {}).length,
      ))
    )
      report.outputSkipped =
        "A .mpalace project needs at least one floor plan and local panoramas.";
    else if (options.out) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 300000 }),
        page.evaluate(() => saveMpalace()),
      ]);
      await download.saveAs(path.resolve(options.out));
      report.output = path.basename(options.out);
    }
    const json = JSON.stringify(report, null, 2);
    if (options.report) fs.writeFileSync(path.resolve(options.report), json);
    else console.log(json);
    const summary = await page.evaluate(
      (r) => PalaceCalibrationAutopilot.summary(r),
      report,
    );
    process.stderr.write(summary + "\n");
    const complete =
      report.groups.length > 0 &&
      report.groups.every(
        (g) => g.status === "solved" && (!options.apply || g.applied),
      ) &&
      !report.unmatchedPanoramas.length;
    return complete ? 0 : 2;
  } finally {
    await browser.close();
    server.close();
  }
}
main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
