/** Screen-space transmission through distinct buildings, independent of draw order.
 * Four nearest owners per cell; repeated faces of one building count only once.
 * Reciprocal camera distance is affine on a projected plane. No GPU readbacks.
 */
export function createDepthField(surfaces, distance) {
  const owners = new Map(
    [...new Set(surfaces.map((s) => s.building))].map((id, i) => [id, i + 1]),
  );
  const layers = 4;
  let cols = 0,
    rows = 0,
    step = 3,
    depths,
    ids;
  const reciprocal = (depth) => 1 / (distance - depth);
  function resize(width, height) {
    step = Math.max(3, width / 320, height / 240);
    cols = Math.ceil(width / step);
    rows = Math.ceil(height / step);
    depths = new Float32Array(cols * rows * layers);
    ids = new Uint16Array(cols * rows * layers);
  }
  function insert(cell, owner, depth) {
    const base = cell * layers;
    let slot = layers;
    for (let k = 0; k < layers; k++) {
      if (ids[base + k] === owner) {
        if (depth <= depths[base + k]) return;
        slot = k;
        break;
      }
    }
    if (slot === layers && depth <= depths[base + layers - 1]) return;
    if (slot === layers) slot--;
    while (slot > 0 && depth > depths[base + slot - 1]) {
      depths[base + slot] = depths[base + slot - 1];
      ids[base + slot] = ids[base + slot - 1];
      slot--;
    }
    depths[base + slot] = depth;
    ids[base + slot] = owner;
  }
  const prepared = surfaces.map((s) => ({
    owner: owners.get(s.building),
    points: s.points,
    screen: new Float64Array(s.points.length * 3),
    hits: new Float64Array(s.points.length * 2),
  }));
  function update(project) {
    depths.fill(0);
    ids.fill(0);
    for (const surface of prepared) {
      const { screen: p, hits, owner, points } = surface;
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      for (let i = 0; i < points.length; i++) {
        const q = project(points[i]),
          x = q[0] / step,
          y = q[1] / step;
        p[i * 3] = x;
        p[i * 3 + 1] = y;
        p[i * 3 + 2] = reciprocal(q[2]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (maxX < 0 || minX >= cols || maxY < 0 || minY >= rows) continue;
      minY = Math.max(0, Math.ceil(minY - 0.5));
      maxY = Math.min(rows - 1, Math.floor(maxY - 0.5));
      // Scanline pairs support concave polygons, avoiding triangle-fan overfill.
      for (let y = minY; y <= maxY; y++) {
        const scan = y + 0.5;
        let count = 0;
        for (let i = 0; i < points.length; i++) {
          const a = i * 3,
            b = ((i + 1) % points.length) * 3,
            ay = p[a + 1],
            by = p[b + 1];
          if ((ay <= scan && by > scan) || (by <= scan && ay > scan)) {
            const t = (scan - ay) / (by - ay),
              x = p[a] + (p[b] - p[a]) * t;
            const d = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
            let at = count;
            while (at > 0 && hits[(at - 1) * 2] > x) {
              hits[at * 2] = hits[(at - 1) * 2];
              hits[at * 2 + 1] = hits[(at - 1) * 2 + 1];
              at--;
            }
            hits[at * 2] = x;
            hits[at * 2 + 1] = d;
            count++;
          }
        }
        for (let i = 1; i < count; i += 2) {
          const a = (i - 1) * 2,
            b = i * 2,
            span = hits[b] - hits[a];
          if (span < 1e-6) continue;
          const first = Math.max(0, Math.ceil(hits[a] - 0.5));
          const last = Math.min(cols - 1, Math.floor(hits[b] - 0.5));
          const slope = (hits[b + 1] - hits[a + 1]) / span;
          let d = hits[a + 1] + slope * (first + 0.5 - hits[a]);
          for (let x = first; x <= last; x++, d += slope)
            insert(y * cols + x, owner, d);
        }
      }
    }
  }
  function cellTransmission(x, y, depth, owner) {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return 1;
    const base = (y * cols + x) * layers;
    let count = 0;
    for (let k = 0; k < layers; k++) {
      if (depths[base + k] <= depth + 0.000006) break;
      if (ids[base + k] !== owner) count++;
    }
    return 0.48 ** count;
  }
  function transmission(x, y, depth, building) {
    const gx = x / step - 0.5,
      gy = y / step - 0.5;
    const ix = Math.floor(gx),
      iy = Math.floor(gy),
      fx = gx - ix,
      fy = gy - iy;
    const owner =
      typeof building === "number" ? building : owners.get(building) || 0;
    const a = cellTransmission(ix, iy, depth, owner);
    const b = cellTransmission(ix + 1, iy, depth, owner);
    const c = cellTransmission(ix, iy + 1, depth, owner);
    const d = cellTransmission(ix + 1, iy + 1, depth, owner);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  // Split long edges so only their obscured portions recede.
  function fragments(a, b, building, visit) {
    const owner = owners.get(building) || 0;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / 7));
    const qa = reciprocal(a[2]),
      qb = reciprocal(b[2]);
    let start = 0,
      previous = -1;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const level = Math.round(
        transmission(
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          qa + (qb - qa) * t,
          owner,
        ) * 12,
      );
      if (previous !== -1 && level !== previous) {
        visit(start / steps, i / steps, previous / 12);
        start = i;
      }
      previous = level;
    }
    visit(start / steps, 1, previous / 12);
  }
  return {
    resize,
    update,
    fragments,
    at: (p, building) => transmission(p[0], p[1], reciprocal(p[2]), building),
  };
}
