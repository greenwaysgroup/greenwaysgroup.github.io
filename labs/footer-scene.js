/**
 * Architectural light sculpture for the shared site footer.
 * A three-dimensional wire model, glass veils, reflected linework and local light.
 * No labels, stages, quantities or informational overlays.
 */
import { createWireCity } from "./footer-scene-city.js";
import { cityMap } from "./footer-scene-map.js";
import { createDepthField } from "./footer-scene-depth.js";
import { createLightRoutes, createSignalCircuits } from "./footer-scene-traces.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => {
  const x = clamp((v - a) / (b - a), 0, 1);
  return x * x * (3 - 2 * x);
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (c, a) => "rgba(" + c.join(",") + "," + a + ")";

document.querySelectorAll("[data-footer-scene-stage]").forEach((root) => {
  if (root.dataset.wireInitialized) return;
  root.dataset.wireInitialized = "true";
  const canvas = root.querySelector("[data-footer-scene-canvas]");
  const ctx = canvas?.getContext("2d", { alpha: true });
  if (!ctx) return;
  const city = createWireCity();
  const traceSpeed = 2.6244; // Shared timing for contours and building-light completion.
  const buildingLights = city.lights.map(light => ({
    ...light,
    r: light.r * 1.38,
    h: light.h * 1.38,
  }));
  const litBuildings = new Set();
  let lastLightingTime = 0, lightingTracks = null;
  const depthField = createDepthField(city.surfaces, city.camera.distance);
  const circuits = createSignalCircuits(city, createLightRoutes(city));
  // Bound each drawing's extent without cutting a building contour in half.
  // Successive sections eventually cover every component of the street graph.
  const lightRoutes = [];
  for(const circuit of circuits) {
    let parts=[],length=0;
    const finish=()=>{if(parts.length)lightRoutes.push({parts,length});parts=[];length=0;};
    for(const part of circuit.parts){
      if(length>=140 && part.building==='streets' && parts.at(-1)?.building==='streets')finish();
      const d=part.end-part.start;
      parts.push({...part,start:length,end:length+d});length+=d;
    }
    finish();
  }
  // Keep simultaneous drawings in separate areas of the city. The routes and
  // their geometry stay intact; only their scheduling and overlap change.
  const buildingDrawings=lightRoutes.filter(r=>r.parts.some(p=>p.building!=='streets'));
  const roadDrawings=lightRoutes.filter(r=>r.parts.every(p=>p.building==='streets'));
  const makeTracks=(buildingCount,roadCount,viewYaw)=>{
    const tracks=[];
    const rightX=Math.cos(viewYaw),rightZ=-Math.sin(viewYaw);
    for(const [pool,count] of [[buildingDrawings,buildingCount],[roadDrawings,roadCount]]) {
      if(!pool.length)continue;
      const lanes=Math.min(count,pool.length);
      // Balance left, centre and right using actual route positions, not the
      // traversal order of the street graph. Buildings take priority over approaches.
      const ordered=pool.map(route=>{
        const facades=route.parts.filter(part=>part.building!=='streets');
        const parts=facades.length?facades:route.parts;
        let position=0,weight=0;
        for(const part of parts) {
          const length=part.end-part.start;
          position+=((part.a[0]+part.b[0])*rightX+(part.a[2]+part.b[2])*rightZ)*.5*length;
          weight+=length;
        }
        return {route,position:position/weight};
      }).sort((a,b)=>a.position-b.position);
      for(let lane=0;lane<lanes;lane++) {
        const area=ordered.slice(
          Math.floor(lane*ordered.length/lanes),
          Math.floor((lane+1)*ordered.length/lanes),
        );
        const middle=Math.floor(area.length/2);
        const sequence=[...area.slice(middle),...area.slice(0,middle)];
        const entries=[];let total=0;
        for(const {route} of sequence) {
          const drawing=Math.max(2.5,Math.min(20,route.length/11));
          // Completion belongs to the whole building contour, including its descent.
          const ends = new Map();
          for (const part of route.parts)
            if (part.building !== 'streets') ends.set(part.building, part.end);
          const completions = [...ends].map(([building, end]) => ({
            building, at: drawing * end / route.length,
          }));
          entries.push({route,start:total,drawing,duration:drawing+1.8,completions});
          // The next drawing grows while the previous complete contour fades.
          total+=sequence.length>1?drawing*.82:drawing+1.8;
        }
        // A route must finish fading before its own cycle can restart.
        total=Math.max(total,...entries.map(entry=>entry.duration));
        const first=entries[0];
        const facade=first.route.parts.find(part=>part.building!=='streets');
        const initialReach=facade
          ? facade.start+(facade.end-facade.start)*(.45+lane*.10)
          : first.route.length*(.35+lane*.10);
        const offset=first.drawing*initialReach/first.route.length;
        tracks.push({entries,total,offset});
      }
    }
    return tracks;
  };
  const drawingTracks={
    desktop:makeTracks(5,4,city.camera.yaw),
    compact:makeTracks(3,3,city.camera.compactYaw),
  };
  const contourStrength = new Map();
  for (const segment of city.segments) {
    if (segment.tone === 1 && segment.detail === 0)
      contourStrength.set(segment.building, Math.max(contourStrength.get(segment.building) || 0, segment.strength));
  }
  let depthView = "";
  // Match the live Home footer's drag sensitivity and frame-independent release.
  const orbitFriction = 1.2 / (1.3 * 1.4);
  const orbitReleaseBoost = (1.45 * 1.3) / 0.7;
  const projected = city.vertices.map(() => [0, 0, 0, 0]);
  // Precompute each line's horizontal facing relative to its own building.
  // The map is already loaded by createWireCity; this adds no new asset.
  // Zero is a deliberate sentinel for street lines and centre-axis details.
  const buildingCenters = new Map(
    cityMap.buildings.map((b) => [b.id, b.center]),
  );
  const facadeSides = new Float32Array(city.segments.length * 2);
  city.segments.forEach((segment, i) => {
    const center = buildingCenters.get(segment.building);
    if (!center) return;
    const dx = (segment.a[0] + segment.b[0]) * 0.5 - center[0];
    const dz = (segment.a[2] + segment.b[2]) * 0.5 - center[1];
    const radius = Math.hypot(dx, dz);
    if (radius > 0.15) {
      facadeSides[2 * i] = dx / radius;
      facadeSides[2 * i + 1] = dz / radius;
    }
  });
  // Reuse the architectural drawing whenever the camera is stationary.
  // Play advances the street/building signals without automatic camera rotation.
  const architecture = document.createElement("canvas");
  const architectureContext = architecture.getContext("2d", { alpha: true });
  if (!architectureContext) return;
  let architectureView = "";
  const bloom = document.createElement("canvas");
  const bctx = bloom.getContext("2d", { alpha: true });
  if (!bctx) return;
  const style = getComputedStyle(root);
  const color = (name, backup) => {
    const value = style.getPropertyValue(name).trim();
    return rgb(/^#[0-9a-f]{6}$/i.test(value) ? value : backup);
  };
  const colors = {
    ink: color("--color-ink", "#080808"),
    grey: color("--color-paper", "#f2f0e8"),
    green: color("--color-signal", "#53d43d"),
  };
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const plus = root.querySelector("[data-footer-scene-in]");
  const minus = root.querySelector("[data-footer-scene-out]");
  const motion = root.querySelector("[data-footer-scene-motion]");
  const reset = root.querySelector("[data-footer-scene-reset]");
  let width = 1,
    height = 1,
    dpr = 1,
    compact = false;
  let home = { yaw: city.camera.yaw, pitch: city.camera.pitch };
  let yaw = home.yaw,
    pitch = home.pitch,
    zoom = 0.88,
    targetZoom = 0.88;
  let scale = 1,
    offsetY = 0;
  let paused = reduce.matches,
    manualOrbit = false,
    visible = false,
    dirty = true;
  let age = 0,
    raf = 0,
    lastTime = 0,
    lastPaint = 0;
  let yawVelocity = 0,
    pitchVelocity = 0,
    previousMove = 0,
    pinch = 0,
    dragged = false;
  const pointers = new Map();

  function wake() {
    dirty = true;
    if (visible && !document.hidden && !raf) raf = requestAnimationFrame(frame);
  }
  function controls() {
    root.dataset.wireZoom = targetZoom.toFixed(3);
    plus.disabled = targetZoom >= 1.6499;
    minus.disabled = targetZoom <= 0.6801;
    const stopped = paused;
    motion.setAttribute("aria-pressed", String(stopped));
    motion.setAttribute(
      "aria-label",
      stopped ? "Resume animation" : "Pause animation",
    );
  }

  function basis(a = yaw, p = pitch) {
    const sa = Math.sin(a),
      ca = Math.cos(a),
      sp = Math.sin(p),
      cp = Math.cos(p);
    return {
      right: [ca, 0, -sa],
      up: [-sp * sa, cp, -sp * ca],
      eye: [sa * cp, sp, ca * cp],
    };
  }
  function coordinates(p, b, result = [0, 0, 0, 0]) {
    const x = p[0],
      y = p[1] - city.camera.targetY,
      z = p[2];
    const depth = x * b.eye[0] + y * b.eye[1] + z * b.eye[2];
    const perspective = city.camera.distance / (city.camera.distance - depth);
    result[0] = (x * b.right[0] + z * b.right[2]) * perspective;
    result[1] = (x * b.up[0] + y * b.up[1] + z * b.up[2]) * perspective;
    result[2] = depth;
    result[3] = perspective;
    return result;
  }
  function projector(update = true) {
    const b = basis();
    const project = (p, result = [0, 0, 0, 0]) => {
      const q = coordinates(p, b, result);
      result[0] = width * 0.5 + q[0] * scale * zoom;
      result[1] = height * 0.47 - (q[1] - offsetY) * scale * zoom;
      result[2] = q[2];
      result[3] = q[3] * scale * zoom;
      return result;
    };
    // Shared vertices are projected once per frame, including glass and ribs.
    if (update) city.vertices.forEach((p, i) => project(p, projected[i]));
    return (p) => {
      const index = city.indices.get(p);
      return index === undefined ? project(p) : projected[index];
    };
  }
  function resize() {
    const rect = root.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nextCompact = rect.width < 650;
    if (compact !== nextCompact) {
      home = {
        yaw: nextCompact ? city.camera.compactYaw : city.camera.yaw,
        pitch: nextCompact ? city.camera.compactPitch : city.camera.pitch,
      };
      if (!manualOrbit) {
        yaw = home.yaw;
        pitch = home.pitch;
      }
    }
    compact = nextCompact;
    width = rect.width;
    height = rect.height;
    dpr = Math.min(devicePixelRatio || 1, 1.65);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    architecture.width = canvas.width;
    architecture.height = canvas.height;
    architectureView = "";
    bloom.width = Math.max(1, Math.round(width * 0.5));
    bloom.height = Math.max(1, Math.round(height * 0.5));
    depthField.resize(width, height);
    depthView = "";
    const b = basis(home.yaw, home.pitch);
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    city.framing.forEach((p) => {
      const q = coordinates(p, b);
      minX = Math.min(minX, q[0]);
      maxX = Math.max(maxX, q[0]);
      minY = Math.min(minY, q[1]);
      maxY = Math.max(maxY, q[1]);
    });
    scale = Math.min(
      ((width - (compact ? 20 : 42)) / (maxX - minX)) * (compact ? 1.7 : 1.04),
      (height - 145) / (maxY - minY),
    );
    // Keep the reference composition proportional across desktop viewports.
    if (!compact) scale *= city.camera.framingScale;
    offsetY = (maxY + minY) * 0.5 + (compact ? 0 : city.camera.framingOffsetY);
    wake();
  }

  function polygon(points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++)
      ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }
  function ground(project) {
    // The stage CSS owns the entire backdrop. Keep the projected perimeter
    // only to bound the existing line reflections; never paint a ground
    // polygon, which makes visible straight-edged shades during rotation.
    return city.ground.map(project);
  }

  function reflection(project, floor) {
    ctx.save();
    polygon(floor);
    ctx.clip();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(1.7px)";
    const groups = new Map();
    city.segments.forEach((segment) => {
      const high = Math.max(segment.a[1], segment.b[1]);
      if (high > 3.8) return;
      const middle = project(segment.a.map((v, i) => (v + segment.b[i]) / 2));
      const strength =
        (1 - high / 3.8) ** 2 *
        segment.strength *
        depthField.at(middle, segment.building);
      const bucket = clamp(Math.round(strength * 3), 0, 3);
      if (!bucket) return;
      const green = segment.tone >= 2;
      const key = (green ? "g" : "n") + bucket;
      if (!groups.has(key))
        groups.set(key, { path: new Path2D(), green, bucket });
      const group = groups.get(key);
      const a = project([
        segment.a[0],
        -0.15 - segment.a[1] * 0.75,
        segment.a[2],
      ]);
      const b = project([
        segment.b[0],
        -0.15 - segment.b[1] * 0.75,
        segment.b[2],
      ]);
      group.path.moveTo(a[0], a[1]);
      group.path.lineTo(b[0], b[1]);
    });
    for (const group of groups.values()) {
      ctx.strokeStyle = rgba(
        group.green ? colors.green : colors.grey,
        (group.bucket / 3) * (group.green ? 0.16 : 0.065),
      );
      ctx.lineWidth = group.green ? 1.1 : 0.6;
      ctx.stroke(group.path);
    }
    ctx.restore();
  }

  // The estimator's radial stops: 18% core, 5.5% at 45%, transparent at 80%.
  function lightPool(project, light, power) {
    const c = project([light.x, 0.025, light.z]);
    power *= depthField.at(c, light.building);
    const a = project([light.x + light.r, 0.025, light.z]);
    const b = project([light.x, 0.025, light.z + light.r]);
    ctx.save();
    ctx.transform(
      a[0] - c[0],
      a[1] - c[1],
      b[0] - c[0],
      b[1] - c[1],
      c[0],
      c[1],
    );
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, rgba(colors.green, 0.18 * power));
    g.addColorStop(0.45, rgba(colors.green, 0.055 * power));
    g.addColorStop(0.8, rgba(colors.green, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function lightVolume(project, light, power) {
    power *= depthField.at(
      project([light.x, light.y + light.h * 0.5, light.z]),
      light.building,
    );
    const bottom = project([light.x, light.y, light.z]);
    const top = project([light.x, light.y + light.h, light.z]);
    const r = light.r * bottom[3] * 0.55;
    ctx.save();
    ctx.transform(
      r,
      0,
      top[0] - bottom[0],
      top[1] - bottom[1],
      bottom[0],
      bottom[1],
    );
    const g = ctx.createRadialGradient(0, 0.48, 0, 0, 0.48, 0.85);
    g.addColorStop(0, rgba(colors.green, 0.18 * power));
    g.addColorStop(0.36, rgba(colors.green, 0.055 * power));
    g.addColorStop(1, rgba(colors.green, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-1.2, -0.2, 2.4, 1.5);
    const rim = ctx.createRadialGradient(0, 0.35, 0, 0, 0.35, 0.48);
    rim.addColorStop(0, rgba(colors.grey, 0.055 * power));
    rim.addColorStop(1, rgba(colors.grey, 0));
    ctx.fillStyle = rim;
    ctx.fillRect(-0.65, -0.1, 1.3, 1.2);
    if (light.y > 1.5) {
      const core = ctx.createRadialGradient(0, 0.48, 0, 0, 0.48, 0.46);
      core.addColorStop(0, rgba(colors.green, 0.4 * power));
      core.addColorStop(0.3, rgba(colors.green, 0.17 * power));
      core.addColorStop(0.65, rgba(colors.green, 0.055 * power));
      core.addColorStop(1, rgba(colors.green, 0));
      ctx.fillStyle = core;
      ctx.fillRect(-0.6, -0.05, 1.2, 1.15);
    }
    ctx.restore();
  }

  function glass(project) {
    const panes = city.glass
      .map((points, i) => {
        const p = points.map(project);
        const center = points[0].map(
          (_, j) => points.reduce((n, q) => n + q[j], 0) / points.length,
        );
        const transmission = depthField.at(
          project(center),
          city.glassBuildings[i],
        );
        return {
          p,
          transmission,
          depth: p.reduce((n, q) => n + q[2], 0) / p.length,
        };
      })
      .sort((a, b) => a.depth - b.depth);
    for (const { p, transmission } of panes) {
      const xs = p.map((q) => q[0]),
        ys = p.map((q) => q[1]);
      const left = Math.min(...xs),
        right = Math.max(...xs);
      const top = Math.min(...ys),
        bottom = Math.max(...ys);
      if (
        right < 0 ||
        left > width ||
        bottom < 0 ||
        top > height ||
        bottom - top < 1
      )
        continue;
      polygon(p);
      const gradient = ctx.createLinearGradient(
        (left + right) / 2,
        bottom,
        (left + right) / 2,
        top,
      );
      gradient.addColorStop(0, rgba(colors.grey, 0.028 * transmission));
      gradient.addColorStop(0.5, rgba(colors.grey, 0.012 * transmission));
      gradient.addColorStop(1, rgba(colors.green, 0.018 * transmission));
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  function wirework(project) {
    const groups = new Map(),
      emission = Array.from({ length: 4 }, () => new Path2D()),
      softEdges = new Path2D();
    const eye = basis().eye;
    const eyeLength = Math.hypot(eye[0], eye[2]) || 1;
    const eyeX = eye[0] / eyeLength;
    const eyeZ = eye[2] / eyeLength;
    city.segments.forEach((segment, i) => {
      if (compact && segment.detail === 2 && !segment.landmark) return;
      const a = project(segment.a),
        b = project(segment.b);
      if (
        (a[0] < -24 && b[0] < -24) ||
        (a[0] > width + 24 && b[0] > width + 24) ||
        (a[1] < -24 && b[1] < -24) ||
        (a[1] > height + 24 && b[1] > height + 24)
      )
        return;
      // Depth comes from the current camera orientation: positive values are
      // closer to the viewer. Finer buckets avoid visible changes as it orbits.
      const distance = (a[2] + b[2]) * 0.5;
      // Suppress see-through back-facade lines, not all distant buildings.
      // A continuous near/far-facing response follows camera rotation.
      // Keep the outline of a rear silhouette visible, while fine glazing
      // and mullions from the opposite wall recede more strongly.
      const sideX = facadeSides[2 * i];
      const sideZ = facadeSides[2 * i + 1];
      const facing = sideX * eyeX + sideZ * eyeZ;
      const rearFloor = segment.detail > 0 ? 0.2 : 0.36;
      // A roof faces upward, not outward from the building's horizontal centre.
      // Explicit surface normals preserve the same depth and occlusion rules.
      const surfaceFacing = segment.normal
        ? segment.normal[0] * eye[0] + segment.normal[1] * eye[1] + segment.normal[2] * eye[2]
        : facing;
      const faceVisibility =
        segment.normal || sideX || sideZ
          ? rearFloor + (1 - rearFloor) * smooth(-0.65, 0.1, surfaceFacing)
          : 1;
      const depthSteps = 12; // finer than the original five depth planes
      // A tighter camera-depth span makes nearby facades stand out from the
      // overlapping skyline without changing the geographic model.
      const depth = clamp(
        Math.round(smooth(-32, 32, distance) * depthSteps),
        0,
        depthSteps,
      );
      // Preserve the camera/depth rules and give the facade framework a
      // gentle hierarchy: outlines stay legible, while internal floor grids
      // and mullions recede without deleting a single segment.
      const linePriority =
        segment.tone >= 2
          ? 1
          : segment.tone === 1
            ? 1
            : segment.detail > 0
              ? 0.86
              : 0.96;
      depthField.fragments(a, b, segment.building, (from, to, transmission) => {
        const level = clamp(
          Math.round(
            segment.strength *
              faceVisibility *
              linePriority *
              transmission *
              32,
          ),
          0,
          32,
        );
        if (!level) return;
        const ax = lerp(a[0], b[0], from),
          ay = lerp(a[1], b[1], from);
        const bx = lerp(a[0], b[0], to),
          by = lerp(a[1], b[1], to);
        const key = segment.tone * 1000 + depth * 40 + level;
        if (!groups.has(key))
          groups.set(key, {
            path: new Path2D(),
            tone: segment.tone,
            depth: depth / depthSteps,
            level: level / 32,
          });
        const group = groups.get(key);
        group.path.moveTo(ax, ay);
        group.path.lineTo(bx, by);
        if (segment.tone >= 2) {
          const glow = Math.round(
            segment.strength *
              faceVisibility *
              transmission *
              (0.45 + 0.7 * (depth / depthSteps)) *
              4,
          );
          if (glow > 0) {
            const path = emission[clamp(glow - 1, 0, 3)];
            path.moveTo(ax, ay);
            path.lineTo(bx, by);
          }
        } else if (
          segment.tone === 1 &&
          segment.strength > 0.8 &&
          faceVisibility > 0.75 &&
          transmission > 0.9 &&
          depth / depthSteps > 0.68
        ) {
          softEdges.moveTo(ax, ay);
          softEdges.lineTo(bx, by);
        }
      });
    });

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, bloom.width, bloom.height);
    bctx.setTransform(0.5, 0, 0, 0.5, 0, 0);
    emission.forEach((path, i) => {
      bctx.strokeStyle = rgba(colors.green, 0.75 * ((i + 1) / 4));
      bctx.lineWidth = i > 1 ? 1.6 : 1.1;
      bctx.stroke(path);
    });
    bctx.strokeStyle = rgba(colors.grey, 0.055);
    bctx.lineWidth = 1.1;
    bctx.stroke(softEdges);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.filter = "blur(11px)";
    ctx.globalAlpha = 0.4;
    ctx.drawImage(bloom, 0, 0, width, height);
    ctx.filter = "blur(3px)";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(bloom, 0, 0, width, height);
    ctx.restore();

    // Established GWG stroke palette, with distance and zoom hierarchy.
    const alpha = [0.205, 0.6848, 0.62, 0.9];
    const widths = [0.58, 0.945, 0.82, 1.08];
    // Stronger near/far separation while preserving the original architectural
    // detail levels. Interpolated zoom applies additional emphasis smoothly.
    const zoomIn = smooth(1, 1.65, zoom);
    const zoomOut = 1 - smooth(0.68, 1, zoom);
    for (const group of groups.values()) {
      const near = group.depth;
      const baseContrast = 0.18 + 1.36 * near;
      const zoomContrast =
        (1 + zoomIn * (0.28 * near)) *
        (1 - zoomOut * (0.06 + 0.22 * (1 - near)));
      const opacity = clamp(
        alpha[group.tone] *
          group.level *
          baseContrast *
          zoomContrast *
          (group.tone === 0 ? 0.9 : 1),
        0,
        0.96,
      );
      const baseWidth = 0.58 + 1.02 * near;
      const zoomWidth =
        (1 + zoomIn * (0.03 + 0.34 * near)) *
        (1 - zoomOut * (0.1 + 0.16 * (1 - near)));
      ctx.strokeStyle = rgba(
        group.tone >= 2 ? colors.green : colors.grey,
        opacity,
      );
      ctx.lineWidth = widths[group.tone] * baseWidth * zoomWidth;
      ctx.stroke(group.path);
    }
  }

  function updateBuildingLights() {
    const tracks = compact ? drawingTracks.compact : drawingTracks.desktop;
    const clock = age * traceSpeed;
    // A responsive layout change starts observing its own schedule from now;
    // previously illuminated buildings stay lit, without replaying past events.
    if (lightingTracks !== tracks) {
      lightingTracks = tracks;
      lastLightingTime = clock;
      return false;
    }
    let changed = false;
    for (const track of tracks)
      for (const entry of track.entries)
        for (const completion of entry.completions) {
          if (litBuildings.has(completion.building)) continue;
          const event = entry.start + completion.at - track.offset;
          const before = Math.floor((lastLightingTime - event) / track.total);
          const after = Math.floor((clock - event) / track.total);
          if (after > before) {
            litBuildings.add(completion.building);
            changed = true;
          }
        }
    lastLightingTime = clock;
    return changed;
  }

  function traces(project) {
    if (!lightRoutes.length) return;
    const groups = new Map();
    const eye=basis().eye;
    const eyeLength=Math.hypot(eye[0],eye[2])||1;
    const zoomIn=smooth(1,1.65,zoom), zoomOut=1-smooth(.68,1,zoom);
    // Staggered drawings begin mid-contour; adjacent drawings overlap without a blank interval.
    // Each completed section fades uniformly, never turning into a moving dash.
    for(const track of compact?drawingTracks.compact:drawingTracks.desktop) {
      const clock=(age*traceSpeed+track.offset)%track.total;
      for(const entry of track.entries) {
        const time=(clock-entry.start+track.total)%track.total;
        if(time>=entry.duration)continue;
        const route=entry.route;
        const reach=Math.min(1,time/entry.drawing)*route.length;
        const fade=(1-smooth(entry.drawing+.3,entry.duration,time))* .94;
        for(const part of route.parts) {
          if(part.start>=reach)break;
          const t=Math.min(1,(reach-part.start)/(part.end-part.start));
          const a=project(part.a);
          const b=project(part.a.map((v,j)=>lerp(v,part.b[j],t)));
          const center=buildingCenters.get(part.building);
          let facing=1;
          if(center) {
            const dx=(part.a[0]+part.b[0])*.5-center[0];
            const dz=(part.a[2]+part.b[2])*.5-center[1];
            const radius=Math.hypot(dx,dz);
            if(radius>.15)facing=.68+.32*smooth(-.65,.1,(dx*eye[0]+dz*eye[2])/(radius*eyeLength));
          }
          const depth=clamp(Math.round(smooth(-32,32,(a[2]+b[2])*.5)*12),0,12);
          const strength=Math.max(.82,contourStrength.get(part.building)??.82)*facing*fade;
          depthField.fragments(a,b,part.building,(from,to,transmission)=>{
            // Geographic falloff follows the city footprint, including during rotation.
            // Sample each visible fragment so long streets fade smoothly at the outskirts.
            const along=t*(from+to)*.5;
            const x=lerp(part.a[0],part.b[0],along);
            const z=lerp(part.a[2],part.b[2],along);
            const peripheral=.035+.965*Math.exp(-((Math.hypot(x/65,z/53)/.78)**4));
            const level=clamp(Math.round(strength*peripheral*Math.sqrt(transmission)*128),0,128);
            if(!level)return;
            const key=depth*129+level;
            if(!groups.has(key))groups.set(key,{path:new Path2D(),depth:depth/12,level:level/128});
            const path=groups.get(key).path;
            path.moveTo(lerp(a[0],b[0],from),lerp(a[1],b[1],from));
            path.lineTo(lerp(a[0],b[0],to),lerp(a[1],b[1],to));
          });
        }
      }
    }
    ctx.save();
    ctx.globalCompositeOperation='source-over';
    ctx.filter='none';
    ctx.lineCap='butt';
    ctx.lineJoin='round';
    for(const group of groups.values()) {
      // Animated green contours stay legible; depth and overlap remain gentler than the pale wirework.
      const near=group.depth;
      const contrast=(.78+.30*near)*(.92+.06*near)*(1+zoomIn*.12*near)*(1-zoomOut*(.03+.07*(1-near)));
      const width=(1.30+.35*near)*(1+zoomIn*(.03+.12*near))*(1-zoomOut*(.04+.05*(1-near)));
      ctx.strokeStyle=rgba(colors.green,clamp(.95*group.level*contrast,0,.96));
      ctx.lineWidth=1.10*width;
      ctx.stroke(group.path);
    }
    ctx.restore();
  }

  function paint() {
    const lightingChanged = updateBuildingLights();
    const view = `${yaw}:${pitch}:${zoom}:${width}:${height}`;
    const changed = architectureView !== view || lightingChanged;
    const project = projector(changed);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (changed) {
      if (depthView !== view) {
        depthField.update(project);
        depthView = view;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      const floor = ground(project);
      reflection(project, floor);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      buildingLights.forEach((light) => {
        if (litBuildings.has(light.building)) lightPool(project, light, light.power);
      });
      ctx.restore();
      glass(project);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      buildingLights.forEach((light) => {
        if (litBuildings.has(light.building)) lightVolume(project, light, light.power);
      });
      ctx.restore();
      wirework(project);
      architectureContext.clearRect(
        0,
        0,
        architecture.width,
        architecture.height,
      );
      architectureContext.drawImage(canvas, 0, 0);
      architectureView = view;
    } else ctx.drawImage(architecture, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    traces(project);
    dirty = false;
  }

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden) {
      lastTime = 0;
      return;
    }
    const elapsed = Math.max(0, (now - (lastTime || now)) / 1000);
    const dt = Math.min(elapsed, 0.05);
    lastTime = now;
    const animate = !paused && !reduce.matches;
    let moving = false;
    if (animate) {
      age += elapsed;
    }
    if (Math.abs(zoom - targetZoom) > 0.0002) {
      zoom = reduce.matches
        ? targetZoom
        : lerp(zoom, targetZoom, 1 - Math.exp(-elapsed * 7));
      moving = true;
    } else zoom = targetZoom;
    if (
      !pointers.size &&
      Math.abs(yawVelocity) + Math.abs(pitchVelocity) > 0.008
    ) {
      if (!animate) {
        yawVelocity = pitchVelocity = 0;
      } else {
        const decay = Math.exp(-orbitFriction * dt),
          travel = (1 - decay) / orbitFriction;
        yaw += yawVelocity * travel;
        const next = clamp(pitch + pitchVelocity * travel, 0.22, 1.13);
        if (next === 0.22 || next === 1.13) pitchVelocity = 0;
        pitch = next;
        yawVelocity *= decay;
        pitchVelocity *= decay;
        moving = true;
      }
    }
    if (
      (dirty || moving || animate) &&
      now - lastPaint >= 1000 / (compact ? 24 : 30)
    ) {
      paint();
      lastPaint = now;
    }
    if (dirty || moving || animate) {
      if (!raf) raf = requestAnimationFrame(frame);
    }
  }

  function setZoom(value) {
    targetZoom = clamp(value, 0.68, 1.65);
    if (reduce.matches) zoom = targetZoom;
    controls();
    wake();
  }
  function resetView() {
    yaw = home.yaw;
    pitch = home.pitch;
    targetZoom = 0.88;
    age = 0;
    litBuildings.clear();
    lightingTracks = null;
    lastLightingTime = 0;
    architectureView = "";
    if (reduce.matches) zoom = 0.88;
    manualOrbit = false;
    yawVelocity = pitchVelocity = 0;
    controls();
    wake();
  }
  function toggleMotion() {
    paused = !paused;
    yawVelocity = pitchVelocity = 0;
    controls();
    wake();
  }
  plus.addEventListener("click", () => setZoom(targetZoom + 0.12));
  minus.addEventListener("click", () => setZoom(targetZoom - 0.12));
  reset.addEventListener("click", resetView);
  motion.addEventListener("click", toggleMotion);
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    yawVelocity = pitchVelocity = 0;
    previousMove = performance.now();
    pinch = 0;
    dragged = false;
  });
  canvas.addEventListener("pointermove", (event) => {
    const before = pointers.get(event.pointerId);
    if (!before) return;
    pointers.set(event.pointerId, [event.clientX, event.clientY]);
    if (pointers.size > 1) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) setZoom((targetZoom * distance) / pinch);
      pinch = distance;
      return;
    }
    const now = performance.now(),
      elapsed = Math.max((now - previousMove) / 1000, 1 / 120);
    const dx = event.clientX - before[0],
      dy = event.clientY - before[1];
    const turn = -dx * 0.00245,
      oldPitch = pitch;
    yaw += turn;
    pitch = clamp(pitch + dy * 0.00245, 0.22, 1.13);
    if (Math.hypot(dx, dy) > 0.5) {
      yawVelocity = lerp(
        yawVelocity,
        clamp(turn / elapsed, -5, 5),
        dragged ? 0.5 : 1,
      );
      pitchVelocity = lerp(
        pitchVelocity,
        clamp((pitch - oldPitch) / elapsed, -4, 4),
        dragged ? 0.5 : 1,
      );
      manualOrbit = true;
      dragged = true;
    }
    previousMove = now;
    controls();
    wake();
  });
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    pinch = 0;
    if (
      event.type !== "pointerup" ||
      pointers.size ||
      !dragged ||
      reduce.matches ||
      paused ||
      performance.now() - previousMove > 110
    ) {
      yawVelocity = pitchVelocity = 0;
    } else {
      yawVelocity = clamp(yawVelocity * orbitReleaseBoost, -9.1, 9.1);
      pitchVelocity = clamp(pitchVelocity * orbitReleaseBoost, -7.15, 7.15);
    }
    wake();
  }
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) =>
    canvas.addEventListener(type, endPointer),
  );
  canvas.addEventListener("keydown", (event) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
        "0",
        "Home",
        " ",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (event.key.startsWith("Arrow")) manualOrbit = true;
    yawVelocity = pitchVelocity = 0;
    if (event.key === "ArrowLeft") yaw -= 0.1;
    if (event.key === "ArrowRight") yaw += 0.1;
    if (event.key === "ArrowUp") pitch = clamp(pitch + 0.08, 0.22, 1.13);
    if (event.key === "ArrowDown") pitch = clamp(pitch - 0.08, 0.22, 1.13);
    if (event.key === "+" || event.key === "=") setZoom(targetZoom + 0.12);
    if (event.key === "-") setZoom(targetZoom - 0.12);
    if (event.key === "0" || event.key === "Home") resetView();
    if (event.key === " ") toggleMotion();
    controls();
    wake();
  });
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  // Observe the in-flow reveal targets, not the fixed stage itself.
  const footerAnchor = root.closest(".r3-footer")?.querySelector("[data-footer-artwork-reveal]");
  const peekAnchor = document.querySelector("[data-artwork-peek]");
  const targets = [footerAnchor, peekAnchor].filter(Boolean);
  const intersections = new Map(targets.map((target) => [target, false]));
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        intersections.set(entry.target, entry.isIntersecting);
      visible = [...intersections.values()].some(Boolean);
      root.dataset.footerRevealed = String(
        !!footerAnchor && intersections.get(footerAnchor) === true,
      );
      lastTime = 0;
      if (visible) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0.01 },
  );
  if (targets.length) targets.forEach((target) => io.observe(target));
  else io.observe(root);
  document.addEventListener("visibilitychange", () => {
    lastTime = 0;
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  });
  reduce.addEventListener("change", () => {
    paused = reduce.matches;
    yawVelocity = pitchVelocity = 0;
    controls();
    wake();
  });
  window.addEventListener("pagehide", () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastTime = 0;
  });
  window.addEventListener("pageshow", wake);
  resize();
  controls();
  paint();
  canvas.hidden = false;
  root.dataset.wireReady = "true";
  root.dataset.wireSegments = String(city.segments.length);
  root.dataset.wireBuildings = String(city.buildings);
  root.dataset.wireLandmarks = String(city.landmarks.length);
});
