/**
 * Reconjurer / Builder — extension secondary (key 3).
 * Near debris: rebuild that pile for free (+2 ejection scraps).
 * Near intact cover: Patching / Bracing — weld a metal casing shell.
 * Otherwise: conjure the selected breakable for nanobots (T cycles type;
 * metal box costs more and has a 10s CD). Left-corner HUD previews the look.
 */
import { SIZE, WORLD } from "./config.js";
import { resolveStandTarget, tryManualRebuildNear } from "./debris.js";
import {
  GEAR_BY_ID, MATERIAL_CONSUMER_BOTS_PER_PIECE, MATERIAL_CONSUMER_EJECTION_TANK_CAP,
  materialEjectionTank, NO_EXTENSION_ID, RECONJURER_BUILDER_ID
} from "./equipment.js";
import { createMapProp, MAP_PROP_KINDS } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { clamp } from "./utils.js";

export { RECONJURER_BUILDER_ID };

/** Seconds between successful rebuilds / conjures. */
export const RECONJURER_COOLDOWN = 1.2;
/** Global per-user cooldown between metal power-crate rebuilds/conjures. */
export const RECONJURER_METAL_COOLDOWN = 10;
/** How close debris must be to rebuild with key 3. */
export const RECONJURER_REBUILD_RADIUS = 150;
/** World radius for conjure placement when no debris is near. */
export const RECONJURER_PLACE_RADIUS = 140;
/** How close an intact breakable must be to Patch / Brace. */
export const RECONJURER_BRACE_RADIUS = 150;
/** @deprecated Selection replaces random metal rolls; kept for save/FAQ compat. */
export const RECONJURER_METAL_CRATE_CHANCE = 0.08;
/** Ejection-tank scraps granted after a successful rebuild or conjure. */
export const RECONJURER_SCRAP_REWARD = 2;
/** Free nanobots charged for a normal conjure. */
export const RECONJURER_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE;
/** Free nanobots charged for a metal power-crate conjure. */
export const RECONJURER_METAL_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE * 2;
/** Nanobots to weld a Patching / Bracing metal casing onto intact cover. */
export const RECONJURER_BRACE_BOT_COST = MATERIAL_CONSUMER_BOTS_PER_PIECE;
/** Extra HP shell on a braced breakable (absorbs hits before wood). */
export const RECONJURER_BRACE_HP = 48;

/** Selection id for a metal power crate. */
export const RECONJURER_METAL_TYPE = "metal";

const THEME_KINDS = Object.freeze({
  desert: ["cactus", "bush", "crate", "barrel"],
  forest: ["tree", "bush", "crate", "barrel"],
  industrial: ["crate", "pipe", "barrel", "redBarrel", "pillar"],
  yard: ["crate", "pipe", "barrel", "redBarrel", "crateStack"],
  ruins: ["pillar", "crate", "barrel", "bush"],
  docks: ["crate", "barrel", "redBarrel", "pipe"],
  city: ["crate", "barrel", "redBarrel", "pipe", "pillar"],
  battlefield: ["crate", "barrel", "pipe", "bush"]
});

export function isReconjurerBuilder(fighterOrId) {
  if (typeof fighterOrId === "string") return fighterOrId === RECONJURER_BUILDER_ID;
  if (fighterOrId?.reconjurerBuilder === true) return true;
  const id = fighterOrId?.loadout?.extensionSecondary;
  return id === RECONJURER_BUILDER_ID
    || GEAR_BY_ID[id]?.reconjurerBuilder === true;
}

export function hasExtensionSecondary(fighter) {
  const id = fighter?.loadout?.extensionSecondary;
  return !!id && id !== NO_EXTENSION_ID && !!GEAR_BY_ID[id];
}

/** Theme-appropriate breakable kinds + metal. */
export function listReconjurerChoices(game) {
  const theme = game?.theme || game?.mapId || "battlefield";
  const pool = THEME_KINDS[theme] || THEME_KINDS.battlefield;
  const kinds = pool.filter((kind) => MAP_PROP_KINDS.includes(kind));
  const base = kinds.length ? kinds : ["crate"];
  return [...base, RECONJURER_METAL_TYPE];
}

export function normalizeReconjurerType(type, game = null) {
  const choices = listReconjurerChoices(game);
  if (choices.includes(type)) return type;
  return choices[0] || "crate";
}

export function reconjurerTypeLabel(type) {
  if (type === RECONJURER_METAL_TYPE) return "METAL";
  if (type === "crateStack") return "STACK";
  return String(type || "crate").toUpperCase();
}

