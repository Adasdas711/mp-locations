/* Image corners for guided panorama matching. Suggestions are not correspondences. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PalaceCalibrationFeatures = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  function detect({ width, height, pixels, count = 20 }) {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 16 ||
      height < 16 ||
      width * height > 262144 ||
      pixels?.length !== width * height * 4
    )
      throw new Error("Invalid reference image sample.");
    count = Math.max(1, Math.min(32, Math.floor(count)));
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
        if (d < 0.095) continue;
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
                ";onmessage=e=>{try{postMessage({points:detect(e.data)})}catch(error){postMessage({error:error.message})}}",
            ],
            { type: "text/javascript" },
          ),
        );
        worker = new Worker(url);
        worker.onmessage = (e) =>
          finish(e.data.error ? new Error(e.data.error) : null, e.data.points);
        worker.onerror = () =>
          finish(new Error("Unable to analyze panorama details."));
        worker.postMessage(sample, [sample.pixels.buffer]);
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
  return Object.freeze({ detect, start });
});
