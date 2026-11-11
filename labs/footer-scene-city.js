/**
 * City of London in the existing grey/green line language of footer-scene.
 * One unit = 10 metres; x = east, z = south. No compositional repositioning.
 * See the map data and README for provenance and the limits of the model.
 */
import { cityMap } from "./footer-scene-map.js";
import { createWalkieEnvelope } from "./footer-scene-walkie.js";

// A broad centre with a continuous shoulder into the quiet outer city.
export const contextEmphasis = (x, z) =>
  0.054 + 0.486 * Math.exp(-((Math.hypot(x / 65, z / 53) / 0.78) ** 4));

export function createWireCity() {
  const segments = [],
    glass = [],
    glassBuildings = [],
    surfaces = [],
    lights = [],
    vertices = [],
    landmarks = [];
  const indices = new WeakMap(),
    vertexMap = new Map(),
    edgeMap = new Map();
  let weight = 1,
    isLandmark = true,
    buildingId = "";
  const mix = (a, b, t) => a + (b - a) * t;
  const point = (p) => {
    const key = p.map((v) => v.toFixed(3)).join(",");
    if (!vertexMap.has(key)) {
      indices.set(p, vertices.length);
      vertices.push(p);
      vertexMap.set(key, p);
    }
    return vertexMap.get(key);
  };
  const line = (a, b, tone = 0, strength = 1, detail = 0, normal = null) => {
    if (Math.hypot(...a.map((v, i) => v - b[i])) < 0.015) return;
    const pa = point(a),
      pb = point(b),
      ia = indices.get(pa),
      ib = indices.get(pb);
    const key = `${Math.min(ia, ib)}:${Math.max(ia, ib)}:${tone}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.strength = Math.max(existing.strength, strength * weight);
      existing.detail = Math.min(existing.detail, detail);
      return;
    }
    const segment = {
      a: pa,
      b: pb,
      tone,
      strength: strength * weight,
      detail,
      landmark: isLandmark,
      building: buildingId,
      ...(normal ? { normal } : {}),
    };
    edgeMap.set(key, segment);
    segments.push(segment);
  };
  const path = (points, tone = 0, strength = 1, close = false, detail = 0) => {
    for (let i = 1; i < points.length; i++)
      line(points[i - 1], points[i], tone, strength, detail);
    if (close && points.length > 2)
      line(points.at(-1), points[0], tone, strength, detail);
  };
  const surface = (points) =>
    surfaces.push({
      building: buildingId,
      points: points.map(point),
    });
  const pane = (points) => {
    glass.push(points.map(point));
    glassBuildings.push(buildingId);
  };
  // Horizontal plane cuts keep floors level on tapered / inclined facades.
  const cut = (face, axis, value) => {
    const crossings = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i],
        b = face[(i + 1) % face.length];
      if (
        (a[axis] < value && b[axis] >= value) ||
        (b[axis] < value && a[axis] >= value)
      ) {
        const t = (value - a[axis]) / (b[axis] - a[axis]);
        crossings.push(a.map((v, j) => mix(v, b[j], t)));
      }
    }
    if (crossings.length < 2) return [];
    const ranges = [0, 1, 2].map(
      (j) =>
        Math.max(...crossings.map((p) => p[j])) -
        Math.min(...crossings.map((p) => p[j])),
    );
    const along = ranges.indexOf(Math.max(...ranges));
    crossings.sort((a, b) => a[along] - b[along]);
    const pairs = [];
    for (let i = 0; i + 1 < crossings.length; i += 2)
      pairs.push([crossings[i], crossings[i + 1]]);
    return pairs;
  };
  const floorPitch = {
    "22-bishopsgate": 0.43,
    leadenhall: 0.4,
    "heron-tower": 0.41,
    scalpel: 0.4,
    "100-bishopsgate": 0.4,
    "tower-42": 0.365,
    "st-helens": 0.425,
    lloyds: 0.48,
    "8-bishopsgate": 0.4,
    "40-leadenhall": 0.39,
    willis: 0.43,
  };
  const modelById = new Map(cityMap.buildings.map((b) => [b.id, b]));
  const majorBuildings = cityMap.buildings.filter(
    (building) => building.landmark && building.height >= 15,
  );
  const emphasis = {
    "40-leadenhall": 0.7,
    "one-leadenhall": 0.65,
    lloyds: 0.7,
    willis: 0.75,
    "tower-42": 0.85,
  };
  for (const building of cityMap.buildings) {
    const {
      id,
      center: [x, z],
      faces,
      height,
    } = building;
    buildingId = id;
    isLandmark = building.landmark;
    // The low adjoining volume belongs visually with the Walkie Talkie.
    // Match its stroke strength without changing geometry or landmark routing.
    const isWalkieCompanion = id === "141329945";
    weight = isLandmark ? emphasis[id] || 1 : isWalkieCompanion ? 1 : contextEmphasis(x, z);
    if (!isLandmark && !isWalkieCompanion) {
      const distance = Math.min(
        ...majorBuildings.map((b) =>
          Math.hypot(x - b.center[0], z - b.center[1]),
        ),
      );
      // +5% within 40 m of a major tower, fading smoothly to zero at 120 m.
      const t = Math.max(0, Math.min(1, (distance - 4) / 8));
      weight *= 1 + 0.05 * (1 - t * t * (3 - 2 * t));
    }
    if (isLandmark) landmarks.push({ id, x, z, height });
    for (const face of faces) {
      surface(face);
      const ys = face.map((p) => p[1]),
        low = Math.min(...ys),
        high = Math.max(...ys);
      const roof = high - low < 0.03;
      path(face, 1, 0.9, true);
      if (roof && isWalkieCompanion && low > 0.03) {
        // Roof divisions follow the footprint rather than the global map axes.
        // Clip both directions to this face; keep the existing shell and outline.
        const edge = face.map((p, i) => {
          const q = face[(i + 1) % face.length];
          return [q[0] - p[0], q[2] - p[2]];
        }).sort((a, b) => Math.hypot(...b) - Math.hypot(...a))[0];
        const length = Math.hypot(...edge);
        const ux = edge[0] / length, uz = edge[1] / length;
        const origin = face[0];
        const local = face.map(p => [
          (p[0] - origin[0]) * ux + (p[2] - origin[2]) * uz,
          p[1],
          -(p[0] - origin[0]) * uz + (p[2] - origin[2]) * ux,
        ]);
        const world = p => [
          origin[0] + p[0] * ux - p[2] * uz,
          p[1],
          origin[2] + p[0] * uz + p[2] * ux,
        ];
        for (const [axis, spacing] of [[2, 0.20], [0, 1.2]]) {
          const values = local.map(p => p[axis]);
          const min = Math.min(...values), max = Math.max(...values);
          for (let v = min + spacing; v < max - 0.03; v += spacing)
            for (const [a, b] of cut(local, axis, v))
              // Up-facing ribs have the same primary strength as Sky Garden fins.
              // Keep them out of contour routing: these are surface divisions.
              line(world(a), world(b), axis === 2 ? 1 : 0, axis === 2 ? 0.9 : 0.55, 1, [0, 1, 0]);
        }
      }
      if (roof || high - low < 0.22) continue;
      const pitch = isLandmark ? floorPitch[id] || 0.4 : 1.2;
      for (
        let y = Math.ceil((low + 0.025) / pitch) * pitch;
        y < high - 0.025;
        y += pitch
      )
        for (const [a, b] of cut(face, 1, y))
          line(a, b, 0, 0.63, isLandmark || isWalkieCompanion ? 1 : 2);
      if (!isLandmark) continue;
      const xs = face.map((p) => p[0]),
        zs = face.map((p) => p[2]);
      const axis =
        Math.max(...xs) - Math.min(...xs) > Math.max(...zs) - Math.min(...zs)
          ? 0
          : 2;
      const values = face.map((p) => p[axis]);
      const spacing = id === "40-leadenhall" ? 0.24 : 0.42;
      for (
        let v = Math.ceil((Math.min(...values) + 0.025) / spacing) * spacing;
        v < Math.max(...values) - 0.025;
        v += spacing
      )
        for (const [a, b] of cut(face, axis, v)) line(a, b, 0, 0.58, 1);
      // Tiny split faces add draw calls but no visible glass at footer scale.
      const span = Math.max(...values) - Math.min(...values);
      if ((high - low) * span > 5 && face.length <= 12) pane(face);
    }
  }
  isLandmark = true;
  weight = 1;
  // Parallel east/west facade fins wrap over the roof without converging.
  const walkie = modelById.get("walkie-talkie");
  buildingId = walkie.id;
  const envelope = createWalkieEnvelope(walkie);
  envelope.floorRings.forEach((ring, i) =>
    path(ring, i ? 0 : 1, 0.62, true, i ? 1 : 0),
  );
  envelope.fins.forEach((fin, i) =>
    path(fin, i % 2 ? 0 : 1, i % 2 ? 0.6 : 0.9, false, i % 2 ? 1 : 0),
  );
  envelope.endMullions.forEach((points) => path(points, 0, 0.6, false, 1));
  envelope.endFrames.forEach((points) => path(points, 1, 0.9));
  envelope.roofRails.forEach((points) => path(points, 0, 0.55, false, 1));
  envelope.glass.forEach(pane);
  // The occlusion shell uses the same sampled fins as the visible drawing.
  // Include the ground-level walls and both ends, not just decorative glass.
  for (let j = 1; j < envelope.fins.length; j++)
    for (let i = 1; i < envelope.fins[j].length; i++)
      surface([
        envelope.fins[j - 1][i - 1],
        envelope.fins[j][i - 1],
        envelope.fins[j][i],
        envelope.fins[j - 1][i],
      ]);
  for (const fin of [envelope.fins[0], envelope.fins.at(-1)]) surface(fin);
  // 30 St Mary Axe: 180 m height, 56.6 m maximum diameter, rounded top lens.
  const g = modelById.get("gherkin");
  buildingId = g.id;
  const profile = [
    [0, 2.02],
    [0.04, 2.2],
    [0.16, 2.61],
    [0.28, 2.82],
    [0.39, 2.83],
    [0.52, 2.69],
    [0.65, 2.36],
    [0.77, 1.97],
    [0.87, 1.55],
    [0.94, 1.08],
    [0.98, 0.62],
    [0.996, 0.25],
    [1, 0],
  ];
  const radiusAt = (t) => {
    const i = Math.max(0, profile.findIndex((p) => p[0] >= t) - 1);
    const a = profile[i],
      b = profile[Math.min(i + 1, profile.length - 1)];
    return mix(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1));
  };
  const gp = (t, a) => [
    g.center[0] + radiusAt(t) * Math.cos(a),
    18 * t,
    g.center[1] + radiusAt(t) * Math.sin(a),
  ];
  const levels = 40,
    sectors = 36;
  for (let i = 0; i < levels; i++) {
    const ring = Array.from({ length: sectors }, (_, j) =>
      gp(i / levels, (j * Math.PI * 2) / sectors),
    );
    path(ring, i === 0 ? 1 : 0, i === 0 ? 0.95 : 0.57, true, i === 0 ? 0 : 1);
  }
  for (const direction of [-1, 1])
    for (let j = 0; j < 18; j++) {
      const rib = Array.from({ length: levels + 1 }, (_, i) =>
        gp(i / levels, (j * Math.PI) / 9 + (direction * i * Math.PI) / 36),
      );
      path(
        rib,
        j % 3 === 0 ? 1 : 0,
        j % 3 === 0 ? 0.9 : 0.78,
        false,
        j % 3 === 0 ? 0 : 1,
      );
      if (direction === 1 && j % 6 === 1) path(rib.slice(1, 28), 2, 0.35);
    }
  for (let j = 0; j < sectors; j++)
    for (let i = 0; i < levels; i++)
      surface([
        gp(i / levels, (j * Math.PI * 2) / sectors),
        gp(i / levels, ((j + 1) * Math.PI * 2) / sectors),
        gp((i + 1) / levels, ((j + 1) * Math.PI * 2) / sectors),
        gp((i + 1) / levels, (j * Math.PI * 2) / sectors),
      ]);
  for (let j = 0; j < 18; j++)
    for (let i = 0; i < 6; i++)
      pane([
        gp(i / 6, (j * Math.PI) / 9),
        gp(i / 6, ((j + 1) * Math.PI) / 9),
        gp((i + 1) / 6, ((j + 1) * Math.PI) / 9),
        gp((i + 1) / 6, (j * Math.PI) / 9),
      ]);

  // 70 St Mary Axe: the arch spans the short NE/SW footprint axis.
  // The barrel runs NW/SE, with flat glazed gable ends facing NW and SE.
  const ham = modelById.get("70-st-mary-axe");
  buildingId = ham.id;
  const footprint = ham.footprint;
  let edgeIndex = 0;
  for (let i = 1; i < 4; i++)
    if (
      Math.hypot(...footprint[(i + 1) % 4].map((v, j) => v - footprint[i][j])) <
      Math.hypot(
        ...footprint[(edgeIndex + 1) % 4].map(
          (v, j) => v - footprint[edgeIndex][j],
        ),
      )
    )
      edgeIndex = i;
  const origin = footprint[edgeIndex],
    across = footprint[(edgeIndex + 1) % 4],
    end = footprint[(edgeIndex + 3) % 4];
  const hp = (u, v, y) => [
    origin[0] + u * (across[0] - origin[0]) + v * (end[0] - origin[0]),
    y,
    origin[1] + u * (across[1] - origin[1]) + v * (end[1] - origin[1]),
  ];
  const crown = (u) =>
    3.8 + 5.25 * Math.sqrt(Math.max(0, 1 - (u * 2 - 1) ** 2));
  // Reference-based lower curvature: 18% narrower at ground level,
  // joining the widest section tangentially at 38 m.
  const lowerWidth = (y) => Math.sqrt(1 - (1 - 0.82 ** 2) * (1 - y / 3.8) ** 2);
  const lowerU = (side, y) => 0.5 + (side - 0.5) * lowerWidth(y);
  const section = [
    ...Array.from({ length: 13 }, (_, i) => {
      const y = (3.8 * i) / 12;
      return [lowerU(0, y), y, 0];
    }),
    ...Array.from({ length: 32 }, (_, i) => {
      const u = (i + 1) / 32;
      return [u, crown(u), 0];
    }),
    ...Array.from({ length: 12 }, (_, i) => {
      const y = (3.8 * (11 - i)) / 12;
      return [lowerU(1, y), y, 0];
    }),
  ];
  for (const v of [0, 1]) {
    const outline = section.map(([u, y]) => hp(u, v, y));
    path(outline, 1, 0.9, true);
    pane(outline);
    surface(outline);
    for (let y = 0.4; y < 9.05; y += 0.4)
      for (const [a, b] of cut(section, 1, y))
        line(hp(a[0], v, a[1]), hp(b[0], v, b[1]), 0, 0.6, 1);
    for (let i = 1; i < 16; i++)
      for (const [a, b] of cut(section, 0, i / 16))
        line(hp(a[0], v, a[1]), hp(b[0], v, b[1]), 0, 0.55, 1);
  }
  for (let i = 1; i < section.length; i++) {
    const [u0, y0] = section[i - 1],
      [u1, y1] = section[i];
    surface([hp(u0, 0, y0), hp(u1, 0, y1), hp(u1, 1, y1), hp(u0, 1, y0)]);
  }
  for (let i = 0; i <= 16; i++)
    line(
      hp(i / 16, 0, crown(i / 16)),
      hp(i / 16, 1, crown(i / 16)),
      i % 4 ? 0 : 1,
      0.75,
      i % 4 ? 1 : 0,
    );
  for (const u of [0, 1]) {
    // Follow the same lower curve on both long sides; no rectangular skirt.
    path(
      [
        ...Array.from({ length: 13 }, (_, i) => {
          const y = (3.8 * i) / 12;
          return hp(lowerU(u, y), 0, y);
        }),
        ...Array.from({ length: 13 }, (_, i) => {
          const y = (3.8 * (12 - i)) / 12;
          return hp(lowerU(u, y), 1, y);
        }),
      ],
      1,
      0.9,
      true,
    );
  }

  // Leadenhall's megaframes follow the real north/south section.
  const lead = modelById.get("leadenhall");
  buildingId = lead.id;
  const leadFace = lead.faces.filter(
    (f) =>
      Math.max(...f.map((p) => p[1])) > 21 &&
      Math.min(...f.map((p) => p[1])) < 3 &&
      Math.max(...f.map((p) => p[0])) - Math.min(...f.map((p) => p[0])) < 0.15,
  );
  for (const face of leadFace)
    for (let y = 2.85; y < 21; y += 2.8) {
      const lower = cut(face, 1, y)[0],
        upper = cut(face, 1, Math.min(y + 2.8, 22.3))[0];
      if (lower && upper) {
        line(lower[0], upper[1], 1, 0.9);
        line(lower[1], upper[0], 1, 0.9);
      }
    }
  isLandmark = false;
  buildingId = "streets";
  weight = 0.55;
  const illuminated = new Set([
    "Bishopsgate",
    "Leadenhall Street",
    "St Mary Axe",
    "Saint Mary Axe",
    "Fenchurch Street",
    "Houndsditch",
  ]);
  for (const street of cityMap.streets) {
    const green = illuminated.has(street.name);
    path(
      street.points.map(([x, z]) => [x, 0.025, z]),
      green ? 2 : 0,
      green ? 0.8 : 0.45,
      false,
      green ? 0 : 2,
    );
  }
  // Same lighting language/power, now anchored to the geographic architecture.
  weight = 1;
  isLandmark = true;
  for (const [id, power] of [
    ["walkie-talkie", 0.8],
    ["leadenhall", 0.9],
    ["22-bishopsgate", 0.8],
    ["gherkin", 0.88],
    ["heron-tower", 0.7],
    ["scalpel", 0.8],
    ["lloyds", 0.7],
    ["40-leadenhall", 0.6],
  ]) {
    const b = modelById.get(id),
      [x, z] = b.center;
    lights.push({ building: id, x, z, y: 0.2, r: 4.6, h: 3.5, power });
    if (id !== "lloyds" && id !== "40-leadenhall")
      lights.push({
        building: id,
        x,
        z,
        y: b.height * 0.3,
        r: id === "22-bishopsgate" ? 2.9 : 1.8,
        h: b.height * 0.45,
        power: power * 0.65,
      });
    buildingId = id;
    const facade = b.faces.find(
      (f) => f.some((p) => p[1] < 0.5) && f.some((p) => p[1] > 5),
    );
    if (facade) {
      const pair = cut(facade, 1, 0.7)[0];
      if (pair) line(pair[0], pair[1], 2, 0.5);
    }
  }
  return {
    segments,
    glass,
    glassBuildings,
    surfaces,
    lights,
    vertices,
    indices,
    landmarks,
    buildings: cityMap.buildings.length,
    camera: {
      distance: 125,
      targetY: 7.4,
      yaw: 2.418,
      pitch: 0.2285,
      compactYaw: 2.418,
      compactPitch: 0.30,
      framingScale: 0.925,
      framingOffsetY: 0.12,
    },
    framing: [
      [-5, 0, 32],
      [-5, 0, -34],
      [18, 0, 32],
      [18, 0, -34],
      ...landmarks
        .filter((b) => ["22-bishopsgate", "heron-tower"].includes(b.id))
        .map((b) => [b.x, b.height, b.z]),
    ],
    ground: [
      [-76, -0.17, -66],
      [76, -0.17, -66],
      [76, -0.17, 66],
      [-76, -0.17, 66],
    ],
  };
}
