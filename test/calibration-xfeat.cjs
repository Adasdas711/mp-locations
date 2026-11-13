const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const X = require("../calibration-xfeat.js"),
  A = require("../calibration-auto.js"),
  reference = require("./support/xfeat-reference.json"),
  model = X.load(
    fs.readFileSync(path.join(__dirname, "../vendor/xfeat/xfeat-backbone.bin")),
  );
// Reference values were computed by the PyTorch XFeat model (float32 weights).
test("JavaScript XFeat backbone reproduces the reference network outputs", () => {
  const gray = new Float32Array(64 * 64).map((_, i) => (i * 37) % 251),
    out = X.forward(model, gray, 64, 64),
    pick = (t) => {
      const r = [];
      for (let c = 0; c < t.c; c++)
        for (let y = 0; y < t.h; y += 3)
          for (let x = 0; x < t.w; x += 3)
            r.push(t.data[c * t.h * t.w + y * t.w + x]);
      return r.slice(0, 200);
    };
  for (const [name, values, tolerance] of [
    ["feats", pick(out.feats), 0.003],
    ["kp", pick(out.logits), 0.03],
    ["heat", Array.from(out.heat.data), 0.0005],
  ])
    reference[name].forEach((v, i) =>
      assert.ok(
        Math.abs(values[i] - v) <= tolerance,
        `${name}[${i}] ${values[i]} vs ${v}`,
      ),
    );
  assert.throws(() => X.forward(model, gray, 60, 64), /multiples of 32/);
});
test("Keypoints and descriptors match the reference extractor", () => {
  const pixels = new Float32Array(128 * 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++)
      pixels[y * 128 + x] = Math.fround(
        Math.sin(x * 0.31) * Math.cos(y * 0.17) * 80 +
          (((x >> 4) + (y >> 4)) % 2) * 90 +
          ((x * 7 + y * 13) % 23) * 2 +
          40,
      );
  const result = X.detect(
      model,
      { width: 128, height: 128, pixels },
      { topK: 64 },
    ),
    expected = reference.detect.keypoints.map(([x, y]) => `${x},${y}`),
    found = new Map(result.points.map((p, i) => [`${p.x},${p.y}`, i]));
  const common = expected.filter((k) => found.has(k));
  assert.ok(common.length >= 60, `only ${common.length} of 64 keypoints agree`);
  for (const [i, k] of expected.entries()) {
    if (!found.has(k)) continue;
    const j = found.get(k);
    reference.detect.descriptors8[i].forEach((v, c) =>
      assert.ok(
        Math.abs(result.descriptors[j * 64 + c] - v) < 0.02,
        `descriptor ${k}[${c}]`,
      ),
    );
  }
  for (let i = 0; i < result.points.length; i++) {
    let n = 0;
    for (let c = 0; c < 64; c++) n += result.descriptors[i * 64 + c] ** 2;
    assert.ok(Math.abs(n - 1) < 1e-4);
  }
  // A photograph matched with itself yields mutual identity correspondences.
  const self = X.match(result, result);
  assert.equal(self.length, result.points.length);
  assert.ok(self.every((m) => m.i === m.j));
});
test("Loop verification accepts closed triangles and rejects inconsistent pairs", () => {
  // Cameras on a right triangle, all yaw 0 except c (rotated 90°).
  const camera = { a: [0, 0, 0], b: [2, 0, 0], c: [0, 0, -2] },
    yaw = { a: 0, b: 0, c: 90 },
    bearingYaw = (v) => (Math.atan2(-v[0], -v[2]) * 180) / Math.PI,
    estimate = (p, q) => {
      const d = camera[q].map((v, i) => v - camera[p][i]);
      return {
        a: p,
        b: q,
        relYaw: yaw[q] - yaw[p],
        dir: bearingYaw(d) - yaw[p],
      };
    };
  const good = [estimate("a", "b"), estimate("b", "c"), estimate("a", "c")];
  let result = A.verifyCycles(good);
  assert.equal(result.triangles, 1);
  assert.equal(result.verified.size, 3);
  // A wrong rotation on one pair or a reversed baseline breaks the loop.
  for (const broken of [
    { ...good[1], relYaw: good[1].relYaw + 20 },
    { ...good[1], dir: good[1].dir + 180 },
  ]) {
    result = A.verifyCycles([good[0], broken, good[2]]);
    assert.equal(result.verified.size, 0, JSON.stringify(broken));
  }
  // Without a third pair nothing can be verified.
  assert.equal(A.verifyCycles(good.slice(0, 2)).verified.size, 0);
});
