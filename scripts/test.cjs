// Serve the actual application on an ephemeral loopback port for browser regression tests.
const path = require("node:path");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const { createAppServer } = require("../test/support/server.cjs");
const server = createAppServer();
// PALACE_TEST_FILES=a.cjs,b.cjs limits the run; PALACE_SHARD=i/n runs one of
// n balanced parts (files assigned greedily by size, largest first), so CI
// can split the suite over parallel jobs without losing or repeating files.
function selectedFiles() {
  const fsSync = require("node:fs"),
    dir = path.join(root, "test");
  let files = fsSync
    .readdirSync(dir)
    .filter(
      (file) =>
        file.endsWith(".cjs") &&
        (!process.env.PALACE_TEST_FILES ||
          process.env.PALACE_TEST_FILES.split(",").includes(file)),
    )
    .sort();
  const shard = /^(\d+)\/(\d+)$/.exec(process.env.PALACE_SHARD || "");
  if (process.env.PALACE_SHARD && !shard)
    throw new Error("PALACE_SHARD must look like 1/3");
  if (shard) {
    const index = Number(shard[1]),
      count = Number(shard[2]);
    if (!(count >= 1 && index >= 1 && index <= count))
      throw new Error("PALACE_SHARD out of range: " + process.env.PALACE_SHARD);
    const load = new Array(count).fill(0),
      parts = Array.from({ length: count }, () => []);
    for (const file of [...files].sort(
      (a, b) =>
        fsSync.statSync(path.join(dir, b)).size -
          fsSync.statSync(path.join(dir, a)).size || a.localeCompare(b),
    )) {
      const lightest = load.indexOf(Math.min(...load));
      parts[lightest].push(file);
      load[lightest] += fsSync.statSync(path.join(dir, file)).size;
    }
    files = parts[index - 1].sort();
  }
  return files;
}
server.listen(0, "127.0.0.1", () => {
  const child = spawn(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-concurrency=2",
      ...selectedFiles().map((file) => "test/" + file),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        PALACE_TEST_URL: `http://127.0.0.1:${server.address().port}`,
      },
    },
  );
  child.on("error", (error) => {
    console.error(error);
    server.close();
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    server.close();
    process.exitCode = code ?? 1;
  });
});
