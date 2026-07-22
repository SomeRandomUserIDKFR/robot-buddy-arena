import {
  CEILING, GRAVITY, JET_BURN_TIME, JET_MAX_RISE, JET_RECHARGE_TIME, JET_RESTART_FUEL,
  JET_THRUST, JUMP, SIZE, WORLD
} from "./config.js";
import { updateAI } from "./ai.js";
import {
  applyHpDamage, applyNanotechSlashBotLoss, canNanotechAttack, chuckMaterialConsumerScrap,
  consumeNanotechShot, nanotechFormPct, retractableSpeedMultiplier,
  shieldBlocksAttack, shieldSpeedMultiplier, tickAdaptiveWeapon, tickModularWeapon,
  tickNanotech, tickRetractableArmor, weaponAttackLocked
} from "./equipment.js";
import { armorDummyBlockers, damageArmorDummy } from "./debris.js";
import {
  damageProp, platformsOf, projectileBlockers, solidProps
} from "./maps.js";
import {
  consumeOvercharge, damagePowerCrate, fireRateBuffMult, moveSpeedBuffMult,
  powerCrateBlockers, tryCounterSlash
} from "./powerups.js";
import {
  attackThrowBreakable, bindThrowBreakablePowerCrateDamager, isThrowBreakable,
  stepThrownBreakables
} from "./throw-breakable.js";
import { angleDiff, clamp, dist, lerp, segmentHitsBox } from "./utils.js";

bindThrowBreakablePowerCrateDamager(damagePowerCrate);

function landableSurfaces(game) {
  return [
    ...platformsOf(game),
    ...solidProps(game),
    ...powerCrateBlockers(game).filter((c) => c.solid),
    ...armorDummyBlockers(game).filter((d) => d.solid)
  ];
}

function allProjectileBlockers(game) {
  return [
    ...projectileBlockers(game),
    ...powerCrateBlockers(game),
    ...armorDummyBlockers(game)
  ];
}

export class Fighter {
  constructor(options) {
    Object.assign(this, {
      x: 0, y: 0, vx: 0, vy: 0, team: 0, color: "#fff", name: "Bot", weapon: "gun",
      human: false, buddy: false, hp: 500, fuel: 1, grounded: false, dead: false,
      facing: 1, aim: 0, attackCd: 0, dodgeCd: 0, iframe: 0, hitFlash: 0, hitFace: 0,
      dodgeFace: 0, spotted: 0, thrusting: false, lastHitAt: -99, ai: null, totalDamage: 0,
      fuelWasted: 0,
      jetLocked: false, jetReleased: true, maxHp: 500, moveSpeed: 520, acceleration: 1800,
      damageTaken: 1, sight: 820, jetFuelCapacity: 1, jetThrust: JET_THRUST,
      jetRechargeScale: 1, weaponDamage: 1, weaponFireRate: 1, weaponRange: 1,
      dodgeCooldownMult: 1,
      projectileSpeed: 1, weaponBaseDamage: 12, weaponRpm: 500, weaponReach: 1317.5,
      weaponDropoff: { start: 300, end: 1200, minMultiplier: 10 / 12 },
      aimSettle: 0, aimSettleRequired: 0, unsettledSpread: 0, lastAim: null,
      iframeMultiplier: 1, directionalSightRange: 0, sightHalfAngle: 0,
      shieldId: "no-shield", shieldMaxDurability: 0, shieldDurability: 0,
      shieldBlockHalfAngle: 0, shieldRaisedSpeed: 1, shieldBrokenSpeed: 1,
      shieldRaised: false, shieldBroken: false, shieldFlash: 0,
      powerBuffs: {}
    }, options);
    this.aiState = {
      timer: Math.random() * .2, mx: 0, jump: false, jet: false, attack: false,
      dodge: false, target: null, lastKnown: null, stale: 0, plan: "idle", escape: null,
      desiredAim: null, shieldHoldUntil: 0, shieldCooldownUntil: 0
    };
  }

  center() {
    return { x: this.x + SIZE / 2, y: this.y + SIZE / 2 };
  }
}

