/* Shared photographic regions: multiscale ORB, reciprocal matching, planar RANSAC. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./vendor/jsfeat-0.0.8.min.js"));
  else root.PalaceCalibrationOverlap = factory(root.jsfeat);
})(typeof self !== "undefined" ? self : globalThis, function (J) {
  "use strict";
  function features(sample) {
    const src = new J.matrix_t(sample.width, sample.height, J.U8_t | J.C1_t);
    J.imgproc.grayscale(sample.pixels, sample.width, sample.height, src);
    const output = [];
    for (const scale of [1, Math.SQRT2, 2, 2 * Math.SQRT2, 4]) {
      const w = Math.round(sample.width / scale),
        h = Math.round(sample.height / scale);
      if (Math.min(w, h) < 60) continue;
      const gray = new J.matrix_t(w, h, J.U8_t | J.C1_t);
      if (w === src.cols && h === src.rows) src.copy_to(gray);
      else J.imgproc.resample(src, gray, w, h);
      const points = new Proxy([], {
        get(t, k) {
          if (typeof k === "string" && /^\d+$/.test(k) && !t[k])
            t[k] = new J.keypoint_t(0, 0, 0, 0);
          return t[k];
        },
      });
      J.yape06.laplacian_threshold = 20;
      J.yape06.min_eigen_value_threshold = 15;
      const n = J.yape06.detect(gray, points, 18),
        selected = points
          .slice(0, n)
          .sort((a, b) => b.score - a.score)
          .slice(0, 200);
      for (const p of selected) {
        let m10 = 0,
          m01 = 0;
        for (let dy = -15; dy <= 15; dy++)
          for (let dx = -15; dx <= 15; dx++)
            if (dx * dx + dy * dy <= 225) {
              const v = gray.data[(p.y + dy) * w + p.x + dx];
              m10 += dx * v;
              m01 += dy * v;
            }
        p.angle = Math.atan2(m01, m10);
      }
      const blur = new J.matrix_t(w, h, J.U8_t | J.C1_t);
      J.imgproc.gaussian_blur(gray, blur, 5, 1.2);
      const desc = new J.matrix_t(32, selected.length, J.U8_t | J.C1_t);
      J.orb.describe(blur, selected, selected.length, desc);
      const words = new Uint32Array(
        desc.data.buffer,
        desc.data.byteOffset,
        selected.length * 8,
      );
      selected.forEach((p, i) =>
        output.push({
          x: (p.x + 0.5) * scale - 0.5,
          y: (p.y + 0.5) * scale - 0.5,
          score: p.score,
          desc: Array.from(words.subarray(i * 8, i * 8 + 8)),
        }),
      );
    }
    return output;
  }
  const pop = (v) => {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
  };
  function match(a, b) {
    const rows = [],
      reverse = b.map(() => ({ distance: 257, index: -1 }));
    for (let i = 0; i < a.length; i++) {
      const best = [];
      for (let j = 0; j < b.length; j++) {
        let d = 0;
        for (let k = 0; k < 8; k++) d += pop(a[i].desc[k] ^ b[j].desc[k]);
        if (d < reverse[j].distance) reverse[j] = { distance: d, index: i };
        if (
          d <= 160 &&
          (best.length < 8 || d < best[best.length - 1].distance)
        ) {
          best.push({ i, j, distance: d });
          best.sort((p, q) => p.distance - q.distance);
          if (best.length > 8) best.pop();
        }
      }
      rows.push(best);
    }
    const candidates = [];
    for (let i = 0; i < rows.length; i++) {
      const first = rows[i][0];
      if (!first || first.distance > 62) continue;
      const second = rows[i].find(
        (q) => Math.hypot(b[q.j].x - b[first.j].x, b[q.j].y - b[first.j].y) > 4,
      );
      if (
        second &&
        (first.distance > second.distance * 0.8 ||
          second.distance - first.distance < 8)
      )
        continue;
      const rev = a[reverse[first.j].index];
      if (Math.hypot(rev.x - a[i].x, rev.y - a[i].y) > 4) continue;
      candidates.push(first);
    }
    candidates.sort((p, q) => p.distance - q.distance);
    const accepted = [];
    for (const p of candidates)
      if (
        accepted.every(
          (q) =>
            Math.hypot(a[p.i].x - a[q.i].x, a[p.i].y - a[q.i].y) > 4 &&
            Math.hypot(b[p.j].x - b[q.j].x, b[p.j].y - b[q.j].y) > 4,
        )
      )
        accepted.push(p);
    return accepted;
  }
  function model(a, b, matches) {
    if (matches.length < 8) return {};
    const from = matches.map((p) => a[p.i]),
      to = matches.map((p) => b[p.j]),
      kernel = new J.motion_model.homography2d(),
      candidate = new J.matrix_t(3, 3, J.F64_t | J.C1_t),
      errors = new Float64Array(matches.length);
    let random = 0x47a13b51,
      best = [],
      bestCost = Infinity,
      bestH = null;
    const next = () => {
      random ^= random << 13;
      random ^= random >>> 17;
      random ^= random << 5;
      return (random >>> 0) / 4294967296;
    };
    for (let iteration = 0; iteration < 384; iteration++) {
      const ids = new Set();
      while (ids.size < 4) ids.add(Math.floor(next() * matches.length));
      const left = [...ids].map((i) => from[i]),
        right = [...ids].map((i) => to[i]);
      if (
        !kernel.check_subset(left, right, 4) ||
        !kernel.run(left, right, candidate, 4)
      )
        continue;
      kernel.error(from, to, candidate, errors, matches.length);
      const inliers = [],
        limit = 2.5 * 2.5;
      let cost = 0;
      for (let i = 0; i < matches.length; i++)
        if (errors[i] <= limit) {
          inliers.push(i);
          cost += errors[i];
        }
      if (
        inliers.length > best.length ||
        (inliers.length === best.length && cost < bestCost)
      ) {
        best = inliers;
        bestCost = cost;
        bestH = Array.from(candidate.data).slice(0, 9);
      }
    }
    if (best.length < 8) return {};
    if (
      kernel.run(
        best.map((i) => from[i]),
        best.map((i) => to[i]),
        candidate,
        best.length,
      )
    ) {
      // Refining the model may move its support. Recheck every correspondence
      // before using it to bound the common region.
      kernel.error(from, to, candidate, errors, matches.length);
      const refined = matches
        .map((_, i) => i)
        .filter((i) => errors[i] <= 2.5 * 2.5);
      if (refined.length >= 8) {
        best = refined;
        bestH = Array.from(candidate.data).slice(0, 9);
      }
    }
    return {
      inliers: best.length,
      total: matches.length,
      H: bestH,
      points: best.map((i) => ({
        left: from[i],
        right: to[i],
        distance: matches[i].distance,
      })),
    };
  }
  function hull(points) {
    const sorted = points
        .map((p) => ({ x: p.x, y: p.y }))
        .sort((a, b) => a.x - b.x || a.y - b.y),
      cross = (a, b, c) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
      build = (list) => {
        const h = [];
        for (const p of list) {
          while (
            h.length > 1 &&
            cross(h[h.length - 2], h[h.length - 1], p) <= 0
          )
            h.pop();
          h.push(p);
        }
        return h;
      };
    if (sorted.length < 3) return [];
    return [
      ...build(sorted).slice(0, -1),
      ...build([...sorted].reverse()).slice(0, -1),
    ];
  }
  function inside(point, polygon) {
    return (
      polygon.length >= 3 &&
      polygon.every((p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return (
          (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x) >=
          -Math.hypot(q.x - p.x, q.y - p.y) * 1.5
        );
      })
    );
  }
  function warp(H, p) {
    const z = H[6] * p.x + H[7] * p.y + H[8];
    return {
      x: (H[0] * p.x + H[1] * p.y + H[2]) / z,
      y: (H[3] * p.x + H[4] * p.y + H[5]) / z,
    };
  }
  function correlation(a, b, H, p) {
    const av = [],
      bv = [];
    const value = (s, x, y) => {
      if (x < 1 || y < 1 || x >= s.width - 2 || y >= s.height - 2) return null;
      const ix = Math.floor(x),
        iy = Math.floor(y),
        fx = x - ix,
        fy = y - iy;
      let v = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const i = ((iy + dy) * s.width + ix + dx) * 4;
          v +=
            (s.pixels[i] * 0.299 +
              s.pixels[i + 1] * 0.587 +
              s.pixels[i + 2] * 0.114) *
            (dx ? fx : 1 - fx) *
            (dy ? fy : 1 - fy);
        }
      return v;
    };
    for (let y = -12; y <= 12; y += 3)
      for (let x = -12; x <= 12; x += 3) {
        const u = { x: p.x + x, y: p.y + y },
          v = warp(H, u),
          aa = value(a, u.x, u.y),
          bb = value(b, v.x, v.y);
        if (aa == null || bb == null) return -1;
        av.push(aa);
        bv.push(bb);
      }
    const ma = av.reduce((s, v) => s + v, 0) / av.length,
      mb = bv.reduce((s, v) => s + v, 0) / bv.length;
    let aa = 0,
      bb = 0,
      ab = 0;
    for (let i = 0; i < av.length; i++) {
      const x = av[i] - ma,
        y = bv[i] - mb;
      aa += x * x;
      bb += y * y;
      ab += x * y;
    }
    return aa > 100 && bb > 100 ? ab / Math.sqrt(aa * bb) : -1;
  }
  function find(reference, targets, detect) {
    const source = features(reference),
      corners = detect({ ...reference, count: 128, separation: 0.025 });
    let result = [];
    for (const target of targets) {
      const destination = features(target),
        matches = match(source, destination),
        fit = model(source, destination, matches);
      if (!fit.inliers || fit.inliers < 8 || fit.inliers < fit.total * 0.25)
        continue;
      const region = hull(fit.points.map((p) => p.left)),
        otherRegion = hull(fit.points.map((p) => p.right));
      const area = (polygon) =>
        Math.abs(
          polygon.reduce((sum, p, i) => {
            const q = polygon[(i + 1) % polygon.length];
            return sum + p.x * q.y - p.y * q.x;
          }, 0),
        ) / 2;
      if (
        area(region) < reference.width * reference.height * 0.003 ||
        area(otherRegion) < target.width * target.height * 0.003
      )
        continue;
      const candidates = [];
      for (const p of corners) {
        if (!inside(p, region)) continue;
        const q = warp(fit.H, p);
        if (!inside(q, otherRegion)) continue;
        const similarity = correlation(reference, target, fit.H, p);
        if (similarity < 0.75) continue;
        // Periodic tiles can be consistent with a homography despite not
        // identifying a unique physical detail. Reject repeated source contexts.
        if (
          corners.some(
            (other) =>
              Math.hypot(other.x - p.x, other.y - p.y) > 12 &&
              correlation(
                reference,
                reference,
                [1, 0, other.x - p.x, 0, 1, other.y - p.y, 0, 0, 1],
                p,
              ) > 0.97,
          )
        )
          continue;
        candidates.push({
          ...p,
          rightPoint: q,
          similarity,
          evidence: { inliers: fit.inliers, region },
          target,
        });
      }
      if (candidates.length > result.length) result = candidates;
    }
    return result;
  }
  function bearing(sample, p) {
    const { pose = { yaw: 0, pitch: 0, fov: 90 }, width, height } = sample,
      f = Math.tan((pose.fov * Math.PI) / 360),
      v = [
        (((((p.x + 0.5) / width) * 2 - 1) * width) / height) * f,
        (1 - ((p.y + 0.5) / height) * 2) * f,
        -1,
      ],
      pitch = (pose.pitch * Math.PI) / 180,
      yaw = (pose.yaw * Math.PI) / 180,
      y = Math.cos(pitch) * v[1] - Math.sin(pitch) * v[2],
      z = Math.sin(pitch) * v[1] + Math.cos(pitch) * v[2],
      x = Math.cos(yaw) * v[0] + Math.sin(yaw) * z,
      zz = -Math.sin(yaw) * v[0] + Math.cos(yaw) * z,
      n = Math.hypot(x, y, zz);
    return {
      yaw: ((Math.atan2(-x, -zz) * 180) / Math.PI + 360) % 360,
      pitch: (Math.asin(y / n) * 180) / Math.PI,
    };
  }
  return Object.freeze({ features, match, model, find, bearing });
});