export function cycleReconjurerType(fighter, game = null) {
  if (!isReconjurerBuilder(fighter)) return null;
  const choices = listReconjurerChoices(game);
  const cur = normalizeReconjurerType(fighter.reconjurerType, game);
  const idx = choices.indexOf(cur);
  const next = choices[(idx + 1) % choices.length];
  fighter.reconjurerType = next;
  return next;
}

function affordBots(fighter, cost) {
  return (fighter.nanobotFree || 0) >= Math.max(0, cost | 0);
}

function spendBots(fighter, cost) {
  const need = Math.max(0, cost | 0);
  if (!affordBots(fighter, need)) return false;
  if (need > 0) fighter.nanobotFree -= need;
  return true;
}

function grantRebuildScraps(fighter, count = RECONJURER_SCRAP_REWARD) {
  const tank = materialEjectionTank(fighter);
  let gained = 0;
  for (let i = 0; i < count; i++) {
    if (tank.length >= MATERIAL_CONSUMER_EJECTION_TANK_CAP) break;
    tank.push({
      bots: 0,
      ejection: true,
      reconjurerReward: true,
      color: "#8ec4d0",
      w: 8,
      h: 8
    });
    gained += 1;
  }
  return gained;
}

function placePoint(fighter, random) {
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const aim = Number.isFinite(fighter.aim) ? fighter.aim : 0;
  const dist = 48 + random() * RECONJURER_PLACE_RADIUS;
  const spread = (random() - 0.5) * 1.1;
  return {
    x: cx + Math.cos(aim + spread) * dist,
    y: cy + Math.sin(aim + spread) * dist * 0.55
  };
}

function finishBuild(fighter, game, target, isMetal, opts = {}) {
  grantRebuildScraps(fighter, RECONJURER_SCRAP_REWARD);
  fighter.reconjurerCd = RECONJURER_COOLDOWN;
  fighter.reconjurerFlash = 0.22;
  if (isMetal && !opts.skipMetalCd) {
    fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN;
  }
  if (game.effects) {
    game.effects.push({
      type: "crateBreak",
      x: target.x + target.w * 0.5,
      y: target.y + target.h * 0.5,
      life: 0.35,
      color: isMetal || opts.brace ? "#d8e0ea" : "#8ec4d0"
    });
    game.effects.push({
      type: "propHit",
      x: target.x + target.w * 0.5,
      y: target.y + target.h * 0.5,
      life: 0.14
    });
  }
  return target;
}

/** Whether a map prop can receive Patching / Bracing. */
export function canBraceBreakable(prop) {
  if (!prop || prop.destroyed || !prop.breakable) return false;
  if (prop.braced && (prop.braceHp || 0) > 0) return false;
  if (prop.powerCrate || prop.kind === "powerCrate") return false;
  if (prop.armorDummy || prop.forgeHidden || prop.illusionGhosted) return false;
  if (prop.lightCondensation || prop.kind === "lightCondensation") return false;
  if (prop.heldBy || prop.thrownInFlight) return false;
  if (prop.illusionObject || prop.illusionHeldProp) return false;
  if (prop.hp != null && !(prop.hp > 0)) return false;
  return true;
}

/** Nearest intact breakable in brace range, or null. */
export function findBraceTarget(game, fighter, maxRange = RECONJURER_BRACE_RADIUS) {
  if (!game || !fighter || !(maxRange > 0)) return null;
  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  let best = null;
  let bestD = maxRange;
  for (const prop of game.props || []) {
    if (!canBraceBreakable(prop)) continue;
    const px = prop.x + (prop.w || 0) / 2;
    const py = prop.y + (prop.h || 0) / 2;
    const d = Math.hypot(px - cx, py - cy);
    if (d <= bestD) {
      best = prop;
      bestD = d;
    }
  }
  return best;
}

/** Apply a metal casing shell to an intact breakable. */
export function applyBraceCasing(prop, hp = RECONJURER_BRACE_HP) {
  if (!prop) return null;
  const shell = Math.max(1, hp | 0);
  prop.braced = true;
  prop.braceHp = shell;
  prop.braceMaxHp = shell;
  prop.hitFlash = Math.max(prop.hitFlash || 0, 0.18);
  return prop;
}

/**
 * Press 3 near intact cover: spend bots to weld a metal casing (Patching / Bracing).
 * @returns {object|null}
 */
export function tryBraceNearIntact(fighter, game) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;
  const target = findBraceTarget(game, fighter, RECONJURER_BRACE_RADIUS);
  if (!target) return null;
  if (!affordBots(fighter, RECONJURER_BRACE_BOT_COST)) return null;
  if (!spendBots(fighter, RECONJURER_BRACE_BOT_COST)) return null;
  applyBraceCasing(target, RECONJURER_BRACE_HP);
  return finishBuild(fighter, game, target, true, { skipMetalCd: true, brace: true });
}

