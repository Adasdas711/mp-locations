/* XFeat local features (Potje et al., CVPR 2024; Apache-2.0 weights in
   vendor/xfeat) evaluated in plain JavaScript. BatchNorm is folded into the
   convolutions of the exported backbone; no external runtime is required. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PalaceCalibrationXFeat = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";
  function half(h) {
    const s = h & 0x8000 ? -1 : 1,
      e = (h >> 10) & 31,
      f = h & 1023;
    if (!e) return s * f * 2 ** -24;
    if (e === 31) return f ? NaN : s * Infinity;
    return s * (1 + f / 1024) * 2 ** (e - 15);
  }
  /** Parse the exported backbone: [u32 header length][JSON][float16 data]. */
  function load(buffer) {
    const bytes =
        buffer instanceof ArrayBuffer
          ? buffer
          : buffer.buffer.slice(
              buffer.byteOffset,
              buffer.byteOffset + buffer.byteLength,
            ),
      view = new DataView(bytes),
      length = view.getUint32(0, true),
      header = JSON.parse(
        new TextDecoder().decode(new Uint8Array(bytes, 4, length)),
      );
    if (header.format !== "palace-xfeat-1")
      throw new Error("Unsupported feature model.");
    const start = 4 + length,
      layers = {};
    for (const [name, l] of Object.entries(header.layers)) {
      const count = l.out * l.in * l.k * l.k,
        w = new Float32Array(count),
        b = new Float32Array(l.out);
      for (let i = 0; i < count; i++)
        w[i] = half(view.getUint16(start + (l.offset + i) * 2, true));
      for (let i = 0; i < l.out; i++)
        b[i] = half(view.getUint16(start + (l.offset + count + i) * 2, true));
      layers[name] = { ...l, w, b };
    }
    return { layers };
  }
  // Tensors are {c, h, w, data: Float32Array} in channel-major order.
  function conv(x, L, relu) {
    const { c, h, w, data } = x,
      s = L.stride,
      k = L.k,
      p = L.pad,
      oh = Math.floor((h + 2 * p - k) / s) + 1,
      ow = Math.floor((w + 2 * p - k) / s) + 1,
      out = new Float32Array(L.out * oh * ow),
      plane = oh * ow;
    if (k === 1 && s === 1 && !p) {
      for (let o = 0; o < L.out; o++) {
        const acc = out.subarray(o * plane, (o + 1) * plane);
        acc.fill(L.b[o]);
        let i = 0;
        for (; i + 3 < c; i += 4) {
          const w0 = L.w[o * c + i],
            w1 = L.w[o * c + i + 1],
            w2 = L.w[o * c + i + 2],
            w3 = L.w[o * c + i + 3],
            s0 = i * plane,
            s1 = s0 + plane,
            s2 = s1 + plane,
            s3 = s2 + plane;
          for (let q = 0; q < plane; q++)
            acc[q] +=
              w0 * data[s0 + q] +
              w1 * data[s1 + q] +
              w2 * data[s2 + q] +
              w3 * data[s3 + q];
        }
        for (; i < c; i++) {
          const wv = L.w[o * c + i],
            src = i * plane;
          for (let q = 0; q < plane; q++) acc[q] += wv * data[src + q];
        }
      }
    } else {
      // Zero-padded copy keeps the inner loops free of bounds checks.
      const ph = h + 2 * p,
        pw = w + 2 * p,
        padded = new Float32Array(c * ph * pw);
      for (let i = 0; i < c; i++)
        for (let y = 0; y < h; y++)
          padded.set(
            data.subarray(i * h * w + y * w, i * h * w + (y + 1) * w),
            i * ph * pw + (y + p) * pw + p,
          );
      for (let o = 0; o < L.out; o++) {
        const acc = out.subarray(o * plane, (o + 1) * plane);
        acc.fill(L.b[o]);
        for (let i = 0; i < c; i++) {
          const base = (o * c + i) * 9,
            src = i * ph * pw,
            w0 = L.w[base],
            w1 = L.w[base + 1],
            w2 = L.w[base + 2],
            w3 = L.w[base + 3],
            w4 = L.w[base + 4],
            w5 = L.w[base + 5],
            w6 = L.w[base + 6],
            w7 = L.w[base + 7],
            w8 = L.w[base + 8];
          // All nine taps in one pass over each output row.
          for (let y = 0; y < oh; y++) {
            const r0 = src + y * s * pw,
              r1 = r0 + pw,
              r2 = r1 + pw,
              dst = y * ow;
            if (s === 1)
              for (let xx = 0; xx < ow; xx++)
                acc[dst + xx] +=
                  w0 * padded[r0 + xx] +
                  w1 * padded[r0 + xx + 1] +
                  w2 * padded[r0 + xx + 2] +
                  w3 * padded[r1 + xx] +
                  w4 * padded[r1 + xx + 1] +
                  w5 * padded[r1 + xx + 2] +
                  w6 * padded[r2 + xx] +
                  w7 * padded[r2 + xx + 1] +
                  w8 * padded[r2 + xx + 2];
            else
              for (let xx = 0, q = 0; xx < ow; xx++, q += s)
                acc[dst + xx] +=
                  w0 * padded[r0 + q] +
                  w1 * padded[r0 + q + 1] +
                  w2 * padded[r0 + q + 2] +
                  w3 * padded[r1 + q] +
                  w4 * padded[r1 + q + 1] +
                  w5 * padded[r1 + q + 2] +
                  w6 * padded[r2 + q] +
                  w7 * padded[r2 + q + 1] +
                  w8 * padded[r2 + q + 2];
          }
        }
      }
    }
    if (relu) for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
    return { c: L.out, h: oh, w: ow, data: out };
  }
  function sequence(model, prefix, count, x, lastLinear = false) {
    for (let i = 0; i < count; i++)
      x = conv(
        x,
        model.layers[prefix + "." + i],
        !(lastLinear && i === count - 1),
      );
    return x;
  }
  function add(a, b) {
    const data = new Float32Array(a.data.length);
    for (let i = 0; i < data.length; i++) data[i] = a.data[i] + b.data[i];
    return { ...a, data };
  }
  function avgpool4(x) {
    const h = x.h >> 2,
      w = x.w >> 2,
      data = new Float32Array(x.c * h * w);
    for (let c = 0; c < x.c; c++)
      for (let y = 0; y < h; y++)
        for (let xx = 0; xx < w; xx++) {
          let s = 0;
          for (let dy = 0; dy < 4; dy++)
            for (let dx = 0; dx < 4; dx++)
              s += x.data[c * x.h * x.w + (y * 4 + dy) * x.w + xx * 4 + dx];
          data[c * h * w + y * w + xx] = s / 16;
        }
    return { c: x.c, h, w, data };
  }
  // F.interpolate(mode='bilinear', align_corners=False)
  function resize(x, h, w) {
    const data = new Float32Array(x.c * h * w),
      sy = x.h / h,
      sx = x.w / w;
    for (let y = 0; y < h; y++) {
      const fy = Math.max(0, (y + 0.5) * sy - 0.5),
        y0 = Math.min(Math.floor(fy), x.h - 1),
        y1 = Math.min(y0 + 1, x.h - 1),
        ty = fy - y0;
      for (let xx = 0; xx < w; xx++) {
        const fx = Math.max(0, (xx + 0.5) * sx - 0.5),
          x0 = Math.min(Math.floor(fx), x.w - 1),
          x1 = Math.min(x0 + 1, x.w - 1),
          tx = fx - x0;
        for (let c = 0; c < x.c; c++) {
          const o = c * x.h * x.w;
          data[c * h * w + y * w + xx] =
            (x.data[o + y0 * x.w + x0] * (1 - tx) +
              x.data[o + y0 * x.w + x1] * tx) *
              (1 - ty) +
            (x.data[o + y1 * x.w + x0] * (1 - tx) +
              x.data[o + y1 * x.w + x1] * tx) *
              ty;
        }
      }
    }
    return { c: x.c, h, w, data };
  }
  /**
   * Dense network outputs for a grayscale image (values 0..255) whose sides
   * are multiples of 32: L2-normalised descriptors (64×h/8×w/8), keypoint
   * logits (65×h/8×w/8) and reliability (1×h/8×w/8).
   */
  function forward(model, gray, width, height) {
    if (width % 32 || height % 32)
      throw new Error("Feature input sides must be multiples of 32.");
    let mean = 0;
    for (let i = 0; i < gray.length; i++) mean += gray[i];
    mean /= gray.length;
    let variance = 0;
    for (let i = 0; i < gray.length; i++) variance += (gray[i] - mean) ** 2;
    variance /= gray.length;
    const scale = 1 / Math.sqrt(variance + 1e-5),
      input = new Float32Array(gray.length);
    for (let i = 0; i < gray.length; i++) input[i] = (gray[i] - mean) * scale;
    const x = { c: 1, h: height, w: width, data: input };
    const x1 = sequence(model, "block1", 4, x),
      skip = conv(avgpool4(x), model.layers.skip1, false),
      x2 = sequence(model, "block2", 2, add(x1, skip)),
      x3 = sequence(model, "block3", 3, x2),
      x4 = sequence(model, "block4", 3, x3),
      x5 = sequence(model, "block5", 4, x4),
      fused = add(add(x3, resize(x4, x3.h, x3.w)), resize(x5, x3.h, x3.w)),
      feats = sequence(model, "block_fusion", 3, fused, true),
      heat = sequence(model, "heatmap_head", 3, feats, true);
    for (let i = 0; i < heat.data.length; i++)
      heat.data[i] = 1 / (1 + Math.exp(-heat.data[i]));
    const h8 = height / 8,
      w8 = width / 8,
      unfold = new Float32Array(64 * h8 * w8);
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        for (let y = 0; y < h8; y++)
          for (let xx = 0; xx < w8; xx++)
            unfold[(r * 8 + c) * h8 * w8 + y * w8 + xx] =
              input[(y * 8 + r) * width + xx * 8 + c];
    const logits = sequence(
      model,
      "keypoint_head",
      4,
      { c: 64, h: h8, w: w8, data: unfold },
      true,
    );
    const plane = h8 * w8;
    for (let q = 0; q < plane; q++) {
      let n = 0;
      for (let c = 0; c < 64; c++) n += feats.data[c * plane + q] ** 2;
      n = 1 / Math.max(Math.sqrt(n), 1e-12);
      for (let c = 0; c < 64; c++) feats.data[c * plane + q] *= n;
    }
    return { feats, logits, heat };
  }
  function bilinear(t, channel, fx, fy) {
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      tx = fx - x0,
      ty = fy - y0,
      value = (x, y) =>
        x < 0 || y < 0 || x >= t.w || y >= t.h
          ? 0
          : t.data[channel * t.h * t.w + y * t.w + x];
    return (
      (value(x0, y0) * (1 - tx) + value(x0 + 1, y0) * tx) * (1 - ty) +
      (value(x0, y0 + 1) * (1 - tx) + value(x0 + 1, y0 + 1) * tx) * ty
    );
  }
  // grid_sample(mode='bicubic', align_corners=False, padding_mode='zeros')
  function cubicWeights(t) {
    const A = -0.75,
      near = (x) => ((A + 2) * x - (A + 3)) * x * x + 1,
      far = (x) => ((A * x - 5 * A) * x + 8 * A) * x - 4 * A;
    return [far(t + 1), near(t), near(1 - t), far(2 - t)];
  }
  function bicubic(t, channel, fx, fy) {
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy),
      wx = cubicWeights(fx - x0),
      wy = cubicWeights(fy - y0),
      base = channel * t.h * t.w;
    let sum = 0;
    for (let j = 0; j < 4; j++) {
      const y = y0 - 1 + j;
      if (y < 0 || y >= t.h) continue;
      let row = 0;
      for (let i = 0; i < 4; i++) {
        const x = x0 - 1 + i;
        if (x >= 0 && x < t.w) row += wx[i] * t.data[base + y * t.w + x];
      }
      sum += wy[j] * row;
    }
    return sum;
  }
  /**
   * Sparse keypoints and 64-d descriptors. sample: {width, height, pixels}
   * with RGBA or single-channel pixels. Returns {points:[{x,y,score}],
   * descriptors: Float32Array(n*64)} sorted by score.
   */
  function detect(model, sample, options = {}) {
    const { width, height } = sample,
      topK = options.topK ?? 1024,
      threshold = options.threshold ?? 0.05,
      n = width * height,
      rgba = sample.pixels.length === n * 4,
      gray = new Float32Array(n);
    for (let i = 0; i < n; i++)
      gray[i] = rgba
        ? sample.pixels[i * 4] * 0.299 +
          sample.pixels[i * 4 + 1] * 0.587 +
          sample.pixels[i * 4 + 2] * 0.114
        : sample.pixels[i];
    const { feats, logits, heat } = forward(model, gray, width, height),
      h8 = height / 8,
      w8 = width / 8,
      plane = h8 * w8,
      full = new Float32Array(n);
    for (let q = 0; q < plane; q++) {
      let max = -Infinity;
      for (let c = 0; c < 65; c++)
        max = Math.max(max, logits.data[c * plane + q]);
      let sum = 0;
      for (let c = 0; c < 65; c++)
        sum += Math.exp(logits.data[c * plane + q] - max);
      const y = Math.floor(q / w8),
        x = q % w8;
      for (let c = 0; c < 64; c++)
        full[(y * 8 + (c >> 3)) * width + x * 8 + (c & 7)] =
          Math.exp(logits.data[c * plane + q] - max) / sum;
    }
    // 5×5 non-maximum suppression (separable maximum filter).
    const rows = new Float32Array(n),
      local = new Float32Array(n);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let m = -Infinity;
        for (let d = -2; d <= 2; d++) {
          const xx = x + d;
          if (xx >= 0 && xx < width) m = Math.max(m, full[y * width + xx]);
        }
        rows[y * width + x] = m;
      }
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let m = -Infinity;
        for (let d = -2; d <= 2; d++) {
          const yy = y + d;
          if (yy >= 0 && yy < height) m = Math.max(m, rows[yy * width + x]);
        }
        local[y * width + x] = m;
      }
    const candidates = [];
    // grid_sample(align_corners=False) of an h8×w8 map at full-resolution
    // pixel positions normalised by (size - 1), as in the reference model.
    const gx = (x) => ((x / (width - 1)) * 2 * w8 - 1) / 2 + 0,
      gy = (y) => ((y / (height - 1)) * 2 * h8 - 1) / 2 + 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const v = full[y * width + x];
        if (v > threshold && v === local[y * width + x]) {
          const score = v * bilinear(heat, 0, gx(x), gy(y));
          if (score > 0) candidates.push({ x, y, score });
        }
      }
    candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x);
    const points = candidates.slice(0, topK),
      descriptors = new Float32Array(points.length * 64);
    points.forEach((p, i) => {
      const fx = gx(p.x),
        fy = gy(p.y);
      let norm = 0;
      for (let c = 0; c < 64; c++) {
        const v = bicubic(feats, c, fx, fy);
        descriptors[i * 64 + c] = v;
        norm += v * v;
      }
      norm = 1 / Math.max(Math.sqrt(norm), 1e-12);
      for (let c = 0; c < 64; c++) descriptors[i * 64 + c] *= norm;
    });
    return { points, descriptors };
  }
  /**
   * Mutual nearest neighbours with cosine similarity above minCos. With
   * ratio < 1, the best match must also be clearly better than the second
   * best: (1 - best) < ratio * (1 - second).
   */
  function match(a, b, minCos = 0.82, ratio = 1) {
    const na = a.points.length,
      nb = b.points.length,
      best = new Int32Array(na).fill(-1),
      bestValue = new Float32Array(na).fill(-2),
      second = new Float32Array(na).fill(-2),
      reverse = new Int32Array(nb).fill(-1),
      reverseValue = new Float32Array(nb).fill(-2),
      A = a.descriptors,
      B = b.descriptors;
    for (let i = 0; i < na; i++) {
      const oi = i * 64;
      for (let j = 0; j < nb; j++) {
        const oj = j * 64;
        let s = 0;
        for (let k = 0; k < 64; k++) s += A[oi + k] * B[oj + k];
        if (s > bestValue[i]) {
          second[i] = bestValue[i];
          bestValue[i] = s;
          best[i] = j;
        } else if (s > second[i]) second[i] = s;
        if (s > reverseValue[j]) {
          reverseValue[j] = s;
          reverse[j] = i;
        }
      }
    }
    const out = [];
    for (let i = 0; i < na; i++) {
      const j = best[i];
      if (
        j >= 0 &&
        reverse[j] === i &&
        bestValue[i] > minCos &&
        1 - bestValue[i] < ratio * (1 - second[i])
      )
        out.push({ i, j, distance: 1 - bestValue[i] });
    }
    return out;
  }
  return Object.freeze({ load, forward, detect, match });
});
