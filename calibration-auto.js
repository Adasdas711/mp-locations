/* Project-wide automatic calibration planning: candidate pairs, multi-view
   tracks, independent groups, batch review and application quality gates.
   Pure functions shared by the browser autopilot, CLI and numerical tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PalaceCalibrationAuto = api;
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";
  const DEG = Math.PI / 180;
  function ray(p) {
    return [
      -Math.sin(p.yaw * DEG) * Math.cos(p.pitch * DEG),
      Math.sin(p.pitch * DEG),
      -Math.cos(p.yaw * DEG) * Math.cos(p.pitch * DEG),
    ];
  }
  function separation(a, b) {
    const p = ray(a),
      q = ray(b);
    return (
      Math.acos(
        Math.max(-1, Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])),
      ) / DEG
    );
  }
  const key = (a, b) => (a < b ? a + "\u0000" + b : b + "\u0000" + a);
  /**
   * Candidate pairs to analyse.
   * panoramas: [{id, neighbors?:[id], position?:{x,y,z}}]
   * mode: 'auto' (links, nearest registered cameras, sequence; all pairs for
   *       small projects), 'links' or 'all'.
   */
  function candidatePairs(panoramas, options = {}) {
    const mode = options.mode || "auto",
      nearest = options.nearest ?? 3,
      allLimit = options.allPairsUpTo ?? 12,
      ids = panoramas.map((p) => p.id),
      known = new Set(ids),
      pairs = new Map(),
      add = (a, b, reason) => {
        if (a === b || !known.has(a) || !known.has(b)) return;
        const k = key(a, b);
        if (!pairs.has(k))
          pairs.set(k, { a: a < b ? a : b, b: a < b ? b : a, reasons: [] });
        if (!pairs.get(k).reasons.includes(reason))
          pairs.get(k).reasons.push(reason);
      };
    if (mode === "all" || (mode === "auto" && ids.length <= allLimit))
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], "all");
    for (const p of panoramas)
      for (const n of p.neighbors || []) add(p.id, n, "link");
    if (mode !== "links") {
      const placed = panoramas.filter((p) => p.position);
      for (const p of placed)
        placed
          .filter((q) => q.id !== p.id)
          .map((q) => ({
            id: q.id,
            d: Math.hypot(
              q.position.x - p.position.x,
              q.position.y - p.position.y,
              q.position.z - p.position.z,
            ),
          }))
          .sort((x, y) => x.d - y.d)
          .slice(0, nearest)
          .forEach((q) => add(p.id, q.id, "nearest"));
      for (let i = 1; i < ids.length; i++) add(ids[i - 1], ids[i], "sequence");
    }
    return [...pairs.values()];
  }
  /**
   * Merge pairwise matches into multi-view tracks. Observations of one
   * panorama within mergeDeg are one physical direction; matches chain
   * A↔B↔C into one landmark. A track that would hold two different
   * directions of the same panorama is ambiguous and is discarded.
   * pairMatches: [{a, b, points:[{yaw,pitch,rightHint:{yaw,pitch}}]}]
   */
  function buildTracks(pairMatches, options = {}) {
    const mergeDeg = options.mergeDeg ?? 0.4,
      nodes = [],
      byPano = new Map(),
      parent = [];
    const node = (panoId, bearing) => {
      const list = byPano.get(panoId) || [];
      byPano.set(panoId, list);
      for (const index of list)
        if (separation(nodes[index], bearing) < mergeDeg) return index;
      nodes.push({ panoId, yaw: bearing.yaw, pitch: bearing.pitch });
      parent.push(nodes.length - 1);
      list.push(nodes.length - 1);
      return nodes.length - 1;
    };
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    const support = new Map();
    for (const pair of pairMatches)
      for (const p of pair.points) {
        const u = node(pair.a, p),
          v = node(pair.b, p.rightHint),
          ru = find(u),
          rv = find(v);
        if (ru !== rv) parent[ru] = rv;
        support.set(key(String(u), String(v)), true);
      }
    const groups = new Map();
    nodes.forEach((_, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    });
    const tracks = [];
    let ambiguous = 0;
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const panos = members.map((i) => nodes[i].panoId);
      if (new Set(panos).size !== panos.length) {
        ambiguous++;
        continue;
      }
      tracks.push({
        observations: members
          .map((i) => ({ ...nodes[i] }))
          .sort((x, y) => (x.panoId < y.panoId ? -1 : 1)),
      });
    }
    tracks.sort(
      (x, y) =>
        y.observations.length - x.observations.length ||
        (x.observations[0].panoId < y.observations[0].panoId ? -1 : 1) ||
        x.observations[0].yaw - y.observations[0].yaw,
    );
    return { tracks, ambiguous };
  }
  const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  /**
   * Loop verification for upright panoramas. Each estimate gives the yaw of
   * b relative to a (relYaw) and the baseline direction a→b as a yaw in a's
   * own frame (dir). A triangle a,b,c is consistent when the relative yaws
   * close (yawTol) and the triangle's interior angles, measured from three
   * different cameras, have one orientation and sum to 180° (angleTol).
   * Wrong pairwise poses almost never close such a loop.
   * estimates: [{a, b, relYaw, dir}]. Returns the set of verified pair keys
   * (pairKey) and the number of consistent triangles.
   */
  function verifyCycles(estimates, options = {}) {
    const yawTol = options.yawTol ?? 4,
      angleTol = options.angleTol ?? 10,
      edges = new Map(),
      neighbors = new Map();
    for (const e of estimates) {
      edges.set(e.a + "\u0000" + e.b, { relYaw: e.relYaw, dir: e.dir });
      edges.set(e.b + "\u0000" + e.a, {
        relYaw: -e.relYaw,
        dir: wrap(e.dir + 180 - e.relYaw),
      });
      for (const [x, y] of [
        [e.a, e.b],
        [e.b, e.a],
      ]) {
        if (!neighbors.has(x)) neighbors.set(x, new Set());
        neighbors.get(x).add(y);
      }
    }
    const get = (x, y) => edges.get(x + "\u0000" + y),
      verified = new Set();
    let triangles = 0;
    const ids = [...neighbors.keys()].sort();
    for (const a of ids)
      for (const b of neighbors.get(a))
        if (b > a)
          for (const c of neighbors.get(b))
            if (c > b && neighbors.get(a).has(c)) {
              const ab = get(a, b),
                bc = get(b, c),
                ac = get(a, c),
                ba = get(b, a),
                cb = get(c, b),
                ca = get(c, a);
              if (Math.abs(wrap(ab.relYaw + bc.relYaw - ac.relYaw)) >= yawTol)
                continue;
              const ta = wrap(ac.dir - ab.dir),
                tb = wrap(ba.dir - bc.dir),
                tc = wrap(cb.dir - ca.dir);
              if (!(ta > 0 === tb > 0 && tb > 0 === tc > 0)) continue;
              if (
                Math.abs(Math.abs(ta) + Math.abs(tb) + Math.abs(tc) - 180) >=
                angleTol
              )
                continue;
              triangles++;
              for (const [x, y] of [
                [a, b],
                [b, c],
                [a, c],
              ])
                verified.add(key(x, y));
            }
    return { verified, triangles };
  }
  /** Connected camera groups from accepted pairs; singletons are omitted. */
  function components(ids, pairs) {
    const parent = new Map(ids.map((id) => [id, id])),
      find = (i) => {
        while (parent.get(i) !== i) {
          parent.set(i, parent.get(parent.get(i)));
          i = parent.get(i);
        }
        return i;
      };
    for (const { a, b } of pairs)
      if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
    const groups = new Map();
    for (const id of ids) {
      const r = find(id);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(id);
    }
    return [...groups.values()]
      .filter((g) => g.length > 1)
      .sort((x, y) => y.length - x.length);
  }
  /**
   * Batch review of unverified landmarks against a solved candidate:
   * every observation must be reconstructed within tolerance.
   */
  function reviewDecision(session, landmarkIds) {
    const quality = session?.quality,
      limit = (session?.config?.ransacThresholdDeg ?? 0.6) * 2,
      wanted = landmarkIds ? new Set(landmarkIds) : null,
      confirm = [],
      disable = [];
    for (const landmark of session?.landmarks || []) {
      if (!landmark.enabled || (wanted && !wanted.has(landmark.id))) continue;
      if (landmark.observations.every((o) => o.verified)) continue;
      const metric = quality?.landmarks?.find((m) => m.id === landmark.id),
        consistent =
          metric?.distances?.length === landmark.observations.length &&
          metric.distances.every((d) => d.angularErrorDeg <= limit);
      (consistent ? confirm : disable).push(landmark.id);
    }
    return { confirm, disable };
  }
  const GATE_DEFAULTS = {
    maxMedianErrorDeg: 0.35,
    maxMeanErrorDeg: 0.6,
    maxOutlierRatio: 0.2,
    minInliersPerCamera: 8,
  };
  /** Conservative checks before a solution may be applied without a person. */
  function qualityGate(session, thresholds = {}) {
    const t = { ...GATE_DEFAULTS, ...thresholds },
      q = session?.quality,
      reasons = [];
    if (!session || session.status !== "solved")
      reasons.push("status is " + (session?.status || "missing"));
    if (session?.pending) reasons.push("calculation pending");
    if (session && session.solvedRevision !== session.revision)
      reasons.push("solution is stale");
    if (q) {
      if (q.unregisteredCameraIds?.length)
        reasons.push(q.unregisteredCameraIds.length + " cameras unregistered");
      if (q.visibility?.occluded?.length)
        reasons.push(q.visibility.occluded.length + " occluded observations");
      if (q.degeneracy?.length)
        reasons.push("degeneracy: " + q.degeneracy.join(", "));
      if (!(q.medianAngularErrorDeg <= t.maxMedianErrorDeg))
        reasons.push("median error " + q.medianAngularErrorDeg);
      if (!(q.meanAngularErrorDeg <= t.maxMeanErrorDeg))
        reasons.push("mean error " + q.meanAngularErrorDeg);
      const total = (q.inliers || 0) + (q.outliers || 0);
      if (!total || q.outliers / total > t.maxOutlierRatio)
        reasons.push("outlier ratio " + (total ? q.outliers / total : "n/a"));
      const cameras = q.registeredCameraIds?.length || 0;
      if (!cameras || q.inliers / cameras < t.minInliersPerCamera)
        reasons.push("too few inliers per camera");
    } else reasons.push("no quality metrics");
    return { pass: !reasons.length, reasons };
  }
  return Object.freeze({
    separation,
    pairKey: key,
    candidatePairs,
    buildTracks,
    verifyCycles,
    components,
    reviewDecision,
    qualityGate,
    GATE_DEFAULTS,
  });
});