export function triggerDodge(fighter, game, keys) {
  if (fighter.dead || fighter.dodgeCd > 0) return;
  const direction = fighter.human
    ? ((keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) || fighter.facing)
    : (fighter.aiState.mx || fighter.facing);
  fighter.vx = direction * 720;
  fighter.vy *= .45;
  fighter.iframe = .15 * (fighter.iframeMultiplier || 1);
  fighter.dodgeCd = 1.2 * (fighter.dodgeCooldownMult || 1);
  game.effects.push({ type: "dash", x: fighter.x, y: fighter.y, life: .24, color: fighter.color });
  if (fighter.human && game.mode === "training") {
    game.stats.dodges++;
    if (game.elapsed - game.lastShotAtPlayer < .35) game.stats.reactive++;
  }
  if (fighter.buddy && game.mode === "training") {
    game.stats.buddyDodges++;
    game.stats.buddyDodgeAttempts++;
  }
}

function hit(target, source, damage, angle, game, extras = {}) {
  if (target.iframe > 0 || target.dead) {
    // A successful dodge is only when iframes negate a hit that would have landed.
    if (target.iframe > 0 && !target.dead) {
      target.dodgeFace = .45;
      if (target.buddy && game.mode === "training") {
        game.stats.buddyDodgeSuccesses++;
      }
    }
    return;
  }
  // Snapshot before shield-break may clear raised — melee and projectile alike.
  const counterEligible = !extras.fromCounterSlash
    && !!target.shieldRaised
    && !target.shieldBroken;
  let dealt = damage * (target.damageTaken || 1);
  let shieldBlocked = false;
  if (shieldBlocksAttack(target, angle) && dealt > 0) {
    const shieldMult = extras.shieldDamageMult
      ?? source?.weaponStats?.shieldDamageMult
      ?? 1;
    const drain = dealt * shieldMult;
    const absorbed = Math.min(target.shieldDurability, drain);
    target.shieldDurability = Math.max(0, target.shieldDurability - absorbed);
    dealt = Math.max(0, dealt - absorbed / Math.max(shieldMult, 1e-6));
    target.shieldFlash = .16;
    target.vx += Math.cos(angle) * 35;
    target.vy += Math.sin(angle) * 20 - 12;
    shieldBlocked = true;
    game.effects.push({
      type: "shield",
      x: target.x + SIZE / 2,
      y: target.y + SIZE / 2,
      life: .18,
      angle: target.aim,
      half: target.shieldBlockHalfAngle || 1.2
    });
    if (
      game.mode === "training" && target.human && game.stats
      && (target.shieldMaxDurability || 0) > 0
    ) {
      game.stats.shieldBlocks = (game.stats.shieldBlocks || 0) + 1;
      game.stats.shieldDamageAbsorbed = (game.stats.shieldDamageAbsorbed || 0) + absorbed;
      game.stats.shieldMaxDurability = target.shieldMaxDurability;
      if (target.shieldDurability <= 0) game.stats.shieldBroke = 1;
    }
    if (target.shieldDurability <= 0) {
      target.shieldBroken = true;
      target.shieldRaised = false;
    }
    if (dealt <= 0) {
      if (counterEligible) {
        tryCounterSlash(target, source, game, { requireShield: false });
      }
      return;
    }
  }
  applyHpDamage(target, dealt, game);
  target.hitFlash = .12;
  target.hitFace = .35;
  target.lastHitAt = game.elapsed;
  target.vx += Math.cos(angle) * 90;
  target.vy += Math.sin(angle) * 55 - 30;
  source.totalDamage += dealt;
  if (target.human) game.lastShotAtPlayer = game.elapsed;
  if (source.buddy) {
    game.stats.buddyDamage += dealt;
    game.stats.buddyHits++;
    if (game.pings.length) game.stats.pingTargetHits++;
    const human = game.fighters[0];
    // Matches the tightened rush definition in trackTraining: a counter only
    // counts when the player is genuinely committed to close range.
    if (
      game.mode === "training"
      && Math.sign(source.x - human.x) * human.vx > 100
      && dist(source, human) < 360
    ) game.stats.rushCounterSuccesses++;
  }
  if (target.buddy) game.stats.buddyDamageTaken += dealt;
  game.effects.push({ type: "hit", x: target.x + SIZE / 2, y: target.y + SIZE / 2, life: .2 });
  if (counterEligible && (shieldBlocked || dealt > 0)) {
    tryCounterSlash(target, source, game, { requireShield: false });
  }
  if ((target.coreHp ?? target.hp) <= 0) {
    target.dead = true;
    target.hp = 0;
    target.coreHp = 0;
    target.vx = 0;
    target.vy = 0;
  }
}

export { hit };

