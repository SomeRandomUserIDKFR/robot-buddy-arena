/**
 * Match ground debris: non-armor scraps (Debris disappear) and armor plates
 * (Armor disappear — fade / shrink / decimate / build dummy).
 */
import { GRAVITY, SIZE, WORLD } from "./config.js";
import {
  normalizeArmorDespawnStyle, normalizeArmorDespawnTimer,
  normalizeDebrisDespawnStyle, normalizeReconquerRate
} from "./settings.js";
import { clamp } from "./utils.js";

export const NON_ARMOR_DEBRIS_LIFE = 14;
export const DEBRIS_DESPAWN_DURATION = 1.05;
export const RECONQUER_DURATION = 1.45;
export const ARMOR_DUMMY_MELT_DURATION = 0.95;
export const ARMOR_DUMMY_COOL_DURATION = 1.1;
export const ARMOR_DUMMY_METAL = "#7a848e";
/** Bonus reconquer attempts accrue against this baseline (seconds at +1× rate). */
export const RECONQUER_BONUS_INTERVAL = 8;
/** Prefer restore / cast targets within this distance of the break origin. */
export const RECONQUER_NEAR_RANGE = 520;
const POWER_CRATE_FALLBACK_H = 40;

/** Metal reconquer: furnace arrives → ingest scraps → cast molten square → cool. */
export const FORGE_PHASE_DURATIONS = Object.freeze({
  arrive: 0.45,
  ingest: 0.95,
  melt: 0.4,
  cast: 0.55,
  cool: 1.05
});

/** Material Consumer: scraps stream to the saber tip then dissolve into bots. */
export const MATERIAL_CONSUME_DURATION = 0.52;

const MOLTEN_COLOR = "#ff4a00";
const MOLTEN_HOT = "#ffe14a";

function debrisLandables(game) {
  const platforms = game?.platforms?.length ? game.platforms : [];
  const solids = (game?.props || []).filter(
    (prop) => !prop.destroyed && prop.solid && (prop.hp == null || prop.hp > 0)
  );
  const dummies = armorDummyBlockers(game).filter((dummy) => dummy.solid);
  return [
    ...platforms,
    ...solids.map((prop) => ({ x: prop.x, y: prop.y, w: prop.w, h: prop.h })),
    ...dummies.map((dummy) => ({ x: dummy.x, y: dummy.y, w: dummy.w, h: dummy.h }))
  ];
}

/** Floors a training dummy / thrown prop can stand on (platforms + solid props). */
function dummyStandSurfaces(game, excludeProp = null) {
  const platforms = game?.platforms?.length ? game.platforms : [];
  const solids = (game?.props || []).filter(
    (prop) => prop !== excludeProp
      && !prop.destroyed
      && !prop.thrownInFlight
      && !prop.heldBy
      && prop.solid
      && (prop.hp == null || prop.hp > 0)
  );
  return [
    ...platforms,
    ...solids.map((prop) => ({ x: prop.x, y: prop.y, w: prop.w, h: prop.h }))
  ];
}

/**
 * Snap a stand center onto a real floor near a rough world point.
 * Prefers the surface most scraps already rest on; otherwise the first floor
 * under the point (avoids mid-air averages between stacked platforms).
 * Shared by armor dummies and thrown-breakable reconquer slots.
 */
export function resolveStandTarget(game, group, roughX, roughY, w, h, options = {}) {
  const surfaces = dummyStandSurfaces(game, options.excludeProp || null);
  const halfW = w * 0.5;
  const clampXOnto = (surface, x) => {
    if (surface.w <= w) return surface.x + surface.w * 0.5;
    return clamp(x, surface.x + halfW, surface.x + surface.w - halfW);
  };

  if (!surfaces.length) {
    return { targetX: roughX, targetY: WORLD.h - h * 0.5 };
  }

  // Vote for platforms scraps are already sitting on.
  const votes = new Map();
  for (const scrap of group || []) {
    const scale = scrap.scale || 1;
    const halfScrapW = (scrap.w || 10) * scale * 0.5;
    const halfScrapH = (scrap.h || 10) * scale * 0.5;
    const bottom = scrap.y + halfScrapH;
    for (const surface of surfaces) {
      if (
        scrap.x + halfScrapW > surface.x
        && scrap.x - halfScrapW < surface.x + surface.w
        && Math.abs(bottom - surface.y) < 14
      ) {
        votes.set(surface, (votes.get(surface) || 0) + 1);
      }
    }
  }
  let winner = null;
  let bestVotes = 0;
  for (const [surface, count] of votes) {
    if (count > bestVotes) {
      bestVotes = count;
      winner = surface;
    }
  }
  if (winner) {
    return {
      targetX: clampXOnto(winner, roughX),
      targetY: winner.y - h * 0.5
    };
  }

  const overlaps = (surface) =>
    roughX + halfW > surface.x && roughX - halfW < surface.x + surface.w;
  const overlapping = surfaces.filter(overlaps);
  const pool = overlapping.length ? overlapping : surfaces;
  // First floor at or below the pile center (Y grows downward).
  const below = pool
    .filter((surface) => surface.y >= roughY - 4)
    .sort((a, b) => a.y - b.y);
  const nearest = [...pool].sort(
    (a, b) => Math.abs(a.y - (roughY + h * 0.5)) - Math.abs(b.y - (roughY + h * 0.5))
  );
  const chosen = below[0] || nearest[0];
  return {
    targetX: clampXOnto(chosen, roughX),
    targetY: chosen.y - h * 0.5
  };
}

/** @deprecated internal alias — armor dummy build still calls this name. */
function resolveDummyStandTarget(game, group, roughX, roughY, w, h) {
  return resolveStandTarget(game, group, roughX, roughY, w, h);
}

function pushPiece(game, piece) {
  game.groundDebris ||= [];
  game.groundDebris.push(piece);
}

function nextSourceId(game) {
  game._debrisSourceSeq = (game._debrisSourceSeq || 0) + 1;
  return `src-${game._debrisSourceSeq}`;
}

function burstPiece(game, {
  material, kind, x, y, w, h, color, vx = 0, vy = 0, facing = 0, index = 0,
  sourceType = null, sourceKind = null, sourceId = null, sourceProp = null,
  originX = null, originY = null, armorMaxHp = null,
  homeLx = 0, homeLy = 0, shape = "rect", detail = null, edge = null,
  verts = null, marks = null
}) {
  const burst = 100 + (index % 5) * 28;
  const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 1.5 + facing * 0.12;
  const armor = material === "armor";
  const armorLife = armor ? armorDespawnTimer(game) : NON_ARMOR_DEBRIS_LIFE;
  pushPiece(game, {
    material,
    kind,
    x,
    y,
    vx: Math.cos(ang) * burst + vx,
    vy: Math.sin(ang) * burst - 70 - Math.random() * 90 + vy,
    rot: (Math.random() - 0.5) * Math.PI,
    spin: (Math.random() - 0.5) * 10,
    w,
    h,
    baseW: w,
    baseH: h,
    color,
    edge: edge || null,
    shape: shape || "rect",
    detail: detail || null,
    // Jagged polygon relative to piece centroid — shared edges reassemble cleanly.
    verts: Array.isArray(verts) && verts.length >= 3
      ? verts.map((p) => [p[0], p[1]])
      : null,
    marks: Array.isArray(marks) && marks.length
      ? marks.map((m) => ({
        x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, color: m.color || null
      }))
      : null,
    // Jigsaw slot relative to object center — reconquer flies each shard home.
    homeLx,
    homeLy,
    grounded: false,
    settle: 0,
    immortal: false,
    life: armorLife,
    maxLife: armorLife,
    alpha: 1,
    scale: 1,
    despawnMode: null,
    despawnT: 0,
    sourceType,
    sourceKind,
    sourceId,
    sourceProp,
    originX,
    originY,
    armorMaxHp: armor ? (armorMaxHp || 100) : null,
    homeX: null,
    homeY: null
  });
}

const ARMOR_PLATE_SPECS = Object.freeze([
  { kind: "helmet", ox: 0, oy: -20, w: 30, h: 12 },
  { kind: "crest", ox: 0, oy: -28, w: 10, h: 6 },
  { kind: "cheekL", ox: -16, oy: -10, w: 10, h: 16 },
  { kind: "cheekR", ox: 16, oy: -10, w: 10, h: 16 },
  { kind: "chin", ox: 0, oy: 2, w: 20, h: 10 },
  { kind: "shoulderL", ox: -20, oy: 6, w: 14, h: 9 },
  { kind: "shoulderR", ox: 20, oy: 6, w: 14, h: 9 },
  { kind: "breast", ox: 0, oy: 14, w: 28, h: 16 },
  { kind: "ab", ox: 0, oy: 24, w: 22, h: 7 }
]);

function spawnArmorPlateBurst(game, {
  cx, cy, color, facing = 0, vx = 0, vy = 0, armorMaxHp = 100
}) {
  const sourceId = nextSourceId(game);
  for (let i = 0; i < ARMOR_PLATE_SPECS.length; i++) {
    const spec = ARMOR_PLATE_SPECS[i];
    burstPiece(game, {
      material: "armor",
      kind: spec.kind,
      x: cx + spec.ox,
      y: cy + spec.oy,
      w: spec.w,
      h: spec.h,
      color,
      vx,
      vy,
      facing,
      index: i,
      sourceType: "armor",
      sourceKind: "armor",
      sourceId,
      originX: cx,
      originY: cy,
      armorMaxHp
    });
  }
  return sourceId;
}

function armorDebrisColor(fighter) {
  if (fighter?.buddy) return "#8ec4d0";
  if (fighter?.team) {
    const base = fighter.color || "#ff8279";
    return typeof base === "string" ? base : "#b89088";
  }
  return "#8aa4b0";
}

