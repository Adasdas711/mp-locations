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
    const unknown = (reason, extra = {}) => ({
      visible: null,
      reason,
      ...extra,
    });
    const validPose = (p) =>
      p &&
      [
        p.position?.x,
        p.position?.y,
        p.position?.z,
        p.rotation?.x,
        p.rotation?.y,
        p.rotation?.z,
        p.rotation?.w,
      ].every(Number.isFinite);
    if (!validPose(left) || !validPose(right))
      return unknown("unknown-camera-poses");
    if (
      !Number.isFinite(point?.yaw) ||
      !Number.isFinite(point?.pitch) ||
      Math.abs(point.pitch) > 90
    )
      return unknown("invalid-bearing");
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
      const n = Math.hypot(q.x, q.y, q.z, q.w);
      if (n < 1e-12) return [NaN, NaN, NaN];
      const r = [q.x, q.y, q.z].map((x) => (x / n) * (inverse ? -1 : 1)),
        a = cross(r, v),
        b = cross(r, a);
      return add(v, add(mul(a, (2 * q.w) / n), mul(b, 2)));
    };
    const xyz = (p) => [p.x, p.y, p.z],
      yaw = (point.yaw * Math.PI) / 180,
      pitch = (point.pitch * Math.PI) / 180,
      origin = xyz(left.position),
      other = xyz(right.position),
      ray = rotate(
        [
          -Math.sin(yaw) * Math.cos(pitch),
          Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        ],
        left.rotation,
      );
    if (!ray.every(Number.isFinite)) return unknown("invalid-camera-rotation");
    // Tolerances scale with the reconstruction, including non-metric projects.
    const baseline = Math.hypot(...sub(origin, other)),
      epsilon = Math.max(1e-9, baseline * 1e-7),
      metersPerUnit = context.units === "meters" ? 1 : context.metersPerUnit;
    const surfaceTolerance = (distance) => Math.max(epsilon, distance * 1e-4),
      depthTolerance = (distance) =>
        Math.max(
          epsilon,
          distance * 0.02,
          Number.isFinite(metersPerUnit) && metersPerUnit > 0
            ? 0.015 / metersPerUnit
            : 0,
        );
    const hit = (o, d) => {
      if (!geometry?.positions?.length) return null;
      let nearest = null;
      const ids =
        geometry.indices ||
        Array.from({ length: geometry.positions.length / 3 }, (_, i) => i);
      for (let i = 0; i + 2 < ids.length; i += 3) {
        const a = geometry.positions.slice(ids[i] * 3, ids[i] * 3 + 3),
          b = geometry.positions.slice(ids[i + 1] * 3, ids[i + 1] * 3 + 3),
          c = geometry.positions.slice(ids[i + 2] * 3, ids[i + 2] * 3 + 3),
          e1 = sub(b, a),
          e2 = sub(c, a),
          p = cross(d, e2),
          det = dot(e1, p),
          area = Math.hypot(...cross(e1, e2));
        if (!Number.isFinite(det) || area === 0 || Math.abs(det) < area * 1e-10)
          continue;
        const t = sub(o, a),
          u = dot(t, p) / det;
        if (u < -1e-8 || u > 1 + 1e-8) continue;
        const q = cross(t, e1),
          v = dot(d, q) / det;
        if (v < -1e-8 || u + v > 1 + 1e-8) continue;
        const distance = dot(e2, q) / det;
        if (distance > epsilon && (!nearest || distance < nearest.distance))
          nearest = {
            distance,
            normal: unit(cross(e1, e2)),
            triangle: i,
            vertices: [a, b, c],
            barycentric: [1 - u - v, u, v],
          };
      }
      return nearest;
    };
    const boundary = (surface) => {
      const area = Math.hypot(
          ...cross(
            sub(surface.vertices[1], surface.vertices[0]),
            sub(surface.vertices[2], surface.vertices[0]),
          ),
        ),
        margin = Math.max(epsilon * 4, surface.distance * 0.005),
        edges = surface.barycentric.flatMap((weight, i) => {
          const other = surface.vertices.filter((_, j) => j !== i),
            height = area / Math.hypot(...sub(other[0], other[1]));
          return weight * height <= margin ? [i] : [];
        });
      if (!edges.length) return false;
      // A vertex or exposed edge may be visible around a doorway. An internal
      // triangulation seam is not a physical boundary of the opaque wall.
      if (edges.length > 1) return true;
      const endpoints = surface.vertices.filter((_, i) => i !== edges[0]),
        ids =
          geometry.indices ||
          Array.from({ length: geometry.positions.length / 3 }, (_, i) => i),
        same = (a, b) => Math.hypot(...sub(a, b)) <= epsilon * 4;
      for (let i = 0; i + 2 < ids.length; i += 3) {
        if (i === surface.triangle) continue;
        const vertices = Array.from(ids.slice(i, i + 3), (id) =>
          geometry.positions.slice(id * 3, id * 3 + 3),
        );
        if (!endpoints.every((p) => vertices.some((q) => same(p, q)))) continue;
        const n = unit(
          cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])),
        );
        if (Math.abs(dot(n, surface.normal)) > 0.99999) return false;
      }
      return true;
    };
    const depth = (map, p) => {
      if (
        !map ||
        !Number.isInteger(map.width) ||
        map.width < 1 ||
        !Number.isInteger(map.height) ||
        map.height < 1 ||
        map.data?.length !== map.width * map.height
      )
        return null;
      const scale = map.scale ?? 1;
      if (!Number.isFinite(scale) || scale <= 0) return null;
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
        value = map.data[y * map.width + x] * scale;
      return Number.isFinite(value) && value > 0 ? value : null;
    };
    const first = hit(origin, ray),
      sourceDepth = depth(leftDepth, point),
      distance = sourceDepth ?? first?.distance;
    if (!distance) return unknown("unknown-point-depth");
    if (
      sourceDepth &&
      first &&
      Math.abs(first.distance - sourceDepth) > depthTolerance(sourceDepth)
    )
      return unknown("geometry-depth-conflict");
    const position = add(origin, mul(ray, distance)),
      delta = sub(position, other),
      range = Math.hypot(...delta);
    if (range <= epsilon) return unknown("camera-at-landmark");
    const targetRay = unit(delta),
      local = rotate(targetRay, right.rotation, true);
    if (!local.every(Number.isFinite))
      return unknown("invalid-camera-rotation");
    const rightHint = {
        yaw: ((Math.atan2(-local[0], -local[2]) * 180) / Math.PI + 360) % 360,
        pitch: (Math.asin(Math.max(-1, Math.min(1, local[1]))) * 180) / Math.PI,
      },
      blocker = hit(other, targetRay),
      tolerance = surfaceTolerance(range);
    if (blocker && blocker.distance < range - tolerance)
      return { visible: false, reason: "wall-occlusion", rightHint };
    // A surface remains one-sided even when its range came from a depth map.
    if (
      first &&
      Math.abs(first.distance - distance) <= depthTolerance(distance)
    ) {
      const a = dot(sub(origin, position), first.normal),
        b = dot(sub(other, position), first.normal);
      if (
        (a > tolerance && b < -tolerance) ||
        (a < -tolerance && b > tolerance)
      )
        return boundary(first)
          ? unknown("surface-boundary", { rightHint })
          : { visible: false, reason: "opposite-wall-face", rightHint };
    }
    const targetDepth = depth(rightDepth, rightHint);
    if (targetDepth) {
      if (targetDepth < range - depthTolerance(range))
        return { visible: false, reason: "depth-occlusion", rightHint };
      if (Math.abs(targetDepth - range) > depthTolerance(range))
        return unknown("target-depth-mismatch", { rightHint });
      return { visible: true, reason: "depth-supported", rightHint };
    }
    if (blocker && Math.abs(blocker.distance - range) <= tolerance)
      return { visible: true, reason: "geometry-supported", rightHint };
    return unknown("unverified-target-surface", { rightHint });
  }
  function matchVisible({
    reference,
    targets,
    count = 24,
    geometryContext,
    includeUnverified = false,
  }) {
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
      const features = detect({ ...sample, count: 96, separation: 0.035 });
      for (const p of features) {
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
      accepted = [],
      pending = [];
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
      ) {
        if (includeUnverified)
          pending.push({ ...source[i], visibility: "unverified" });
        continue;
      }
      const reverse = scores
        .map((row, index) => ({ index, score: row[first.j] }))
        .sort((a, b) => b.score - a.score);
      if (reverse[0]?.index !== i) {
        if (includeUnverified)
          pending.push({ ...source[i], visibility: "unverified" });
        continue;
      }
      accepted.push({
        ...source[i],
        rightHint: target[first.j].pose,
        similarity: first.score,
        visibility: "image-supported",
      });
    }
    // Absence of an image match is not proof of a wall. Offer real reference
    // corners as explicitly unverified candidates; never invent a right hint.
    // Prefer the neighborhood of supported details over unrelated rooms.
    if (accepted.length)
      pending.sort(
        (a, b) =>
          Math.min(...accepted.map((p) => Math.hypot(p.x - a.x, p.y - a.y))) -
          Math.min(...accepted.map((p) => Math.hypot(p.x - b.x, p.y - b.y))),
      );
    return [...accepted, ...pending];
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
