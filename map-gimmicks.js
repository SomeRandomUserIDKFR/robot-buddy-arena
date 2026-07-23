/**
 * Per-map specials — one signature hazard / toy per arena.
 * Init once in makeGame; tick each frame; draw overlays from rendering.
 */
import { SIZE, WORLD } from "./config.js";
import { applyHpDamage } from "./equipment.js";
import { clamp } from "./utils.js";

export const GIMMICK_BY_MAP = Object.freeze({
  battlefield: "crosswind",
  city: "elevators",
  desert: "sandstorm",
  forest: "canopyDrop",
  yard: "steamVents",
  ruins: "crumble",
  docks: "tide"
});

export function gimmickLabel(kind) {
  return ({
    crosswind: "CROSSWIND",
    elevators: "ELEVATORS",
    sandstorm: "SANDSTORM",
    canopyDrop: "CANOPY DROP",
    steamVents: "STEAM VENTS",
    crumble: "CRUMBLE",
    tide: "TIDE"
  })[kind] || null;
}

/**
 * Attach `game.gimmick` for the match. Mutates platforms where needed.
 */
export function initMapGimmicks(game) {
  if (!game) return null;
  const kind = GIMMICK_BY_MAP[game.mapId] || null;
  if (!kind) {
    game.gimmick = null;
    return null;
  }

  const gimmick = {
    kind,
    label: gimmickLabel(kind),
    t: 0,
    sightMult: 1,
    active: false
  };

  if (kind === "crosswind") {
    gimmick.dir = 1;
    gimmick.pulseT = 0;
    gimmick.cooldown = 6;
  } else if (kind === "elevators") {
    // Mid alley ledges become freight elevators.
    const plats = (game.platforms || []).filter(
      (p) => !p.blocksSight && p.w >= 160 && p.w <= 240 && p.y < 1200 && p.y > 600
    );
    const picks = plats.slice(0, 3);
    gimmick.elevators = picks.map((p, i) => {
      p.elevator = true;
      p.baseY = p.y;
      return {
        platform: p,
        baseY: p.y,
        amp: 90 + i * 20,
        period: 5.5 + i * 0.8,
        phase: i * 1.7
      };
    });
  } else if (kind === "sandstorm") {
    gimmick.cooldown = 10;
    gimmick.stormT = 0;
  } else if (kind === "canopyDrop") {
    gimmick.cooldown = 4.5;
    gimmick.drops = [];
  } else if (kind === "steamVents") {
    // Vents under mid industrial platforms / near pipes.
    const vents = [];
    for (const p of game.platforms || []) {
      if (p.y > 1300 || p.y < 500) continue;
      if (p.w < 280) continue;
      vents.push({
        x: p.x + p.w * 0.35,
        y: p.y,
        w: 56,
        h: 18,
        phase: vents.length * 2.1,
        blastT: 0
      });
      if (vents.length >= 5) break;
    }
    // Fallback anchors if layout is weird.
    if (!vents.length) {
      vents.push(
        { x: 900, y: 1060, w: 56, h: 18, phase: 0, blastT: 0 },
        { x: 1900, y: 1000, w: 56, h: 18, phase: 2, blastT: 0 },
        { x: 2800, y: 520, w: 56, h: 18, phase: 4, blastT: 0 }
      );
    }
    gimmick.vents = vents;
    gimmick.period = 3.2;
  } else if (kind === "crumble") {
    const candidates = (game.platforms || []).filter(
      (p) => !p.blocksSight && p !== game.platforms?.[0] && p.w <= 320 && p.y < 1300
    );
    gimmick.unstable = candidates.slice(0, 6).map((p) => {
      p.unstable = true;
      p.crumbled = false;
      p.stress = 0;
      return p;
    });
    gimmick.stressMax = 1.6;
    gimmick.goneT = 3.2;
  } else if (kind === "tide") {
    gimmick.baseY = 1520;
    gimmick.amp = 110;
    gimmick.period = 14;
    gimmick.tideY = gimmick.baseY;
  }

  game.gimmick = gimmick;
  return gimmick;
}

function pushWind(fighter, dir, strength) {
  if (!fighter || fighter.dead) return;
  const mult = fighter.grounded ? 0.35 : 1;
  fighter.vx += dir * strength * mult;
}

/**
 * @param {object} game
 * @param {number} dt
 */