/** Exact prop paint colors (match rendering.js drawPropBody / power crates). */
export const PROP_DEBRIS_COLORS = Object.freeze({
  cactus: { fill: "#3d8a4a", edge: "#2a5e32", material: "plant" },
  bush: { fill: "#6a5838", edge: "#3a3018", material: "plant" },
  tree: { fill: "#3a2818", edge: "#241810", material: "wood" },
  treeCanopy: { fill: "#1a3a24", fill2: "#2d5a3c", edge: "#0e2416", material: "plant" },
  crate: { fill: "#8a6a3a", edge: "#4a3818", material: "wood" },
  pipe: { fill: "#6a7888", fill2: "#3a4858", edge: "#2a343e", material: "metal" },
  pillar: { fill: "#7a6a72", fill2: "#4a3e48", edge: "#2e262c", material: "stone" },
  barrel: { fill: "#8a5030", hoop: "#3a2010", edge: "#3a2010", material: "metal" },
  redBarrel: {
    fill: "#c62828", fill2: "#f0c020", hoop: "#4a1010", edge: "#4a1010", material: "metal"
  },
  powerCrate: { fill: "#6a7078", rim: "#2a3038", edge: "#1a2028", material: "metal" }
});

/** Deterministic 0..1 hash — jagged edges stay stable across break/rebuild. */
function shardJitter(x, y, salt = 0) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + salt * 45.164) * 43758.5453;
  return n - Math.floor(n);
}

function shoelaceArea(verts) {
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) * 0.5;
}

function polygonCentroid(verts) {
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (Math.abs(area) < 1e-6) {
    let sx = 0;
    let sy = 0;
    for (const v of verts) {
      sx += v[0];
      sy += v[1];
    }
    return { x: sx / verts.length, y: sy / verts.length };
  }
  area *= 0.5;
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function aabbOfVerts(verts) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] > maxY) maxY = v[1];
  }
  return {
    w: Math.max(2, maxX - minX),
    h: Math.max(2, maxY - minY)
  };
}

/**
 * Liang–Barsky clip of a prop-local mark line to a shard AABB, returned in
 * shard-local coords. Rejects misses and hairline leftovers.
 */
function clipMarkToShard(x1, y1, x2, y2, homeLx, homeLy, hw, hh, color) {
  const pad = 0.75;
  const minX = homeLx - hw - pad;
  const maxX = homeLx + hw + pad;
  const minY = homeLy - hh - pad;
  const maxY = homeLy + hh + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const clip = (p, q) => {
    if (Math.abs(p) < 1e-9) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    !clip(-dx, x1 - minX) || !clip(dx, maxX - x1)
    || !clip(-dy, y1 - minY) || !clip(dy, maxY - y1)
  ) {
    return null;
  }
  const ax = x1 + t0 * dx;
  const ay = y1 + t0 * dy;
  const bx = x1 + t1 * dx;
  const by = y1 + t1 * dy;
  const len = Math.hypot(bx - ax, by - ay);
  // Ignore stubs — they read as stray hairs once pieces spin.
  if (len < 2.5) return null;
  return {
    x1: ax - homeLx,
    y1: ay - homeLy,
    x2: bx - homeLx,
    y2: by - homeLy,
    color: color || null
  };
}

/**
 * Push one sharp polygonal shard (straight edges only — no curves).
 */
function pushSharpShard(tiles, vertsWorld, paint, colorAt, markLines, c, r) {
  if (!vertsWorld || vertsWorld.length < 3) return;
  // Drop near-duplicates that can collapse an edge into a soft look.
  const cleaned = [];
  for (const p of vertsWorld) {
    const prev = cleaned[cleaned.length - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 0.35) continue;
    cleaned.push([p[0], p[1]]);
  }
  if (cleaned.length >= 3) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.35) cleaned.pop();
  }
  if (cleaned.length < 3) return;

  const center = polygonCentroid(cleaned);
  const verts = cleaned.map((p) => [p[0] - center.x, p[1] - center.y]);
  const box = aabbOfVerts(verts);
  if (box.w < 1.5 || box.h < 1.5) return;
  const color = typeof colorAt === "function"
    ? colorAt(center.x, center.y, c, r)
    : paint.fill;
  const marks = [];
  if (Array.isArray(markLines)) {
    for (const line of markLines) {
      const clipped = clipMarkToShard(
        line.x1, line.y1, line.x2, line.y2,
        center.x, center.y, box.w / 2, box.h / 2, line.color
      );
      if (clipped) marks.push(clipped);
    }
  }
  tiles.push({
    kind: "tile",
    homeLx: center.x,
    homeLy: center.y,
    w: box.w,
    h: box.h,
    color,
    edge: paint.edge,
    shape: "poly",
    detail: paint.detail || null,
    material: paint.material,
    verts,
    marks: marks.length ? marks : null,
    area: shoelaceArea(cleaned)
  });
}

/**
 * Hard rectangular jigsaw: jittered corners cracked into pure triangles.
 * Exactly 3 vertices per shard — straight edges into pointed tips only.
 * No mid-edge teeth (those read as soft bumps under canvas AA).
 */
function jaggedRectShards(localX, localY, w, h, cols, rows, paint, colorAt, markLines) {
  const tiles = [];
  const tw = w / cols;
  const th = h / rows;
  const jag = Math.min(tw, th) * 0.42;

  // Shared corner grid. Interior corners get sharp 2D offsets; boundary stays
  // on the outer rectangle so the assembled silhouette matches the prop.
  const corners = [];
  for (let r = 0; r <= rows; r++) {
    corners[r] = [];
    for (let c = 0; c <= cols; c++) {
      const onEdge = r === 0 || r === rows || c === 0 || c === cols;
      const bx = localX + c * tw;
      const by = localY + r * th;
      if (onEdge) {
        corners[r][c] = [bx, by];
      } else {
        const jx = (shardJitter(bx, by, 11) - 0.5) * 2 * jag;
        const jy = (shardJitter(bx, by, 17) - 0.5) * 2 * jag;
        corners[r][c] = [bx + jx, by + jy];
      }
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tl = corners[r][c];
      const tr = corners[r][c + 1];
      const br = corners[r + 1][c + 1];
      const bl = corners[r + 1][c];

      // Pure triangles only — three hard corners, three straight edges.
      if (shardJitter(tl[0], tl[1], 3) >= 0.5) {
        pushSharpShard(tiles, [tl, tr, br], paint, colorAt, markLines, c, r);
        pushSharpShard(tiles, [tl, br, bl], paint, colorAt, markLines, c, r);
      } else {
        pushSharpShard(tiles, [tl, tr, bl], paint, colorAt, markLines, c, r);
        pushSharpShard(tiles, [tr, br, bl], paint, colorAt, markLines, c, r);
      }
    }
  }
  return tiles;
}

/**
 * Jagged shards clipped to an ellipse (bush / canopy). Shared jags still match.
 */
function jaggedEllipseShards(cx, cy, rw, rh, cols, rows, paint, colorAt) {
  const localX = cx - rw;
  const localY = cy - rh;
  const raw = jaggedRectShards(
    localX, localY, rw * 2, rh * 2, cols, rows, paint, colorAt, null
  );
  return raw.filter((tile) => {
    const nx = (tile.homeLx - cx) / rw;
    const ny = (tile.homeLy - cy) / rh;
    return nx * nx + ny * ny <= 1.12;
  });
}

