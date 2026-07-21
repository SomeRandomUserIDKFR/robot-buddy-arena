/**
 * Match ground debris: armor plates (persist), plus non-armor scraps that
 * despawn via Settings → Visual → Debris disappear (fade / shrink / decimate / reconquer).
 */
import { GRAVITY, SIZE, WORLD } from "./config.js";
import { normalizeDebrisDespawnStyle } from "./settings.js";
import { clamp } from "./utils.js";

export const NON_ARMOR_DEBRIS_LIFE = 14;
export const DEBRIS_DESPAWN_DURATION = 1.05;
export const RECONQUER_DURATION = 1.45;

function debrisLandables(game) {
  const platforms = game?.platforms?.length ? game.platforms : [];
  const solids = (game?.props || []).filter(
    (prop) => !prop.destroyed && prop.solid && (prop.hp == null || prop.hp > 0)
  );
  return [
    ...platforms,
    ...solids.map((prop) => ({ x: prop.x, y: prop.y, w: prop.w, h: prop.h }))
  ];
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
  homeLx = 0, homeLy = 0, shape = "rect", detail = null, edge = null
}) {
  const burst = 100 + (index % 5) * 28;
  const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 1.5 + facing * 0.12;
  const armor = material === "armor";
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
    // Jigsaw slot relative to object center — reconquer flies each tile home.
    homeLx,
    homeLy,
    grounded: false,
    settle: 0,
    // Armor never despawns mid-match; everything else ages out.
    immortal: armor,
    life: armor ? Infinity : NON_ARMOR_DEBRIS_LIFE,
    maxLife: armor ? Infinity : NON_ARMOR_DEBRIS_LIFE,
    alpha: 1,
    scale: 1,
    despawnMode: null,
    despawnT: 0,
    sourceType,
    sourceKind,
    sourceId,
    sourceProp,
    homeX: null,
    homeY: null
  });
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
  barrel: { fill: "#8a5030", edge: "#3a2010", material: "metal" },
  powerCrate: { fill: "#6a7078", rim: "#2a3038", edge: "#1a2028", material: "metal" }
});

function gridRect(localX, localY, w, h, cols, rows, paint) {
  const tiles = [];
  const tw = w / cols;
  const th = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const useAlt = paint.fill2 && ((c + r) % 2 === 1);
      tiles.push({
        kind: "tile",
        homeLx: localX + tw * (c + 0.5),
        homeLy: localY + th * (r + 0.5),
        w: tw,
        h: th,
        color: useAlt ? paint.fill2 : paint.fill,
        edge: paint.edge,
        shape: "rect",
        detail: paint.detail || null,
        material: paint.material
      });
    }
  }
  return tiles;
}

function ellipseTiles(cx, cy, rw, rh, cols, rows, paint) {
  const tiles = [];
  const tw = (rw * 2) / cols;
  const th = (rh * 2) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Offset from ellipse center (not prop center) for the containment test.
      const ox = -rw + tw * (c + 0.5);
      const oy = -rh + th * (r + 0.5);
      if ((ox * ox) / (rw * rw) + (oy * oy) / (rh * rh) > 1.08) continue;
      const useAlt = paint.fill2 && ((c + r) % 2 === 1);
      tiles.push({
        kind: "tile",
        homeLx: cx + ox,
        homeLy: cy + oy,
        w: tw,
        h: th,
        color: useAlt ? paint.fill2 : paint.fill,
        edge: paint.edge,
        shape: "rect",
        detail: null,
        material: paint.material
      });
    }
  }
  return tiles;
}