/**
 * No debris nearby: spend nanobots and conjure the selected breakable.
 * @returns {object|null}
 */
function conjureSelectedBreakable(fighter, game, random) {
  const type = normalizeReconjurerType(fighter.reconjurerType, game);
  const wantMetal = type === RECONJURER_METAL_TYPE;
  if (wantMetal && (fighter.reconjurerMetalCd || 0) > 0) return null;
  const botCost = wantMetal ? RECONJURER_METAL_BOT_COST : RECONJURER_BOT_COST;
  if (!affordBots(fighter, botCost)) return null;

  const rough = placePoint(fighter, random);
  let spawned = null;

  if (wantMetal) {
    const w = 40;
    const h = 40;
    const stand = resolveStandTarget(game, [], rough.x, rough.y, w, h);
    const x = stand.targetX - w * 0.5;
    const yBottom = stand.targetY + h * 0.5;
    if (!spendBots(fighter, botCost)) return null;
    spawned = createPowerCrate(
      { x, y: yBottom },
      game.mapId || "battlefield",
      game.theme || "battlefield",
      `rj-pc-${Math.floor((game.elapsed || 0) * 1000)}-${Math.floor(random() * 1e6)}`
    );
    game.powerCrates ||= [];
    game.powerCrates.push(spawned);
  } else {
    const kind = type;
    const probe = createMapProp(kind, 0, 0);
    const stand = resolveStandTarget(game, [], rough.x, rough.y, probe.w, probe.h);
    const x = stand.targetX - probe.w * 0.5;
    const yBottom = stand.targetY + probe.h * 0.5;
    if (!spendBots(fighter, botCost)) return null;
    spawned = createMapProp(kind, x, yBottom);
    spawned.x = clamp(spawned.x, 0, WORLD.w - spawned.w);
    game.props ||= [];
    game.props.push(spawned);
  }

  return finishBuild(fighter, game, spawned, wantMetal);
}

/**
 * Press 3 near debris: free rebuild (+2 scraps).
 * Else near intact cover: Patching / Bracing metal casing (bots).
 * Otherwise: paid conjure of the selected type (T cycles).
 * @returns {object|null} restored, braced, or spawned prop / power crate
 */
export function tryReconjurerBuild(fighter, game, random = Math.random) {
  if (!fighter || fighter.dead || !game) return null;
  if (!isReconjurerBuilder(fighter)) return null;
  if ((fighter.reconjurerCd || 0) > 0) return null;

  const cx = fighter.x + SIZE / 2;
  const cy = fighter.y + SIZE / 2;
  const metalReady = (fighter.reconjurerMetalCd || 0) <= 0;

  const rebuilt = tryManualRebuildNear(game, cx, cy, RECONJURER_REBUILD_RADIUS, {
    allowPowerCrate: metalReady,
    createPowerCrate
  });
  if (rebuilt?.target) {
    // Fresh rebuild starts without leftover casing.
    clearBraceCasing(rebuilt.target);
    return finishBuild(
      fighter,
      game,
      rebuilt.target,
      rebuilt.sourceType === "powerCrate"
    );
  }

  const braced = tryBraceNearIntact(fighter, game);
  if (braced) return braced;

  return conjureSelectedBreakable(fighter, game, random);
}

/** Strip Patching / Bracing casing from a prop. */
export function clearBraceCasing(prop) {
  if (!prop) return prop;
  prop.braced = false;
  prop.braceHp = 0;
  prop.braceMaxHp = 0;
  return prop;
}

export function tickReconjurerBuilder(fighter, dt) {
  if (!fighter) return;
  const step = dt || 0;
  if (fighter.reconjurerCd > 0) {
    fighter.reconjurerCd = Math.max(0, fighter.reconjurerCd - step);
  }
  if (fighter.reconjurerMetalCd > 0) {
    fighter.reconjurerMetalCd = Math.max(0, fighter.reconjurerMetalCd - step);
  }
  if (fighter.reconjurerFlash > 0) {
    fighter.reconjurerFlash = Math.max(0, fighter.reconjurerFlash - step);
  }
}