function mixDebrisHex(a, b, t) {
  const parse = (hex) => {
    const h = (hex || "#888888").replace("#", "");
    if (h.length !== 6) return [136, 136, 136];
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  };
  const ca = parse(a);
  const cb = parse(b);
  const u = Math.max(0, Math.min(1, t));
  const ch = (i) => Math.round(ca[i] + (cb[i] - ca[i]) * u);
  return `#${[ch(0), ch(1), ch(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

function crateColorAt(lx, ly, propW, propH, paint) {
  // Source-region shade toward the border — stay readable as a wood chunk.
  const hw = propW / 2;
  const hh = propH / 2;
  const edgeBand = Math.min(hw, hh) * 0.32;
  const near = Math.min(hw - Math.abs(lx), hh - Math.abs(ly));
  if (near >= edgeBand) return paint.fill;
  const t = 1 - near / edgeBand;
  return mixDebrisHex(paint.fill, paint.edge, 0.35 * t);
}

function pipeColorAt(lx, ly, propW, propH, paint) {
  // Match drawPropBody: darker hollow band inset from the outer shell.
  const hh = propH / 2;
  const inner = Math.abs(ly) < hh * 0.55 && Math.abs(lx) < propW / 2 - 8;
  return inner ? paint.fill2 : paint.fill;
}

function barrelColorAt(lx, ly, propW, propH, paint) {
  // Hoop bands at 30% / 70% of height — shaded body, not a hairline.
  const top = -propH / 2;
  const t = (ly - top) / propH;
  const onHoop = Math.abs(t - 0.3) < 0.08 || Math.abs(t - 0.7) < 0.08;
  if (!onHoop) return paint.fill;
  return mixDebrisHex(paint.fill, paint.hoop || paint.edge, 0.55);
}

function pillarColorAt(lx, ly, propW, propH, paint) {
  const hh = propH / 2;
  const onCap = ly < -hh + 14 || ly > hh - 14;
  return onCap ? paint.fill2 : paint.fill;
}

function canopyColorAt(lx, ly, cx, cy, rw, rh, paint) {
  // Lighter leaf patches toward the canopy's secondary blob, not a checkerboard.
  const dx = (lx - (cx - rw * 0.1)) / (rw * 0.7);
  const dy = (ly - (cy - rh * 0.05)) / (rh * 0.7);
  const inLight = dx * dx + dy * dy < 1;
  return inLight ? (paint.fill2 || paint.fill) : paint.fill;
}

function powerCrateColorAt(lx, ly, propW, propH, paint) {
  const hw = propW / 2;
  const hh = propH / 2;
  const rimBand = Math.min(hw, hh) * 0.22;
  const nearRim = Math.min(hw - Math.abs(lx), hh - Math.abs(ly)) < rimBand;
  return nearRim ? (paint.rim || paint.fill2 || paint.fill) : paint.fill;
}

/**
 * Full jagged jigsaw of a prop's drawn geometry — source-region colors + marks.
 * Coordinates are relative to the prop/crate center.
 */
export function buildPropJigsaw(prop, kind = prop.kind) {
  const tiles = [];
  if (kind === "cactus") {
    const paint = PROP_DEBRIS_COLORS.cactus;
    // Match drawPropBody cactus rectangles (local to prop top-left → center).
    const parts = [
      { x: 8, y: 0, w: 12, h: prop.h, cols: 1, rows: 5 },
      { x: 0, y: prop.h * 0.35, w: 28, h: 12, cols: 3, rows: 1 },
      { x: 4, y: prop.h * 0.55, w: 10, h: 28, cols: 1, rows: 2 }
    ];
    for (const part of parts) {
      tiles.push(...jaggedRectShards(
        part.x - prop.w / 2,
        part.y - prop.h / 2,
        part.w,
        part.h,
        part.cols,
        part.rows,
        paint,
        () => paint.fill,
        null
      ));
    }
    return tiles;
  }
  if (kind === "bush") {
    return jaggedEllipseShards(
      0, prop.h * 0.05, prop.w / 2, prop.h / 2, 4, 3, PROP_DEBRIS_COLORS.bush,
      () => PROP_DEBRIS_COLORS.bush.fill
    );
  }
  if (kind === "tree") {
    const trunkW = prop.w * 0.44;
    const trunkX = prop.w * 0.28 - prop.w / 2;
    tiles.push(...jaggedRectShards(
      trunkX, -prop.h / 2, trunkW, prop.h, 2, 8, PROP_DEBRIS_COLORS.tree,
      () => PROP_DEBRIS_COLORS.tree.fill,
      null
    ));
    if (prop.canopy) {
      const c = prop.canopy;
      const cx = (c.x + c.w / 2) - (prop.x + prop.w / 2);
      const cy = (c.y + c.h / 2) - (prop.y + prop.h / 2);
      const paint = PROP_DEBRIS_COLORS.treeCanopy;
      tiles.push(...jaggedEllipseShards(
        cx, cy, c.w / 2, c.h / 2, 5, 4, paint,
        (lx, ly) => canopyColorAt(lx, ly, cx, cy, c.w / 2, c.h / 2, paint)
      ));
    }
    return tiles;
  }
  if (kind === "crate") {
    const paint = { ...PROP_DEBRIS_COLORS.crate, detail: "crate" };
    const hw = prop.w / 2;
    const hh = prop.h / 2;
    const marks = [
      // Inner border stroke (approx of strokeRect inset).
      { x1: -hw + 2, y1: -hh + 2, x2: hw - 2, y2: -hh + 2, color: paint.edge },
      { x1: hw - 2, y1: -hh + 2, x2: hw - 2, y2: hh - 2, color: paint.edge },
      { x1: hw - 2, y1: hh - 2, x2: -hw + 2, y2: hh - 2, color: paint.edge },
      { x1: -hw + 2, y1: hh - 2, x2: -hw + 2, y2: -hh + 2, color: paint.edge },
      // Drawn X diagonal.
      { x1: -hw, y1: -hh, x2: hw, y2: hh, color: paint.edge }
    ];
    return jaggedRectShards(
      -hw, -hh, prop.w, prop.h, 4, 4, paint,
      (lx, ly) => crateColorAt(lx, ly, prop.w, prop.h, paint),
      marks
    );
  }
  if (kind === "pipe") {
    const paint = PROP_DEBRIS_COLORS.pipe;
    return jaggedRectShards(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 5, 2, paint,
      (lx, ly) => pipeColorAt(lx, ly, prop.w, prop.h, paint),
      null
    );
  }
  if (kind === "pillar") {
    const paint = PROP_DEBRIS_COLORS.pillar;
    const body = jaggedRectShards(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 2, 6, paint,
      (lx, ly) => pillarColorAt(lx, ly, prop.w, prop.h, paint),
      null
    );
    tiles.push(...body);
    // Wider top/bottom cap bands matching drawPropBody.
    tiles.push(...jaggedRectShards(
      -prop.w / 2 - 4, -prop.h / 2, prop.w + 8, 14, 3, 1,
      { fill: paint.fill2, edge: paint.edge, material: paint.material },
      () => paint.fill2,
      null
    ));
    tiles.push(...jaggedRectShards(
      -prop.w / 2 - 4, prop.h / 2 - 14, prop.w + 8, 14, 3, 1,
      { fill: paint.fill2, edge: paint.edge, material: paint.material },
      () => paint.fill2,
      null
    ));
    return tiles;
  }
  if (kind === "barrel") {
    const paint = { ...PROP_DEBRIS_COLORS.barrel, detail: "barrel" };
    const hw = prop.w / 2;
    const hh = prop.h / 2;
    const marks = [
      {
        x1: -hw, y1: -hh + prop.h * 0.3,
        x2: hw, y2: -hh + prop.h * 0.3,
        color: paint.hoop || paint.edge
      },
      {
        x1: -hw, y1: -hh + prop.h * 0.7,
        x2: hw, y2: -hh + prop.h * 0.7,
        color: paint.hoop || paint.edge
      }
    ];
    return jaggedRectShards(
      -hw, -hh, prop.w, prop.h, 3, 4, paint,
      (lx, ly) => barrelColorAt(lx, ly, prop.w, prop.h, paint),
      marks
    );
  }
  if (kind === "redBarrel") {
    const paint = { ...PROP_DEBRIS_COLORS.redBarrel, detail: "barrel" };
    const hw = prop.w / 2;
    const hh = prop.h / 2;
    const marks = [
      {
        x1: -hw, y1: -hh + prop.h * 0.38,
        x2: hw, y2: -hh + prop.h * 0.38,
        color: paint.fill2
      },
      {
        x1: -hw, y1: -hh + prop.h * 0.62,
        x2: hw, y2: -hh + prop.h * 0.62,
        color: paint.fill2
      },
      {
        x1: -hw + 4, y1: -hh + prop.h * 0.2,
        x2: hw - 4, y2: -hh + prop.h * 0.8,
        color: paint.edge
      },
      {
        x1: hw - 4, y1: -hh + prop.h * 0.2,
        x2: -hw + 4, y2: -hh + prop.h * 0.8,
        color: paint.edge
      }
    ];
    return jaggedRectShards(
      -hw, -hh, prop.w, prop.h, 3, 4, paint,
      (lx, ly) => {
        const top = -prop.h / 2;
        const t = (ly - top) / prop.h;
        if (t > 0.38 && t < 0.62) return paint.fill2;
        return barrelColorAt(lx, ly, prop.w, prop.h, paint);
      },
      marks
    );
  }
  if (kind === "powerCrate") {
    const look = prop.look || PROP_DEBRIS_COLORS.powerCrate;
    const paint = {
      fill: look.metal || PROP_DEBRIS_COLORS.powerCrate.fill,
      rim: look.rim || PROP_DEBRIS_COLORS.powerCrate.rim,
      edge: PROP_DEBRIS_COLORS.powerCrate.edge,
      material: "metal",
      detail: "powerCrate"
    };
    const hw = prop.w / 2;
    const hh = prop.h / 2;
    const marks = [
      {
        x1: -hw + 2, y1: -hh + 2, x2: hw - 2, y2: -hh + 2, color: paint.rim
      },
      {
        x1: hw - 2, y1: -hh + 2, x2: hw - 2, y2: hh - 2, color: paint.rim
      },
      {
        x1: hw - 2, y1: hh - 2, x2: -hw + 2, y2: hh - 2, color: paint.rim
      },
      {
        x1: -hw + 2, y1: hh - 2, x2: -hw + 2, y2: -hh + 2, color: paint.rim
      }
    ];
    return jaggedRectShards(
      -hw, -hh, prop.w, prop.h, 4, 4, paint,
      (lx, ly) => powerCrateColorAt(lx, ly, prop.w, prop.h, paint),
      marks
    );
  }
  return jaggedRectShards(
    -prop.w / 2, -prop.h / 2, prop.w, prop.h, 3, 3,
    { fill: "#668", edge: "#334", material: "scrap" },
    () => "#668",
    null
  );
}

/** @deprecated — use buildPropJigsaw for accurate full-coverage fragments. */
export function propDebrisProfile(kind) {
  const paint = PROP_DEBRIS_COLORS[kind] || PROP_DEBRIS_COLORS.crate;
  return {
    material: paint.material,
    colors: [paint.fill, paint.fill2 || paint.fill].filter(Boolean),
    specs: []
  };
}

function despawnStyle(game) {
  return normalizeDebrisDespawnStyle(game?.settings?.visual?.debrisDespawnStyle);
}

function armorDespawnStyle(game) {
  return normalizeArmorDespawnStyle(game?.settings?.visual?.armorDespawnStyle);
}

export function armorDespawnTimer(game) {
  return normalizeArmorDespawnTimer(game?.settings?.visual?.armorDespawnTimer);
}

/** 0.1×–10× multiplier for how often reconquer queues and fires. */
export function reconquerRate(game) {
  return normalizeReconquerRate(game?.settings?.visual?.reconquerRate);
}

/**
 * Extra reconquer attempts above the baseline (spawn-tied) cadence.
 * At 1× this never fires; at 2× it adds about one attempt per bonus interval.
 */
export function tickReconquerBonus(game, dt) {
  if (!game || despawnStyle(game) !== "reconquer") return;
  const rate = reconquerRate(game);
  const bonus = Math.max(0, rate - 1);
  if (bonus <= 0) return;
  const queue = game.reconquerQueue || [];
  if (!queue.some((entry) => entry.ready)) return;

  game.reconquerBonusAcc = (game.reconquerBonusAcc || 0) + dt * bonus;
  while (game.reconquerBonusAcc >= RECONQUER_BONUS_INTERVAL) {
    game.reconquerBonusAcc -= RECONQUER_BONUS_INTERVAL;
    // Prefer map-prop rebuilds; power crates still need a real spawn slot.
    if (tryReconquerAtSpawn(game, null, { preferPowerCrate: false })) continue;
    break;
  }
}

/**
 * When retractable armor is destroyed, drop helmet/plate pieces that later
 * despawn via Settings → Visual → Armor disappear.
 */
export function spawnBrokenArmorDebris(game, fighter) {
  if (!game || !fighter || fighter.armorDebrisDropped) return;
  fighter.armorDebrisDropped = true;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const color = armorDebrisColor(fighter);
  const facing = Math.cos(fighter.aim || 0) >= 0 ? 1 : -1;
  const armorMaxHp = Math.max(1, fighter.retractableMax || 100);
  spawnArmorPlateBurst(game, {
    cx,
    cy,
    color,
    facing,
    vx: (fighter.vx || 0) * 0.25,
    vy: (fighter.vy || 0) * 0.15,
    armorMaxHp
  });

  game.effects ||= [];
  game.effects.push({
    type: "debris",
    x: cx,
    y: cy,
    life: .45,
    kind: "armor",
    w: SIZE,
    h: SIZE
  });
}

/** Drop armor plates from a destroyed training dummy (same full armor HP pool). */
export function spawnArmorDebrisFromDummy(game, dummy) {
  if (!game || !dummy || dummy.debrisDropped) return;
  dummy.debrisDropped = true;
  const cx = dummy.x + (dummy.w || 36) / 2;
  const cy = dummy.y + (dummy.h || 58) / 2;
  spawnArmorPlateBurst(game, {
    cx,
    cy,
    color: dummy.color || ARMOR_DUMMY_METAL,
    facing: 0,
    armorMaxHp: Math.max(1, dummy.maxHp || dummy.armorMaxHp || 100)
  });
  game.effects ||= [];
  game.effects.push({
    type: "debris",
    x: cx,
    y: cy,
    life: .45,
    kind: "armor",
    w: dummy.w || 36,
    h: dummy.h || 58
  });
}

/** Lasting rubble when a breakable map prop is destroyed — full jigsaw, exact colors. */
export function spawnPropDebris(game, prop, impactX, impactY, options = {}) {
  if (!game || !prop || prop.groundDebrisDropped) return;
  prop.groundDebrisDropped = true;

  const kind = options.forceKind || prop.kind;
  const tiles = buildPropJigsaw(prop, kind);
  const cx = prop.x + prop.w / 2;
  const cy = prop.y + prop.h / 2;
  const sourceId = nextSourceId(game);
  const sourceType = options.sourceType
    || (kind === "powerCrate" || prop.powerCrate ? "powerCrate" : "prop");

  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i];
    // Spawn from the shard's true place on the object, then burst outward.
    burstPiece(game, {
      material: tile.material,
      kind: tile.kind,
      x: cx + tile.homeLx,
      y: cy + tile.homeLy,
      w: tile.w,
      h: tile.h,
      color: tile.color,
      edge: tile.edge,
      shape: tile.shape,
      detail: tile.detail,
      verts: tile.verts,
      marks: tile.marks,
      homeLx: tile.homeLx,
      homeLy: tile.homeLy,
      index: i,
      sourceType,
      sourceKind: kind,
      sourceId,
      sourceProp: sourceType === "prop" ? prop : null,
      originX: cx,
      originY: cy
    });
  }
}

/** Metal fragments when a power crate is destroyed. */
export function spawnPowerCrateDebris(game, crate) {
  if (!crate) return;
  spawnPropDebris(game, crate, crate.x + crate.w / 2, crate.y + crate.h / 2, {
    forceKind: "powerCrate",
    sourceType: "powerCrate"
  });
}

function pieceHasSupport(piece, surfaces) {
  const halfW = (piece.w * (piece.scale || 1)) * 0.5;
  const halfH = (piece.h * (piece.scale || 1)) * 0.5;
  const bottom = piece.y + halfH;
  for (const platform of surfaces) {
    const onTop = Math.abs(bottom - platform.y) <= 4;
    const overlap = piece.x + halfW > platform.x + 1
      && piece.x - halfW < platform.x + platform.w - 1;
    if (onTop && overlap) return true;
  }
  return false;
}

function beginDespawn(piece, style) {
  if (piece.immortal || piece.despawnMode) return;
  piece.grounded = false;
  piece.despawnMode = style;
  piece.despawnT = 0;
  if (style === "decimate") {
    const ang = Math.random() * Math.PI * 2;
    const speed = 220 + Math.random() * 320;
    piece.vx = Math.cos(ang) * speed;
    piece.vy = Math.sin(ang) * speed - 120;
    piece.spin = (Math.random() - 0.5) * 28;
  }
  if (style === "reconquer") {
    piece.despawnMode = "reconquer-wait";
  }
}

/** Start armor-plate despawn using Armor disappear settings. */
function beginArmorDespawn(game, piece) {
  if (!piece || piece.despawnMode) return;
  const style = armorDespawnStyle(game);
  if (style === "buildDummy") {
    beginArmorDummyBuild(game, piece);
    return;
  }
  beginDespawn(piece, style);
}

/**
 * Melt a broken armor set into a metal training dummy near the scrap pile.
 * Uses the same furnace cinematic as metal reconquer, then stands the dummy
 * on a real floor (not the mid-air average of multi-height debris).
 */
export function beginArmorDummyBuild(game, piece) {
  if (!game || !piece?.sourceId) return null;
  game.forgeCasts ||= [];
  if (game.forgeCasts.some((forge) => forge.sourceId === piece.sourceId)) return null;
  if (game.armorDummyBuilds?.some((build) => build.sourceId === piece.sourceId)) return null;

  const group = piecesForSource(game, piece.sourceId).filter((p) => p.material === "armor");
  if (!group.length) return null;

  const dummyW = 36;
  const dummyH = 58;
  let sx = 0;
  let sy = 0;
  for (const p of group) {
    sx += p.x;
    sy += p.y;
  }
  const roughX = sx / group.length + (Math.random() - 0.5) * 40;
  const roughY = sy / group.length;
  const { targetX, targetY } = resolveDummyStandTarget(
    game, group, roughX, roughY, dummyW, dummyH
  );
  const color = group[0].color || ARMOR_DUMMY_METAL;
  const armorMaxHp = Math.max(1, group[0].armorMaxHp || 100);

  const build = {
    sourceId: piece.sourceId,
    targetX,
    targetY,
    color,
    armorMaxHp
  };

  beginMetalForgeCast(game, {
    sourceId: piece.sourceId,
    sourceType: "armor",
    sourceKind: "armorDummy",
    castX: targetX,
    castY: targetY,
    castW: dummyW,
    castH: dummyH,
    finalColor: color,
    restore: () => finishArmorDummyBuild(game, build)
  });
  return build;
}

function finishArmorDummyBuild(game, build) {
  const w = 36;
  const h = 58;
  const maxHp = Math.max(1, build.armorMaxHp || 100);
  game.armorDummies ||= [];
  game.armorDummies.push({
    kind: "armorDummy",
    armorDummy: true,
    x: build.targetX - w / 2,
    y: build.targetY - h / 2,
    w,
    h,
    hp: maxHp,
    maxHp,
    armorMaxHp: maxHp,
    breakable: true,
    solid: true,
    blocksProjectiles: true,
    destroyed: false,
    debrisDropped: false,
    color: build.color || ARMOR_DUMMY_METAL,
    hitFlash: 0,
    cool: 0,
    phase: "cool"
  });
  removeSourcePieces(game, build.sourceId);
}

/** Intact training dummies that block shots / melee. */
export function armorDummyBlockers(game) {
  return (game?.armorDummies || []).filter(
    (dummy) => !dummy.destroyed && dummy.blocksProjectiles
  );
}

/**
 * Damage a metal training dummy. On death, plates drop and follow Armor disappear
 * (Build dummy remelts a new one nearby with the same full armor HP).
 */
export function damageArmorDummy(dummy, amount, game, impactX, impactY) {
  if (!dummy || dummy.destroyed || !dummy.breakable) return false;
  dummy.hp = Math.max(0, (dummy.hp ?? dummy.maxHp ?? 1) - amount);
  dummy.hitFlash = 0.14;
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: impactX ?? dummy.x + dummy.w / 2,
      y: impactY ?? dummy.y + dummy.h / 2,
      life: 0.12
    });
  }
  if (dummy.hp <= 0) {
    dummy.destroyed = true;
    dummy.solid = false;
    dummy.blocksProjectiles = false;
    spawnArmorDebrisFromDummy(game, dummy);
    game.armorDummies = (game.armorDummies || []).filter((entry) => entry !== dummy);
  }
  return true;
}

/** Tick armor → training-dummy melt / cool sequences. */
export function tickArmorDummyBuilds(game, dt) {
  const builds = game?.armorDummyBuilds;
  if (!builds?.length) {
    tickArmorDummies(game, dt);
    return;
  }
  const keep = [];
  for (const build of builds) {
    build.t += dt;
    if (build.phase === "melt") {
      if (build.t >= ARMOR_DUMMY_MELT_DURATION) {
        finishArmorDummyBuild(game, build);
        build.phase = "done";
      } else {
        keep.push(build);
      }
    }
  }
  game.armorDummyBuilds = keep;
  tickArmorDummies(game, dt);
}

function tickArmorDummies(game, dt) {
  for (const dummy of game?.armorDummies || []) {
    if (dummy.hitFlash > 0) dummy.hitFlash -= dt;
    if (dummy.phase !== "cool") continue;
    dummy.cool = Math.min(1, (dummy.cool || 0) + dt / ARMOR_DUMMY_COOL_DURATION);
    if (dummy.cool >= 1) dummy.phase = "idle";
  }
}

/** Molten → metal tint while a fresh dummy cools. */
export function armorDummyColor(dummy) {
  const cool = dummy?.cool || 0;
  if (dummy?.phase === "cool" && cool < 0.02) return "#ffe14a";
  if (dummy?.phase !== "cool") return dummy?.color || ARMOR_DUMMY_METAL;
  if (cool < 0.45) return mixHex("#ffe14a", "#ff4a00", cool / 0.45);
  return mixHex("#ff4a00", dummy.color || ARMOR_DUMMY_METAL, (cool - 0.45) / 0.55);
}

function queueReconquer(game, piece) {
  game.reconquerQueue ||= [];
  if (game.reconquerQueue.some((entry) => entry.sourceId === piece.sourceId)) return;
  const origin = reconquerOriginFromPiece(piece, game);
  game.reconquerQueue.push({
    sourceId: piece.sourceId,
    sourceType: piece.sourceType,
    sourceKind: piece.sourceKind,
    sourceProp: piece.sourceProp || null,
    originX: origin.x,
    originY: origin.y,
    ready: true
  });
}

function propCenter(prop) {
  return {
    x: (prop?.x || 0) + (prop?.w || 0) / 2,
    y: (prop?.y || 0) + (prop?.h || 0) / 2
  };
}

function pointDist(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function reconquerOriginFromPiece(piece, game) {
  if (piece?.sourceProp) return propCenter(piece.sourceProp);
  if (Number.isFinite(piece?.originX) && Number.isFinite(piece?.originY)) {
    return { x: piece.originX, y: piece.originY };
  }
  const group = piecesForSource(game, piece.sourceId);
  if (group.length) {
    let sx = 0;
    let sy = 0;
    for (const p of group) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / group.length, y: sy / group.length };
  }
  return { x: piece?.x || 0, y: piece?.y || 0 };
}

function entryOrigin(entry, group) {
  if (entry?.sourceProp) return propCenter(entry.sourceProp);
  if (Number.isFinite(entry?.originX) && Number.isFinite(entry?.originY)) {
    return { x: entry.originX, y: entry.originY };
  }
  if (group?.length) {
    let sx = 0;
    let sy = 0;
    for (const p of group) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / group.length, y: sy / group.length };
  }
  return { x: 0, y: 0 };
}

/**
 * Prefer the original break site, else a nearby same-kind slot (slight area shift).
 * Avoids map-wide random teleports.
 */
export function pickNearbyRestoreProp(entry, candidates, group = []) {
  if (!candidates?.length) return null;
  const origin = entryOrigin(entry, group);
  const source = entry.sourceProp;
  if (source && candidates.includes(source)) {
    // Usually rebuild in place; sometimes a slight nearby alternate.
    const nearbyAlts = candidates.filter(
      (prop) => prop !== source && pointDist(propCenter(prop), origin) <= RECONQUER_NEAR_RANGE
    );
    if (nearbyAlts.length && Math.random() < 0.22) {
      return nearestByOrigin(nearbyAlts, origin);
    }
    return source;
  }
  const nearby = candidates.filter(
    (prop) => pointDist(propCenter(prop), origin) <= RECONQUER_NEAR_RANGE
  );
  return nearestByOrigin(nearby.length ? nearby : candidates, origin);
}

function nearestByOrigin(props, origin) {
  let best = props[0];
  let bestD = Infinity;
  for (const prop of props) {
    const d = pointDist(propCenter(prop), origin);
    if (d < bestD) {
      best = prop;
      bestD = d;
    }
  }
  return best;
}

function listFreePowerCrateSpawns(game, occupied) {
  const spawns = game?.powerCrateSpawns || [];
  return spawns.filter((s) => !occupied.has(`${s.x},${s.y}`));
}

/** Pull a power-crate spawn toward the scrap origin when the roll landed far away. */
export function pullSpawnTowardOrigin(spot, origin, freeSpawns = []) {
  if (!spot || !origin) return spot;
  const spotCenter = {
    x: spot.x + (spot.w || 40) / 2,
    y: (spot.y ?? ((spot.yBottom || 0) - (spot.h || 40))) + (spot.h || 40) / 2
  };
  if (pointDist(spotCenter, origin) <= RECONQUER_NEAR_RANGE) return spot;
  if (!freeSpawns.length) return spot;

  let best = null;
  let bestD = Infinity;
  for (const spawn of freeSpawns) {
    const floorY = spawn.y ?? spawn.yBottom ?? 0;
    const center = spawn.w
      ? {
        x: spawn.x + spawn.w / 2,
        y: (spawn.y ?? (floorY - (spawn.h || POWER_CRATE_FALLBACK_H)))
          + (spawn.h || POWER_CRATE_FALLBACK_H) / 2
      }
      : { x: spawn.x + POWER_CRATE_FALLBACK_H / 2, y: floorY - POWER_CRATE_FALLBACK_H / 2 };
    const d = pointDist(center, origin);
    if (d < bestD) {
      best = spawn;
      bestD = d;
    }
  }
  if (!best || bestD > RECONQUER_NEAR_RANGE * 1.35) return spot;

  // Relocate the already-created crate onto the nearer spawn.
  const h = spot.h || POWER_CRATE_FALLBACK_H;
  const w = spot.w || POWER_CRATE_FALLBACK_H;
  const floorY = best.y ?? best.yBottom;
  spot.x = best.x;
  spot.y = floorY - h;
  spot.w = w;
  spot.h = h;
  if (spot.spawnKey != null) spot.spawnKey = `${best.x},${floorY}`;
  return spot;
}

function piecesForSource(game, sourceId) {
  return (game.groundDebris || []).filter((p) => p.sourceId === sourceId);
}

function removeSourcePieces(game, sourceId) {
  game.groundDebris = (game.groundDebris || []).filter((p) => p.sourceId !== sourceId);
}

/**
 * Permanently consume a debris source group (no reconquer / forge / dummy rebuild).
 * @returns {number} pieces removed
 */
export function consumeDebrisSource(game, sourceId) {
  if (!game || !sourceId) return 0;
  const before = (game.groundDebris || []).length;
  removeSourcePieces(game, sourceId);
  const removed = before - (game.groundDebris || []).length;
  game.reconquerQueue = (game.reconquerQueue || []).filter(
    (entry) => entry.sourceId !== sourceId
  );
  game.forgeCasts = (game.forgeCasts || []).filter(
    (forge) => forge.sourceId !== sourceId
  );
  game.armorDummyBuilds = (game.armorDummyBuilds || []).filter(
    (build) => build.sourceId !== sourceId
  );
  return removed;
}

function clearDebrisSourceQueues(game, sourceId) {
  game.reconquerQueue = (game.reconquerQueue || []).filter(
    (entry) => entry.sourceId !== sourceId
  );
  game.forgeCasts = (game.forgeCasts || []).filter(
    (forge) => forge.sourceId !== sourceId
  );
  game.armorDummyBuilds = (game.armorDummyBuilds || []).filter(
    (build) => build.sourceId !== sourceId
  );
}

function isVacuumLockedMode(mode) {
  return mode === "forge-ingest"
    || mode === "build-dummy-melt"
    || mode === "reconquer-home"
    || mode === "reconquer-seated"
    || mode === "material-consume"
    || mode === "gone";
}

/** True when every scrap for a source has snapped into its jigsaw slot. */
function allSourcePiecesSeated(game, sourceId) {
  const group = piecesForSource(game, sourceId);
  if (!group.length) return false;
  return group.every((piece) => piece.despawnMode === "reconquer-seated");
}

/**
 * Claim nearby debris for Material Consumer suction. Pieces stay visible and
 * stream to the tip; reconquer/forge/dummy queues for those sources are cleared
 * immediately so leftovers cannot rebuild.
 * @returns {{ pieces: number, sources: number }}
 */
export function claimDebrisForMaterialConsume(
  game, tipX, tipY, radius, owner, botsPerPiece = 4, options = {}
) {
  const pieces = game?.groundDebris || [];
  if (!pieces.length || !(radius > 0) || !owner) return { pieces: 0, sources: 0 };
  const toEjection = !!options.toEjection;
  const r2 = radius * radius;
  const hitIds = new Set();
  for (const piece of pieces) {
    if (!piece.sourceId || isVacuumLockedMode(piece.despawnMode)) continue;
    const dx = piece.x - tipX;
    const dy = piece.y - tipY;
    // Also accept scraps near the fighter body when tip is offset.
    if (dx * dx + dy * dy <= r2) hitIds.add(piece.sourceId);
  }
  let claimed = 0;
  for (const sourceId of hitIds) {
    clearDebrisSourceQueues(game, sourceId);
    const group = piecesForSource(game, sourceId);
    let i = 0;
    for (const piece of group) {
      if (isVacuumLockedMode(piece.despawnMode) && piece.despawnMode !== "material-consume") {
        continue;
      }
      piece.despawnMode = "material-consume";
      piece.despawnT = -i * 0.04;
      piece.grounded = false;
      piece.vx = (piece.vx || 0) * 0.2;
      piece.vy = (piece.vy || 0) * 0.2;
      piece.homeX = tipX;
      piece.homeY = tipY;
      piece.consumeOwner = owner;
      piece.consumeToEjection = toEjection;
      piece.consumeBots = toEjection ? 0 : Math.max(0, botsPerPiece | 0);
      piece.consumeBaseColor = piece.color || "#8a7a68";
      piece.scale = 1;
      piece.alpha = 1;
      claimed += 1;
      i += 1;
    }
  }
  return { pieces: claimed, sources: hitIds.size };
}

/**
 * Instant vacuum (hard remove). Prefer claimDebrisForMaterialConsume for the
 * animated Material Consumer path.
 * @returns {{ pieces: number, sources: number }}
 */
export function vacuumNearbyDebris(game, x, y, radius) {
  const pieces = game?.groundDebris || [];
  if (!pieces.length || !(radius > 0)) return { pieces: 0, sources: 0 };
  const r2 = radius * radius;
  const hitIds = new Set();
  for (const piece of pieces) {
    if (!piece.sourceId || piece.despawnMode === "gone") continue;
    if (isVacuumLockedMode(piece.despawnMode)) continue;
    const dx = piece.x - x;
    const dy = piece.y - y;
    if (dx * dx + dy * dy <= r2) hitIds.add(piece.sourceId);
  }
  let removed = 0;
  for (const sourceId of hitIds) {
    removed += consumeDebrisSource(game, sourceId);
  }
  return { pieces: removed, sources: hitIds.size };
}

/** Refresh tip targets for scraps already streaming into a Material Consumer. */
export function retargetMaterialConsumeTip(game, owner, tipX, tipY) {
  if (!game?.groundDebris?.length || !owner) return;
  for (const piece of game.groundDebris) {
    if (piece.despawnMode === "material-consume" && piece.consumeOwner === owner) {
      piece.homeX = tipX;
      piece.homeY = tipY;
    }
  }
}

function finishMaterialConsumePiece(game, piece) {
  const tipX = piece.homeX;
  const tipY = piece.homeY;
  game.effects ||= [];
  // Scraps collapse into the blade tip…
  game.effects.push({
    type: "nanoIngest",
    x: tipX,
    y: tipY,
    life: 0.26,
    color: piece.color || "#6cffb0"
  });
  game.materialConsumeArrivals ||= [];
  const ejection = !!piece.consumeToEjection;
  game.materialConsumeArrivals.push({
    owner: piece.consumeOwner,
    bots: ejection ? 0 : Math.max(0, piece.consumeBots || 0),
    ejection,
    x: tipX,
    y: tipY,
    color: piece.consumeBaseColor || piece.color || "#8a7a68",
    edge: piece.edge || null,
    kind: piece.kind || null,
    material: piece.material || null,
    w: piece.w || 8,
    h: piece.h || 8,
    shape: piece.shape || null,
    detail: piece.detail || null,
    verts: Array.isArray(piece.verts)
      ? piece.verts.map((p) => [p[0], p[1]])
      : null,
    marks: Array.isArray(piece.marks)
      ? piece.marks.map((m) => ({
        x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, color: m.color || null
      }))
      : null
  });
}

/** Restore a destroyed map prop in place. */
export function restoreMapProp(prop) {
  if (!prop) return false;
  prop.destroyed = false;
  prop.hp = prop.maxHp ?? prop.hp ?? 1;
  prop.solid = prop.baseSolid ?? prop.solid;
  prop.blocksProjectiles = prop.baseBlocksProjectiles ?? prop.blocksProjectiles;
  prop.blocksSight = prop.baseBlocksSight ?? prop.blocksSight;
  prop.hitFlash = .2;
  prop.groundDebrisDropped = false;
  prop.thrownInFlight = false;
  prop.heldBy = null;
  return true;
}

/** Restore a destroyed metal power crate in place. */
export function restorePowerCrate(crate) {
  if (!crate) return false;
  crate.destroyed = false;
  crate.hp = Math.max(1, crate.maxHp ?? crate.hp ?? 60);
  crate.solid = true;
  crate.blocksProjectiles = true;
  crate.blocksSight = false;
  crate.forgeHidden = false;
  crate.hitFlash = 0.2;
  crate.groundDebrisDropped = false;
  crate.heldBy = null;
  crate.thrownInFlight = false;
  return true;
}

function groupCentroid(group) {
  if (!group?.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of group) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / group.length, y: sy / group.length };
}

function isManualRebuildablePiece(piece) {
  if (!piece?.sourceId) return false;
  if (piece.sourceType !== "prop" && piece.sourceType !== "powerCrate") return false;
  if (isVacuumLockedMode(piece.despawnMode)) return false;
  return true;
}

/**
 * Find rebuildable debris source groups near a world point, nearest first.
 * @returns {Array<{ sourceId, sourceType, sourceKind, group, origin }>}
 */
export function listRebuildableDebrisNear(game, x, y, radius) {
  const pieces = game?.groundDebris || [];
  if (!pieces.length || !(radius > 0)) return [];
  const r2 = radius * radius;
  const bySource = new Map();
  for (const piece of pieces) {
    if (!isManualRebuildablePiece(piece)) continue;
    const dx = piece.x - x;
    const dy = piece.y - y;
    if (dx * dx + dy * dy > r2) continue;
    let list = bySource.get(piece.sourceId);
    if (!list) {
      list = [];
      bySource.set(piece.sourceId, list);
    }
    list.push(piece);
  }
  const results = [];
  for (const [sourceId, group] of bySource) {
    const origin = groupCentroid(group);
    results.push({
      sourceId,
      sourceType: group[0].sourceType,
      sourceKind: group[0].sourceKind,
      sourceProp: group[0].sourceProp || null,
      group,
      origin,
      dist: Math.hypot(origin.x - x, origin.y - y)
    });
  }
  results.sort((a, b) => a.dist - b.dist);
  return results;
}

/** Nearest rebuildable debris source, or null. */
export function findRebuildableDebrisNear(game, x, y, radius, options = {}) {
  const allowPower = options.allowPowerCrate !== false;
  for (const entry of listRebuildableDebrisNear(game, x, y, radius)) {
    if (entry.sourceType === "powerCrate" && !allowPower) continue;
    return entry;
  }
  return null;
}

/**
 * Manually rebuild a debris pile into its prop / metal power crate (Reconjurer).
 * Works regardless of the Debris disappear style. Instant restore + scrap cleanup.
 * @param {{ allowPowerCrate?: boolean, createPowerCrate?: Function }} [options]
 * @returns {{ target: object, sourceType: string, origin: {x,y} } | null}
 */
export function tryManualRebuildNear(game, x, y, radius, options = {}) {
  if (!game) return null;
  const found = findRebuildableDebrisNear(game, x, y, radius, options);
  if (!found) return null;

  if (found.sourceType === "powerCrate") {
    if (options.allowPowerCrate === false) return null;
    let crate = null;
    let bestD = Infinity;
    for (const c of game.powerCrates || []) {
      if (!c.destroyed) continue;
      const d = Math.hypot(
        (c.x + c.w * 0.5) - found.origin.x,
        (c.y + c.h * 0.5) - found.origin.y
      );
      if (d < bestD) {
        bestD = d;
        crate = c;
      }
    }
    if (!crate || bestD > RECONQUER_NEAR_RANGE) {
      // No destroyed crate nearby — stand a fresh one on the floor under the pile.
      const w = 40;
      const h = 40;
      const stand = resolveStandTarget(game, found.group, found.origin.x, found.origin.y, w, h);
      const { createPowerCrate } = options;
      if (typeof createPowerCrate !== "function") return null;
      crate = createPowerCrate(
        { x: stand.targetX - w * 0.5, y: stand.targetY + h * 0.5 },
        game.mapId || "battlefield",
        game.theme || "battlefield",
        `rj-rebuild-${found.sourceId}`
      );
      game.powerCrates ||= [];
      game.powerCrates.push(crate);
    } else {
      restorePowerCrate(crate);
      // Cancel a pending respawn for this spawn key so we don't double-drop.
      if (game.powerCrateState?.pending && crate.spawnKey) {
        game.powerCrateState.pending = game.powerCrateState.pending.filter(
          (p) => p.spawnKey !== crate.spawnKey
        );
      }
    }
    consumeDebrisSource(game, found.sourceId);
    return { target: crate, sourceType: "powerCrate", origin: found.origin };
  }

  // Map prop rebuild.
  const candidates = (game.props || []).filter(
    (prop) => prop.destroyed && prop.kind === found.sourceKind
  );
  let prop = pickNearbyRestoreProp(
    {
      sourceProp: found.sourceProp,
      sourceKind: found.sourceKind,
      originX: found.origin.x,
      originY: found.origin.y
    },
    candidates,
    found.group
  );
  if (!prop && found.sourceProp?.destroyed) prop = found.sourceProp;
  if (!prop) return null;
  restoreMapProp(prop);
  consumeDebrisSource(game, found.sourceId);
  return { target: prop, sourceType: "prop", origin: found.origin };
}

function groupIsMetal(group) {
  return group.length > 0 && group.every((p) => p.material === "metal");
}

function finalMetalColor(entry, group, spot) {
  if (spot?.look?.metal) return spot.look.metal;
  if (entry.sourceKind === "powerCrate") {
    return PROP_DEBRIS_COLORS.powerCrate.fill;
  }
  const paint = PROP_DEBRIS_COLORS[entry.sourceKind];
  return paint?.fill || group[0]?.color || "#6a7888";
}

/**
 * Start the furnace cast for metal scraps (power crates / pipes / barrels…).
 * Wood/plant still use the jigsaw reconquer path.
 */
export function beginMetalForgeCast(game, {
  sourceId, sourceType, sourceKind, castX, castY, castW, castH, finalColor, restore, hideTarget = null
}) {
  game.forgeCasts ||= [];
  const mouthX = castX - Math.max(36, castW) * 0.75;
  const mouthY = castY - Math.max(28, castH) * 0.35;
  const forge = {
    sourceId,
    sourceType,
    sourceKind,
    castX,
    castY,
    castW,
    castH,
    finalColor,
    restore,
    hideTarget,
    phase: "arrive",
    t: 0,
    furnaceX: mouthX - 10,
    furnaceY: mouthY + 18,
    mouthX,
    mouthY,
    molten: 0,
    cool: 0
  };
  game.forgeCasts.push(forge);
  if (hideTarget) hideTarget.forgeHidden = true;

  const group = piecesForSource(game, sourceId);
  for (const piece of group) {
    piece.despawnMode = "forge-ingest";
    piece.despawnT = 0;
    piece.grounded = false;
    piece.homeX = mouthX;
    piece.homeY = mouthY;
    piece.scale = 1;
    piece.alpha = 1;
  }
  return forge;
}

/**
 * Called when the match spawn system places (or is about to place) a new object.
 * Reconquer style rebuilds near the break origin (original slot or a slight nearby shift).
 * Metal → furnace cast; wood/plant → jigsaw assemble.
 * @returns {boolean} whether a reconquer consumed this spawn opportunity
 */
export function tryReconquerAtSpawn(game, spot, options = {}) {
  if (!game || despawnStyle(game) !== "reconquer") return false;
  const queue = game.reconquerQueue || [];
  if (!queue.length) return false;

  const preferPower = options.preferPowerCrate === true;
  let index = queue.findIndex((entry) => (
    preferPower ? entry.sourceType === "powerCrate" : entry.sourceType === "prop"
  ));
  if (index < 0) index = 0;
  const entry = queue[index];
  if (!entry?.ready) return false;

  let homeX;
  let homeY;
  let castW = 40;
  let castH = 40;
  let restore = null;
  let hideTarget = null;
  let restoreProp = null;

  const group = piecesForSource(game, entry.sourceId);
  if (!group.length) {
    queue.splice(index, 1);
    return false;
  }
  const origin = entryOrigin(entry, group);

  if (entry.sourceType === "powerCrate") {
    if (!spot) return false;
    // If the spawn rolled far from the break, nudge onto a nearer free spawn.
    const occupied = new Set(
      (game.powerCrates || [])
        .filter((c) => !c.destroyed && c !== spot)
        .map((c) => c.spawnKey)
    );
    pullSpawnTowardOrigin(spot, origin, listFreePowerCrateSpawns(game, occupied));
    castW = spot.w || 40;
    castH = spot.h || 40;
    homeX = spot.x + castW / 2;
    homeY = (spot.y ?? ((spot.yBottom || 0) - castH)) + castH / 2;
    // Caller already spawned the crate; hide until the forge cools.
    hideTarget = spot;
    restore = () => {
      hideTarget.forgeHidden = false;
      removeSourcePieces(game, entry.sourceId);
    };
  } else {
    const candidates = (game.props || []).filter(
      (prop) => prop.destroyed && prop.kind === entry.sourceKind
    );
    if (!candidates.length) return false;
    restoreProp = pickNearbyRestoreProp(entry, candidates, group);
    if (!restoreProp) return false;
    castW = restoreProp.w;
    castH = restoreProp.h;
    homeX = restoreProp.x + castW / 2;
    homeY = restoreProp.y + castH / 2;
    restore = () => {
      restoreMapProp(restoreProp);
      removeSourcePieces(game, entry.sourceId);
    };
  }

  entry.ready = false;
  entry.homing = true;

  if (groupIsMetal(group)) {
    const colorSpot = entry.sourceType === "powerCrate" ? spot : restoreProp;
    beginMetalForgeCast(game, {
      sourceId: entry.sourceId,
      sourceType: entry.sourceType,
      sourceKind: entry.sourceKind,
      castX: homeX,
      castY: homeY,
      castW,
      castH,
      finalColor: finalMetalColor(entry, group, colorSpot),
      restore,
      hideTarget
    });
    return entry.sourceType === "prop";
  }

  for (const piece of group) {
    piece.despawnMode = "reconquer-home";
    piece.despawnT = 0;
    piece.grounded = false;
    piece.scale = 1;
    piece.alpha = 1;
    piece.homeX = homeX;
    piece.homeY = homeY;
    piece.homeRestore = restore;
    piece.homeSeated = false;
  }
  return entry.sourceType === "prop";
}

function advanceForgePhase(forge) {
  const order = ["arrive", "ingest", "melt", "cast", "cool"];
  const at = order.indexOf(forge.phase);
  if (at < 0 || at >= order.length - 1) {
    forge.phase = "done";
    return;
  }
  forge.phase = order[at + 1];
  forge.t = 0;
}

/** Tick furnace cast animations for metal reconquer. */
export function tickForgeCasts(game, dt) {
  const casts = game?.forgeCasts;
  if (!casts?.length) return;
  const keep = [];
  for (const forge of casts) {
    const dur = FORGE_PHASE_DURATIONS[forge.phase] || 0.5;
    forge.t += dt;

    if (forge.phase === "ingest") {
      // Pieces are steered in tickGroundDebris; once time is up, swallow leftovers.
      if (forge.t >= dur) {
        for (const piece of piecesForSource(game, forge.sourceId)) {
          piece.despawnMode = "gone";
          piece.alpha = 0;
        }
        removeSourcePieces(game, forge.sourceId);
        advanceForgePhase(forge);
      }
    } else if (forge.phase === "melt") {
      if (forge.t >= dur) advanceForgePhase(forge);
    } else if (forge.phase === "cast") {
      forge.molten = Math.min(1, forge.t / dur);
      if (forge.t >= dur) {
        forge.molten = 1;
        advanceForgePhase(forge);
      }
    } else if (forge.phase === "cool") {
      forge.cool = Math.min(1, forge.t / dur);
      if (forge.t >= dur) {
        forge.cool = 1;
        if (typeof forge.restore === "function") forge.restore();
        forge.restore = null;
        game.reconquerQueue = (game.reconquerQueue || []).filter(
          (entry) => entry.sourceId !== forge.sourceId
        );
        forge.phase = "done";
      }
    } else if (forge.phase === "arrive") {
      if (forge.t >= dur) advanceForgePhase(forge);
    }

    if (forge.phase !== "done") keep.push(forge);
  }
  game.forgeCasts = keep;
}

/** Mix neon molten orange into the final metal tint by cool progress 0→1. */
export function forgeCastColor(forge) {
  const cool = forge.cool || 0;
  if (forge.phase === "cast" || (forge.phase === "cool" && cool < 0.02)) {
    return MOLTEN_HOT;
  }
  if (forge.phase !== "cool") return MOLTEN_COLOR;
  // Neon orange → hot amber → final metal.
  if (cool < 0.45) {
    return mixHex(MOLTEN_HOT, MOLTEN_COLOR, cool / 0.45);
  }
  return mixHex(MOLTEN_COLOR, forge.finalColor || "#6a7078", (cool - 0.45) / 0.55);
}

function mixHex(a, b, t) {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return b || a;
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(pa.r + (pb.r - pa.r) * u);
  const g = Math.round(pa.g + (pb.g - pa.g) * u);
  const bl = Math.round(pa.b + (pb.b - pa.b) * u);
  return `#${[r, g, bl].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function finishReconquerHome(game, piece) {
  // Only reform once the full jigsaw is seated.
  if (!allSourcePiecesSeated(game, piece.sourceId)) return;
  if (typeof piece.homeRestore === "function") {
    piece.homeRestore();
    // Clear restore on siblings so it only runs once.
    for (const other of piecesForSource(game, piece.sourceId)) {
      other.homeRestore = null;
      other.despawnMode = "gone";
    }
  }
  game.reconquerQueue = (game.reconquerQueue || []).filter(
    (entry) => entry.sourceId !== piece.sourceId
  );
  removeSourcePieces(game, piece.sourceId);
}