/**
 * Full jigsaw of a prop's drawn geometry — every fragment, accurate colors.
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
      tiles.push(...gridRect(
        part.x - prop.w / 2,
        part.y - prop.h / 2,
        part.w,
        part.h,
        part.cols,
        part.rows,
        paint
      ));
    }
    return tiles;
  }
  if (kind === "bush") {
    return ellipseTiles(0, prop.h * 0.05, prop.w / 2, prop.h / 2, 4, 3, PROP_DEBRIS_COLORS.bush);
  }
  if (kind === "tree") {
    // Trunk (full drawn rect) + canopy jigsaw.
    const trunkW = prop.w * 0.44;
    const trunkX = prop.w * 0.28 - prop.w / 2;
    tiles.push(...gridRect(
      trunkX, -prop.h / 2, trunkW, prop.h, 2, 8, PROP_DEBRIS_COLORS.tree
    ));
    if (prop.canopy) {
      const c = prop.canopy;
      const cx = (c.x + c.w / 2) - (prop.x + prop.w / 2);
      const cy = (c.y + c.h / 2) - (prop.y + prop.h / 2);
      tiles.push(...ellipseTiles(
        cx, cy, c.w / 2, c.h / 2, 5, 4, PROP_DEBRIS_COLORS.treeCanopy
      ));
    }
    return tiles;
  }
  if (kind === "crate") {
    return gridRect(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 4, 4,
      { ...PROP_DEBRIS_COLORS.crate, detail: "crate" }
    );
  }
  if (kind === "pipe") {
    const outer = gridRect(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 5, 2, PROP_DEBRIS_COLORS.pipe
    );
    // Hollow look: mark center-row tiles with darker fill already via fill2 checker.
    return outer;
  }
  if (kind === "pillar") {
    const body = gridRect(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 2, 6, PROP_DEBRIS_COLORS.pillar
    );
    const cap = PROP_DEBRIS_COLORS.pillar;
    tiles.push(...body);
    // Cap fragments matching the wider top/bottom bands.
    tiles.push(...gridRect(-prop.w / 2 - 4, -prop.h / 2, prop.w + 8, 14, 3, 1, {
      fill: cap.fill2, edge: cap.edge, material: cap.material
    }));
    tiles.push(...gridRect(-prop.w / 2 - 4, prop.h / 2 - 14, prop.w + 8, 14, 3, 1, {
      fill: cap.fill2, edge: cap.edge, material: cap.material
    }));
    return tiles;
  }
  if (kind === "barrel") {
    return gridRect(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 3, 4,
      { ...PROP_DEBRIS_COLORS.barrel, detail: "barrel" }
    );
  }
  if (kind === "powerCrate") {
    const look = prop.look || PROP_DEBRIS_COLORS.powerCrate;
    return gridRect(
      -prop.w / 2, -prop.h / 2, prop.w, prop.h, 4, 4,
      {
        fill: look.metal || PROP_DEBRIS_COLORS.powerCrate.fill,
        fill2: look.rim || PROP_DEBRIS_COLORS.powerCrate.rim,
        edge: PROP_DEBRIS_COLORS.powerCrate.edge,
        material: "metal",
        detail: "powerCrate"
      }
    );
  }
  return gridRect(
    -prop.w / 2, -prop.h / 2, prop.w, prop.h, 3, 3,
    { fill: "#668", edge: "#334", material: "scrap" }
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

/**
 * When retractable armor is destroyed, drop helmet/plate pieces that stay
 * on the ground for the rest of the match.
 */
export function spawnBrokenArmorDebris(game, fighter) {
  if (!game || !fighter || fighter.armorDebrisDropped) return;
  fighter.armorDebrisDropped = true;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const color = armorDebrisColor(fighter);
  const facing = Math.cos(fighter.aim || 0) >= 0 ? 1 : -1;
  const specs = [
    { kind: "helmet", ox: 0, oy: -20, w: 30, h: 12 },
    { kind: "crest", ox: 0, oy: -28, w: 10, h: 6 },
    { kind: "cheekL", ox: -16, oy: -10, w: 10, h: 16 },
    { kind: "cheekR", ox: 16, oy: -10, w: 10, h: 16 },
    { kind: "chin", ox: 0, oy: 2, w: 20, h: 10 },
    { kind: "shoulderL", ox: -20, oy: 6, w: 14, h: 9 },
    { kind: "shoulderR", ox: 20, oy: 6, w: 14, h: 9 },
    { kind: "breast", ox: 0, oy: 14, w: 28, h: 16 },
    { kind: "ab", ox: 0, oy: 24, w: 22, h: 7 }
  ];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    burstPiece(game, {
      material: "armor",
      kind: spec.kind,
      x: cx + spec.ox,
      y: cy + spec.oy,
      w: spec.w,
      h: spec.h,
      color,
      vx: (fighter.vx || 0) * 0.25,
      vy: (fighter.vy || 0) * 0.15,
      facing,
      index: i
    });
  }

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
    // Spawn from the tile's true place on the object, then burst outward.
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
      homeLx: tile.homeLx,
      homeLy: tile.homeLy,
      index: i,
      sourceType,
      sourceKind: kind,
      sourceId,
      sourceProp: sourceType === "prop" ? prop : null
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

