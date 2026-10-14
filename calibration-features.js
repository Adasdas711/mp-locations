/* Image corners for guided panorama matching. Suggestions are not correspondences. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PalaceCalibrationFeatures = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  function detect({ width, height, pixels, count = 20, separation = 0.095 }) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width * height > 262144 ||
      pixels?.length !== width * height * 4
    )
      throw new Error("Invalid reference image sample.");
    count = Math.max(1, Math.min(128, Math.floor(count)));
    const n = width * height,
      gray = new Float32Array(n),
      xx = new Float64Array(n),
      xy = new Float64Array(n),
      yy = new Float64Array(n),
      score = new Float32Array(n);
    for (let i = 0; i < n; i++)
      gray[i] =
        pixels[i * 4] * 0.299 +
        pixels[i * 4 + 1] * 0.587 +
        pixels[i * 4 + 2] * 0.114;
    for (let y = 1; y < height - 1; y++)
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x,
          gx = (gray[i + 1] - gray[i - 1]) / 2,
          gy = (gray[i + width] - gray[i - width]) / 2;
        xx[i] = gx * gx;
        xy[i] = gx * gy;
        yy[i] = gy * gy;
      }
    // Integral gradient products keep the local structure tensor calculation linear.
    for (const a of [xx, xy, yy])
      for (let y = 0; y < height; y++) {
        let row = 0;
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          row += a[i];
          a[i] = row + (y ? a[i - width] : 0);
        }
      }
    const box = (a, x, y) =>
      a[(y + 3) * width + x + 3] -
      a[(y - 4) * width + x + 3] -
      a[(y + 3) * width + x - 4] +
      a[(y - 4) * width + x - 4];
    const margin = Math.max(8, Math.ceil(Math.min(width, height) * 0.05));
    let peak = 0;
    for (let y = margin; y < height - margin; y++)
      for (let x = margin; x < width - margin; x++) {
        const a = box(xx, x, y) / 49,
          b = box(xy, x, y) / 49,
          c = box(yy, x, y) / 49,
          d = Math.hypot(a - c, 2 * b),
          s = (a + c - d) / 2;
        if (s < (a + c + d) * 0.075) continue;
        score[y * width + x] = s;
        if (s > peak) peak = s;
      }
    const candidates = [],
      threshold = Math.max(80, peak * 0.025);
    for (let y = margin; y < height - margin; y++)
      for (let x = margin; x < width - margin; x++) {
        const s = score[y * width + x];
        if (s < threshold) continue;
        let max = true;
        for (let dy = -3; dy <= 3 && max; dy++)
          for (let dx = -3; dx <= 3; dx++)
            if (
              score[(y + dy) * width + x + dx] > s ||
              (score[(y + dy) * width + x + dx] === s &&
                (dy < 0 || (dy === 0 && dx < 0)))
            ) {
              max = false;
              break;
            }
        if (max) candidates.push({ x, y, score: s });
      }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const selected = [];
    const distance = (a, b) =>
      Math.hypot(a.x - b.x, a.y - b.y) / Math.min(width, height);
    while (selected.length < count && candidates.length) {
      let best = -1,
        value = -1;
      for (let i = 0; i < candidates.length; i++) {
        const p = candidates[i],
          d = selected.length
            ? Math.min(...selected.map((q) => distance(p, q)))
            : 1;
        if (d < Math.max(0.025, Math.min(0.2, separation))) continue;
        const v = Math.sqrt(p.score / peak) * Math.min(d, 0.6);
        if (v > value) {
          value = v;
          best = i;
        }
      }
      if (best < 0) break;
      selected.push(candidates.splice(best, 1)[0]);
    }
    // Refine the intersection of image-gradient normals instead of pointing
    // several pixels inside the corner response's averaging window.
    return selected
      .map((p) => {
        let cx = p.x,
          cy = p.y;
        for (let iteration = 0; iteration < 12; iteration++) {
          let a = 0,
            b = 0,
            c = 0,
            bx = 0,
            by = 0;
          for (let y = Math.round(cy) - 5; y <= Math.round(cy) + 5; y++)
            for (let x = Math.round(cx) - 5; x <= Math.round(cx) + 5; x++) {
              if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
              const i = y * width + x,
                gx = (gray[i + 1] - gray[i - 1]) / 2,
                gy = (gray[i + width] - gray[i - width]) / 2,
                w = Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / 16),
                aa = w * gx * gx,
                bb = w * gx * gy,
                cc = w * gy * gy;
              a += aa;
              b += bb;
              c += cc;
              bx += aa * x + bb * y;
              by += bb * x + cc * y;
            }
          const det = a * c - b * b;
          if (det < 1e-6) break;
          const nx = (c * bx - b * by) / det,
            ny = (a * by - b * bx) / det;
          if (Math.hypot(nx - p.x, ny - p.y) > 6) break;
          const moved = Math.hypot(nx - cx, ny - cy);
          cx = nx;
          cy = ny;
          if (moved < 0.001) break;
        }
        return { ...p, x: cx, y: cy };
      })
      .filter(
        (p) =>
          p.x >= margin &&
          p.y >= margin &&
          p.x < width - margin &&
          p.y < height - margin,
      );
  }
  function describe(sample, point) {
    const { width, height, pixels } = sample,
      descriptors = [];
    for (const radius of [11, 17, 25, 35]) {
      if (
        point.x < radius * 2 ||
        point.y < radius * 2 ||
        point.x >= width - radius * 2 ||
        point.y >= height - radius * 2
      )
        continue;
      const values = [];
      let sum = 0;
      const levels = [];
      for (const extent of [radius, radius * 2]) {
        values.length = 0;
        sum = 0;
        for (let y = -3; y <= 3; y++)
          for (let x = -3; x <= 3; x++) {
            const px = point.x + (x * extent) / 3,
              py = point.y + (y * extent) / 3,
              ix = Math.floor(px),
              iy = Math.floor(py),
              fx = px - ix,
              fy = py - iy;
            const gray = (x, y) => {
              const i = (y * width + x) * 4;
              return (
                pixels[i] * 0.299 +
                pixels[i + 1] * 0.587 +
                pixels[i + 2] * 0.114
              );
            };
            const v =
              gray(ix, iy) * (1 - fx) * (1 - fy) +
              gray(ix + 1, iy) * fx * (1 - fy) +
              gray(ix, iy + 1) * (1 - fx) * fy +
              gray(ix + 1, iy + 1) * fx * fy;
            values.push(v);
            sum += v;
          }
        const mean = sum / values.length,
          norm = Math.hypot(...values.map((v) => v - mean));
        if (norm < 50) break;
        levels.push(values.map((v) => (v - mean) / norm));
      }
      if (levels.length === 2) {
        const histogram = new Array(128).fill(0),
          extent = radius * 2;
        const gray = (x, y) => {
          x = Math.max(0, Math.min(width - 1, Math.round(x)));
          y = Math.max(0, Math.min(height - 1, Math.round(y)));
          const i = (y * width + x) * 4;
          return (
            pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114
          );
        };
        for (let py = Math.ceil(point.y - extent); py < point.y + extent; py++)
          for (
            let px = Math.ceil(point.x - extent);
            px < point.x + extent;
            px++
          ) {
            const dx = (px - point.x) / extent,
              dy = (py - point.y) / extent,
              gx = gray(px + 1, py) - gray(px - 1, py),
              gy = gray(px, py + 1) - gray(px, py - 1),
              magnitude =
                Math.hypot(gx, gy) * Math.exp(-(dx * dx + dy * dy) * 2),
              angle = ((Math.atan2(gy, gx) / Math.PI) * 4 + 8) % 8,
              bin = Math.floor(angle),
              fraction = angle - bin,
              cx = (dx + 1) * 2 - 0.5,
              cy = (dy + 1) * 2 - 0.5,
              ix = Math.floor(cx),
              iy = Math.floor(cy);
            for (const x of [ix, ix + 1])
              for (const y of [iy, iy + 1]) {
                if (x < 0 || x >= 4 || y < 0 || y >= 4) continue;
                const base = (y * 4 + x) * 8,
                  weight = (1 - Math.abs(cx - x)) * (1 - Math.abs(cy - y));
                histogram[base + bin] += magnitude * (1 - fraction) * weight;
                histogram[base + ((bin + 1) % 8)] +=
                  magnitude * fraction * weight;
              }
          }
        const total = histogram.reduce((sum, v) => sum + v, 0);
        if (total < 1) continue;
        descriptors.push({
          pixels: [
            ...levels[0].map((v) => v * Math.sqrt(0.3)),
            ...levels[1].map((v) => v * Math.sqrt(0.7)),
          ],
          structure: histogram.map((v) => Math.sqrt(v / total)),
        });
      }
    }
    return descriptors;
  }
  function visibility(point, context = {}) {
    const { left, right, geometry, leftDepth, rightDepth } = context;
    if (!left || !right)
      return { visible: null, reason: "unknown-camera-poses" };
    const sub = (a, b) => a.map((v, i) => v - b[i]),
      add = (a, b) => a.map((v, i) => v + b[i]),
      mul = (a, s) => a.map((v) => v * s),
      dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
      cross = (a, b) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ],
      unit = (a) => mul(a, 1 / Math.hypot(...a));
    const rotate = (v, q, inverse = false) => {
      const r = [q.x, q.y, q.z].map((x) => (inverse ? -x : x)),
        a = cross(r, v),
        b = cross(r, a);
      return add(v, add(mul(a, 2 * q.w), mul(b, 2)));
    };
    const xyz = (p) => [p.x, p.y, p.z],
      yaw = (point.yaw * Math.PI) / 180,
      pitch = (point.pitch * Math.PI) / 180,
      origin = xyz(left.position),
      ray = rotate(
        [
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        ],
        left.rotation,
      );
    const hit = (o, d) => {
      if (!geometry) return null;
      let nearest = null;
      const ids =
        geometry.indices ||
        Array.from({ length: geometry.positions.length / 3 }, (_, i) => i);
      for (let i = 0; i < ids.length; i += 3) {
        const a = geometry.positions.slice(ids[i] * 3, ids[i] * 3 + 3),
          b = geometry.positions.slice(ids[i + 1] * 3, ids[i + 1] * 3 + 3),
          c = geometry.positions.slice(ids[i + 2] * 3, ids[i + 2] * 3 + 3),
          e1 = sub(b, a),
          e2 = sub(c, a),
          p = cross(d, e2),
          det = dot(e1, p);
        if (Math.abs(det) < 1e-9) continue;
        const t = sub(o, a),
          u = dot(t, p) / det;
        if (u < 0 || u > 1) continue;
        const q = cross(t, e1),
          v = dot(d, q) / det;
        if (v < 0 || u + v > 1) continue;
        const distance = dot(e2, q) / det;
        if (distance > 1e-5 && (!nearest || distance < nearest.distance))
          nearest = { distance, normal: unit(cross(e1, e2)) };
      }
      return nearest;
    };
    const depth = (map, p) => {
      if (!map) return null;
      const x =
          Math.floor(((((p.yaw % 360) + 360) % 360) / 360) * map.width) %
          map.width,
        y = Math.max(
          0,
          Math.min(
            map.height - 1,
            Math.round(((90 - p.pitch) / 180) * (map.height - 1)),
          ),
        ),
        value = map.data[y * map.width + x];
      return value > 0 ? value * (map.scale || 1) : null;
    };
    const first = hit(origin, ray),
      sourceDepth = depth(leftDepth, point),
      distance = sourceDepth ?? first?.distance;
    if (
      sourceDepth &&
      first &&
      first.distance < sourceDepth - Math.max(0.02, sourceDepth * 0.01)
    )
      return { visible: false, reason: "source-occlusion" };
    if (!distance) return { visible: null, reason: "unknown-point-depth" };
    const position = add(origin, mul(ray, distance)),
      other = xyz(right.position),
      delta = sub(position, other),
      range = Math.hypot(...delta);
    if (range < 0.001) return { visible: false, reason: "camera-at-landmark" };
    const targetRay = unit(delta),
      blocker = hit(other, targetRay),
      tolerance = Math.max(0.02, range * 0.01);
    if (blocker && blocker.distance < range - tolerance)
      return { visible: false, reason: "wall-occlusion" };
    if (
      first &&
      !sourceDepth &&
      dot(sub(origin, position), first.normal) *
        dot(sub(other, position), first.normal) <
        -1e-6
    )
      return { visible: false, reason: "opposite-wall-face" };
    const local = rotate(targetRay, right.rotation, true),
      rightHint = {
        yaw: ((Math.atan2(-local[0], -local[2]) * 180) / Math.PI + 360) % 360,
        pitch: (Math.asin(Math.max(-1, Math.min(1, local[1]))) * 180) / Math.PI,
      },
      targetDepth = depth(rightDepth, rightHint);
    if (targetDepth && targetDepth < range - Math.max(0.03, range * 0.02))
      return { visible: false, reason: "depth-occlusion" };
    return {
      visible: !!geometry || !!targetDepth ? true : null,
      reason:
        geometry || targetDepth
          ? "geometry-supported"
          : "unverified-target-depth",
      rightHint,
    };
  }
  function matchVisible({ reference, targets, count = 24, geometryContext }) {
    const source = detect({ ...reference, count }),
      target = [];
    const ray = (p) => {
      const y = (p.yaw * Math.PI) / 180,
        t = (p.pitch * Math.PI) / 180;
      return [
        -Math.sin(y) * Math.cos(t),
        Math.sin(t),
        -Math.cos(y) * Math.cos(t),
      ];
    };
    const bearing = (sample, p) => {
      const { pose = { yaw: 0, pitch: 0, fov: 90 }, width, height } = sample,
        f = Math.tan((pose.fov * Math.PI) / 360),
        v = [
          (((((p.x + 0.5) / width) * 2 - 1) * width) / height) * f,
          (1 - ((p.y + 0.5) / height) * 2) * f,
          -1,
        ],
        pitch = (pose.pitch * Math.PI) / 180,
        yaw = (pose.yaw * Math.PI) / 180;
      const y = Math.cos(pitch) * v[1] - Math.sin(pitch) * v[2],
        z = Math.sin(pitch) * v[1] + Math.cos(pitch) * v[2],
        x = Math.cos(yaw) * v[0] + Math.sin(yaw) * z,
        zz = -Math.sin(yaw) * v[0] + Math.cos(yaw) * z,
        n = Math.hypot(x, y, zz);
      return {
        yaw: ((Math.atan2(-x, -zz) * 180) / Math.PI + 360) % 360,
        pitch: (Math.asin(y / n) * 180) / Math.PI,
      };
    };
    for (const sample of targets) {
      for (const p of detect({ ...sample, count: 96, separation: 0.035 })) {
        const pose = bearing(sample, p),
          direction = ray(pose),
          descriptors = describe(sample, p);
        if (!descriptors.length) continue;
        const old = target.find(
          (q) =>
            q.ray.reduce((s, v, i) => s + v * direction[i], 0) >
            Math.cos((3 * Math.PI) / 180),
        );
        if (old) {
          old.descriptors.push(...descriptors);
          continue;
        }
        target.push({ pose, ray: direction, descriptors });
      }
    }
    const similarity = (a, b) => {
      let best = -1;
      for (const x of a)
        for (const y of b) {
          let dot = 0,
            structure = 0;
          for (let i = 0; i < x.pixels.length; i++)
            dot += x.pixels[i] * y.pixels[i];
          for (let i = 0; i < x.structure.length; i++)
            structure += x.structure[i] * y.structure[i];
          if (dot < 0.7 || structure < 0.87) continue;
          const score = 0.35 * dot + 0.65 * structure;
          if (score > best) best = score;
        }
      return best;
    };
    const descriptions = source.map((p) => describe(reference, p)),
      scores = descriptions.map((d) =>
        target.map((t) => similarity(d, t.descriptors)),
      ),
      accepted = [];
    for (let i = 0; i < source.length; i++) {
      const check = visibility(bearing(reference, source[i]), geometryContext);
      if (check.visible === false) continue;
      if (check.visible === true) {
        accepted.push({
          ...source[i],
          rightHint: check.rightHint,
          visibility: "geometry-supported",
        });
        continue;
      }
      const ranked = scores[i]
          .map((score, j) => ({ score, j }))
          .sort((a, b) => b.score - a.score),
        first = ranked[0],
        second = ranked[1];
      if (
        !first ||
        first.score < 0.9 ||
        (second &&
          (1 - first.score > 0.8 * (1 - second.score) ||
            first.score - second.score < 0.025))
      )
        continue;
      const reverse = scores
        .map((row, index) => ({ index, score: row[first.j] }))
        .sort((a, b) => b.score - a.score);
      if (reverse[0]?.index !== i) continue;
      accepted.push({
        ...source[i],
        rightHint: target[first.j].pose,
        similarity: first.score,
        visibility: "image-supported",
      });
    }
    return accepted;
  }
  function start(sample) {
    let worker,
      url,
      settled = false,
      rejectTask;
    const promise = new Promise((resolve, reject) => {
      rejectTask = reject;
      const finish = (error, points) => {
        if (settled) return;
        settled = true;
        worker?.terminate();
        if (url) URL.revokeObjectURL(url);
        error ? reject(error) : resolve(points);
      };
      try {
        url = URL.createObjectURL(
          new Blob(
            [
              "const detect=" +
                detect.toString() +
                ";const describe=" +
                describe.toString() +
                ";const visibility=" +
                visibility.toString() +
                ";const matchVisible=" +
                matchVisible.toString() +
                ";onmessage=e=>{try{postMessage({points:e.data.reference?matchVisible(e.data):detect(e.data)})}catch(error){postMessage({error:error.message})}}",
            ],
            { type: "text/javascript" },
          ),
        );
        worker = new Worker(url);
        worker.onmessage = (e) =>
          finish(e.data.error ? new Error(e.data.error) : null, e.data.points);
        worker.onerror = () =>
          finish(new Error("Unable to analyze panorama details."));
        worker.postMessage(
          sample,
          sample.reference
            ? [
                sample.reference.pixels.buffer,
                ...sample.targets.map((t) => t.pixels.buffer),
              ]
            : [sample.pixels.buffer],
        );
      } catch (error) {
        finish(error);
      }
    });
    return {
      promise,
      cancel() {
        if (settled) return;
        settled = true;
        worker?.terminate();
        if (url) URL.revokeObjectURL(url);
        rejectTask(new Error("Point suggestion cancelled."));
      },
    };
  }
  return Object.freeze({ detect, matchVisible, visibility, start });
});
