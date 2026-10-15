const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  F = require("../calibration-features.js"),
  C = require("../calibration-overlap.js");
function texture(seed, width = 320, height = 256, hidden = false) {
  let state = seed;
  const cells = new Uint8Array(Math.ceil(width / 5) * Math.ceil(height / 5));
  for (let i = 0; i < cells.length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    cells[i] = 30 + ((state >>> 0) % 200);
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        v =
          hidden && x > width * 0.55
            ? 128
            : cells[
                Math.floor(y / 5) * Math.ceil(width / 5) + Math.floor(x / 5)
              ];
      pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
      pixels[i + 3] = 255;
    }
  return { width, height, pixels, pose: { yaw: 0, pitch: 0, fov: 80 } };
}
for (const seed of [1, 7, 31, 97])
  test(`Shared-region seed ${seed}: opaque wall hides the right half of a textured reference`, () => {
    const source = texture(seed),
      target = texture(seed, 320, 256, true),
      points = C.find(source, [target], F.detect);
    assert.ok(
      points.length >= 4,
      "Actual shared texture must supply reference points",
    );
    assert.ok(
      points.every(
        (p) =>
          p.x < source.width * 0.55 && p.rightPoint.x < target.width * 0.55,
      ),
      "No automatic point may lie behind the occluding half",
    );
    assert.ok(
      points.every((p) => p.evidence.inliers >= 8 && p.similarity >= 0.75),
    );
  });
for (const seed of [2, 11, 37, 83])
  test(`Unrelated rooms seed ${seed}: texture and corners alone never justify automatic points`, () => {
    const points = C.find(texture(seed), [texture(seed + 10000)], F.detect);
    assert.equal(points.length, 0);
  });
test("Blank images cannot fabricate a confirmed overlap", () => {
  const source = texture(4),
    target = texture(5);
  target.pixels.fill(120);
  assert.equal(C.find(source, [target], F.detect).length, 0);
});
test("Shared-region estimation is deterministic and preserves source pixels", () => {
  const source = texture(16),
    target = texture(16, 320, 256, true),
    before = Buffer.from(source.pixels);
  const first = C.find(source, [target], F.detect).map(({ target, ...p }) => p),
    second = C.find(source, [target], F.detect).map(({ target, ...p }) => p);
  assert.deepEqual(first, second);
  assert.deepEqual(Buffer.from(source.pixels), before);
});

for (const scale of [0.9, 1.1])
  test(`Scaled common surface ${scale}: translated image and an occluding wall restrict the supported region`, () => {
    const source = texture(62),
      target = texture(99);
    target.pixels.fill(128);
    const tx = 17,
      ty = 9,
      cut = source.width * 0.58;
    for (let y = 0; y < target.height; y++)
      for (let x = 0; x < target.width; x++) {
        const sx = (x - tx) / scale,
          sy = (y - ty) / scale;
        if (sx < 0 || sy < 0 || sx >= cut || sy >= source.height) continue;
        const i = (y * target.width + x) * 4,
          j = (Math.floor(sy) * source.width + Math.floor(sx)) * 4;
        for (let k = 0; k < 3; k++) target.pixels[i + k] = source.pixels[j + k];
        target.pixels[i + 3] = 255;
      }
    const points = C.find(source, [target], F.detect);
    assert.ok(
      points.length >= 4,
      "The overlapping textured surface remains usable after viewpoint scale changes",
    );
    for (const p of points) {
      assert.ok(p.x < cut, "Source point must not be hidden by the wall");
      assert.ok(
        Math.hypot(
          p.rightPoint.x - (p.x * scale + tx),
          p.rightPoint.y - (p.y * scale + ty),
        ) < 3,
        "Right hint agrees with independent image geometry",
      );
    }
  });
test("Repeated wall tiles cannot supply distinct reciprocal feature matches", () => {
  const source = texture(1);
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const i = (y * source.width + x) * 4,
        v = ((Math.floor(x / 12) + Math.floor(y / 12)) % 2) * 220;
      source.pixels[i] = source.pixels[i + 1] = source.pixels[i + 2] = v;
    }
  assert.equal(
    C.find(source, [{ ...source, pixels: source.pixels.slice() }], F.detect)
      .length,
    0,
  );
});
test("Collinear and insufficient image matches cannot define a shared area", () => {
  for (const n of [4, 7, 20]) {
    const a = Array.from({ length: n }, (_, i) => ({ x: 10 + i * 8, y: 50 })),
      b = a.map((p) => ({ x: p.x + 10, y: 60 }));
    assert.equal(
      C.model(
        a,
        b,
        a.map((_, i) => ({ i, j: i, distance: 0 })),
      ).H,
      undefined,
    );
  }
});
