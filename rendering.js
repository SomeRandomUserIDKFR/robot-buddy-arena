import { CEILING, SIGHT, SIZE, WORLD } from "./config.js";
import { armorDummyColor, FORGE_PHASE_DURATIONS, forgeCastColor } from "./debris.js";
import {
  ADAPTIVE_MODE_DEFS, ADAPTIVE_NANOTECH_ID, MODULAR_MODE_DEFS, MODULAR_WEAPON_ID,
  nanotechArmorHp, nanotechArmorMaxHp, nanotechWeaponVisibility
} from "./equipment.js";
import {
  displayedHp, displayedMaxHp, hasIllusionTruthSight, isIllusionFighter
} from "./illusionist.js";
import { normalizeModularMorphStyle } from "./settings.js";
import { platformsOf } from "./maps.js";
import { crateVisibleToTeam, listTimedBuffs } from "./powerups.js";
import { clamp, dist } from "./utils.js";
import { visibleToSelf, visibleToTeam } from "./vision.js";

/**
 * Weapon silhouette map — simple aim-aligned rects (length × width, gripOffset from center).
 * Families: pulse med/blue-gray | burst short/fat/bright | marksman+snipers long/thin
 * (strong longest, quick-fire stubbier) | gattler short thick warm | laser long thin beam body
 * | sabers blade-like (heavy thicker, duelist shorter) | daggers very short/thin.
 * Colors: type hue + holder faction (ally cool / enemy warm / buddy cyan-adjacent).
 */
const WEAPON_VISUALS = {
  "pulse-rifle": { length: 32, width: 10, gripOffset: 18, ally: "#6a8f9c", enemy: "#8a655c", buddy: "#5aa8b4" },
  "burst-carbine": { length: 24, width: 13, gripOffset: 16, ally: "#7ec8d8", enemy: "#d88878", buddy: "#6ed8e8" },
  "marksman-rifle": { length: 42, width: 7, gripOffset: 18, ally: "#5aa0b0", enemy: "#b87068", buddy: "#4db8c8" },
  "quick-fire-sniper": { length: 48, width: 5, gripOffset: 17, ally: "#4a98a8", enemy: "#c07060", buddy: "#3eb0c4" },
  "classic-sniper": { length: 54, width: 5, gripOffset: 17, ally: "#3a889c", enemy: "#b06050", buddy: "#2ea0b8" },
  "strong-sniper": { length: 60, width: 4, gripOffset: 16, ally: "#2a7890", enemy: "#a05048", buddy: "#2090ac" },
  gattler: { length: 22, width: 14, gripOffset: 15, ally: "#c89860", enemy: "#e88850", buddy: "#d0a868" },
  laser: { length: 50, width: 4, gripOffset: 18, ally: "#40f0ff", enemy: "#ff60c8", buddy: "#5cf8ff" },
  "arc-saber": { length: 48, width: 5, gripOffset: 17, ally: "#70f3ff", enemy: "#ff8279", buddy: "#4df2ff" },
  "heavy-saber": { length: 52, width: 8, gripOffset: 16, ally: "#50d0e0", enemy: "#ff7060", buddy: "#39e8f8" },
  "duelist-blade": { length: 38, width: 5, gripOffset: 17, ally: "#90f8ff", enemy: "#ff9a88", buddy: "#78f4ff" },
  daggers: { length: 16, width: 4, gripOffset: 18, ally: "#a8e0e8", enemy: "#ffb0a0", buddy: "#9cf0f8" },
  "mechanical-modularity": { length: 48, width: 5, gripOffset: 17, ally: "#70f3ff", enemy: "#ff8279", buddy: "#4df2ff" },
  // Nanotech weapons: counterpart silhouettes with cyan/magenta nano tint.
  "nanotech-sword": { length: 48, width: 5, gripOffset: 17, ally: "#5cffd8", enemy: "#ff58c8", buddy: "#48fff0" },
  "nanotech-rifle": { length: 32, width: 10, gripOffset: 18, ally: "#4ae8ff", enemy: "#e050c0", buddy: "#3af8ff" },
  "nanotech-sniper": { length: 54, width: 5, gripOffset: 17, ally: "#2ad0ff", enemy: "#d040b8", buddy: "#20e8ff" },
  "material-consumer-nanotech": {
    length: 44, width: 6, gripOffset: 17, ally: "#6cffb0", enemy: "#ff6aa8", buddy: "#58ffd0"
  },
  "throw-breakable": {
    length: 22, width: 8, gripOffset: 16, ally: "#c4a878", enemy: "#d88868", buddy: "#d0b888"
  },
  // Legacy baseKind fallbacks
  gun: { length: 32, width: 10, gripOffset: 18, ally: "#6a8f9c", enemy: "#8a655c", buddy: "#5aa8b4" },
  saber: { length: 48, width: 5, gripOffset: 17, ally: "#70f3ff", enemy: "#ff8279", buddy: "#4df2ff" }
};