function queueReconquer(game, piece) {
  game.reconquerQueue ||= [];
  if (game.reconquerQueue.some((entry) => entry.sourceId === piece.sourceId)) return;
  game.reconquerQueue.push({
    sourceId: piece.sourceId,
    sourceType: piece.sourceType,
    sourceKind: piece.sourceKind,
    sourceProp: piece.sourceProp || null,
    ready: true
  });
}

function piecesForSource(game, sourceId) {
  return (game.groundDebris || []).filter((p) => p.sourceId === sourceId);
}

function removeSourcePieces(game, sourceId) {
  game.groundDebris = (game.groundDebris || []).filter((p) => p.sourceId !== sourceId);
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
  return true;
}

/**
 * Called when the match spawn system places (or is about to place) a new object.
 * Reconquer style only rebuilds then, at that spawn opportunity / a random slot.
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
  let restore = null;

  if (entry.sourceType === "powerCrate") {
    if (!spot) return false;
    homeX = spot.x + (spot.w || 40) / 2;
    homeY = (spot.y ?? (spot.yBottom - 40)) + 20;
    // Caller still spawns the crate; we just animate debris home and clear.
    restore = () => removeSourcePieces(game, entry.sourceId);
  } else {
    const candidates = (game.props || []).filter(
      (prop) => prop.destroyed && prop.kind === entry.sourceKind
    );
    if (!candidates.length) return false;
    const prop = candidates[Math.floor(Math.random() * candidates.length) % candidates.length];
    homeX = prop.x + prop.w / 2;
    homeY = prop.y + prop.h / 2;
    restore = () => {
      restoreMapProp(prop);
      removeSourcePieces(game, entry.sourceId);
    };
  }

  const group = piecesForSource(game, entry.sourceId);
  if (!group.length) {
    queue.splice(index, 1);
    return false;
  }

  for (const piece of group) {
    piece.despawnMode = "reconquer-home";
    piece.despawnT = 0;
    piece.grounded = false;
    piece.scale = 1;
    piece.alpha = 1;
    // Object center; each tile still offsets by its jigsaw homeLx/homeLy.
    piece.homeX = homeX;
    piece.homeY = homeY;
    piece.homeRestore = restore;
  }
  entry.ready = false;
  entry.homing = true;
  return entry.sourceType === "prop";
}

function finishReconquerHome(game, piece) {
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
  if (!pieces?.length) return;
  const surfaces = debrisLandables(game);
  const style = despawnStyle(game);
  const keep = [];

  for (const piece of pieces) {
    if (piece.despawnMode === "gone") continue;

    if (!piece.immortal && !piece.despawnMode) {
      piece.life -= dt;
      if (piece.life <= 0) {
        beginDespawn(piece, style);
        if (piece.despawnMode === "reconquer-wait") queueReconquer(game, piece);
      }
    }

    if (piece.despawnMode === "reconquer-wait") {
      // Idle until a spawn opportunity claims this source.
      piece.alpha = 0.55 + Math.sin((game.elapsed || 0) * 4 + (piece.x || 0) * 0.01) * 0.2;
      piece.scale = 1;
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

  game.groundDebris = keep;
}

/** @deprecated alias */
export const tickArmorDebris = tickGroundDebris;