/** Draw a breakable silhouette into a HUD preview canvas (matches in-world look). */
export function paintReconjurerPreview(canvas, type, game = null) {
  if (!canvas?.getContext) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width || 96;
  const H = canvas.height || 96;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(6, 14, 20, 0.92)";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(100, 180, 200, 0.35)";
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  const sel = normalizeReconjurerType(type, game);
  if (sel === RECONJURER_METAL_TYPE) {
    paintMetalPreview(ctx, W, H);
    return;
  }
  const probe = createMapProp(sel, 0, 0);
  // createMapProp(kind, x, yBottom) → top at -h when yBottom=0; normalize to 0,0.
  const pw = probe.w;
  const ph = probe.h;
  const pad = 14;
  const scale = Math.min((W - pad * 2) / pw, (H - pad * 2) / ph);
  const dw = pw * scale;
  const dh = ph * scale;
  const ox = (W - dw) / 2;
  const oy = (H - dh) / 2;
  paintPropLook(ctx, sel === "crateStack" ? "crateStack" : probe.kind, ox, oy, dw, dh);
}

function paintMetalPreview(ctx, W, H) {
  const s = Math.min(W, H) * 0.62;
  const x = (W - s) / 2;
  const y = (H - s) / 2;
  ctx.fillStyle = "#6a7078";
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = "#2a3038";
  const rim = Math.max(2, s * 0.08);
  ctx.fillRect(x, y, s, rim);
  ctx.fillRect(x, y + s - rim, s, rim);
  ctx.fillRect(x, y, rim, s);
  ctx.fillRect(x + s - rim, y, rim, s);
  ctx.strokeStyle = "rgba(220,230,240,.55)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + rim + 1, y + rim + 1, s - (rim + 1) * 2, s - (rim + 1) * 2);
  ctx.beginPath();
  ctx.moveTo(x + s / 2, y + rim * 2);
  ctx.lineTo(x + s - rim * 2, y + s / 2);
  ctx.lineTo(x + s / 2, y + s - rim * 2);
  ctx.lineTo(x + rim * 2, y + s / 2);
  ctx.closePath();
  ctx.strokeStyle = "#4a3a28";
  ctx.stroke();
  ctx.fillStyle = "#2a3038";
  const r = Math.max(2, s * 0.06);
  for (const [rx, ry] of [
    [rim + 2, rim + 2],
    [s - rim - r - 2, rim + 2],
    [rim + 2, s - rim - r - 2],
    [s - rim - r - 2, s - rim - r - 2]
  ]) {
    ctx.fillRect(x + rx, y + ry, r, r);
  }
}

function paintPropLook(ctx, kind, x, y, w, h) {
  if (kind === "cactus") {
    ctx.fillStyle = "#3d8a4a";
    ctx.fillRect(x + w * 0.28, y, w * 0.44, h);
    ctx.fillRect(x, y + h * 0.35, w, h * 0.16);
    ctx.fillRect(x + w * 0.12, y + h * 0.55, w * 0.28, h * 0.35);
    return;
  }
  if (kind === "bush") {
    ctx.fillStyle = "#6a5838";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.55, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (kind === "tree") {
    ctx.fillStyle = "#3a2818";
    ctx.fillRect(x + w * 0.28, y, w * 0.44, h);
    ctx.fillStyle = "rgba(20,40,28,.35)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h * 0.22, w * 0.55, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  if (kind === "pipe") {
    ctx.fillStyle = "#6a7888";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#3a4858";
    ctx.fillRect(x + w * 0.1, y + h * 0.18, w * 0.8, h * 0.64);
    return;
  }
  if (kind === "pillar") {
    ctx.fillStyle = "#7a6a72";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#4a3e48";
    ctx.fillRect(x - w * 0.12, y, w * 1.24, h * 0.12);
    ctx.fillRect(x - w * 0.12, y + h * 0.88, w * 1.24, h * 0.12);
    return;
  }
  if (kind === "barrel") {
    ctx.fillStyle = "#8a5030";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#3a2010";
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.3);
    ctx.lineTo(x + w, y + h * 0.3);
    ctx.moveTo(x, y + h * 0.7);
    ctx.lineTo(x + w, y + h * 0.7);
    ctx.stroke();
    return;
  }
  if (kind === "redBarrel") {
    ctx.fillStyle = "#c62828";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#f0c020";
    ctx.fillRect(x, y + h * 0.38, w, h * 0.24);
    ctx.strokeStyle = "#4a1010";
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    return;
  }
  // crate / crateStack — wood box with X
  ctx.fillStyle = "#8a6a3a";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#4a3818";
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  if (kind === "crateStack") {
    ctx.strokeStyle = "rgba(40,28,12,.55)";
    ctx.beginPath();
    ctx.moveTo(x, y + h * 0.5);
    ctx.lineTo(x + w, y + h * 0.5);
    ctx.stroke();
  }
}