function parseHexRgb(hex) {
  const raw = String(hex || "").replace("#", "").trim();
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16)
    };
  }
  if (raw.length !== 6) return null;
  const n = Number.parseInt(raw, 16);
  if (!Number.isFinite(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixHexColors(a, b, t) {
  const ca = parseHexRgb(a);
  const cb = parseHexRgb(b);
  if (!ca || !cb) return a || b;
  const u = Math.max(0, Math.min(1, t));
  const ch = (x, y) => Math.round(x + (y - x) * u);
  const to = (n) => n.toString(16).padStart(2, "0");
  return `#${to(ch(ca.r, cb.r))}${to(ch(ca.g, cb.g))}${to(ch(ca.b, cb.b))}`;
}

/**
 * @param {string} [weaponId]
 * @param {{ team?: number, buddy?: boolean, color?: string, modularMode?: string,
 *   modularMorphing?: boolean, modularMorphFrom?: string, modularMorphTo?: string,
 *   modularMorphT?: number }} [holder]
 */
export function weaponVisual(weaponId, holder = {}) {
  const faction = holder.buddy ? "buddy" : holder.team ? "enemy" : "ally";
  let base = WEAPON_VISUALS[weaponId] || WEAPON_VISUALS.gun;

  if (weaponId === "mechanical-modularity") {
    const mode = holder.modularMode || "sword";
    const fromId = holder.modularMorphing
      ? (holder.modularMorphFrom || mode)
      : mode;
    const toId = holder.modularMorphing
      ? (holder.modularMorphTo || mode)
      : mode;
    const from = MODULAR_MODE_DEFS[fromId]?.visual || MODULAR_MODE_DEFS.sword.visual;
    const to = MODULAR_MODE_DEFS[toId]?.visual || from;
    const t = holder.modularMorphing
      ? Math.max(0, Math.min(1, holder.modularMorphT ?? 0))
      : 1;
    // Ease-out so the last morph snap reads as a settle.
    const u = 1 - (1 - t) * (1 - t);
    const fromColor = from[faction];
    const toColor = to[faction];
    let color = mixHexColors(fromColor, toColor, u);
    if (holder.color && faction === "enemy") {
      color = mixHexColors(color, holder.color, 0.62);
    }
    return {
      length: from.length + (to.length - from.length) * u,
      width: from.width + (to.width - from.width) * u,
      gripOffset: from.gripOffset + (to.gripOffset - from.gripOffset) * u,
      color,
      morphing: !!holder.modularMorphing,
      morphU: u,
      fromShape: {
        length: from.length,
        width: from.width,
        gripOffset: from.gripOffset,
        color: holder.color && faction === "enemy"
          ? mixHexColors(fromColor, holder.color, 0.62)
          : fromColor
      },
      toShape: {
        length: to.length,
        width: to.width,
        gripOffset: to.gripOffset,
        color: holder.color && faction === "enemy"
          ? mixHexColors(toColor, holder.color, 0.62)
          : toColor
      }
    };
  }

  if (weaponId === ADAPTIVE_NANOTECH_ID) {
    const mode = holder.adaptiveMode || "sword";
    const fromId = holder.adaptiveMorphing
      ? (holder.adaptiveMorphFrom || mode)
      : mode;
    const toId = holder.adaptiveMorphing
      ? (holder.adaptiveMorphTo || mode)
      : mode;
    const from = ADAPTIVE_MODE_DEFS[fromId]?.visual || ADAPTIVE_MODE_DEFS.sword.visual;
    const to = ADAPTIVE_MODE_DEFS[toId]?.visual || from;
    const t = holder.adaptiveMorphing
      ? Math.max(0, Math.min(1, holder.adaptiveMorphT ?? 0))
      : 1;
    const u = 1 - (1 - t) * (1 - t);
    const fromColor = from[faction];
    const toColor = to[faction];
    let color = mixHexColors(fromColor, toColor, u);
    if (holder.color && faction === "enemy") {
      color = mixHexColors(color, holder.color, 0.62);
    }
    return {
      length: from.length + (to.length - from.length) * u,
      width: from.width + (to.width - from.width) * u,
      gripOffset: from.gripOffset + (to.gripOffset - from.gripOffset) * u,
      color,
      morphing: !!holder.adaptiveMorphing,
      morphU: u,
      fromShape: {
        length: from.length,
        width: from.width,
        gripOffset: from.gripOffset,
        color: holder.color && faction === "enemy"
          ? mixHexColors(fromColor, holder.color, 0.62)
          : fromColor
      },
      toShape: {
        length: to.length,
        width: to.width,
        gripOffset: to.gripOffset,
        color: holder.color && faction === "enemy"
          ? mixHexColors(toColor, holder.color, 0.62)
          : toColor
      }
    };
  }

  let color = base[faction];
  // Conquest (and other) per-fighter body colors: tint enemy weapons toward body.
  if (holder.color && faction === "enemy") {
    color = mixHexColors(base.enemy, holder.color, 0.62);
  }
  return {
    length: base.length,
    width: base.width,
    gripOffset: base.gripOffset,
    color
  };
}

function morphEase(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function drawFlyingRearrangementMorph(context, visual, alpha) {
  const u = visual.morphU ?? 0;
  const spread = Math.sin(u * Math.PI);
  const segments = 5;
  const from = visual.fromShape;
  const to = visual.toShape;
  if (!from || !to) return;

  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const fromX = from.gripOffset + from.length * t0;
    const fromW = from.length / segments;
    const toX = to.gripOffset + to.length * t0;
    const toW = to.length / segments;
    const lane = i - (segments - 1) / 2;

    let x = fromX + (toX - fromX) * u;
    const w = fromW + (toW - fromW) * u;
    const h = from.width + (to.width - from.width) * u;
    const y = lane * (5 + spread * 16)
      + Math.sin(u * Math.PI * 2 + i * 1.35) * spread * 5;
    x += spread * Math.sin(i * 2.05 + u * 6.2) * 11;
    const rot = spread * lane * 0.24;
    const shrink = 1 - spread * 0.1;
    const color = mixHexColors(from.color, to.color, u);

    context.save();
    context.globalAlpha = alpha * (0.86 + 0.14 * (1 - spread));
    context.translate(x + w * 0.5, y);
    context.rotate(rot);
    context.fillStyle = color;
    context.fillRect(-w * 0.5 * shrink, -h * 0.5 * shrink, w * shrink, h * shrink);
    if (spread > 0.12) {
      context.strokeStyle = mixHexColors(color, "#ffffff", 0.28);
      context.lineWidth = 1;
      context.strokeRect(-w * 0.5 * shrink, -h * 0.5 * shrink, w * shrink, h * shrink);
    }
    context.restore();
  }

  if (spread > 0.45) {
    const coreX = from.gripOffset + from.length * 0.35
      + (to.gripOffset + to.length * 0.35 - (from.gripOffset + from.length * 0.35)) * u;
    context.save();
    context.globalAlpha = alpha * (spread - 0.35);
    context.fillStyle = visual.color;
    context.beginPath();
    context.arc(coreX, 0, 3 + spread * 6, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
}

function drawNanotechMorph(context, visual, alpha) {
  const u = visual.morphU ?? 0;
  const from = visual.fromShape;
  const to = visual.toShape;
  if (!from || !to) return;

  const dissolve = morphEase(clamp(u / 0.42, 0, 1));
  const reform = morphEase(clamp((u - 0.38) / 0.62, 0, 1));
  const swarm = Math.sin(clamp(u, 0, 1) * Math.PI);
  const midX = (from.gripOffset + from.length * 0.5 + to.gripOffset + to.length * 0.5) * 0.5;
  const color = mixHexColors(from.color, to.color, u);
  const glow = mixHexColors(color, "#ffffff", 0.35);

  // Fading silhouette of the old shape (dissolving into nano dust).
  if (dissolve < 0.98) {
    context.save();
    context.globalAlpha = alpha * (1 - dissolve) * 0.9;
    context.fillStyle = from.color;
    context.fillRect(
      from.gripOffset,
      -from.width / 2 * (1 - dissolve * 0.35),
      from.length * (1 - dissolve * 0.55),
      from.width * (1 - dissolve * 0.35)
    );
    context.restore();
  }

  // Nano swarm: deterministic particle cloud streaming toward the new silhouette.
  const particles = 28;
  for (let i = 0; i < particles; i++) {
    const seed = i * 12.9898;
    const frac = i / (particles - 1);
    const fromX = from.gripOffset + from.length * frac;
    const toX = to.gripOffset + to.length * frac;
    const orbit = Math.sin(seed + u * 9.4) * swarm * (10 + (i % 5) * 2.2);
    const drift = Math.cos(seed * 0.7 + u * 7.1) * swarm * 7;
    const along = dissolve * (1 - reform * 0.35);
    let x = fromX + (toX - fromX) * morphEase(along) + orbit * 0.35;
    let y = drift + Math.sin(frac * Math.PI * 2 + u * 6) * swarm * 5;
    // Pull toward a mid swarm cloud early, then lock onto the new outline.
    const cloudPull = swarm * (1 - reform);
    x = x * (1 - cloudPull * 0.35) + (midX + Math.sin(seed) * 14) * cloudPull * 0.35;
    y = y * (1 - cloudPull * 0.2);

    const size = 1.2 + (i % 3) * 0.7 + swarm * 1.1;
    context.save();
    context.globalAlpha = alpha * (0.35 + swarm * 0.55);
    context.fillStyle = i % 4 === 0 ? glow : color;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
    if (swarm > 0.35 && i % 3 === 0) {
      context.globalAlpha = alpha * swarm * 0.25;
      context.strokeStyle = glow;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x - orbit * 0.2, y - 2);
      context.lineTo(x + orbit * 0.15, y + 2);
      context.stroke();
    }
    context.restore();
  }

  // Soft energy sheath while the swarm is densest.
  if (swarm > 0.2) {
    context.save();
    context.globalAlpha = alpha * swarm * 0.22;
    context.strokeStyle = glow;
    context.lineWidth = 2 + swarm * 3;
    context.beginPath();
    context.ellipse(
      midX,
      0,
      10 + swarm * 16 + Math.abs(to.length - from.length) * 0.08,
      6 + swarm * 10,
      0,
      0,
      Math.PI * 2
    );
    context.stroke();
    context.restore();
  }

  // Coalescing new shape.
  if (reform > 0.02) {
    context.save();
    context.globalAlpha = alpha * (0.35 + reform * 0.65);
    context.fillStyle = to.color;
    const w = to.length * (0.4 + reform * 0.6);
    const h = to.width * (0.45 + reform * 0.55);
    context.fillRect(
      to.gripOffset + (to.length - w) * 0.5,
      -h / 2,
      w,
      h
    );
    if (reform < 0.85) {
      context.globalAlpha = alpha * (1 - reform) * 0.55;
      context.strokeStyle = glow;
      context.lineWidth = 1.5;
      context.strokeRect(
        to.gripOffset + (to.length - w) * 0.5,
        -h / 2,
        w,
        h
      );
    }
    context.restore();
  }
}

/**
 * Helmet (open visor) + chestplate for retractable armor.
 * Face window stays clear so eyes/mouth text remain readable.
 * `u` 0→1 assemble progress; `scatter` spreads pieces during fly/nanotech mid-morph.
 */
function drawHelmetAndChestplate(context, color, bodyAlpha, u, scatter = 0) {
  if (u <= 0.02) return;
  const edge = mixHexColors(color, "#061018", 0.4);
  const highlight = mixHexColors(color, "#ffffff", 0.22);
  const half = SIZE / 2;
  const a = bodyAlpha * (0.55 + u * 0.45);

  // --- Helmet: crown, cheeks, chin — open center for face ---
  const helmetRise = (1 - u) * 14 + scatter * 10;
  const cheekOut = scatter * 8;
  context.save();
  context.globalAlpha = a;
  context.translate(0, -helmetRise);

  // Crown / brow plate (above eyes)
  context.fillStyle = color;
  context.fillRect(-half + 2, -half - 3, SIZE - 4, 11);
  context.fillStyle = highlight;
  context.fillRect(-half + 6, -half - 1, SIZE - 12, 3);
  // Small crest ridge
  context.fillStyle = color;
  context.fillRect(-5, -half - 7, 10, 5);

  // Left cheek / temple (outside the face window)
  context.fillStyle = color;
  context.fillRect(-half - 1 - cheekOut, -half + 6, 10, 18);
  context.fillRect(-half + 2 - cheekOut * 0.4, -half + 8, 7, 14);
  // Right cheek
  context.fillRect(half - 9 + cheekOut, -half + 6, 10, 18);
  context.fillRect(half - 9 + cheekOut * 0.4, -half + 8, 7, 14);

  // Chin / jaw under the mouth (below face center)
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-12, 6);
  context.lineTo(-8, 12);
  context.lineTo(8, 12);
  context.lineTo(12, 6);
  context.lineTo(7, 4);
  context.lineTo(-7, 4);
  context.closePath();
  context.fill();

  // Visor rim (outline of open face window — does not fill over eyes/mouth)
  context.strokeStyle = edge;
  context.lineWidth = 1.5;
  context.strokeRect(-11, -half + 7, 22, 14);
  context.strokeStyle = highlight;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(-half + 3, -half + 7);
  context.lineTo(half - 3, -half + 7);
  context.stroke();
  context.restore();

  // --- Chestplate: shoulders + breastplate on lower torso ---
  const chestDrop = (1 - u) * 16 + scatter * 8;
  context.save();
  context.globalAlpha = a;
  context.translate(0, chestDrop);

  // Shoulder pads
  context.fillStyle = color;
  context.fillRect(-half - 3 - scatter * 4, 2, 14, 9);
  context.fillRect(half - 11 + scatter * 4, 2, 14, 9);
  context.fillStyle = highlight;
  context.fillRect(-half - 1 - scatter * 4, 3, 10, 2);
  context.fillRect(half - 9 + scatter * 4, 3, 10, 2);

  // Main breastplate
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-half + 4, 8);
  context.lineTo(half - 4, 8);
  context.lineTo(half - 6, half + 1);
  context.lineTo(-half + 6, half + 1);
  context.closePath();
  context.fill();

  // Center keel / seams
  context.strokeStyle = edge;
  context.lineWidth = 1.2;
  context.beginPath();
  context.moveTo(0, 9);
  context.lineTo(0, half);
  context.moveTo(-half + 8, 14);
  context.lineTo(half - 8, 14);
  context.stroke();
  context.strokeStyle = highlight;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(-6, 10);
  context.lineTo(-6, half - 2);
  context.moveTo(6, 10);
  context.lineTo(6, half - 2);
  context.stroke();

  // Ab plate row
  context.fillStyle = mixHexColors(color, "#061018", 0.15);
  context.fillRect(-half + 8, half - 8, SIZE - 16, 6);
  context.restore();
}

function drawNanotechArmorSuit(context, color, glow, half, u, bodyAlpha, morphing, channelHint = false) {
  const time = performance.now() / 1000;
  const idle = !morphing && u > 0.05
    ? (0.14 + 0.07 * Math.sin(time * 3.4)) * (channelHint ? 1.45 : 1)
    : 0;
  const swarm = morphing ? Math.sin(u * Math.PI) : idle;
  // Lock plates in earlier within a short Mark-85 assemble.
  const reform = morphing ? morphEase(clamp((u - 0.12) / 0.88, 0, 1)) : 1;
  const particles = morphing ? 28 : 16;

  for (let i = 0; i < particles; i++) {
    const seed = i * 9.17;
    // Bias particles toward helmet (upper) and chest (lower) zones.
    const zone = i % 2 === 0 ? -1 : 1;
    const ang = (i / particles) * Math.PI * 2 + u * 1.8 + time * (morphing ? 0 : 1.1);
    const radius = half * (0.25 + reform * 0.7)
      + Math.sin(seed + u * 8 + time * 2.2) * swarm * (morphing ? 11 : 5);
    const x = Math.cos(ang) * radius * 0.85;
    const y = Math.sin(ang) * radius * 0.55 + zone * half * (0.35 + reform * 0.25);
    const size = 1.1 + (i % 3) * 0.6 + swarm * (morphing ? 1.4 : 0.7);
    context.save();
    context.globalAlpha = bodyAlpha * (0.22 + swarm * 0.55 + reform * 0.2);
    context.fillStyle = i % 3 === 0 ? glow : color;
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  if (swarm > 0.12) {
    context.save();
    context.globalAlpha = bodyAlpha * swarm * (morphing ? 0.24 : 0.12);
    context.strokeStyle = glow;
    context.lineWidth = 1.5 + swarm * 2;
    context.beginPath();
    context.ellipse(0, -half * 0.35, half * 0.55, half * 0.4, 0, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.ellipse(0, half * 0.35, half * 0.65, half * 0.45, 0, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  const suitU = morphing ? reform : u;
  if (suitU > 0.1) {
    drawHelmetAndChestplate(context, color, bodyAlpha, suitU, swarm * 0.28 * (1 - reform));
  }
}

function drawPanelFoldMorph(context, visual, alpha) {
  const u = visual.morphU ?? 0;
  const from = visual.fromShape;
  const to = visual.toShape;
  if (!from || !to) return;

  const segments = 4;
  const foldMid = 0.5;
  const gripX = from.gripOffset + (to.gripOffset - from.gripOffset) * u;

  for (let i = 0; i < segments; i++) {
    const tStart = i / segments;
    const fromX = from.gripOffset + from.length * tStart;
    const fromW = Math.max(2, from.length / segments);
    const toX = to.gripOffset + to.length * tStart;
    const toW = Math.max(2, to.length / segments);
    const lane = i - (segments - 1) / 2;
    const stagger = i * 0.055;

    let x;
    let w;
    let h;
    let y = 0;
    let color;
    let panelAlpha = alpha;
    let drawSeam = false;

    if (u < foldMid) {
      const local = clamp((u - stagger * 0.35) / Math.max(0.001, foldMid - stagger * 0.35), 0, 1);
      const e = morphEase(local);
      const tuck = 1 - e;
      w = fromW * tuck;
      x = fromX + (gripX - fromX) * e * 0.92;
      h = from.width * (0.55 + 0.45 * tuck);
      y = lane * from.width * 0.22 * e;
      color = from.color;
      panelAlpha *= 0.92 - e * 0.18;
      drawSeam = e > 0.08 && e < 0.92;
    } else {
      const local = clamp((u - foldMid - stagger * 0.35) / Math.max(0.001, 1 - foldMid - stagger * 0.35), 0, 1);
      const e = morphEase(local);
      w = toW * e;
      x = gripX + (toX - gripX) * e;
      h = to.width * (0.55 + 0.45 * e);
      y = lane * to.width * 0.18 * (1 - e);
      color = mixHexColors(from.color, to.color, e);
      panelAlpha *= 0.72 + e * 0.28;
      drawSeam = e > 0.08 && e < 0.95;
    }

    if (w < 1.2) continue;

    context.save();
    context.globalAlpha = panelAlpha;
    context.fillStyle = color;
    context.fillRect(x, y - h / 2, w, h);
    if (drawSeam) {
      context.strokeStyle = mixHexColors(color, "#061018", 0.45);
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x + w, y - h / 2);
      context.lineTo(x + w, y + h / 2);
      context.stroke();
      context.strokeStyle = mixHexColors(color, "#ffffff", 0.16);
      context.beginPath();
      context.moveTo(x, y - h / 2);
      context.lineTo(x, y + h / 2);
      context.stroke();
    }
    context.restore();
  }
}

/** Resolve morph visual style; nanotech gear forces the nanotech swarm look. */
function morphStyleFor(fighter, game) {
  if (fighter?.forceNanotechMorph) return "nanotech";
  return normalizeModularMorphStyle(game?.settings?.visual?.modularMorphStyle);
}

/** Retractable armor: open-face helmet + chestplate (morph styles: fold / fly / smooth / nanotech). */
function drawRetractableArmorPlates(context, game, fighter, centerX, centerY, bodyAlpha) {
  if (!(fighter.retractableMax > 0)) return;
  const morphing = !!fighter.retractableMorphing;
  const deployed = !!fighter.retractableDeployed;
  if (!morphing && !deployed) return;

  const style = morphStyleFor(fighter, game);
  const faction = fighter.buddy ? "buddy" : fighter.team ? "enemy" : "ally";
  const plate = MODULAR_MODE_DEFS.shield.visual;
  let color = plate[faction] || "#8aa4b0";
  if (fighter.color && faction === "enemy") {
    color = mixHexColors(color, fighter.color, 0.45);
  }
  if (fighter.forceNanotechMorph) {
    color = mixHexColors(color, "#5cffd8", 0.55);
  }

  let u = deployed && !morphing ? 1 : 0;
  if (morphing) {
    const t = Math.max(0, Math.min(1, fighter.retractableMorphT ?? 0));
    const eased = 1 - (1 - t) * (1 - t);
    u = fighter.retractableMorphTo === "on" ? eased : 1 - eased;
  }
  if (u <= 0.02) return;

  const half = SIZE / 2 + 4;
  context.save();
  context.translate(centerX, centerY);

  if (style === "nanotech") {
    const glow = mixHexColors(color, "#ffffff", 0.35);
    drawNanotechArmorSuit(context, color, glow, half, u, bodyAlpha, morphing);
    context.restore();
    return;
  }

  if (style === "fly" && morphing) {
    const scatter = Math.sin(u * Math.PI);
    drawHelmetAndChestplate(context, color, bodyAlpha, u, scatter);
  } else if (style === "smooth") {
    drawHelmetAndChestplate(context, color, bodyAlpha * (0.7 + u * 0.3), u, 0);
  } else {
    // Panel fold: helmet drops from above, chest rises from below (scatter encodes offset).
    const foldScatter = (1 - u) * 0.85;
    drawHelmetAndChestplate(context, color, bodyAlpha, u, foldScatter);
  }

  context.restore();
}

/** Nanotech chestplate buffer: short particle spawn, then living nano suit. */
function drawNanotechChestplateArmor(context, game, fighter, centerX, centerY, bodyAlpha) {
  if (!fighter.hasNanotechChestplate) return;
  const spawning = !!fighter.nanotechArmorSpawning;
  const armorBots = fighter.nanobotArmor || 0;
  if (!spawning && !(armorBots > 0)) return;

  const maxHp = nanotechArmorMaxHp(fighter);
  if (maxHp <= 0 && !spawning) return;

  const fillU = maxHp > 0 ? clamp(nanotechArmorHp(fighter) / maxHp, 0, 1) : 0;
  const spawnT = spawning
    ? clamp(fighter.nanotechArmorSpawnT ?? 0, 0, 1)
    : 1;
  const spawnEase = morphEase(spawnT);
  // During spawn, particles assemble; afterward suit fill tracks armor HP.
  const u = spawning ? Math.max(0.1, spawnEase) : Math.max(fillU, 0.2);
  if (u <= 0.02) return;

  const faction = fighter.buddy ? "buddy" : fighter.team ? "enemy" : "ally";
  let color = faction === "enemy" ? "#e050c0" : faction === "buddy" ? "#48fff0" : "#5cffd8";
  if (fighter.color && faction === "enemy") {
    color = mixHexColors(color, fighter.color, 0.4);
  }
  const glow = mixHexColors(color, "#ffffff", 0.4);
  const half = SIZE / 2 + 4;
  context.save();
  context.translate(centerX, centerY);
  drawNanotechArmorSuit(
    context, color, glow, half, u, bodyAlpha, spawning, !!fighter.nanotechChanneling
  );
  context.restore();
}

function drawHeldWeapon(context, game, fighter, visual, bodyAlpha, shieldUp) {
  const isNanoWeapon = (fighter.nanotechWeaponCost || 0) > 0
    && (!!fighter.weaponId?.startsWith?.("nanotech-") || fighter.weaponId === ADAPTIVE_NANOTECH_ID);
  const weaponVis = isNanoWeapon ? nanotechWeaponVisibility(fighter) : 1;
  if (isNanoWeapon && weaponVis <= 0.02) return;

  const alpha = bodyAlpha * (shieldUp ? .38 : 1) * weaponVis;
  const morphStyle = morphStyleFor(fighter, game);
  const canMorph = (fighter.weaponId === MODULAR_WEAPON_ID || fighter.weaponId === ADAPTIVE_NANOTECH_ID)
    && visual.morphing
    && visual.fromShape
    && visual.toShape;

  if (canMorph && morphStyle === "fly") {
    drawFlyingRearrangementMorph(context, visual, alpha);
    return;
  }
  if (canMorph && morphStyle === "fold") {
    drawPanelFoldMorph(context, visual, alpha);
    return;
  }
  if (canMorph && morphStyle === "nanotech") {
    drawNanotechMorph(context, visual, alpha);
    return;
  }

  const swordLikeDissolve = fighter.weaponId === "nanotech-sword"
    || (fighter.weaponId === ADAPTIVE_NANOTECH_ID && fighter.weapon === "saber");
  const scale = swordLikeDissolve
    ? 0.55 + 0.45 * weaponVis
    : isNanoWeapon
      ? 0.7 + 0.3 * weaponVis
      : 1;
  const length = visual.length * scale;
  const width = visual.width * Math.max(0.35, scale);

  // Throw Breakable: mitt when empty; held props are drawn in world space on the hand.
  if (fighter.throwBreakable) {
    if (!fighter.heldProp) {
      context.globalAlpha = alpha * 0.9;
      context.fillStyle = visual.color;
      context.fillRect(visual.gripOffset, -width / 2, Math.min(length, 18), width);
      context.strokeStyle = "rgba(255,255,255,.35)";
      context.lineWidth = 1;
      context.strokeRect(visual.gripOffset, -width / 2, Math.min(length, 18), width);
    }
    return;
  }

  context.globalAlpha = alpha;
  context.fillStyle = visual.color;
  context.fillRect(visual.gripOffset, -width / 2, length, width);

  // Melting nano flecks while the weapon dissolves / absorbs into reserve.
  if (isNanoWeapon && weaponVis < 0.92 && weaponVis > 0.02) {
    const scatter = 1 - weaponVis;
    const absorbing = !!fighter.nanotechWeaponAbsorbing;
    const flecks = absorbing ? 18 : 10;
    for (let i = 0; i < flecks; i++) {
      const along = visual.gripOffset + length * ((i + 0.5) / flecks);
      const drift = Math.sin(i * 2.3 + scatter * 9) * scatter * (absorbing ? 22 : 14);
      const inward = absorbing ? -scatter * (8 + (i % 5) * 3) : 0;
      context.globalAlpha = alpha * (0.25 + scatter * 0.55);
      context.fillStyle = i % 2 ? "#9fffff" : visual.color;
      context.fillRect(along + inward, drift - 1.2, absorbing ? 1.6 : 2.2, absorbing ? 1.6 : 2.2);
    }
  }

  if (visual.morphing && morphStyle === "smooth") {
    context.globalAlpha = alpha * 0.45;
    context.fillRect(
      visual.gripOffset + length * 0.15,
      -width * 0.35,
      length * 0.55,
      width * 0.7
    );
  }

  // Material Consumer: tip glows while vacuuming / absorbing scraps into bots.
  if (fighter.materialConsumer) {
    const tipX = visual.gripOffset + length;
    const flash = Math.max(0, fighter.materialConsumeFlash || 0);
    const beamFlash = Math.max(0, fighter.materialBeamFlash || 0);
    const pulse = 0.35 + flash * 3.2;
    context.save();
    context.globalAlpha = alpha * Math.min(1, 0.35 + flash * 2.5);
    context.fillStyle = "#9ffff0";
    context.shadowColor = "#6cffb0";
    context.shadowBlur = 8 + flash * 28;
    context.beginPath();
    context.arc(tipX, 0, 2.5 + pulse, 0, Math.PI * 2);
    context.fill();
    if (flash > 0.02) {
      context.strokeStyle = "rgba(108,255,176,.85)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.arc(tipX, 0, 6 + flash * 22, 0, Math.PI * 2);
      context.stroke();
    }
    // Hold-RMB debris beam: scrap stream from the tip along aim (+x in local blade space).
    const tankN = fighter.materialEjectionTank?.length || 0;
    const bankN = fighter.materialScrapBank?.length || 0;
    if (fighter.materialBeamHeld && (tankN + bankN > 0 || beamFlash > 0.02)) {
      const beamLen = 210 + beamFlash * 40;
      const t = performance.now() / 1000;
      context.globalAlpha = alpha * (0.28 + beamFlash * 2.2);
      context.strokeStyle = tankN > 0 ? "rgba(210,180,140,.9)" : "rgba(140,220,190,.85)";
      context.lineWidth = 3.2 + beamFlash * 4;
      context.shadowColor = tankN > 0 ? "#c8a878" : "#6cffb0";
      context.shadowBlur = 10 + beamFlash * 18;
      context.beginPath();
      context.moveTo(tipX, 0);
      context.lineTo(tipX + beamLen, Math.sin(t * 28) * 3);
      context.stroke();
      context.lineWidth = 1.2;
      context.globalAlpha = alpha * (0.45 + beamFlash);
      for (let i = 0; i < 5; i++) {
        const u = ((t * 9 + i * 0.17) % 1);
        const px = tipX + u * beamLen;
        const py = Math.sin(t * 22 + i * 1.7) * (4 + i);
        context.fillStyle = i % 2 ? "#d8c4a0" : "#9a8a78";
        context.fillRect(px - 2.5, py - 2, 5, 4);
      }
    }
    context.restore();
  }
}

export function createRenderer(canvas) {
  const context = canvas.getContext("2d");

  function resize() {
    const width = innerWidth;
    const height = innerHeight;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  function draw(game) {
    resize();
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!game) {
      drawMenuBackdrop();
      return;
    }

    const camera = game.camera;
    context.save();
    context.translate(-camera.x, -camera.y);
    drawBackdrop(game, .2);
    drawPlatforms(game, .28);
    drawIllusions(game, .35, game.fighters?.[0] ?? null);
    drawTraps(game, .35, game.fighters?.[0]?.team ?? 0);
    drawProps(game, .35, false);
    drawGroundDebris(game, .35);
    drawForgeCasts(game, .35);
    drawArmorDummies(game, .35);
    drawCeiling(game, .35);
    const player = game.fighters[0];
    const allies = game.fighters.filter((fighter) => !fighter.dead && fighter.team === player.team);
    context.save();
    context.beginPath();
    for (const fighter of allies) {
      const center = fighter.center();
      const sight = fighter.sight || SIGHT;
      context.moveTo(center.x + sight, center.y);
      context.arc(center.x, center.y, sight, 0, Math.PI * 2);
      if (fighter.directionalSightRange > sight && fighter.sightHalfAngle) {
        context.moveTo(center.x, center.y);
        context.arc(
          center.x,
          center.y,
          fighter.directionalSightRange,
          fighter.aim - fighter.sightHalfAngle,
          fighter.aim + fighter.sightHalfAngle
        );
        context.closePath();
      }
    }
    for (const sample of game.beamReveals || []) {
      if (sample.team !== player.team || !(sample.radius > 0)) continue;
      context.moveTo(sample.x + sample.radius, sample.y);
      context.arc(sample.x, sample.y, sample.radius, 0, Math.PI * 2);
    }
    for (const prop of game.props || []) {
      if (
        prop.destroyed
        || !(prop.hp > 0)
        || prop.team !== player.team
        || !(prop.lightCondensation || prop.kind === "lightCondensation")
      ) {
        continue;
      }
      const pr = prop.revealRadius || ((prop.w || 14) * 40);
      if (!(pr > 0)) continue;
      const px = prop.x + (prop.w || 0) / 2;
      const py = prop.y + (prop.h || 0) / 2;
      context.moveTo(px + pr, py);
      context.arc(px, py, pr, 0, Math.PI * 2);
    }
    context.clip();
    drawBackdrop(game, .9);
    drawPlatforms(game, 1);
    drawIllusions(game, 1, player);
    drawTraps(game, 1, player.team);
    drawProps(game, 1, false);
    drawGroundDebris(game, 1);
    drawForgeCasts(game, 1);
    drawArmorDummies(game, 1);
    drawPowerCrates(game, player);
    drawCeiling(game, 1);
    context.restore();

    const playerCenter = player.center();
    for (const fighter of allies) {
      if (fighter === player) continue;
      const center = fighter.center();
      const sight = fighter.sight || SIGHT;
      const gradient = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, sight);
      gradient.addColorStop(0, "rgba(40,225,255,.055)");
      gradient.addColorStop(1, "rgba(40,225,255,0)");
      context.fillStyle = gradient;
      context.fillRect(center.x - sight, center.y - sight, sight * 2, sight * 2);
      if (fighter.directionalSightRange > sight && fighter.sightHalfAngle) {
        context.fillStyle = "rgba(65,235,255,.035)";
        context.beginPath();
        context.moveTo(center.x, center.y);
        context.arc(
          center.x,
          center.y,
          fighter.directionalSightRange,
          fighter.aim - fighter.sightHalfAngle,
          fighter.aim + fighter.sightHalfAngle
        );
        context.closePath();
        context.fill();
      }
    }
    drawEffects(game);
    drawBullets(game, player);
    drawThrownBreakables(game, 1);
    for (const fighter of game.fighters) {
      const enemy = fighter.team !== player.team;
      if (!enemy || visibleToTeam(game, player, fighter) || fighter.buddy) {
        drawFighter(game, fighter, player);
      }
    }
    // Held breakables sit on the hand — draw after the body so they read on top.
    for (const fighter of game.fighters) {
      const enemy = fighter.team !== player.team;
      if (enemy && !visibleToTeam(game, player, fighter) && !fighter.buddy) continue;
      const held = fighter.heldProp;
      if (!held || held.destroyed) continue;
      if (held.powerCrate || held.kind === "powerCrate") drawMetalPowerCrate(held);
      else drawPropBody(held, 1);
      if (held.canopy) drawCanopy(held, 0.85);
    }
    drawProps(game, 1, true);
    drawPings(game);
    context.restore();
    drawVisionArrows(game, playerCenter);
  }

  function drawMenuBackdrop() {
    const time = performance.now() / 1000;
    context.fillStyle = "#071018";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(72,232,255,.08)";
    context.lineWidth = 1;
    const gap = 55;
    for (let x = -(time * 12) % gap; x < canvas.width; x += gap) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }
    for (let y = 0; y < canvas.height; y += gap) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
  }

  function drawBackdrop(game, alpha) {
    const theme = game?.backdrop || { sky: "#08161f", mid: "#173542", accent: "#304b59", pattern: "grid" };
    context.fillStyle = theme.sky;
    context.globalAlpha = alpha;
    context.fillRect(0, 0, WORLD.w, WORLD.h);
    const pattern = theme.pattern || "grid";
    if (pattern === "dunes") {
      context.fillStyle = theme.mid;
      for (let i = 0; i < 8; i++) {
        const y = 900 + i * 70;
        context.beginPath();
        context.moveTo(0, y);
        for (let x = 0; x <= WORLD.w; x += 120) {
          context.quadraticCurveTo(x + 60, y - 28 - (i % 3) * 8, x + 120, y);
        }
        context.lineTo(WORLD.w, WORLD.h);
        context.lineTo(0, WORLD.h);
        context.closePath();
        context.globalAlpha = alpha * (.12 + i * .04);
        context.fill();
      }
    } else if (pattern === "canopy") {
      context.fillStyle = theme.mid;
      for (let x = 0; x < WORLD.w; x += 180) {
        context.globalAlpha = alpha * .25;
        context.beginPath();
        context.ellipse(x + 90, 180, 110, 70, 0, 0, Math.PI * 2);
        context.fill();
      }
      context.strokeStyle = theme.accent;
      context.lineWidth = 2;
      context.globalAlpha = alpha * .35;
      for (let x = 40; x < WORLD.w; x += 220) {
        context.beginPath();
        context.moveTo(x, 250);
        context.lineTo(x - 20, 900);
        context.stroke();
      }
    } else if (pattern === "skyline") {
      context.fillStyle = theme.mid;
      context.globalAlpha = alpha * .45;
      for (let x = 0; x < WORLD.w; x += 140) {
        const h = 200 + ((x * 17) % 400);
        context.fillRect(x, WORLD.h - h - 180, 100, h);
      }
      context.fillStyle = theme.accent;
      context.globalAlpha = alpha * .2;
      for (let x = 40; x < WORLD.w; x += 140) {
        for (let y = WORLD.h - 500; y < WORLD.h - 200; y += 36) {
          context.fillRect(x + 12, y, 10, 14);
          context.fillRect(x + 40, y, 10, 14);
          context.fillRect(x + 68, y, 10, 14);
        }
      }
    } else if (pattern === "water") {
      context.fillStyle = theme.mid;
      context.globalAlpha = alpha * .35;
      context.fillRect(0, 1200, WORLD.w, WORLD.h - 1200);
      context.strokeStyle = theme.accent;
      context.lineWidth = 2;
      context.globalAlpha = alpha * .4;
      for (let y = 1240; y < WORLD.h; y += 28) {
        context.beginPath();
        for (let x = 0; x <= WORLD.w; x += 80) {
          context.lineTo(x, y + Math.sin((x + y) * .02) * 6);
        }
        context.stroke();
      }
    } else if (pattern === "pipes" || pattern === "ruins") {
      context.strokeStyle = theme.mid;
      context.lineWidth = 3;
      context.globalAlpha = alpha * .3;
      for (let x = 0; x < WORLD.w; x += 160) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x + (pattern === "ruins" ? 40 : 0), WORLD.h);
        context.stroke();
      }
      for (let y = 0; y < WORLD.h; y += 160) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(WORLD.w, y + (pattern === "ruins" ? 20 : 0));
        context.stroke();
      }
    } else {
      context.strokeStyle = theme.mid;
      context.lineWidth = 2;
      context.globalAlpha = alpha;
      for (let x = 0; x < WORLD.w; x += 150) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, WORLD.h);
        context.stroke();
      }
      for (let y = 0; y < WORLD.h; y += 150) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(WORLD.w, y);
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }

  function platformColors(game) {
    const style = game?.groundStyle || "plated";
    const palettes = {
      plated: { fill: "#304b59", top: "#6b95a3", hatch: "#203540" },
      concrete: { fill: "#3a424c", top: "#7a8490", hatch: "#252b32" },
      sand: { fill: "#8a7048", top: "#c4a574", hatch: "#5a4830" },
      moss: { fill: "#2d4a38", top: "#4a7a58", hatch: "#1a3024" },
      grate: { fill: "#3a342c", top: "#8a7a58", hatch: "#221e18" },
      stone: { fill: "#4a3e48", top: "#8a7a82", hatch: "#2a2228" },
      wood: { fill: "#5a4030", top: "#a87848", hatch: "#3a2818" }
    };
    return palettes[style] || palettes.plated;
  }

  function drawPlatforms(game, alpha) {
    const colors = platformColors(game);
    context.globalAlpha = alpha;
    for (const platform of platformsOf(game)) {
      context.fillStyle = platform.blocksSight ? "#2a3038" : colors.fill;
      context.fillRect(platform.x, platform.y, platform.w, platform.h);
      context.fillStyle = colors.top;
      context.fillRect(platform.x, platform.y, platform.w, Math.min(4, platform.h));
      context.strokeStyle = colors.hatch;
      for (let x = platform.x + 15; x < platform.x + platform.w; x += 42) {
        context.beginPath();
        context.moveTo(x, platform.y + 6);
        context.lineTo(x + 15, platform.y + Math.min(platform.h, 26));
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  }

  /**
   * Illusionist props/platforms — drawn like the real thing with NO tell
   * for everyone except Illusionists, who get a lavender truth-sight outline.
   * Visual only (no collision / LOS). Fighter decoys use drawFighter.
   */
  function drawIllusions(game, alpha, viewer = null) {
    const colors = platformColors(game);
    const truth = hasIllusionTruthSight(viewer);
    for (const ill of game.illusions || []) {
      if (!ill || ill.destroyed || !(ill.life > 0)) continue;
      context.globalAlpha = alpha;
      if (ill.illusionType === "platform") {
        context.fillStyle = colors.fill;
        context.fillRect(ill.x, ill.y, ill.w, ill.h);
        context.fillStyle = colors.top;
        context.fillRect(ill.x, ill.y, ill.w, Math.min(4, ill.h));
        context.strokeStyle = colors.hatch;
        for (let x = ill.x + 15; x < ill.x + ill.w; x += 42) {
          context.beginPath();
          context.moveTo(x, ill.y + 6);
          context.lineTo(x + 15, ill.y + Math.min(ill.h, 26));
          context.stroke();
        }
      } else {
        // Crate-like prop silhouette — matches normal crates, no outline cue.
        context.fillStyle = "#8a6a3a";
        context.fillRect(ill.x, ill.y, ill.w, ill.h);
        context.strokeStyle = "#4a3818";
        context.strokeRect(ill.x + 2, ill.y + 2, ill.w - 4, ill.h - 4);
        context.beginPath();
        context.moveTo(ill.x, ill.y);
        context.lineTo(ill.x + ill.w, ill.y + ill.h);
        context.stroke();
      }
      if (truth) {
        context.strokeStyle = "rgba(210,180,255,.9)";
        context.lineWidth = 2;
        context.setLineDash([5, 4]);
        context.strokeRect(ill.x - 2, ill.y - 2, ill.w + 4, ill.h + 4);
        context.setLineDash([]);
        context.lineWidth = 1;
      }
      context.globalAlpha = 1;
    }
  }

  /**
   * Trapper traps: tiny bear jaws; fake platforms almost match real plates
   * but hatch / top edge are slightly wrong. Ally outline, faint enemy cue.
   */
  function drawTraps(game, alpha, viewerTeam = 0) {
    const colors = platformColors(game);
    for (const trap of game.traps || []) {
      if (!trap || trap.destroyed || !(trap.life > 0)) continue;
      const ally = trap.team === viewerTeam;
      const arming = !trap.armed;
      const pulse = arming ? 0.55 + 0.35 * Math.sin((game.elapsed || 0) * 14) : 1;
      context.globalAlpha = alpha * pulse * (ally ? 1 : 0.72);

      if (trap.trapType === "fakePlatform") {
        // Almost real — fill matches, but top edge is thinner/wrong hue and hatch skews.
        context.fillStyle = colors.fill;
        context.fillRect(trap.x, trap.y, trap.w, trap.h);
        context.fillStyle = ally ? "#9ab8c4" : "#5a6a72";
        context.fillRect(trap.x, trap.y, trap.w, 2);
        context.strokeStyle = ally ? "rgba(120,200,220,.55)" : colors.hatch;
        for (let x = trap.x + 10; x < trap.x + trap.w; x += 38) {
          context.beginPath();
          context.moveTo(x, trap.y + 5);
          context.lineTo(x + 18, trap.y + Math.min(trap.h, 22));
          context.stroke();
        }
        // One "wrong" vertical nick so it never quite looks plated.
        context.strokeStyle = ally ? "rgba(72,232,255,.7)" : "rgba(200,210,220,.22)";
        context.beginPath();
        context.moveTo(trap.x + trap.w * 0.62, trap.y + 1);
        context.lineTo(trap.x + trap.w * 0.62, trap.y + trap.h - 2);
        context.stroke();
        if (ally) {
          context.strokeStyle = "rgba(72,232,255,.85)";
          context.lineWidth = 1.5;
          context.strokeRect(trap.x - 1, trap.y - 1, trap.w + 2, trap.h + 2);
          context.lineWidth = 1;
        } else {
          // Tiny enemy tell — sparse corner ticks, not a full outline.
          context.strokeStyle = "rgba(255,220,160,.35)";
          context.beginPath();
          context.moveTo(trap.x, trap.y);
          context.lineTo(trap.x + 8, trap.y);
          context.moveTo(trap.x + trap.w - 8, trap.y);
          context.lineTo(trap.x + trap.w, trap.y);
          context.stroke();
        }
      } else {
        // Bear trap — very small jaws; ally cyan outline, enemy faint rust ticks.
        const cx = trap.x + trap.w / 2;
        const cy = trap.y + trap.h / 2;
        context.fillStyle = ally ? "#3a4a52" : "#2a3238";
        context.fillRect(trap.x, trap.y, trap.w, trap.h);
        context.strokeStyle = ally ? "#8a9aa4" : "#5a6068";
        context.strokeRect(trap.x + 1, trap.y + 1, trap.w - 2, trap.h - 2);
        context.beginPath();
        context.moveTo(trap.x + 4, cy);
        context.lineTo(cx - 2, trap.y + 2);
        context.lineTo(cx + 2, trap.y + 2);
        context.lineTo(trap.x + trap.w - 4, cy);
        context.stroke();
        if (ally) {
          context.strokeStyle = "rgba(72,232,255,.9)";
          context.strokeRect(trap.x - 2, trap.y - 2, trap.w + 4, trap.h + 4);
        } else {
          context.fillStyle = "rgba(255,180,120,.28)";
          context.fillRect(cx - 2, cy - 1, 4, 2);
        }
      }
      context.globalAlpha = 1;
    }
  }

  function drawPropBody(prop, alpha) {
    if (prop.destroyed) return;
    context.globalAlpha = alpha * (prop.hitFlash > 0 ? 1 : .95);
    const flash = prop.hitFlash > 0;
    if (prop.lightCondensation || prop.kind === "lightCondensation") {
      const cx = prop.x + prop.w / 2;
      const cy = prop.y + prop.h / 2;
      const glow = prop.glow || "#ffe56a";
      const core = flash ? "#ffffff" : (prop.color || "#f7f4c8");
      // Soft bloom hint (not the full reveal/block radius — keep the core tiny).
      const bloom = Math.max(prop.w, prop.h) * 1.8;
      const grad = context.createRadialGradient(cx, cy, 0, cx, cy, bloom);
      grad.addColorStop(0, "rgba(255,240,160,.55)");
      grad.addColorStop(0.45, "rgba(255,220,80,.22)");
      grad.addColorStop(1, "rgba(255,220,80,0)");
      context.fillStyle = grad;
      context.beginPath();
      context.arc(cx, cy, bloom, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = core;
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
      context.strokeStyle = glow;
      context.lineWidth = 1.5;
      context.strokeRect(prop.x + 0.5, prop.y + 0.5, prop.w - 1, prop.h - 1);
      context.globalAlpha = 1;
      return;
    }
    if (prop.kind === "cactus") {
      context.fillStyle = flash ? "#dfffd0" : "#3d8a4a";
      context.fillRect(prop.x + 8, prop.y, 12, prop.h);
      context.fillRect(prop.x, prop.y + prop.h * .35, 28, 12);
      context.fillRect(prop.x + 4, prop.y + prop.h * .55, 10, 28);
    } else if (prop.kind === "bush") {
      context.fillStyle = flash ? "#e8d8b0" : "#6a5838";
      context.beginPath();
      context.ellipse(prop.x + prop.w / 2, prop.y + prop.h * .55, prop.w / 2, prop.h / 2, 0, 0, Math.PI * 2);
      context.fill();
    } else if (prop.kind === "tree") {
      context.fillStyle = flash ? "#c8a080" : "#3a2818";
      context.fillRect(prop.x + prop.w * .28, prop.y, prop.w * .44, prop.h);
      // Slight vision tint only — trunks stay see-through for fog fairness.
      context.fillStyle = "rgba(20,40,28,.12)";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
    } else if (prop.kind === "crate") {
      context.fillStyle = flash ? "#fff0c8" : "#8a6a3a";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
      context.strokeStyle = "#4a3818";
      context.strokeRect(prop.x + 2, prop.y + 2, prop.w - 4, prop.h - 4);
      context.beginPath();
      context.moveTo(prop.x, prop.y);
      context.lineTo(prop.x + prop.w, prop.y + prop.h);
      context.stroke();
    } else if (prop.kind === "pipe") {
      context.fillStyle = flash ? "#d0d8e0" : "#6a7888";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
      context.fillStyle = "#3a4858";
      context.fillRect(prop.x + 8, prop.y + 4, prop.w - 16, prop.h - 8);
    } else if (prop.kind === "pillar") {
      context.fillStyle = flash ? "#e8e0e8" : "#7a6a72";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
      context.fillStyle = "#4a3e48";
      context.fillRect(prop.x - 4, prop.y, prop.w + 8, 14);
      context.fillRect(prop.x - 4, prop.y + prop.h - 14, prop.w + 8, 14);
    } else if (prop.kind === "barrel") {
      context.fillStyle = flash ? "#ffd0a0" : "#8a5030";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
      context.strokeStyle = "#3a2010";
      context.beginPath();
      context.moveTo(prop.x, prop.y + prop.h * .3);
      context.lineTo(prop.x + prop.w, prop.y + prop.h * .3);
      context.moveTo(prop.x, prop.y + prop.h * .7);
      context.lineTo(prop.x + prop.w, prop.y + prop.h * .7);
      context.stroke();
    } else {
      context.fillStyle = flash ? "#fff" : "#668";
      context.fillRect(prop.x, prop.y, prop.w, prop.h);
    }
    if (prop.breakable && prop.hp < prop.maxHp && !flash) {
      context.strokeStyle = "rgba(255,255,255,.45)";
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(prop.x + 4, prop.y + prop.h * .3);
      context.lineTo(prop.x + prop.w * .5, prop.y + prop.h * .55);
      context.lineTo(prop.x + prop.w - 6, prop.y + prop.h * .25);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function drawCanopy(prop, alpha) {
    if (prop.destroyed || !prop.canopy) return;
    const c = prop.canopy;
    context.globalAlpha = alpha * .85;
    context.fillStyle = "#1a3a24";
    context.beginPath();
    context.ellipse(c.x + c.w / 2, c.y + c.h / 2, c.w / 2, c.h / 2, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2d5a3c";
    context.beginPath();
    context.ellipse(c.x + c.w * .4, c.y + c.h * .45, c.w * .35, c.h * .35, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }

  /** @param {boolean} canopiesOnly draw tree tops above fighters when true */
  function drawProps(game, alpha, canopiesOnly) {
    for (const prop of game.props || []) {
      // Held / in-flight props are drawn with the thrower / thrown pass.
      if (prop.heldBy || prop.thrownInFlight) continue;
      if (canopiesOnly) drawCanopy(prop, alpha);
      else drawPropBody(prop, alpha);
    }
  }

  function drawThrownBreakables(game, alpha) {
    context.globalAlpha = alpha;
    for (const thrown of game.thrownBreakables || []) {
      const prop = thrown?.prop;
      if (!prop || prop.destroyed) continue;
      if (prop.powerCrate || prop.kind === "powerCrate") drawMetalPowerCrate(prop);
      else drawPropBody(prop, alpha);
      if (prop.canopy) drawCanopy(prop, alpha * 0.9);
    }
    context.globalAlpha = 1;
  }

  // The world ceiling: an energy barrier line with downward hatch ticks so
  // the hard boundary reads as intentional without being a standable surface.
  function drawCeiling(game, alpha) {
    const ceiling = game?.ceiling ?? CEILING;
    context.globalAlpha = alpha;
    context.fillStyle = "rgba(255,110,100,.55)";
    context.fillRect(0, ceiling - 4, WORLD.w, 4);
    context.strokeStyle = "rgba(255,110,100,.35)";
    context.lineWidth = 2;
    for (let x = 0; x < WORLD.w; x += 64) {
      context.beginPath();
      context.moveTo(x, ceiling);
      context.lineTo(x + 14, ceiling + 12);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function drawFighter(game, fighter, viewer = null) {
    if (fighter.iframe > 0 && Math.floor(fighter.iframe * 80) % 2) return;
    const centerX = fighter.x + SIZE / 2;
    const centerY = fighter.y + SIZE / 2;
    const truth = hasIllusionTruthSight(viewer);
    context.save();
    if (fighter.dead) context.globalAlpha = .45;
    if (fighter.buddy) {
      context.shadowColor = "#39efff";
      context.shadowBlur = 14;
      context.strokeStyle = "#4df2ff";
      context.lineWidth = 4;
      context.strokeRect(fighter.x - 3, fighter.y - 3, SIZE + 6, SIZE + 6);
    }
    if (truth && isIllusionFighter(fighter) && !fighter.dead) {
      context.strokeStyle = "rgba(210,180,255,.95)";
      context.lineWidth = 2.5;
      context.setLineDash([6, 4]);
      context.strokeRect(fighter.x - 4, fighter.y - 4, SIZE + 8, SIZE + 8);
      context.setLineDash([]);
      context.lineWidth = 1;
    }
    context.fillStyle = fighter.hitFlash > 0 ? "#fff" : fighter.color;
    context.fillRect(fighter.x, fighter.y, SIZE, SIZE);
    context.shadowBlur = 0;
    drawRetractableArmorPlates(
      context, game, fighter, centerX, centerY, fighter.dead ? .45 : 1
    );
    drawNanotechChestplateArmor(
      context, game, fighter, centerX, centerY, fighter.dead ? .45 : 1
    );
    context.fillStyle = "#071016";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 15px ui-monospace,Consolas";
    const winningTeam = game.over
      ? (game.fighters.some((other) => other.team === 0 && !other.dead) ? 0 : 1)
      : -1;
    const face = fighter.dead
      ? "-_-"
      : game.over && fighter.team === winningTeam
        ? "^_^"
        : fighter.hitFace > 0
          ? ">_<"
          : fighter.dodgeFace > 0
            ? ":P"
            : fighter.spotted > 0
              ? "o_o"
              : "._.";
    context.fillText(face, centerX, centerY);
    context.translate(centerX, centerY);
    context.rotate(fighter.aim);
    const visual = weaponVisual(fighter.weaponId || fighter.weapon, fighter);
    const bodyAlpha = fighter.dead ? .45 : 1;
    const shieldUp = fighter.shieldRaised && !fighter.shieldBroken;
    drawHeldWeapon(context, game, fighter, visual, bodyAlpha, shieldUp);
    context.globalAlpha = bodyAlpha;
    if ((fighter.shieldMaxDurability || 0) > 0 && (fighter.shieldRaised || fighter.shieldBroken)) {
      const half = fighter.shieldBlockHalfAngle || 1.2;
      const broken = fighter.shieldBroken;
      const flashing = fighter.shieldFlash > 0;
      context.strokeStyle = flashing
        ? "#fff6c8"
        : broken
          ? "rgba(120,130,140,.75)"
          : fighter.team ? "#ffb08a" : "#9cf0ff";
      context.fillStyle = flashing
        ? "rgba(255,245,180,.45)"
        : broken
          ? "rgba(90,100,110,.28)"
          : fighter.team ? "rgba(255,140,100,.28)" : "rgba(90,230,255,.28)";
      context.lineWidth = broken ? 2 : flashing ? 4 : 3;
      context.beginPath();
      context.arc(0, 0, broken ? 34 : 38, -half * .85, half * .85);
      context.stroke();
      if (fighter.shieldRaised && !broken) {
        context.beginPath();
        context.moveTo(14, 0);
        context.arc(0, 0, 38, -half * .55, half * .55);
        context.closePath();
        context.fill();
      }
      if (broken) {
        context.strokeStyle = "rgba(200,210,220,.55)";
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(22, -10);
        context.lineTo(30, 8);
        context.moveTo(26, -14);
        context.lineTo(20, 12);
        context.stroke();
      }
    }
    context.restore();
    if (fighter.thrusting) {
      context.fillStyle = "#ffcf4b";
      context.beginPath();
      context.moveTo(centerX - 10, fighter.y + SIZE);
      context.lineTo(centerX, fighter.y + SIZE + 24 + Math.random() * 10);
      context.lineTo(centerX + 10, fighter.y + SIZE);
      context.fill();
    }
    context.fillStyle = "#111c22";
    context.fillRect(fighter.x, fighter.y - 12, SIZE, 5);
    context.fillStyle = fighter.team ? "#ff6259" : "#36dff5";
    // Decoys use a fake pool; phantom gaslight fools everyone except Illusionists.
    const showHp = displayedHp(fighter, viewer);
    const showMax = displayedMaxHp(fighter, viewer);
    const hpFrac = showHp / showMax;
    context.fillRect(fighter.x, fighter.y - 12, SIZE * hpFrac, 5);
    context.fillStyle = "#24343c";
    context.fillRect(fighter.x, fighter.y - 5, SIZE, 3);
    context.fillStyle = fighter.jetLocked ? "#ff5e56" : "#ffd64a";
    context.fillRect(fighter.x, fighter.y - 5, SIZE * fighter.fuel, 3);
    if ((fighter.shieldMaxDurability || 0) > 0) {
      context.fillStyle = "#24343c";
      context.fillRect(fighter.x, fighter.y - 19, SIZE, 3);
      context.fillStyle = fighter.shieldBroken ? "#6b7580" : "#7ec8ff";
      context.fillRect(
        fighter.x,
        fighter.y - 19,
        SIZE * (fighter.shieldDurability / fighter.shieldMaxDurability),
        3
      );
    }
    drawBuffClocks(fighter);
  }

  function drawBuffClocks(fighter) {
    const buffs = listTimedBuffs(fighter);
    if (!buffs.length) return;
    const baseY = fighter.y - ((fighter.shieldMaxDurability || 0) > 0 ? 36 : 28);
    buffs.forEach((buff, index) => {
      const cx = fighter.x + SIZE / 2 + (index - (buffs.length - 1) / 2) * 18;
      const cy = baseY;
      const r = 7;
      const frac = buff.charges
        ? buff.remaining / Math.max(1, buff.duration)
        : clamp(buff.remaining / Math.max(0.01, buff.duration), 0, 1);
      context.beginPath();
      context.arc(cx, cy, r, 0, Math.PI * 2);
      context.fillStyle = "rgba(8,16,22,.72)";
      context.fill();
      context.strokeStyle = "rgba(255,255,255,.2)";
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.moveTo(cx, cy);
      context.arc(cx, cy, r - 1, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      context.closePath();
      context.fillStyle = buff.color;
      context.globalAlpha = .9;
      context.fill();
      context.globalAlpha = 1;
      context.fillStyle = "#e8f4ff";
      context.font = "bold 7px ui-monospace,Consolas";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(buff.charges ? String(buff.remaining) : Math.ceil(buff.remaining), cx, cy);
    });
  }

  function drawPowerCrates(game, player) {
    for (const crate of game.powerCrates || []) {
      if (crate.destroyed || crate.forgeHidden) continue;
      // Held / in-flight crates are drawn with the thrower / thrown pass.
      if (crate.heldBy || crate.thrownInFlight) continue;
      if (!crateVisibleToTeam(game, player, crate)) continue;
      drawMetalPowerCrate(crate);
    }
  }

  /** Furnace arrives, ingests metal scraps, casts a molten square, then cools. */
  function drawForgeCasts(game, fogAlpha = 1) {
    for (const forge of game.forgeCasts || []) {
      drawForgeCast(forge, fogAlpha);
    }
  }

  function drawForgeCast(forge, fogAlpha) {
    const arriveDur = FORGE_PHASE_DURATIONS.arrive;
    const coolDur = FORGE_PHASE_DURATIONS.cool;
    const arriveU = forge.phase === "arrive"
      ? Math.min(1, forge.t / arriveDur)
      : 1;
    const easeIn = 1 - (1 - arriveU) * (1 - arriveU);
    let furnaceAlpha = fogAlpha;
    if (forge.phase === "arrive") furnaceAlpha *= easeIn;
    if (forge.phase === "cool") {
      const fade = Math.min(1, forge.t / coolDur);
      furnaceAlpha *= Math.max(0, 1 - fade * 0.95);
    }

    const mouthX = forge.mouthX;
    const mouthY = forge.mouthY;
    const furnaceW = 52;
    const furnaceH = 44;
    const slide = (1 - easeIn) * 70;
    const fx = forge.furnaceX - furnaceW - slide;
    const fy = forge.furnaceY - furnaceH * 0.55;

    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, furnaceAlpha));

    // Furnace body
    context.fillStyle = "#2a3038";
    context.fillRect(fx, fy, furnaceW, furnaceH);
    context.fillStyle = "#1a2028";
    context.fillRect(fx + 4, fy + 6, furnaceW - 8, furnaceH - 12);
    // Chimney stack
    context.fillStyle = "#3a4450";
    context.fillRect(fx + furnaceW - 16, fy - 16, 10, 18);
    context.fillStyle = "#1e242c";
    context.fillRect(fx + furnaceW - 14, fy - 14, 6, 10);
    // Mouth
    const glow = forge.phase === "ingest" || forge.phase === "melt" || forge.phase === "cast"
      ? 1
      : forge.phase === "cool" ? Math.max(0.2, 1 - (forge.cool || 0))
        : 0.35 + easeIn * 0.35;
    context.fillStyle = mixHexColors("#ff4a00", "#ffe14a", Math.min(1, glow));
    context.globalAlpha = Math.max(0, Math.min(1, furnaceAlpha * (0.55 + glow * 0.45)));
    context.fillRect(fx + furnaceW - 10, fy + 12, 14, 20);
    context.globalAlpha = Math.max(0, Math.min(1, furnaceAlpha));
    // Rivets
    context.fillStyle = "#5a6670";
    for (const [rx, ry] of [[6, 8], [furnaceW - 18, 8], [6, furnaceH - 12], [furnaceW - 18, furnaceH - 12]]) {
      context.fillRect(fx + rx, fy + ry, 3, 3);
    }

    // Pour stream during melt / early cast
    if (forge.phase === "melt" || (forge.phase === "cast" && (forge.molten || 0) < 0.55)) {
      const pourT = forge.phase === "melt"
        ? Math.min(1, forge.t / FORGE_PHASE_DURATIONS.melt)
        : 1;
      context.strokeStyle = "#ffe14a";
      context.globalAlpha = Math.max(0, Math.min(1, furnaceAlpha * 0.85));
      context.lineWidth = 3 + pourT * 2;
      context.beginPath();
      context.moveTo(mouthX, mouthY);
      context.quadraticCurveTo(
        mouthX + (forge.castX - mouthX) * 0.45,
        mouthY - 18,
        forge.castX,
        forge.castY - forge.castH * 0.5 * Math.min(1, forge.molten || pourT)
      );
      context.stroke();
    }

    // Molten / cooling cast rectangle (crate / pipe / barrel silhouette)
    if (forge.phase === "cast" || forge.phase === "cool") {
      const fill = forge.phase === "cast" ? Math.max(0.12, forge.molten || 0) : 1;
      const w = forge.castW * fill;
      const h = forge.castH * fill;
      const x = forge.castX - w / 2;
      const y = forge.castY - h / 2;
      const color = forgeCastColor(forge);
      context.globalAlpha = Math.max(0, Math.min(1, fogAlpha));
      context.fillStyle = color;
      context.fillRect(x, y, w, h);
      context.strokeStyle = mixHexColors(color, "#fff4c0", forge.phase === "cool" ? 0.15 : 0.45);
      context.lineWidth = 2;
      context.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (forge.phase === "cast" || (forge.cool || 0) < 0.55) {
        context.strokeStyle = "rgba(255, 220, 80, 0.55)";
        context.lineWidth = 1.5;
        context.strokeRect(x + 4, y + 4, Math.max(0, w - 8), Math.max(0, h - 8));
      }
    }

    context.restore();
  }

  function drawMetalPowerCrate(crate) {
    const look = crate.look || { metal: "#6a7078", rim: "#2a3038", overlay: "mudScorch", accent: "#4a3a28" };
    const flash = crate.hitFlash > 0;
    const { x, y, w, h } = crate;
    context.globalAlpha = flash ? 1 : .98;
    // Distinct metal silhouette (bevel + rivets) — not bush/tree organic shapes.
    context.fillStyle = flash ? "#f0f4ff" : look.metal;
    context.fillRect(x, y, w, h);
    context.fillStyle = look.rim;
    context.fillRect(x, y, w, 4);
    context.fillRect(x, y + h - 4, w, 4);
    context.fillRect(x, y, 4, h);
    context.fillRect(x + w - 4, y, 4, h);
    context.strokeStyle = flash ? "#ffffff" : "rgba(220,230,240,.55)";
    context.lineWidth = 1.5;
    context.strokeRect(x + 5, y + 5, w - 10, h - 10);
    // Center diamond latch — reads as loot crate, not cover wood X.
    context.beginPath();
    context.moveTo(x + w / 2, y + 10);
    context.lineTo(x + w - 10, y + h / 2);
    context.lineTo(x + w / 2, y + h - 10);
    context.lineTo(x + 10, y + h / 2);
    context.closePath();
    context.strokeStyle = look.accent;
    context.stroke();
    context.fillStyle = look.rim;
    for (const [rx, ry] of [[8, 8], [w - 11, 8], [8, h - 11], [w - 11, h - 11]]) {
      context.fillRect(x + rx, y + ry, 3, 3);
    }
    drawCrateOverlay(crate, look);
    if (crate.breakable && crate.hp < crate.maxHp && !flash) {
      context.strokeStyle = "rgba(255,255,255,.5)";
      context.beginPath();
      context.moveTo(x + 6, y + h * .35);
      context.lineTo(x + w * .45, y + h * .6);
      context.lineTo(x + w - 8, y + h * .28);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function drawCrateOverlay(crate, look) {
    const { x, y, w, h } = crate;
    const overlay = look.overlay;
    context.save();
    if (overlay === "leaves") {
      context.fillStyle = look.accent;
      context.globalAlpha = .55;
      context.beginPath();
      context.ellipse(x + w * .3, y + 4, 10, 5, -.3, 0, Math.PI * 2);
      context.ellipse(x + w * .65, y + 6, 9, 4, .4, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#2d5a3c";
      context.fillRect(x + 4, y + h - 8, w - 8, 5);
    } else if (overlay === "sand") {
      context.fillStyle = look.accent;
      context.globalAlpha = .4;
      for (let i = 0; i < 8; i++) {
        context.fillRect(x + 6 + (i * 7) % (w - 12), y + 8 + (i % 3) * 6, 3, 2);
      }
      context.globalAlpha = .35;
      context.fillRect(x + 2, y + h - 10, w - 4, 8);
    } else if (overlay === "graffiti") {
      context.strokeStyle = look.accent;
      context.globalAlpha = .7;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x + 8, y + 14);
      context.quadraticCurveTo(x + w / 2, y + 6, x + w - 8, y + 16);
      context.stroke();
      context.fillStyle = "rgba(40,40,50,.35)";
      context.fillRect(x + 4, y + h * .55, w - 8, h * .35);
    } else if (overlay === "mudScorch") {
      context.fillStyle = look.accent;
      context.globalAlpha = .45;
      context.beginPath();
      context.ellipse(x + w * .4, y + h * .7, 14, 8, 0, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#2a2018";
      context.beginPath();
      context.arc(x + w * .7, y + h * .35, 8, .2, Math.PI * 1.4);
      context.stroke();
    } else if (overlay === "rustOil") {
      context.fillStyle = look.accent;
      context.globalAlpha = .5;
      context.fillRect(x + 6, y + 12, 8, h - 20);
      context.fillStyle = "#1a1810";
      context.globalAlpha = .4;
      context.beginPath();
      context.ellipse(x + w * .7, y + h - 6, 10, 4, 0, 0, Math.PI * 2);
      context.fill();
    } else if (overlay === "mossRubble") {
      context.fillStyle = look.accent;
      context.globalAlpha = .5;
      context.beginPath();
      context.ellipse(x + w * .35, y + 5, 11, 5, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#7a6a72";
      context.globalAlpha = .4;
      context.fillRect(x + 4, y + h - 9, 10, 6);
      context.fillRect(x + w - 16, y + h - 7, 12, 4);
    } else if (overlay === "wetSalt") {
      context.strokeStyle = look.accent;
      context.globalAlpha = .55;
      context.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        context.beginPath();
        context.moveTo(x + 8 + i * 8, y + 8);
        context.lineTo(x + 12 + i * 8, y + h - 8);
        context.stroke();
      }
      context.fillStyle = "rgba(200,220,240,.25)";
      context.fillRect(x + 3, y + 3, w - 6, 6);
    }
    context.restore();
  }

  function drawGroundDebrisPiece(piece, fogAlpha = 1) {
    const color = piece.color || "#8aa4b0";
    const edge = piece.edge || mixHexColors(color, "#061018", 0.4);
    const highlight = mixHexColors(color, "#ffffff", 0.16);
    const settle = piece.grounded ? 0.78 + (piece.settle || 0) * 0.22 : 0.95;
    const scale = Math.max(0.02, piece.scale ?? 1);
    const pieceAlpha = Math.max(0, Math.min(1, piece.alpha ?? 1));
    const hw = piece.w / 2;
    const hh = piece.h / 2;
    context.save();
    context.translate(piece.x, piece.y);
    context.rotate(piece.rot || 0);
    context.scale(scale, scale);
    // Match prop fog: dim outside sight, full inside the vision clip.
    context.globalAlpha = settle * fogAlpha * pieceAlpha;
    context.fillStyle = color;

    // Jigsaw prop tiles (and armor scraps) — keep silhouette accurate for reconquer.
    if (piece.material !== "armor" && (piece.kind === "tile" || piece.homeLx != null)) {
      if (piece.shape === "ellipse") {
        context.beginPath();
        context.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
        context.fill();
      } else {
        context.fillRect(-hw, -hh, piece.w, piece.h);
      }
      context.strokeStyle = edge;
      context.lineWidth = 1;
      context.strokeRect(-hw + 0.5, -hh + 0.5, piece.w - 1, piece.h - 1);
      if (piece.detail === "crate") {
        context.beginPath();
        context.moveTo(-hw + 1, -hh + 1);
        context.lineTo(hw - 1, hh - 1);
        context.stroke();
      } else if (piece.detail === "barrel") {
        context.beginPath();
        context.moveTo(-hw + 1, 0);
        context.lineTo(hw - 1, 0);
        context.stroke();
      } else if (piece.detail === "powerCrate") {
        context.strokeStyle = highlight;
        context.strokeRect(-hw + 2, -hh + 2, piece.w - 4, piece.h - 4);
      } else if (piece.material === "wood") {
        context.strokeStyle = highlight;
        context.beginPath();
        context.moveTo(-hw + 2, -hh * 0.2);
        context.lineTo(hw - 2, -hh * 0.1);
        context.stroke();
      }
      context.restore();
      return;
    }

    if (piece.kind === "helmet" || piece.kind === "breast") {
      context.fillRect(-hw, -hh, piece.w, piece.h);
      context.fillStyle = highlight;
      context.fillRect(-hw + 3, -hh + 1, piece.w - 6, 2);
      context.strokeStyle = edge;
      context.lineWidth = 1;
      context.strokeRect(-hw, -hh, piece.w, piece.h);
    } else if (piece.kind === "chin") {
      context.beginPath();
      context.moveTo(-hw, -hh);
      context.lineTo(-piece.w / 3, hh);
      context.lineTo(piece.w / 3, hh);
      context.lineTo(hw, -hh);
      context.closePath();
      context.fill();
    } else if (piece.kind === "crest") {
      context.fillRect(-hw, -hh, piece.w, piece.h);
      context.fillStyle = highlight;
      context.fillRect(-2, -hh - 1, 4, piece.h + 2);
    } else {
      context.fillRect(-hw, -hh, piece.w, piece.h);
      context.strokeStyle = edge;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(-hw + 2, 0);
      context.lineTo(hw - 2, 0);
      context.stroke();
    }
    context.restore();
  }

  /** Broken armor / wood / metal / plant scraps left on the ground for the match. */
  function drawGroundDebris(game, fogAlpha = 1) {
    const pieces = game.groundDebris || game.armorDebris || [];
    for (const piece of pieces) drawGroundDebrisPiece(piece, fogAlpha);
  }

  /** Metal training dummies forged from melted armor plates. */
  function drawArmorDummies(game, fogAlpha = 1) {
    for (const dummy of game.armorDummies || []) {
      drawArmorDummy(dummy, fogAlpha);
    }
  }

  function drawArmorDummy(dummy, fogAlpha) {
    if (dummy.destroyed) return;
    const flash = dummy.hitFlash > 0;
    const color = flash ? "#f0f4ff" : armorDummyColor(dummy);
    const rim = mixHexColors(color, "#061018", 0.35);
    const highlight = mixHexColors(color, "#ffffff", 0.18);
    const w = dummy.w || 36;
    const h = dummy.h || 58;
    const cx = dummy.x + w / 2;
    const cy = dummy.y + h / 2;
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, fogAlpha));
    // Stand / base
    context.fillStyle = rim;
    context.fillRect(cx - w * 0.35, cy + h * 0.42, w * 0.7, 6);
    // Pole
    context.fillStyle = color;
    context.fillRect(cx - 3, cy - h * 0.05, 6, h * 0.5);
    // Torso
    context.fillRect(cx - w * 0.28, cy - h * 0.22, w * 0.56, h * 0.34);
    context.fillStyle = highlight;
    context.fillRect(cx - w * 0.2, cy - h * 0.18, w * 0.4, 3);
    // Arms
    context.fillStyle = color;
    context.fillRect(cx - w * 0.48, cy - h * 0.14, w * 0.2, 7);
    context.fillRect(cx + w * 0.28, cy - h * 0.14, w * 0.2, 7);
    // Head
    context.beginPath();
    context.ellipse(cx, cy - h * 0.34, w * 0.18, w * 0.2, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = rim;
    context.lineWidth = 1.5;
    context.strokeRect(cx - w * 0.28 + 1, cy - h * 0.22 + 1, w * 0.56 - 2, h * 0.34 - 2);
    if (!flash && dummy.hp < dummy.maxHp) {
      context.strokeStyle = "rgba(255,255,255,.45)";
      context.beginPath();
      context.moveTo(cx - w * 0.18, cy - h * 0.08);
      context.lineTo(cx + w * 0.1, cy + h * 0.05);
      context.lineTo(cx + w * 0.2, cy - h * 0.02);
      context.stroke();
    }
    context.restore();
  }

  function drawBullets(game, viewer = null) {
    const truth = hasIllusionTruthSight(viewer);
    for (const bullet of game.bullets) {
      // Ghost rounds: invisible to everyone except Illusionist truth sight.
      const ghosted = !!(bullet.ghost || bullet.hidden);
      if (ghosted && !truth) continue;
      if (bullet.scrapChuck) {
        const ang = Math.atan2(bullet.vy, bullet.vx) + (bullet.scrapSpin || 0) * 0.08;
        const w = bullet.scrapW || 8;
        const h = bullet.scrapH || 6;
        context.save();
        context.translate(bullet.x, bullet.y);
        context.rotate(ang);
        context.globalAlpha = ghosted ? 0.55 : 1;
        context.fillStyle = ghosted ? "#c8b0ff" : (bullet.color || "#8a7a68");
        context.fillRect(-w / 2, -h / 2, w, h);
        context.strokeStyle = ghosted ? "rgba(230,210,255,.7)" : "rgba(255,255,255,.35)";
        context.lineWidth = 1;
        context.strokeRect(-w / 2, -h / 2, w, h);
        context.restore();
        continue;
      }
      const hose = bullet.tracer && (bullet.owner?.weaponId === "gattler" || bullet.owner?.weaponStats?.shieldDamageMult);
      context.save();
      if (ghosted) {
        context.globalAlpha = 0.65;
        context.setLineDash([4, 5]);
        context.lineWidth = hose ? 2 : bullet.tracer ? 3.5 : 2.5;
        context.strokeStyle = "#d8c0ff";
      } else {
        context.lineWidth = hose ? 2.5 : bullet.tracer ? 5 : 3;
        context.strokeStyle = bullet.owner.team
          ? (hose ? "#ffb070" : "#ff9b65")
          : (hose ? "#b8fff4" : "#91f7ff");
      }
      context.beginPath();
      const trail = hose ? .018 : bullet.tracer ? .05 : .022;
      context.moveTo(bullet.x - bullet.vx * trail, bullet.y - bullet.vy * trail);
      context.lineTo(bullet.x, bullet.y);
      context.stroke();
      context.restore();
    }
  }

  function drawEffects(game) {
    for (const effect of game.effects) {
      context.save();
      context.globalAlpha = clamp(effect.life * 6, 0, 1);
      if (effect.type === "dash") {
        context.strokeStyle = effect.color;
        context.strokeRect(effect.x, effect.y, SIZE, SIZE);
      }
      if (effect.type === "hit") {
        context.strokeStyle = "#fff";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(effect.x, effect.y, (1 - effect.life) * 35, 0, Math.PI * 2);
        context.stroke();
      }
      if (effect.type === "muzzle") {
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle);
        context.fillStyle = "#fff4a8";
        context.fillRect(0, effect.report ? -5 : -3, effect.report ? 34 : 18, effect.report ? 10 : 6);
        if (effect.report) {
          context.strokeStyle = "rgba(255,220,120,.8)";
          context.lineWidth = 3;
          context.beginPath();
          context.arc(0, 0, 28, -.55, .55);
          context.stroke();
        }
      }
      if (effect.type === "saber") {
        context.translate(effect.x, effect.y);
        context.strokeStyle = effect.owner.team ? "#ff6e67" : "#63f3ff";
        context.lineWidth = 7;
        context.beginPath();
        context.arc(0, 0, Math.max(45, effect.owner.weaponReach * .65), effect.angle - .8, effect.angle + .8);
        context.stroke();
      }
      if (effect.type === "laser") {
        context.strokeStyle = effect.team ? "rgba(255,120,90,.95)" : "rgba(120,255,255,.95)";
        context.lineWidth = 2.5;
        context.shadowColor = effect.team ? "#ff6a4a" : "#5ef0ff";
        context.shadowBlur = 10;
        context.beginPath();
        context.moveTo(effect.x, effect.y);
        context.lineTo(effect.x2, effect.y2);
        context.stroke();
        context.shadowBlur = 0;
        context.strokeStyle = "rgba(255,255,255,.55)";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(effect.x, effect.y);
        context.lineTo(effect.x2, effect.y2);
        context.stroke();
      }
      if (effect.type === "shield") {
        context.translate(effect.x, effect.y);
        context.rotate(effect.angle || 0);
        context.strokeStyle = "#fff4b0";
        context.lineWidth = 4;
        const half = effect.half || 1.2;
        context.beginPath();
        context.arc(0, 0, 42, -half * .7, half * .7);
        context.stroke();
      }
      if (effect.type === "propHit") {
        context.strokeStyle = "#fff8d0";
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(effect.x - 10, effect.y - 8);
        context.lineTo(effect.x + 8, effect.y + 10);
        context.moveTo(effect.x + 8, effect.y - 6);
        context.lineTo(effect.x - 6, effect.y + 10);
        context.stroke();
      }
      if (effect.type === "nanoIngest") {
        // Debris collapses into the blade tip as a tight cyan swirl.
        const u = 1 - clamp(effect.life / 0.26, 0, 1);
        const color = effect.color || "#6cffb0";
        context.strokeStyle = color;
        context.fillStyle = color;
        context.lineWidth = 1.5;
        context.globalAlpha = clamp(effect.life * 3.2, 0, 1);
        for (let i = 0; i < 8; i++) {
          const ang = i * 0.85 + u * 9;
          const r = (1 - u) * (16 - i * 1.2);
          context.beginPath();
          context.arc(
            effect.x + Math.cos(ang) * r,
            effect.y + Math.sin(ang) * r,
            Math.max(0.8, 2.4 * (1 - u)),
            0,
            Math.PI * 2
          );
          context.fill();
        }
        context.beginPath();
        context.arc(effect.x, effect.y, 2 + u * 5, 0, Math.PI * 2);
        context.stroke();
      }
      if (effect.type === "nanoBotGrant") {
        // Free bots bloom out of the tip after a scrap is digested.
        const maxLife = 0.5;
        const u = 1 - clamp(effect.life / maxLife, 0, 1);
        const color = effect.color || "#6cffb0";
        context.fillStyle = color;
        context.globalAlpha = clamp(effect.life * 1.8, 0, 1);
        const count = Math.min(12, 4 + (effect.bots || 4));
        for (let i = 0; i < count; i++) {
          const ang = -Math.PI * 0.55 + (i / Math.max(1, count - 1)) * Math.PI * 1.1;
          const dist = 6 + u * (18 + (i % 3) * 7);
          const bx = effect.x + Math.cos(ang) * dist * 0.55;
          const by = effect.y - u * (10 + i * 2.2) + Math.sin(ang) * dist * 0.25;
          context.fillRect(bx - 1.4, by - 1.4, 2.8, 2.8);
        }
        context.font = "bold 11px ui-monospace,Consolas";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = "#d8fff0";
        context.globalAlpha = clamp(effect.life * 1.4, 0, 1);
        context.fillText(`+${effect.bots || 0}`, effect.x, effect.y - 14 - u * 20);
      }
      if (effect.type === "debris") {
        const t = 1 - clamp(effect.life / .45, 0, 1);
        context.fillStyle = effect.kind === "tree" || effect.kind === "cactus" || effect.kind === "bush"
          ? "#4a6838"
          : effect.kind === "powerCrate"
            ? "#9aa8b8"
            : effect.kind === "armor"
              ? "#9aadb8"
              : "#8a7a68";
        for (let i = 0; i < 6; i++) {
          const ang = i * 1.1;
          const r = 12 + t * 40;
          context.fillRect(
            effect.x + Math.cos(ang) * r - 3,
            effect.y + Math.sin(ang) * r - 3 + t * 20,
            6,
            6
          );
        }
      }
      if (effect.type === "crateBreak") {
        context.strokeStyle = effect.color || "#d8e0ea";
        context.lineWidth = 3;
        context.beginPath();
        context.arc(effect.x, effect.y, (1 - effect.life) * 48, 0, Math.PI * 2);
        context.stroke();
      }
      if (effect.type === "lootPopup") {
        context.globalAlpha = clamp(effect.life * 1.2, 0, 1);
        context.fillStyle = effect.color || "#fff";
        context.font = "bold 14px ui-monospace,Consolas";
        context.textAlign = "center";
        context.textBaseline = "middle";
        const rise = (1.1 - effect.life) * 36;
        context.fillText(effect.label || "Loot!", effect.x, effect.y - rise);
      }
      context.restore();
    }
  }

  function drawPings(game) {
    for (const ping of game.pings) {
      context.strokeStyle = `rgba(72,232,255,${clamp(ping.life / 2, 0, 1)})`;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(ping.x, ping.y, 20 + (3 - ping.life) * 13, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#48e8ff";
      context.textAlign = "center";
      context.font = "bold 12px ui-monospace";
      context.fillText("PING", ping.x, ping.y - 30);
    }
  }

  function drawVisionArrows(game) {
    const camera = game.camera;
    for (const enemy of game.fighters) {
      if (
        enemy.dead || enemy.team === 0
        || !visibleToTeam(game, game.fighters[0], enemy)
        || visibleToSelf(game.fighters[0], enemy)
      ) {
        continue;
      }
      const screenX = enemy.x + SIZE / 2 - camera.x;
      const screenY = enemy.y + SIZE / 2 - camera.y;
      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const angle = Math.atan2(screenY - centerY, screenX - centerX);
      const margin = 42;
      const scale = Math.min(
        (centerX - margin) / Math.max(.001, Math.abs(Math.cos(angle))),
        (centerY - margin) / Math.max(.001, Math.abs(Math.sin(angle)))
      );
      const x = centerX + Math.cos(angle) * scale;
      const y = centerY + Math.sin(angle) * scale;
      const size = clamp(24 - dist(game.fighters[0], enemy) / 100, 10, 22);
      context.save();
      context.translate(x, y);
      context.rotate(angle);
      context.fillStyle = "rgba(72,232,255,.82)";
      context.beginPath();
      context.moveTo(size, 0);
      context.lineTo(-size, -size * .65);
      context.lineTo(-size, size * .65);
      context.closePath();
      context.fill();
      context.restore();
    }
  }

  return { draw };
}
