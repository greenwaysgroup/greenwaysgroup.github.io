/**
 * 20 Fenchurch Street: a fixed site frame, flared facades and parallel fins
 * wrapping over a barrel roof. Units are 10 m. See the scene README for sources.
 * Keeping each fin in its own north/south bay prevents radial roof pinching.
 */
export function createWalkieEnvelope(building) {
  const { center, footprint } = building;
  const edges = footprint.map((p, i) => {
    const q = footprint[(i + 1) % footprint.length];
    return [q[0] - p[0], q[1] - p[1]];
  });
  const east = edges.find(([x, z]) => x > 0 && Math.abs(x) > Math.abs(z));
  const length = Math.hypot(...east);
  const ex = east[0] / length,
    ez = east[1] / length;
  const world = ([x, y, z]) => [
    center[0] + x * ex - z * ez,
    y,
    center[1] + x * ez + z * ex,
  ];
  const eave = 13.475;
  const halfWidth = 5.66 / 2,
    halfDepth = 6.62 / 2;
  const shoulder = (y) => {
    const t = Math.max(0, Math.min(1, (y - 0.77) / (eave - 0.77)));
    const s = t * t * (3 - 2 * t);
    return {
      width:
        4.65 / 2 +
        (halfWidth - 4.65 / 2) * s +
        0.25 * Math.sin(Math.PI * t) ** 2,
      depth: 4.48 / 2 + (halfDepth - 4.48 / 2) * s * s,
      recess: 0.12 + 0.16 * s,
    };
  };
  const wall = (u, v, y) => {
    const p = shoulder(y);
    return world([u * p.width, y, v * (p.depth - p.recess * (1 - u * u))]);
  };
  const roofLocal = (theta, v) => {
    const u = Math.sin(theta);
    // The vault is higher at the north end, not a dome or a pointed crown.
    const ridge = 16 - 1.2 * ((v + 1) / 2) ** 1.7;
    return [
      u * halfWidth,
      eave + (ridge - eave) * Math.max(0, Math.cos(theta)) ** 0.55,
      v * (halfDepth - 0.28 * (1 - u * u)),
    ];
  };
  const roof = (theta, v) => world(roofLocal(theta, v));
  const across = Array.from({ length: 25 }, (_, i) => -1 + i / 12);
  const along = Array.from({ length: 33 }, (_, i) => -1 + i / 16);
  const angles = Array.from(
    { length: 33 },
    (_, i) => -Math.PI / 2 + (i * Math.PI) / 32,
  );
  const levels = [
    0,
    0.77,
    ...Array.from({ length: 32 }, (_, i) => 1.155 + i * 0.385),
    eave,
  ];
  const perimeter = (y) => [
    wall(-1, -1, y),
    wall(-1, 1, y),
    ...across.slice(1).map((u) => wall(u, 1, y)),
    wall(1, -1, y),
    ...across
      .slice(1, -1)
      .reverse()
      .map((u) => wall(u, -1, y)),
  ];
  const floorRings = levels.map(perimeter);
  const roofRibs = along.map((v) => angles.map((theta) => roof(theta, v)));
  const fins = along.map((v, i) => [
    ...levels.map((y) => wall(-1, v, y)),
    ...roofRibs[i].slice(1),
    ...levels
      .slice(0, -1)
      .reverse()
      .map((y) => wall(1, v, y)),
  ]);
  const endMullions = [],
    endFrames = [],
    roofRails = [],
    glass = [];
  for (const v of [-1, 1]) {
    for (const u of across.slice(1, -1)) {
      endMullions.push(levels.map((y) => wall(u, v, y)));
      const top = roof(Math.asin(u), v);
      endMullions.push([wall(u, v, eave), top]);
    }
    endFrames.push(angles.map((theta) => roof(theta, v)));
    endFrames.push(
      angles.map((theta) => {
        const p = roofLocal(theta, v);
        return world([p[0] * 0.97, p[1] - 0.18, p[2]]);
      }),
    );
  }
  for (const theta of [-Math.PI / 4, 0, Math.PI / 4])
    roofRails.push(along.map((v) => roof(theta, v)));
  // Coarse translucent strips follow the actual surfaces; no duplicate shell.
  const glassLevels = [0.77, 4.62, 8.47, 12.705, eave];
  for (let j = 0; j < along.length - 1; j += 4) {
    const a = along[j],
      b = along[j + 4];
    for (const side of [-1, 1])
      for (let i = 0; i < glassLevels.length - 1; i++) {
        const low = glassLevels[i],
          high = glassLevels[i + 1];
        glass.push([
          wall(side, a, low),
          wall(side, b, low),
          wall(side, b, high),
          wall(side, a, high),
        ]);
      }
    for (let i = 0; i < angles.length - 1; i += 4)
      glass.push([
        roof(angles[i], a),
        roof(angles[i], b),
        roof(angles[i + 4], b),
        roof(angles[i + 4], a),
      ]);
  }
  for (const v of [-1, 1])
    for (let j = 0; j < across.length - 1; j += 4) {
      const a = across[j],
        b = across[j + 4];
      for (let i = 0; i < glassLevels.length - 1; i++) {
        const low = glassLevels[i],
          high = glassLevels[i + 1];
        glass.push([
          wall(a, v, low),
          wall(b, v, low),
          wall(b, v, high),
          wall(a, v, high),
        ]);
      }
      glass.push([
        wall(a, v, eave),
        wall(b, v, eave),
        roof(Math.asin(b), v),
        roof(Math.asin(a), v),
      ]);
    }
  return {
    floorRings,
    roofRibs,
    fins,
    endMullions,
    endFrames,
    roofRails,
    glass,
  };
}
