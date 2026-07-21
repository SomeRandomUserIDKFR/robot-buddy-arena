/**
 * Match ground debris: armor plates (persist), plus non-armor scraps that
 * despawn via Settings → Visual → Debris disappear (fade / shrink / decimate / reconquer).
 */
import { GRAVITY, SIZE, WORLD } from "./config.js";
import { normalizeDebrisDespawnStyle } from "./settings.js";
import { clamp } from "./utils.js";

export const NON_ARMOR_DEBRIS_LIFE = 14;
export const DEBRIS_DESPAWN_DURATION = 1.05;

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
  sourceType = null, sourceKind = null, sourceId = null, sourceProp = null
}) {
  const burst = 120 + (index % 4) * 30;
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

/** Material + colors for breakable map props. */
export function propDebrisProfile(kind) {
  switch (kind) {
    case "tree":
      return {
        material: "wood",
        colors: ["#6b4a28", "#8a6234", "#5a3a1c", "#a07440"],
        specs: [
          { kind: "log", w: 22, h: 10 },
          { kind: "log", w: 18, h: 8 },
          { kind: "plank", w: 16, h: 6 },
          { kind: "plank", w: 14, h: 5 },
          { kind: "chip", w: 9, h: 7 },
          { kind: "chip", w: 8, h: 6 },
          { kind: "branch", w: 20, h: 5 },
          { kind: "branch", w: 12, h: 4 }
        ]
      };
    case "cactus":
      return {
        material: "plant",
        colors: ["#3d6a38", "#4a783f", "#2f552c"],
        specs: [
          { kind: "chunk", w: 12, h: 10 },
          { kind: "chunk", w: 10, h: 8 },
          { kind: "spine", w: 8, h: 14 },
          { kind: "spine", w: 7, h: 12 },
          { kind: "chip", w: 6, h: 6 }
        ]
      };
    case "bush":
      return {
        material: "plant",
        colors: ["#3a5c30", "#4a6e38", "#2c4824"],
        specs: [
          { kind: "tuft", w: 14, h: 8 },
          { kind: "tuft", w: 12, h: 7 },
          { kind: "chip", w: 7, h: 6 },
          { kind: "chip", w: 6, h: 5 }
        ]
      };
    case "crate":
    case "pipe":
    case "pillar":
    case "barrel":
    case "powerCrate":
      return {
        material: "metal",
        colors: kind === "powerCrate"
          ? ["#9aa8b8", "#b0bcc8", "#7a8898", "#c4ced8"]
          : kind === "barrel"
            ? ["#8a7060", "#a88870", "#6e5848", "#b89878"]
            : ["#8a949e", "#a8b0b8", "#6e787f", "#c0c8d0"],
        specs: [
          { kind: "panel", w: 16, h: 10 },
          { kind: "panel", w: 14, h: 9 },
          { kind: "shard", w: 11, h: 8 },
          { kind: "shard", w: 10, h: 7 },
          { kind: "rivet", w: 7, h: 6 },
          { kind: "strip", w: 18, h: 5 },
          { kind: "strip", w: 12, h: 4 },
          { kind: "corner", w: 9, h: 9 }
        ]
      };
    default:
      return {
        material: "scrap",
        colors: ["#7a7060", "#908070"],
        specs: [
          { kind: "chip", w: 10, h: 7 },
          { kind: "chip", w: 8, h: 6 },
          { kind: "chip", w: 7, h: 5 }
        ]
      };
  }
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

/** Lasting rubble when a breakable map prop is destroyed. */
export function spawnPropDebris(game, prop, impactX, impactY, options = {}) {
  if (!game || !prop || prop.groundDebrisDropped) return;
  prop.groundDebrisDropped = true;

  const kind = options.forceKind || prop.kind;
  const profile = propDebrisProfile(kind);
  const cx = impactX ?? prop.x + prop.w / 2;
  const cy = impactY ?? prop.y + prop.h / 2;
  const sourceId = nextSourceId(game);
  const sourceType = options.sourceType
    || (kind === "powerCrate" || prop.powerCrate ? "powerCrate" : "prop");
  const count = profile.specs.length;

  for (let i = 0; i < count; i++) {
    const spec = profile.specs[i];
    const color = profile.colors[i % profile.colors.length];
    const spreadX = (Math.random() - 0.5) * prop.w * 0.7;
    const spreadY = (Math.random() - 0.5) * Math.min(prop.h, 60) * 0.5;
    burstPiece(game, {
      material: profile.material,
      kind: spec.kind,
      x: cx + spreadX,
      y: cy + spreadY,
      w: spec.w,
      h: spec.h,
      color,
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
      piece.despawnT = Math.min(1, piece.despawnT + dt / DEBRIS_DESPAWN_DURATION);
      const tx = piece.homeX;
      const ty = piece.homeY;
      piece.x += (tx - piece.x) * Math.min(1, dt * 6);
      piece.y += (ty - piece.y) * Math.min(1, dt * 6);
      piece.scale = 1 - piece.despawnT * 0.35;
      piece.alpha = 1 - piece.despawnT * 0.15;
      piece.spin *= Math.max(0, 1 - dt * 4);
      piece.rot += piece.spin * dt;
      if (piece.despawnT >= 1 || Math.hypot(tx - piece.x, ty - piece.y) < 10) {
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