export function weaponAccuracySpread(fighter) {
  const required = fighter.aimSettleRequired || 0;
  if (!required) return fighter.unsettledSpread || 0;
  const settled = clamp((fighter.aimSettle || 0) / required, 0, 1);
  return (fighter.unsettledSpread || 0) * (1 - settled);
}

/** First contact along a ray against axis-aligned boxes; returns end sample + hit. */
function raycastFirst(ox, oy, ex, ey, boxes) {
  const length = Math.hypot(ex - ox, ey - oy);
  const steps = Math.max(1, Math.ceil(length / 12));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(ox, ex, t);
    const y = lerp(oy, ey, t);
    for (const box of boxes) {
      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        return { x, y, t, box };
      }
    }
  }
  return { x: ex, y: ey, t: 1, box: null };
}

function pushBeamReveals(game, team, x1, y1, x2, y2, radius) {
  if (!game.beamReveals) game.beamReveals = [];
  const length = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.ceil(length / 70));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    game.beamReveals.push({
      x: lerp(x1, x2, t),
      y: lerp(y1, y2, t),
      radius: radius || 56,
      team,
      life: .12
    });
  }
}

function fireHitscanLaser(fighter, game, shotAngle, ox, oy, formPct = 1) {
  const reach = fighter.weaponReach || 1720;
  const ex = ox + Math.cos(shotAngle) * reach;
  const ey = oy + Math.sin(shotAngle) * reach;
  const dmg = fighter.weaponBaseDamage * consumeOvercharge(fighter) * formPct;
  const boxes = [
    ...platformsOf(game).map((platform) => ({
      x: platform.x, y: platform.y, w: platform.w, h: platform.h, kind: "platform"
    })),
    ...allProjectileBlockers(game).map((prop) => ({
      x: prop.x, y: prop.y, w: prop.w, h: prop.h,
      kind: prop.armorDummy ? "armorDummy" : prop.powerCrate ? "powerCrate" : "prop",
      prop
    })),
    ...game.fighters
      .filter((enemy) => !enemy.dead && enemy.team !== fighter.team && enemy !== fighter)
      .map((enemy) => ({
        x: enemy.x, y: enemy.y, w: SIZE, h: SIZE, kind: "fighter", enemy
      }))
  ];
  const hitPoint = raycastFirst(ox, oy, ex, ey, boxes);
  if (hitPoint.box?.kind === "fighter") {
    hit(
      hitPoint.box.enemy,
      fighter,
      dmg,
      shotAngle,
      game
    );
  } else if (hitPoint.box?.kind === "powerCrate") {
    damagePowerCrate(
      hitPoint.box.prop,
      dmg,
      fighter,
      game,
      hitPoint.x,
      hitPoint.y
    );
  } else if (hitPoint.box?.kind === "armorDummy") {
    damageArmorDummy(
      hitPoint.box.prop,
      dmg,
      game,
      hitPoint.x,
      hitPoint.y
    );
  } else if (hitPoint.box?.kind === "prop") {
    damageProp(
      hitPoint.box.prop,
      dmg,
      game,
      hitPoint.x,
      hitPoint.y
    );
  }
  game.effects.push({
    type: "laser",
    x: ox,
    y: oy,
    x2: hitPoint.x,
    y2: hitPoint.y,
    life: .07,
    team: fighter.team,
    owner: fighter
  });
  pushBeamReveals(
    game,
    fighter.team,
    ox,
    oy,
    hitPoint.x,
    hitPoint.y,
    fighter.weaponStats?.beamRevealRadius || 56
  );
  game.effects.push({
    type: "muzzle", x: ox, y: oy, life: .05, angle: shotAngle, report: false
  });
}