export function tickMapGimmicks(game, dt) {
  const g = game?.gimmick;
  if (!g || !dt) return;
  g.t = (g.t || 0) + dt;
  g.sightMult = 1;
  g.active = false;

  if (g.kind === "crosswind") tickCrosswind(game, g, dt);
  else if (g.kind === "elevators") tickElevators(game, g, dt);
  else if (g.kind === "sandstorm") tickSandstorm(game, g, dt);
  else if (g.kind === "canopyDrop") tickCanopyDrop(game, g, dt);
  else if (g.kind === "steamVents") tickSteamVents(game, g, dt);
  else if (g.kind === "crumble") tickCrumble(game, g, dt);
  else if (g.kind === "tide") tickTide(game, g, dt);
}

function tickCrosswind(game, g, dt) {
  g.cooldown -= dt;
  if (g.pulseT > 0) {
    g.pulseT -= dt;
    g.active = true;
    const strength = 520 * dt;
    for (const f of game.fighters || []) pushWind(f, g.dir, strength);
    if (game.effects && Math.random() < 0.45) {
      game.effects.push({
        type: "windStreak",
        x: Math.random() * WORLD.w,
        y: 200 + Math.random() * 1000,
        life: 0.35,
        dir: g.dir
      });
    }
    if (g.pulseT <= 0) g.cooldown = 5 + Math.random() * 4;
  } else if (g.cooldown <= 0) {
    g.dir = Math.random() < 0.5 ? -1 : 1;
    g.pulseT = 2.2 + Math.random() * 1.2;
  }
}

function tickElevators(game, g, dt) {
  g.active = true;
  for (const el of g.elevators || []) {
    const p = el.platform;
    if (!p) continue;
    const prevY = p.y;
    const wave = Math.sin((g.t + el.phase) * ((Math.PI * 2) / el.period));
    p.y = el.baseY + wave * el.amp;
    const dy = p.y - prevY;
    if (!(Math.abs(dy) > 0)) continue;
    for (const f of game.fighters || []) {
      if (f.dead || !f.grounded) continue;
      const feet = f.y + SIZE;
      if (Math.abs(feet - prevY) > 8) continue;
      if (f.x + SIZE <= p.x || f.x >= p.x + p.w) continue;
      f.y += dy;
    }
  }
}

function tickSandstorm(game, g, dt) {
  g.cooldown -= dt;
  if (g.stormT <= 0 && g.cooldown <= 0) {
    g.stormT = 4.5 + Math.random() * 2;
  }
  if (g.stormT > 0) {
    g.stormT -= dt;
    g.active = true;
    g.sightMult = 0.42;
    if (game.effects && Math.random() < 0.55) {
      game.effects.push({
        type: "sandMote",
        x: Math.random() * WORLD.w,
        y: 100 + Math.random() * 1200,
        life: 0.5 + Math.random() * 0.4,
        vx: 180 + Math.random() * 220
      });
    }
    if (g.stormT <= 0) g.cooldown = 8 + Math.random() * 5;
  }
}

function tickCanopyDrop(game, g, dt) {
  g.cooldown -= dt;
  g.drops = (g.drops || []).filter((d) => {
    d.y += d.vy * dt;
    d.life -= dt;
    if (d.life <= 0 || d.y > WORLD.h) return false;
    for (const f of game.fighters || []) {
      if (f.dead) continue;
      if (
        f.x + SIZE > d.x && f.x < d.x + d.w
        && f.y + SIZE > d.y && f.y < d.y + d.h
      ) {
        applyHpDamage(f, 18, game);
        f.hitFlash = Math.max(f.hitFlash || 0, 0.14);
        f.vy += 40;
        if (game.effects) {
          game.effects.push({
            type: "propHit",
            x: d.x + d.w / 2,
            y: d.y + d.h / 2,
            life: 0.16
          });
        }
        return false;
      }
    }
    return true;
  });

  if (g.cooldown > 0) return;
  g.cooldown = 3.8 + Math.random() * 2.5;
  const trees = (game.props || []).filter(
    (p) => p.kind === "tree" && !p.destroyed && p.canopy
  );
  if (!trees.length) return;
  const tree = trees[Math.floor(Math.random() * trees.length)];
  const c = tree.canopy;
  g.drops.push({
    x: c.x + c.w * 0.3 + Math.random() * c.w * 0.4,
    y: c.y + c.h * 0.5,
    w: 28,
    h: 18,
    vy: 520,
    life: 2.2
  });
  g.active = true;
  if (game.effects) {
    game.effects.push({
      type: "propHit",
      x: c.x + c.w / 2,
      y: c.y + c.h / 2,
      life: 0.12
    });
  }
}

