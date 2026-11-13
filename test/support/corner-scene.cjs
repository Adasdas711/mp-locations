// Ray-cast perspective samples of a textured room corner from known camera
// positions. Two non-coplanar walls plus a floor give independent surfaces.
const DEG = Math.PI / 180;
function ray(yaw, pitch) {
  return [
    -Math.sin(yaw * DEG) * Math.cos(pitch * DEG),
    Math.sin(pitch * DEG),
    -Math.cos(yaw * DEG) * Math.cos(pitch * DEG),
  ];
}
function angles(v) {
  const n = Math.hypot(...v);
  return {
    yaw: (((Math.atan2(-v[0], -v[2]) / DEG) % 360) + 360) % 360,
    pitch: Math.asin(v[1] / n) / DEG,
  };
}
// Same pixel convention as PalaceCalibrationOverlap.bearing.
function pixelRay({ width, height, pose }, x, y) {
  const f = Math.tan((pose.fov * Math.PI) / 360),
    v = [
      (((((x + 0.5) / width) * 2 - 1) * width) / height) * f,
      (1 - ((y + 0.5) / height) * 2) * f,
      -1,
    ],
    pitch = pose.pitch * DEG,
    yaw = pose.yaw * DEG,
    py = Math.cos(pitch) * v[1] - Math.sin(pitch) * v[2],
    z = Math.sin(pitch) * v[1] + Math.cos(pitch) * v[2],
    px = Math.cos(yaw) * v[0] + Math.sin(yaw) * z,
    pz = -Math.sin(yaw) * v[0] + Math.cos(yaw) * z,
    n = Math.hypot(px, py, pz);
  return [px / n, py / n, pz / n];
}
const surfaces = [
  // back wall z=-4, right wall x=2, floor y=-1.4
  {
    axis: 2,
    value: -4,
    u: 0,
    v: 1,
    seed: 11,
    bounds: (p) => p[0] <= 2 && p[0] >= -5 && p[1] >= -1.4 && p[1] <= 2,
  },
  {
    axis: 0,
    value: 2,
    u: 2,
    v: 1,
    seed: 23,
    bounds: (p) => p[2] >= -4 && p[2] <= 1 && p[1] >= -1.4 && p[1] <= 2,
  },
  {
    axis: 1,
    value: -1.4,
    u: 0,
    v: 2,
    seed: 41,
    bounds: (p) => p[0] <= 2 && p[0] >= -5 && p[2] >= -4 && p[2] <= 1,
  },
];
function hash(a, b, seed) {
  let h = (a * 73856093) ^ (b * 19349663) ^ (seed * 83492791);
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return (h >>> 0) % 190;
}
function intersect(C, d) {
  let best = null;
  for (const s of surfaces) {
    if (Math.abs(d[s.axis]) < 1e-9) continue;
    const t = (s.value - C[s.axis]) / d[s.axis];
    if (!(t > 0) || (best && t >= best.t)) continue;
    const p = [C[0] + t * d[0], C[1] + t * d[1], C[2] + t * d[2]];
    if (s.bounds(p)) best = { t, p, s };
  }
  return best;
}
function render(C, pose, size = 384) {
  const sample = {
    width: size,
    height: size,
    pose,
    pixels: new Uint8Array(size * size * 4),
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hit = intersect(C, pixelRay(sample, x, y)),
        i = (y * size + x) * 4,
        value = hit
          ? 40 +
            hash(
              Math.floor(hit.p[hit.s.u] * 7),
              Math.floor(hit.p[hit.s.v] * 7),
              hit.s.seed,
            )
          : 20;
      sample.pixels[i] = sample.pixels[i + 1] = sample.pixels[i + 2] = value;
      sample.pixels[i + 3] = 255;
    }
  return sample;
}
// Ground truth: where a reference bearing from A appears from B.
function project(A, B, bearing) {
  const hit = intersect(A, ray(bearing.yaw, bearing.pitch));
  if (!hit) return null;
  return {
    ...angles([hit.p[0] - B[0], hit.p[1] - B[1], hit.p[2] - B[2]]),
    surface: hit.s.seed,
    point: hit.p,
  };
}
function separation(a, b) {
  const p = ray(a.yaw, a.pitch),
    q = ray(b.yaw, b.pitch);
  return (
    Math.acos(
      Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])),
    ) / DEG
  );
}
// Equirectangular grayscale panorama in the photographic fixture convention.
function renderEquirect(C, width = 2048, height = 1024) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const theta = ((y + 0.5) / height) * Math.PI,
        phi = ((x + 0.5) / width) * 2 * Math.PI,
        hit = intersect(C, [
          Math.cos(phi) * Math.sin(theta),
          Math.cos(theta),
          Math.sin(phi) * Math.sin(theta),
        ]);
      gray[y * width + x] = hit
        ? 40 +
          hash(
            Math.floor(hit.p[hit.s.u] * 7),
            Math.floor(hit.p[hit.s.v] * 7),
            hit.s.seed,
          )
        : 20;
    }
  return gray;
}
module.exports = {
  render,
  renderEquirect,
  project,
  separation,
  ray,
  angles,
};
