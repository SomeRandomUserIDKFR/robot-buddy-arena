/**
 * Match-lasting ground debris: broken armor plates, wood from trees,
 * metal fragments from crates/pipes/barrels, plant scraps from cactus/bush.
 */
import { GRAVITY, SIZE, WORLD } from "./config.js";
import { clamp } from "./utils.js";

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

function burstPiece(game, {
  material, kind, x, y, w, h, color, vx = 0, vy = 0, facing = 0, index = 0
}) {
  const burst = 120 + (index % 4) * 30;
  const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 1.5 + facing * 0.12;
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
    color,
    grounded: false,
    settle: 0
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
export function spawnPropDebris(game, prop, impactX, impactY) {
  if (!game || !prop || prop.groundDebrisDropped) return;
  prop.groundDebrisDropped = true;

  const profile = propDebrisProfile(prop.kind);
  const cx = impactX ?? prop.x + prop.w / 2;
  const cy = impactY ?? prop.y + prop.h / 2;
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
      index: i
    });
  }
}

/** Metal fragments when a power crate is destroyed. */
export function spawnPowerCrateDebris(game, crate) {
  if (!crate) return;
  spawnPropDebris(game, { ...crate, kind: "powerCrate", groundDebrisDropped: false });
}

/** Integrate ground debris; pieces rest on platforms for the whole match. */
export function tickGroundDebris(game, dt) {
  const pieces = game?.groundDebris;
  if (!pieces?.length) return;
  const surfaces = debrisLandables(game);
  for (const piece of pieces) {
    if (piece.grounded) {
      piece.settle = Math.min(1, (piece.settle || 0) + dt * 3);
      piece.spin *= Math.max(0, 1 - dt * 8);
      piece.rot += piece.spin * dt;
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

    const halfW = piece.w * 0.5;
    const halfH = piece.h * 0.5;
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
  }
}

/** @deprecated alias — armor debris shares the groundDebris list */
export const tickArmorDebris = tickGroundDebris;
