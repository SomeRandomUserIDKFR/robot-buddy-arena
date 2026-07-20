import { CEILING, SIGHT, SIZE, WORLD } from "./config.js";
import { MODULAR_MODE_DEFS } from "./equipment.js";
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
    let color = mixHexColors(from[faction], to[faction], u);
    if (holder.color && faction === "enemy") {
      color = mixHexColors(color, holder.color, 0.62);
    }
    return {
      length: from.length + (to.length - from.length) * u,
      width: from.width + (to.width - from.width) * u,
      gripOffset: from.gripOffset + (to.gripOffset - from.gripOffset) * u,
      color,
      morphing: !!holder.modularMorphing
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
    drawProps(game, .35, false);
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
    context.clip();
    drawBackdrop(game, .9);
    drawPlatforms(game, 1);
    drawProps(game, 1, false);
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
    drawBullets(game);
    for (const fighter of game.fighters) {
      const enemy = fighter.team !== player.team;
      if (!enemy || visibleToTeam(game, player, fighter) || fighter.buddy) drawFighter(game, fighter);
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

  function drawPropBody(prop, alpha) {
    if (prop.destroyed) return;
    context.globalAlpha = alpha * (prop.hitFlash > 0 ? 1 : .95);
    const flash = prop.hitFlash > 0;
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
      if (canopiesOnly) drawCanopy(prop, alpha);
      else drawPropBody(prop, alpha);
    }
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

  function drawFighter(game, fighter) {
    if (fighter.iframe > 0 && Math.floor(fighter.iframe * 80) % 2) return;
    const centerX = fighter.x + SIZE / 2;
    const centerY = fighter.y + SIZE / 2;
    context.save();
    if (fighter.dead) context.globalAlpha = .45;
    if (fighter.buddy) {
      context.shadowColor = "#39efff";
      context.shadowBlur = 14;
      context.strokeStyle = "#4df2ff";
      context.lineWidth = 4;
      context.strokeRect(fighter.x - 3, fighter.y - 3, SIZE + 6, SIZE + 6);
    }
    context.fillStyle = fighter.hitFlash > 0 ? "#fff" : fighter.color;
    context.fillRect(fighter.x, fighter.y, SIZE, SIZE);
    context.shadowBlur = 0;
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
        : fighter.hitFace > 0 ? ">_<" : fighter.spotted > 0 ? "o_o" : "._.";
    context.fillText(face, centerX, centerY);
    context.translate(centerX, centerY);
    context.rotate(fighter.aim);
    const visual = weaponVisual(fighter.weaponId || fighter.weapon, fighter);
    const bodyAlpha = fighter.dead ? .45 : 1;
    const shieldUp = fighter.shieldRaised && !fighter.shieldBroken;
    // Dim the gun/blade while the shield is up so the block reads first.
    context.globalAlpha = bodyAlpha * (shieldUp ? .38 : 1);
    context.fillStyle = visual.color;
    context.fillRect(visual.gripOffset, -visual.width / 2, visual.length, visual.width);
    // Morphing: second segment hint for the transforming silhouette.
    if (visual.morphing) {
      context.globalAlpha = bodyAlpha * 0.45;
      context.fillRect(
        visual.gripOffset + visual.length * 0.15,
        -visual.width * 0.35,
        visual.length * 0.55,
        visual.width * 0.7
      );
    }
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
    context.fillRect(fighter.x, fighter.y - 12, SIZE * fighter.hp / fighter.maxHp, 5);
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
      if (crate.destroyed) continue;
      if (!crateVisibleToTeam(game, player, crate)) continue;
      drawMetalPowerCrate(crate);
    }
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

  function drawBullets(game) {
    for (const bullet of game.bullets) {
      const hose = bullet.tracer && (bullet.owner?.weaponId === "gattler" || bullet.owner?.weaponStats?.shieldDamageMult);
      context.lineWidth = hose ? 2.5 : bullet.tracer ? 5 : 3;
      context.strokeStyle = bullet.owner.team
        ? (hose ? "#ffb070" : "#ff9b65")
        : (hose ? "#b8fff4" : "#91f7ff");
      context.beginPath();
      const trail = hose ? .018 : bullet.tracer ? .05 : .022;
      context.moveTo(bullet.x - bullet.vx * trail, bullet.y - bullet.vy * trail);
      context.lineTo(bullet.x, bullet.y);
      context.stroke();
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
      if (effect.type === "debris") {
        const t = 1 - clamp(effect.life / .45, 0, 1);
        context.fillStyle = effect.kind === "tree" || effect.kind === "cactus" || effect.kind === "bush"
          ? "#4a6838"
          : effect.kind === "powerCrate"
            ? "#9aa8b8"
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