/** Integrate ground debris physics + despawn styles. */
export function tickGroundDebris(game, dt) {
  const pieces = game?.groundDebris;
  if (!pieces?.length) {
    // Forge casts / armor dummies can outlive their scraps.
    tickForgeCasts(game, dt);
    tickArmorDummyBuilds(game, dt);
    tickReconquerBonus(game, dt);
    return;
  }
  const surfaces = debrisLandables(game);
  const style = despawnStyle(game);
  const keep = [];

  for (const piece of pieces) {
    if (piece.despawnMode === "gone") continue;

    if (!piece.immortal && !piece.despawnMode) {
      // Reconquer rate 0.1×–10× ages non-armor scraps into the queue faster.
      const ageMult = piece.material !== "armor" && style === "reconquer"
        ? reconquerRate(game)
        : 1;
      piece.life -= dt * ageMult;
      if (piece.life <= 0) {
        if (piece.material === "armor") {
          beginArmorDespawn(game, piece);
        } else {
          beginDespawn(piece, style);
          if (piece.despawnMode === "reconquer-wait") queueReconquer(game, piece);
        }
      }
    }

    if (piece.despawnMode === "reconquer-wait") {
      // Idle until a spawn opportunity claims this source.
      piece.alpha = 0.55 + Math.sin((game.elapsed || 0) * 4 + (piece.x || 0) * 0.01) * 0.2;
      piece.scale = 1;
    } else if (piece.despawnMode === "build-dummy-melt") {
      const tx = piece.homeX;
      const ty = piece.homeY;
      piece.despawnT = Math.min(1, piece.despawnT + dt / ARMOR_DUMMY_MELT_DURATION);
      piece.x += (tx - piece.x) * Math.min(1, dt * 6.5);
      piece.y += (ty - piece.y) * Math.min(1, dt * 6.5);
      piece.rot += piece.spin * dt;
      piece.spin *= Math.max(0, 1 - dt * 4);
      piece.scale = Math.max(0.12, 1 - piece.despawnT * 0.88);
      piece.alpha = Math.max(0.2, 1 - piece.despawnT * 0.7);
      // Glow molten while melting into the dummy.
      piece.color = piece.despawnT < 0.55 ? "#ff4a00" : "#ffe14a";
      if (Math.hypot(tx - piece.x, ty - piece.y) < 6 || piece.despawnT >= 1) {
        continue;
      }
      keep.push(piece);
      continue;
    } else if (piece.despawnMode === "material-consume") {
      // Stream scraps into the Material Consumer tip, then dissolve into bots.
      piece.despawnT = Math.min(1, (piece.despawnT || 0) + dt / MATERIAL_CONSUME_DURATION);
      if (piece.despawnT < 0) {
        // Staggered start: hover / nudge while waiting to launch.
        piece.y += Math.sin((game.elapsed || 0) * 10 + piece.x) * 8 * dt;
        keep.push(piece);
        continue;
      }
      const tx = piece.homeX;
      const ty = piece.homeY;
      const pull = 4.5 + piece.despawnT * 10;
      piece.x += (tx - piece.x) * Math.min(1, dt * pull);
      piece.y += (ty - piece.y) * Math.min(1, dt * pull);
      // Spiral in as it nears the tip.
      const ang = Math.atan2(ty - piece.y, tx - piece.x) + Math.PI * 0.5;
      const swirl = (1 - piece.despawnT) * 28 * dt;
      piece.x += Math.cos(ang) * swirl;
      piece.y += Math.sin(ang) * swirl;
      piece.rot += (piece.spin || 2) * dt + dt * (6 + piece.despawnT * 14);
      piece.spin = (piece.spin || 0) * Math.max(0, 1 - dt * 2);
      piece.scale = Math.max(0.06, 1 - piece.despawnT * 0.95);
      piece.alpha = Math.max(0.18, 1 - piece.despawnT * 0.82);
      // Shift scrap color toward nanotech cyan as it converts.
      if (piece.despawnT > 0.55) piece.color = "#6cffb0";
      else if (piece.despawnT > 0.28) piece.color = "#9ab888";
      const dist = Math.hypot(tx - piece.x, ty - piece.y);
      if (dist < 9 || piece.despawnT >= 1) {
        finishMaterialConsumePiece(game, piece);
        continue;
      }
      keep.push(piece);
      continue;
    } else if (piece.despawnMode === "forge-ingest") {
      // Metal scraps get sucked into the furnace mouth.
      const tx = piece.homeX;
      const ty = piece.homeY;
      piece.despawnT = Math.min(1, piece.despawnT + dt / FORGE_PHASE_DURATIONS.ingest);
      piece.x += (tx - piece.x) * Math.min(1, dt * 7);
      piece.y += (ty - piece.y) * Math.min(1, dt * 7);
      piece.rot += piece.spin * dt;
      piece.spin *= Math.max(0, 1 - dt * 3);
      piece.scale = Math.max(0.2, 1 - piece.despawnT * 0.75);
      piece.alpha = Math.max(0.15, 1 - piece.despawnT * 0.85);
      if (Math.hypot(tx - piece.x, ty - piece.y) < 8 || piece.despawnT >= 1) {
        continue; // swallowed
      }
      keep.push(piece);
      continue;
    } else if (piece.despawnMode === "reconquer-home") {
      piece.despawnT = Math.min(1, piece.despawnT + dt / RECONQUER_DURATION);
      const t = piece.despawnT;
      // Ease into the jigsaw slot: position + upright rotation.
      const tx = (piece.homeX || 0) + (piece.homeLx || 0);
      const ty = (piece.homeY || 0) + (piece.homeLy || 0);
      const ease = 1 - (1 - t) * (1 - t);
      piece.x += (tx - piece.x) * Math.min(1, dt * (4 + ease * 5));
      piece.y += (ty - piece.y) * Math.min(1, dt * (4 + ease * 5));
      piece.rot += (0 - piece.rot) * Math.min(1, dt * 6);
      piece.spin *= Math.max(0, 1 - dt * 8);
      piece.scale = 1;
      piece.alpha = 1;
      const dist = Math.hypot(tx - piece.x, ty - piece.y);
      if (t >= 1 || (dist < 3 && Math.abs(piece.rot) < 0.08)) {
        piece.x = tx;
        piece.y = ty;
        piece.rot = 0;
        piece.spin = 0;
        piece.homeSeated = true;
        piece.despawnMode = "reconquer-seated";
        // Reform only after every shard for this source is seated.
        if (allSourcePiecesSeated(game, piece.sourceId)) {
          finishReconquerHome(game, piece);
          continue;
        }
      }
      keep.push(piece);
      continue;
    } else if (piece.despawnMode === "reconquer-seated") {
      // Hold in the jigsaw slot until the last sibling lands, then reform.
      const tx = (piece.homeX || 0) + (piece.homeLx || 0);
      const ty = (piece.homeY || 0) + (piece.homeLy || 0);
      piece.x = tx;
      piece.y = ty;
      piece.rot = 0;
      piece.spin = 0;
      piece.scale = 1;
      piece.alpha = 1;
      piece.homeSeated = true;
      if (allSourcePiecesSeated(game, piece.sourceId)) {
        finishReconquerHome(game, piece);
        continue;
      }
      keep.push(piece);
      continue;
    } else if (piece.despawnMode === "fade") {
      piece.despawnT = Math.min(1, piece.despawnT + dt / DEBRIS_DESPAWN_DURATION);
      piece.alpha = 1 - piece.despawnT;
      if (piece.despawnT >= 1) continue;
    } else if (piece.despawnMode === "shrink") {
      piece.despawnT = Math.min(1, piece.despawnT + dt / DEBRIS_DESPAWN_DURATION);
      piece.scale = Math.max(0.02, 1 - piece.despawnT);
      piece.alpha = 1 - piece.despawnT * 0.35;
      if (piece.despawnT >= 1) continue;
    } else if (piece.despawnMode === "decimate") {
      piece.despawnT = Math.min(1, piece.despawnT + dt / DEBRIS_DESPAWN_DURATION);
      piece.alpha = 1 - piece.despawnT;
      piece.scale = Math.max(0.15, 1 - piece.despawnT * 0.55);
      // Snap fragments fly off-screen; skip normal grounding.
      piece.vy += GRAVITY * dt * 0.35;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rot += piece.spin * dt;
      if (piece.despawnT >= 1) continue;
      keep.push(piece);
      continue;
    }

    if (piece.grounded && piece.despawnMode !== "reconquer-wait" && !pieceHasSupport(piece, surfaces)) {
      piece.grounded = false;
      piece.settle = 0;
      piece.vy = Math.max(piece.vy, 40);
      piece.spin += (Math.random() - 0.5) * 3;
    }

    if (piece.grounded) {
      piece.settle = Math.min(1, (piece.settle || 0) + dt * 3);
      piece.spin *= Math.max(0, 1 - dt * 8);
      piece.rot += piece.spin * dt;
      keep.push(piece);
      continue;
    }

    piece.vy += GRAVITY * dt;
    piece.vy = Math.min(piece.vy, 980);
    const oldY = piece.y;
    piece.x += piece.vx * dt;
    piece.y += piece.vy * dt;
    piece.rot += piece.spin * dt;
    piece.vx *= Math.max(0, 1 - dt * 0.35);
    piece.x = clamp(piece.x, 8, WORLD.w - 8);

    const scale = piece.scale || 1;
    const halfW = piece.w * scale * 0.5;
    const halfH = piece.h * scale * 0.5;
    const bottom = piece.y + halfH;
    for (const platform of surfaces) {
      const wasAbove = oldY + halfH <= platform.y + 4;
      const crosses = bottom >= platform.y
        && bottom <= platform.y + Math.max(28, piece.vy * dt + 10);
      if (
        wasAbove && crosses && piece.vy >= 0
        && piece.x + halfW > platform.x
        && piece.x - halfW < platform.x + platform.w
      ) {
        piece.y = platform.y - halfH;
        piece.vy = 0;
        piece.vx *= 0.45;
        piece.spin *= 0.4;
        if (Math.abs(piece.vx) < 18 && Math.abs(piece.spin) < 1.2) {
          piece.grounded = true;
          piece.vx = 0;
          piece.spin *= 0.2;
        }
        break;
      }
    }
    if (piece.y > WORLD.h + 80) {
      piece.y = WORLD.h - 4;
      piece.grounded = true;
      piece.vx = 0;
      piece.vy = 0;
    }
    keep.push(piece);
  }

  // Drop scraps marked gone mid-tick (e.g. full jigsaw just reformed).
  game.groundDebris = keep.filter((piece) => piece.despawnMode !== "gone");
  tickForgeCasts(game, dt);
  tickArmorDummyBuilds(game, dt);
  tickReconquerBonus(game, dt);
}

/** @deprecated alias */
export const tickArmorDebris = tickGroundDebris;