export function attack(fighter, game, random = Math.random) {
  if (fighter.attackCd > 0 || fighter.dead) return;
  if (fighter.shieldRaised && !fighter.shieldBroken) return;
  if (weaponAttackLocked(fighter)) return;
  if (!canNanotechAttack(fighter)) return;
  if (isThrowBreakable(fighter)) {
    attackThrowBreakable(fighter, game);
    if (fighter.buddy && game.mode === "training") {
      game.stats.buddyAttacks++;
      game.lastBuddyAttackAt = game.elapsed;
    }
    if (fighter.human && game.mode === "training") {
      game.stats.attacks++;
      game.lastPlayerAttackAt = game.elapsed;
      const buddy = game.fighters.find((candidate) => candidate.buddy);
      if (buddy) game.stats.attackRangeSum += dist(fighter, buddy);
      if (fighter.hp < 180) game.stats.lowHpAttack++;
    }
    return;
  }
  const spread = weaponAccuracySpread(fighter);
  const shotAngle = fighter.aim + (random() - .5) * spread * 2;
  const ox = fighter.x + SIZE / 2 + Math.cos(shotAngle) * 31;
  const oy = fighter.y + SIZE / 2 + Math.sin(shotAngle) * 31;
  const rateMult = fireRateBuffMult(fighter);
  const attackInterval = (60 / fighter.weaponRpm) / rateMult;
  const formPct = nanotechFormPct(fighter);
  if (fighter.weapon === "gun") {
    fighter.attackCd = attackInterval;
    if (fighter.weaponStats?.hitscan) {
      fireHitscanLaser(fighter, game, shotAngle, ox, oy, formPct);
    } else {
      const speed = fighter.weaponStats?.projectileSpeed || 1550 * fighter.projectileSpeed;
      const shotDmg = fighter.weaponBaseDamage * consumeOvercharge(fighter) * formPct;
      game.bullets.push({
        x: ox, y: oy, px: ox, py: oy,
        vx: Math.cos(shotAngle) * speed,
        vy: Math.sin(shotAngle) * speed,
        owner: fighter, life: fighter.weaponReach / speed, traveled: 0,
        damage: shotDmg, dropoff: fighter.weaponDropoff,
        tracer: !!fighter.weaponStats?.tracer,
        shieldDamageMult: fighter.weaponStats?.shieldDamageMult || 1
      });
      game.effects.push({
        type: "muzzle", x: ox, y: oy,
        life: fighter.weaponStats?.tracer ? .16 : .07,
        angle: shotAngle, report: !!fighter.weaponStats?.tracer
      });
    }
    consumeNanotechShot(fighter);
  } else {
    fighter.attackCd = attackInterval;
    const swingDmg = fighter.weaponBaseDamage * consumeOvercharge(fighter) * formPct;
    fighter.vx += Math.cos(fighter.aim) * 95;
    game.effects.push({
      type: "saber", x: fighter.x + SIZE / 2, y: fighter.y + SIZE / 2,
      life: .14, angle: fighter.aim, owner: fighter
    });
    let slashedFighter = false;
    for (const enemy of game.fighters) {
      if (!enemy.dead && enemy.team !== fighter.team && dist(fighter, enemy) < fighter.weaponReach) {
        const angle = Math.atan2(enemy.y - fighter.y, enemy.x - fighter.x);
        if (Math.abs(angleDiff(angle, fighter.aim)) < .85) {
          hit(enemy, fighter, swingDmg, fighter.aim, game);
          slashedFighter = true;
        }
      }
    }
    if (slashedFighter) applyNanotechSlashBotLoss(fighter);
    const cx = fighter.x + SIZE / 2;
    const cy = fighter.y + SIZE / 2;
    for (const prop of allProjectileBlockers(game)) {
      if (!prop.breakable) continue;
      const px = prop.x + prop.w / 2;
      const py = prop.y + prop.h / 2;
      if (Math.hypot(px - cx, py - cy) > fighter.weaponReach) continue;
      const angle = Math.atan2(py - cy, px - cx);
      if (Math.abs(angleDiff(angle, fighter.aim)) < .85) {
        if (prop.powerCrate) {
          damagePowerCrate(prop, swingDmg, fighter, game, px, py);
        } else if (prop.armorDummy) {
          damageArmorDummy(prop, swingDmg, game, px, py);
        } else {
          damageProp(prop, swingDmg, game, px, py);
        }
      }
    }
  }
  if (fighter.buddy && game.mode === "training") {
    game.stats.buddyAttacks++;
    game.lastBuddyAttackAt = game.elapsed;
  }
  if (fighter.human && game.mode === "training") {
    game.stats.attacks++;
    game.lastPlayerAttackAt = game.elapsed;
    const buddy = game.fighters.find((candidate) => candidate.buddy);
    if (buddy) game.stats.attackRangeSum += dist(fighter, buddy);
    if (fighter.hp < 180) game.stats.lowHpAttack++;
  }
}

