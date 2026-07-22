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
  homeLx = 0, homeLy = 0, shape = "rect", detail = null, edge = null
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
    // Jigsaw slot relative to object center — reconquer flies each tile home.
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
 * Rebuilds in the same general area (slight nearby shift).
 */
export function beginArmorDummyBuild(game, piece) {
  if (!game || !piece?.sourceId) return null;
  game.armorDummyBuilds ||= [];
  if (game.armorDummyBuilds.some((build) => build.sourceId === piece.sourceId)) return null;

  const group = piecesForSource(game, piece.sourceId).filter((p) => p.material === "armor");
  if (!group.length) return null;

  let sx = 0;
  let sy = 0;
  for (const p of group) {
    sx += p.x;
    sy += p.y;
  }
  // Same / near: keep the pile center, with a slight local nudge.
  const targetX = sx / group.length + (Math.random() - 0.5) * 40;
  const targetY = sy / group.length + (Math.random() - 0.5) * 18;
  const color = group[0].color || ARMOR_DUMMY_METAL;
  const armorMaxHp = Math.max(1, group[0].armorMaxHp || 100);

  const build = {
    sourceId: piece.sourceId,
    targetX,
    targetY,
    color,
    armorMaxHp,
    phase: "melt",
    t: 0,
    cool: 0
  };
  game.armorDummyBuilds.push(build);

  for (const scrap of group) {
    scrap.despawnMode = "build-dummy-melt";
    scrap.despawnT = 0;
    scrap.grounded = false;
    scrap.homeX = targetX;
    scrap.homeY = targetY;
    scrap.scale = 1;
    scrap.alpha = 1;
  }
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
  tickForgeCasts(game, dt);
  tickArmorDummyBuilds(game, dt);
  tickReconquerBonus(game, dt);
}

/** @deprecated alias */
export const tickArmorDebris = tickGroundDebris;