function tickSteamVents(game, g, dt) {
  const period = g.period || 3.2;
  for (const vent of g.vents || []) {
    const phase = (g.t + vent.phase) % period;
    const blasting = phase < 0.85;
    vent.blasting = blasting;
    if (blasting) {
      g.active = true;
      vent.blastT = phase;
      if (game.effects && Math.random() < 0.35) {
        game.effects.push({
          type: "steamPuff",
          x: vent.x + vent.w / 2 + (Math.random() - 0.5) * 20,
          y: vent.y - 10 - Math.random() * 40,
          life: 0.35
        });
      }
      for (const f of game.fighters || []) {
        if (f.dead) continue;
        if (
          f.x + SIZE > vent.x && f.x < vent.x + vent.w
          && f.y + SIZE > vent.y - 40 && f.y < vent.y + 10
        ) {
          f.vy = Math.min(f.vy, -420);
          f.grounded = false;
          if (phase < 0.12) {
            applyHpDamage(f, 6, game);
            f.hitFlash = Math.max(f.hitFlash || 0, 0.1);
          }
        }
      }
    }
  }
}

function tickCrumble(game, g, dt) {
  for (const p of g.unstable || []) {
    if (p.crumbled) {
      p.crumbleRecover = (p.crumbleRecover || 0) - dt;
      if (p.crumbleRecover <= 0) {
        p.crumbled = false;
        p.stress = 0;
      }
      continue;
    }
    let stood = false;
    for (const f of game.fighters || []) {
      if (f.dead || !f.grounded) continue;
      const feet = f.y + SIZE;
      if (Math.abs(feet - p.y) > 6) continue;
      if (f.x + SIZE <= p.x || f.x >= p.x + p.w) continue;
      stood = true;
      break;
    }
    if (stood) {
      p.stress = (p.stress || 0) + dt;
      g.active = p.stress > g.stressMax * 0.55;
      if (p.stress >= g.stressMax) {
        p.crumbled = true;
        p.crumbleRecover = g.goneT;
        p.stress = 0;
        if (game.effects) {
          game.effects.push({
            type: "debris",
            x: p.x + p.w / 2,
            y: p.y,
            life: 0.35,
            kind: "pillar",
            w: Math.min(40, p.w),
            h: p.h
          });
        }
      }
    } else {
      p.stress = Math.max(0, (p.stress || 0) - dt * 0.55);
    }
  }
}

function tickTide(game, g, dt) {
  const wave = Math.sin((g.t * Math.PI * 2) / g.period);
  g.tideY = g.baseY - wave * g.amp;
  g.active = wave > 0.35;
  for (const f of game.fighters || []) {
    if (f.dead) continue;
    const feet = f.y + SIZE;
    if (feet < g.tideY) continue;
    const depth = feet - g.tideY;
    // Buoyancy + drag in the drink.
    f.vy -= 520 * dt;
    f.vx *= Math.pow(0.08, dt);
    if (depth > 10) {
      applyHpDamage(f, 14 * dt, game);
      f.hitFlash = Math.max(f.hitFlash || 0, 0.08);
    }
    if ((f.coreHp ?? f.hp) <= 0) {
      f.dead = true;
      f.hp = 0;
      f.coreHp = 0;
    }
  }
}