// Jet fuel state machine, shared with the headless sim (jetpack-sim.mjs).
// `jetHeld` is the raw thrust input (any key that could thrust), `wantsThrust`
// is that input gated by being airborne. Running dry engages `jetLocked`;
// the jet only re-arms after the input has been fully released AND fuel has
// recovered to JET_RESTART_FUEL, so regen ticks and rapid tapping can never
// produce thrust pulses during the forced downtime. Fuel keeps recharging
// while locked, but never reactivates thrust on its own.
export function stepJetFuel(fighter, jetHeld, wantsThrust, dt) {
  if (!jetHeld) fighter.jetReleased = true;
  if (fighter.jetLocked && fighter.jetReleased && fighter.fuel >= JET_RESTART_FUEL) {
    fighter.jetLocked = false;
  }
  const thrusting = wantsThrust && !fighter.jetLocked && fighter.fuel > 0;
  if (thrusting) {
    fighter.fuel = Math.max(
      0,
      fighter.fuel - dt / (JET_BURN_TIME * (fighter.jetFuelCapacity || 1))
    );
    if (fighter.fuel <= 0) {
      fighter.jetLocked = true;
      fighter.jetReleased = false;
    }
  } else {
    fighter.fuel = Math.min(
      1,
      fighter.fuel + dt * (fighter.jetRechargeScale || 1)
        / (JET_RECHARGE_TIME * (fighter.jetFuelCapacity || 1))
    );
  }
  return thrusting;
}

export function stepFighter(fighter, dt, game, profile, keys, getHumanIntent) {
  if (fighter.dead) return;
  fighter.attackCd -= dt;
  fighter.dodgeCd -= dt;
  fighter.iframe -= dt;
  fighter.hitFlash -= dt;
  fighter.hitFace -= dt;
  fighter.dodgeFace -= dt;
  fighter.spotted -= dt;
  fighter.shieldFlash -= dt;
  tickModularWeapon(fighter, dt);
  tickAdaptiveWeapon(fighter, dt);
  tickRetractableArmor(fighter, dt);
  // Humans: know fire intent before nanotech tick so hold-to-shoot blocks regen.
  let intent = null;
  if (fighter.human && getHumanIntent) {
    intent = getHumanIntent(fighter);
    fighter.nanotechWantFire = !!intent.attack;
  }
  tickNanotech(fighter, dt);
  if (
    fighter.modularWeapon
    && fighter.modularMode === "shield"
    && !fighter.modularMorphing
  ) {
    fighter.modularPlateDurability = fighter.shieldDurability;
    fighter.modularPlateBroken = !!fighter.shieldBroken;
  }
  if (!intent) {
    intent = fighter.human
      ? getHumanIntent(fighter)
      : updateAI(fighter, dt, game, profile);
  }
  fighter.nanotechWantFire = !!intent.attack;
  const aimDelta = fighter.lastAim == null ? Infinity : Math.abs(angleDiff(fighter.aim, fighter.lastAim));
  fighter.aimSettle = aimDelta <= .012
    ? Math.min(fighter.aimSettleRequired || 0, (fighter.aimSettle || 0) + dt)
    : 0;
  fighter.lastAim = fighter.aim;
  if (intent.dodge) {
    triggerDodge(fighter, game, keys);
    intent.dodge = false;
  }
  const speedCap = fighter.moveSpeed * shieldSpeedMultiplier(fighter)
    * retractableSpeedMultiplier(fighter)
    * moveSpeedBuffMult(fighter);
  if (Math.abs(fighter.vx) < speedCap * 1.25) {
    fighter.vx += intent.mx * fighter.acceleration * dt;
  }
  if (!intent.mx) fighter.vx *= Math.pow(.001, dt);
  fighter.vx = clamp(fighter.vx, -speedCap, speedCap);
  if (intent.mx) fighter.facing = Math.sign(intent.mx);
  if (intent.jump && fighter.grounded) {
    fighter.vy = -JUMP;
    fighter.grounded = false;
  }
  // jetHeld is the raw thrust input (for humans it includes W/Space even on
  // the ground) so a held jump key can never count as a "release".
  const jetHeld = intent.jetHeld !== undefined ? !!intent.jetHeld : !!intent.jet;
  fighter.thrusting = stepJetFuel(fighter, jetHeld, intent.jet && !fighter.grounded, dt);
  if (fighter.thrusting) {
    // Only clamp speed gained from thrust; never slow a faster jump launch.
    if (fighter.vy > -JET_MAX_RISE) {
      const riseLimit = JET_MAX_RISE * Math.sqrt(fighter.jetThrust / JET_THRUST);
      fighter.vy = Math.max(fighter.vy - fighter.jetThrust * dt, -riseLimit);
    }
  }
  fighter.vy += GRAVITY * dt;
  fighter.vy = Math.min(fighter.vy, 900);

  const oldY = fighter.y;
  fighter.x += fighter.vx * dt;
  fighter.y += fighter.vy * dt;
  fighter.grounded = false;
  const ceiling = game.ceiling ?? CEILING;
  fighter.x = clamp(fighter.x, 0, WORLD.w - SIZE);
  if (fighter.y < ceiling) {
    fighter.y = ceiling;
    if (fighter.vy < 0) fighter.vy = 0;
  }
  for (const platform of landableSurfaces(game)) {
    const wasAbove = oldY + SIZE <= platform.y + 5;
    const crosses = fighter.y + SIZE >= platform.y
      && fighter.y + SIZE <= platform.y + Math.max(35, fighter.vy * dt + 10);
    if (
      wasAbove && crosses && fighter.x + SIZE > platform.x
      && fighter.x < platform.x + platform.w && fighter.vy >= 0
    ) {
      fighter.y = platform.y - SIZE;
      fighter.vy = 0;
      fighter.grounded = true;
    }
  }
  if (fighter.y > WORLD.h + 100) hit(fighter, fighter, 999, -Math.PI / 2, game);
  if (intent.chuck) chuckMaterialConsumerScrap(fighter, game);
  if (intent.attack) attack(fighter, game);
}

