#!/usr/bin/env node
// Summarise failed tests from a node:test TAP log as Markdown:
//   node scripts/tap-summary.cjs test-output.tap
// Prints each failing test with its location and the first lines of its error.
"use strict";
const fs = require("node:fs");
const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log("No test log found.");
  process.exit(0);
}
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
const failures = [];
for (let i = 0; i < lines.length; i++) {
  const match = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
  if (!match) continue;
  const indent = match[1].length,
    details = [];
  // The YAML diagnostic block follows, indented by two more spaces, up to "...".
  for (let j = i + 1; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === "...") break;
    if (/^\s*(not )?ok \d+ /.test(line)) break;
    if (line.slice(0, indent + 2).trim() === "" && line.trim())
      details.push(line.slice(indent + 2));
  }
  const pick = (key) => {
    const at = details.findIndex((d) => d.startsWith(key + ":"));
    if (at < 0) return [];
    const first = details[at].slice(key.length + 1).trim(),
      rest = [];
    for (let k = at + 1; k < details.length && /^\s/.test(details[k]); k++)
      rest.push(details[k].trim());
    return [first.replace(/^\|-?$/, ""), ...rest].filter(Boolean);
  };
  failures.push({
    name: match[2],
    nested: indent > 0,
    location: pick("location").join(" ").replace(/^'|'$/g, ""),
    error: pick("error").slice(0, 8),
    // first frames inside the test files show which step failed
    at: pick("stack")
      .filter((line) => /\/test\/[^/]+\.cjs:\d+/.test(line))
      .slice(0, 2)
      .map((line) => line.replace(/^.*?\/(test\/[^)]+)\)?$/, "$1")),
  });
}
const top = failures.filter((f) => !f.nested);
const summary = lines
  .filter((l) => /^# (tests|pass|fail|cancelled|skipped) /.test(l))
  .join(" · ");
console.log(`### Failed tests (${top.length})\n`);
if (summary) console.log(summary.replace(/# /g, "") + "\n");
for (const f of top) {
  console.log(`- **${f.name}**${f.location ? ` — \`${f.location}\`` : ""}`);
  if (f.at.length)
    console.log(`  at ${f.at.map((a) => "`" + a + "`").join(", ")}`);
  if (f.error.length)
    console.log("  ```\n  " + f.error.join("\n  ") + "\n  ```");
}
if (!top.length) console.log("No failing tests were reported in the log.");