/** Effective sight range under map gimmicks (sandstorm). */
export function gimmickSightMult(game) {
  const m = game?.gimmick?.sightMult;
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** Platforms that are currently not landable (crumbled ruins). */
export function isPlatformLandable(platform) {
  return !!platform && !platform.crumbled;
}

/**
 * Draw gimmick overlays (hazards, tide, elevator tells, drops).
 * @param {CanvasRenderingContext2D} context
 */
export function drawMapGimmicks(context, game, alpha = 1) {
  const g = game?.gimmick;
  if (!g || !context) return;
  context.save();
  context.globalAlpha = alpha;

  if (g.kind === "elevators") {
    for (const el of g.elevators || []) {
      const p = el.platform;
      if (!p) continue;
      context.strokeStyle = "rgba(120,200,255,.55)";
      context.lineWidth = 2;
      context.strokeRect(p.x - 1, p.y - 1, p.w + 2, p.h + 2);
      context.fillStyle = "rgba(80,160,220,.2)";
      context.fillRect(p.x, p.y, p.w, 3);
    }
  }

  if (g.kind === "steamVents") {
    for (const vent of g.vents || []) {
      context.fillStyle = vent.blasting
        ? "rgba(200,220,230,.45)"
        : "rgba(120,140,150,.25)";
      context.fillRect(vent.x, vent.y - 4, vent.w, vent.h);
      if (vent.blasting) {
        context.fillStyle = "rgba(220,240,255,.2)";
        context.fillRect(vent.x + 8, vent.y - 50, vent.w - 16, 50);
      }
    }
  }

  if (g.kind === "crumble") {
    for (const p of g.unstable || []) {
      if (p.crumbled) {
        context.globalAlpha = alpha * 0.25;
        context.fillStyle = "#3a3034";
        context.fillRect(p.x, p.y, p.w, p.h);
        context.globalAlpha = alpha;
      } else if ((p.stress || 0) > 0.2) {
        const t = clamp((p.stress || 0) / (g.stressMax || 1), 0, 1);
        context.strokeStyle = `rgba(255,160,80,${0.25 + t * 0.55})`;
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(p.x + 4, p.y + p.h / 2);
        context.lineTo(p.x + p.w * 0.4, p.y + 2);
        context.lineTo(p.x + p.w * 0.7, p.y + p.h - 2);
        context.lineTo(p.x + p.w - 4, p.y + 2);
        context.stroke();
      }
    }
  }

  if (g.kind === "canopyDrop") {
    for (const d of g.drops || []) {
      context.fillStyle = "#3a2818";
      context.fillRect(d.x, d.y, d.w, d.h);
      context.fillStyle = "#2d5a3c";
      context.fillRect(d.x - 4, d.y - 6, d.w + 8, 8);
    }
  }

  if (g.kind === "tide" && Number.isFinite(g.tideY)) {
    const y = g.tideY;
    context.fillStyle = "rgba(30,90,130,.42)";
    context.fillRect(0, y, WORLD.w, WORLD.h - y + 40);
    context.strokeStyle = "rgba(120,200,230,.55)";
    context.lineWidth = 2;
    context.beginPath();
    for (let x = 0; x <= WORLD.w; x += 40) {
      const yy = y + Math.sin((x + g.t * 120) * 0.03) * 5;
      if (x === 0) context.moveTo(x, yy);
      else context.lineTo(x, yy);
    }
    context.stroke();
  }

  if (g.kind === "sandstorm" && g.active) {
    context.fillStyle = "rgba(180,140,80,.12)";
    context.fillRect(0, 0, WORLD.w, WORLD.h);
  }

  context.restore();
}

/**
 * Extra effect draws for wind / sand / steam (called from effects loop or here).
 */
export function drawGimmickEffect(context, effect, alpha = 1) {
  if (!effect || !context) return false;
  if (effect.type === "windStreak") {
    context.globalAlpha = alpha * clamp(effect.life / 0.35, 0, 1);
    context.strokeStyle = "rgba(200,220,240,.55)";
    context.lineWidth = 2;
    const len = 70;
    const dir = effect.dir || 1;
    context.beginPath();
    context.moveTo(effect.x, effect.y);
    context.lineTo(effect.x + dir * len, effect.y - 6);
    context.stroke();
    context.globalAlpha = 1;
    return true;
  }
  if (effect.type === "sandMote") {
    context.globalAlpha = alpha * clamp(effect.life / 0.6, 0, 1);
    context.fillStyle = "rgba(210,170,100,.7)";
    context.fillRect(effect.x, effect.y, 3, 2);
    context.globalAlpha = 1;
    return true;
  }
  if (effect.type === "steamPuff") {
    context.globalAlpha = alpha * clamp(effect.life / 0.35, 0, 1) * 0.5;
    context.fillStyle = "#d8e4ec";
    context.beginPath();
    context.ellipse(effect.x, effect.y, 14, 10, 0, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    return true;
  }
  return false;
}

/** Drift sand motes each frame (positions). */
export function tickGimmickEffects(game, dt) {
  for (const effect of game?.effects || []) {
    if (effect.type === "sandMote") {
      effect.x += (effect.vx || 200) * dt;
      effect.y += Math.sin((effect.x || 0) * 0.02) * 20 * dt;
    }
    if (effect.type === "windStreak") {
      effect.x += (effect.dir || 1) * 420 * dt;
    }
    if (effect.type === "steamPuff") {
      effect.y -= 80 * dt;
    }
  }
}