export function stepBullets(game, dt) {
  const ceiling = game.ceiling ?? CEILING;
  for (const bullet of game.bullets) {
    bullet.px = bullet.x;
    bullet.py = bullet.y;
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.traveled += Math.hypot(bullet.vx * dt, bullet.vy * dt);
    bullet.life -= dt;
    for (const enemy of game.fighters) {
      if (enemy.dead || enemy.team === bullet.owner.team || enemy === bullet.owner) continue;
      if (segmentHitsBox(bullet.px, bullet.py, bullet.x, bullet.y, enemy.x, enemy.y, SIZE, SIZE)) {
        const dropoff = bullet.dropoff;
        const multiplier = dropoff
          ? lerp(1, dropoff.minMultiplier, clamp(
            (bullet.traveled - dropoff.start) / Math.max(1, dropoff.end - dropoff.start),
            0,
            1
          ))
          : 1;
        hit(
          enemy,
          bullet.owner,
          (bullet.damage ?? 12 * bullet.owner.weaponDamage) * multiplier,
          Math.atan2(bullet.vy, bullet.vx),
          game,
          { shieldDamageMult: bullet.shieldDamageMult || 1 }
        );
        bullet.life = -1;
        break;
      }
    }
    if (bullet.life <= 0) continue;
    let blocked = false;
    for (const prop of allProjectileBlockers(game)) {
      if (!segmentHitsBox(
        bullet.px, bullet.py, bullet.x, bullet.y,
        prop.x, prop.y, prop.w, prop.h
      )) continue;
      const dropoff = bullet.dropoff;
      const multiplier = dropoff
        ? lerp(1, dropoff.minMultiplier, clamp(
          (bullet.traveled - dropoff.start) / Math.max(1, dropoff.end - dropoff.start),
          0,
          1
        ))
        : 1;
      const dmg = (bullet.damage ?? 12 * bullet.owner.weaponDamage) * multiplier;
      if (prop.powerCrate) {
        damagePowerCrate(prop, dmg, bullet.owner, game, bullet.x, bullet.y);
      } else if (prop.armorDummy) {
        damageArmorDummy(prop, dmg, game, bullet.x, bullet.y);
      } else {
        damageProp(prop, dmg, game, bullet.x, bullet.y);
      }
      bullet.life = -1;
      blocked = true;
      break;
    }
    if (blocked) continue;
    if (platformsOf(game).some((platform) => segmentHitsBox(
      bullet.px, bullet.py, bullet.x, bullet.y,
      platform.x, platform.y, platform.w, platform.h
    ))) {
      bullet.life = -1;
    }
    if (bullet.y < ceiling || bullet.y > WORLD.h || bullet.x < 0 || bullet.x > WORLD.w) {
      bullet.life = -1;
    }
  }
  game.bullets = game.bullets.filter((bullet) => bullet.life > 0);
}

/** Integrate Throw Breakable projectiles (fighter hits via `hit`). */
export function stepThrownProps(game, dt) {
  stepThrownBreakables(game, dt, hit);
}
