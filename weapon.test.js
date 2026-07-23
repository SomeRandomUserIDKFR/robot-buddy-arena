import assert from "node:assert/strict";
import { updateAI } from "./ai.js";
import { cameraTarget, updateCamera } from "./camera.js";
import { attack, Fighter, hit, triggerDodge, weaponAccuracySpread } from "./combat.js";
import { DEFAULT_PROFILE, SIZE, WORLD } from "./config.js";
import {
  applyLoadout, DEFAULT_LOADOUT, effectiveStats, ensureEquipmentProfile, GEAR_BY_ID,
  suggestBuddyLoadout, theoreticalDps, weaponStats
} from "./equipment.js";
import { weaponVisual } from "./rendering.js";
import {
  fighterVisibleToViewer, inDirectionalSight, isConquestDuo, visibleToTeam
} from "./vision.js";

const loadout = (weapon, body = "field-frame") => ({
  ...DEFAULT_LOADOUT, body, weapon
});

// Snipers keep their exact identities and never one-shot a base 500 HP target.
{
  const expected = {
    "quick-fire-sniper": [100, 60, 100, 5],
    "classic-sniper": [180, 30, 90, 3],
    "strong-sniper": [250, 20, 250 / 3, 2]
  };
  for (const [id, [damage, rpm, dps, shots]] of Object.entries(expected)) {
    const stats = weaponStats(id);
    assert.equal(stats.baseDamage, damage);
    assert.equal(stats.rpm, rpm);
    assert.equal(theoreticalDps(id), dps);
    assert.equal(Math.ceil(500 / stats.baseDamage), shots);
    assert.equal(stats.dropoff, null);
    assert.ok(stats.projectileSpeed >= 3000 && stats.range >= 2300);

    const fighter = applyLoadout(new Fighter({ team: 0 }), loadout(id));
    const game = { bullets: [], effects: [], fighters: [fighter], stats: {}, mode: "conquest" };
    fighter.aim = 0;
    fighter.aimSettle = fighter.aimSettleRequired;
    attack(fighter, game, () => .5);
    assert.equal(game.bullets[0].damage, damage);
    assert.equal(fighter.attackCd, 60 / rpm);
  }
}

// Sniper hip fire has meaningful spread; holding a stable aim removes it.
{
  const sniper = applyLoadout(new Fighter({}), loadout("classic-sniper"));
  sniper.aimSettle = 0;
  const hipSpread = weaponAccuracySpread(sniper);
  sniper.aimSettle = sniper.aimSettleRequired;
  assert.ok(hipSpread >= .2);
  assert.equal(weaponAccuracySpread(sniper), 0);
}

// Melee DPS bands and mobility are based on explicit weapon data.
{
  const bands = {
    "arc-saber": [130, 150],
    "duelist-blade": [125, 135],
    "heavy-saber": [130, 140]
  };
  for (const [id, [low, high]] of Object.entries(bands)) {
    const dps = theoreticalDps(id);
    assert.ok(dps >= low && dps <= high, `${id} DPS ${dps}`);
    assert.equal(applyLoadout(new Fighter({}), loadout(id)).moveSpeed, 572);
  }
  assert.equal(applyLoadout(new Fighter({}), loadout("pulse-rifle")).moveSpeed, 520);
}

// Daggers replace, rather than stack with, generic melee speed and preserve dodge travel/cooldown.
{
  assert.equal(theoreticalDps("daggers"), 120);
  const dagger = applyLoadout(new Fighter({ facing: 1 }), loadout("daggers"));
  assert.equal(dagger.moveSpeed, 650);
  const game = { effects: [], mode: "conquest", elapsed: 0 };
  triggerDodge(dagger, game, {});
  assert.equal(dagger.vx, 720);
  assert.equal(dagger.dodgeCd, 1.2);
  assert.equal(dagger.iframe, .1875);
  assert.equal(effectiveStats(loadout("daggers", "scout-frame")).speed, 728);
  assert.equal(dagger.weaponReach, 64);
}

// Look-ahead is capped, eased, returns smoothly, and cannot leave world bounds.
{
  const player = applyLoadout(
    new Fighter({ x: 1800, y: 800, aim: 0 }),
    loadout("strong-sniper")
  );
  const viewport = { width: 1000, height: 700 };
  const forward = cameraTarget(player, viewport);
  const centeredX = player.x + SIZE / 2 - viewport.width / 2;
  assert.ok(forward.x - centeredX <= viewport.width * .4);
  const camera = { x: centeredX, y: 500 };
  updateCamera(camera, player, viewport, .016);
  assert.ok(camera.x > centeredX && camera.x < forward.x);
  const outward = camera.x;
  player.cameraLead = 0;
  updateCamera(camera, player, viewport, .016);
  assert.ok(camera.x < outward && camera.x > centeredX);
  player.x = WORLD.w;
  player.y = -1000;
  player.cameraLead = .4;
  updateCamera(camera, player, viewport, 10);
  assert.ok(camera.x <= WORLD.w - viewport.width);
  assert.ok(camera.y >= 0);
}

// Directional sensing reveals only the forward target, and AI target acquisition uses it.
{
  const sniper = applyLoadout(
    new Fighter({ x: 1000, y: 700, team: 0, ai: "balanced", aim: 0 }),
    loadout("quick-fire-sniper")
  );
  const ahead = new Fighter({ x: 2500, y: 700, team: 1 });
  const behind = new Fighter({ x: -500, y: 700, team: 1 });
  assert.equal(inDirectionalSight(sniper, ahead), true);
  assert.equal(inDirectionalSight(sniper, behind), false);
  assert.equal(visibleToTeam({ fighters: [sniper, ahead] }, sniper, ahead), true);
  assert.equal(visibleToTeam({ fighters: [sniper, behind] }, sniper, behind), false);

  // Training / spar buddy is an enemy — must be in sight to draw (no always-on).
  const you = new Fighter({ x: 100, y: 700, team: 0, human: true, sight: 200 });
  const buddyNear = new Fighter({
    x: 180, y: 700, team: 1, buddy: true, name: "Pixel"
  });
  const buddyFar = new Fighter({
    x: 2000, y: 700, team: 1, buddy: true, name: "Pixel"
  });
  const training = { fighters: [you, buddyNear], mode: "training" };
  assert.equal(fighterVisibleToViewer(training, you, buddyNear), true);
  assert.equal(
    fighterVisibleToViewer({ fighters: [you, buddyFar], mode: "training" }, you, buddyFar),
    false,
    "far training buddy stays hidden out of sight"
  );
  // Conquest: player ↔ buddy always see each other (even far / through walls).
  const allyBuddy = new Fighter({ x: 2000, y: 700, team: 0, buddy: true });
  const wallGame = {
    fighters: [you, allyBuddy],
    mode: "conquest",
    props: [{
      x: 400, y: 600, w: 80, h: 200,
      solid: true, blocksSight: true, destroyed: false
    }]
  };
  assert.ok(isConquestDuo(wallGame, you, allyBuddy));
  assert.equal(
    fighterVisibleToViewer(wallGame, you, allyBuddy),
    true,
    "conquest player always sees buddy"
  );
  assert.equal(
    fighterVisibleToViewer(wallGame, allyBuddy, you),
    true,
    "conquest buddy always sees player"
  );

  const player = new Fighter({ x: 1000, y: 700, team: 0, human: true });
  const game = {
    fighters: [player, sniper, ahead], pings: [], thoughts: [],
    mode: "conquest", elapsed: 1, lastShotAtPlayer: -99
  };
  sniper.aiState.timer = 0;
  updateAI(sniper, 1, game, structuredClone(DEFAULT_PROFILE));
  assert.equal(sniper.aiState.target, ahead);
}

// New weapons are purchasable catalog entries and are not starter-owned.
{
  for (const id of [
    "quick-fire-sniper", "classic-sniper", "strong-sniper", "daggers",
    "gattler", "laser"
  ]) {
    assert.ok(Number.isInteger(GEAR_BY_ID[id].price));
    assert.equal(DEFAULT_PROFILE.equipment.owned.includes(id), false);
  }
  const locked = structuredClone(DEFAULT_PROFILE);
  ensureEquipmentProfile(locked, locked);
  assert.notEqual(suggestBuddyLoadout(locked).loadout.weapon, "quick-fire-sniper");
  locked.equipment.owned.push("quick-fire-sniper");
  Object.assign(locked.weapons.gun.habits.engagementRange, {
    samples: 8, successes: 7, failures: 1, estimate: .8
  });
  assert.equal(suggestBuddyLoadout(locked).loadout.weapon, "quick-fire-sniper");

  locked.equipment.owned.push("laser");
  assert.equal(suggestBuddyLoadout(locked).loadout.weapon, "laser");
}

// Gattler: 4 dmg @ 2× Burst RPM (1380), ~92 DPS hose with shield shred.
{
  const burstRpm = weaponStats("burst-carbine").rpm;
  const stats = weaponStats("gattler");
  assert.equal(stats.baseDamage, 4);
  assert.equal(stats.rpm, burstRpm * 2);
  assert.equal(stats.rpm, 1380);
  assert.equal(theoreticalDps("gattler"), 92);
  assert.equal(stats.shieldDamageMult, 1.35);
  assert.ok(stats.range < weaponStats("pulse-rifle").range);
  assert.ok(stats.unsettledSpread > weaponStats("pulse-rifle").unsettledSpread);
  assert.equal(!!stats.hitscan, false);

  const shooter = applyLoadout(new Fighter({ x: 100, y: 400, team: 0, aim: 0 }), loadout("gattler"));
  const game = { bullets: [], effects: [], fighters: [shooter], stats: {}, mode: "conquest" };
  attack(shooter, game, () => .5);
  assert.equal(game.bullets.length, 1);
  assert.equal(game.bullets[0].damage, 4);
  assert.equal(game.bullets[0].shieldDamageMult, 1.35);
  assert.equal(shooter.attackCd, 60 / 1380);
  assert.ok(game.bullets[0].tracer);
}

// Gattler shield shred drains more durability than raw damage.
{
  const defender = applyLoadout(new Fighter({
    x: 400, y: 400, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  const attacker = applyLoadout(new Fighter({
    x: 520, y: 400, team: 1, aim: Math.PI
  }), loadout("gattler"));
  defender.shieldRaised = true;
  const game = {
    fighters: [defender, attacker], bullets: [], effects: [],
    elapsed: 0, mode: "conquest", stats: {}, lastShotAtPlayer: -99
  };
  const max = defender.shieldDurability;
  hit(defender, attacker, 40, Math.PI, game, { shieldDamageMult: 1.35 });
  assert.equal(defender.hp, defender.maxHp);
  assert.equal(defender.shieldDurability, max - 54);
}

// Laser: 2 dmg hitscan @ 3150 RPM (105 DPS), no spread/dropoff, beam vision.
{
  const stats = weaponStats("laser");
  assert.equal(stats.baseDamage, 2);
  assert.equal(stats.rpm, 3150);
  assert.equal(theoreticalDps("laser"), 105);
  assert.equal(stats.hitscan, true);
  assert.equal(stats.dropoff, null);
  assert.equal(stats.unsettledSpread, 0);
  assert.ok(stats.range >= 1600 && stats.range <= 1900);
  assert.ok(stats.beamRevealRadius > 0);

  const shooter = applyLoadout(
    new Fighter({ x: 200, y: 400, team: 0, aim: 0 }),
    loadout("laser")
  );
  const target = applyLoadout(
    new Fighter({ x: 900, y: 400, team: 1 }),
    DEFAULT_LOADOUT
  );
  const far = applyLoadout(
    new Fighter({ x: 2200, y: 400, team: 1 }),
    DEFAULT_LOADOUT
  );
  const game = {
    fighters: [shooter, target, far],
    bullets: [],
    effects: [],
    beamReveals: [],
    stats: {},
    mode: "conquest",
    elapsed: 0,
    lastShotAtPlayer: -99
  };
  attack(shooter, game, () => .5);
  assert.equal(game.bullets.length, 0, "laser is hitscan, not projectile");
  assert.equal(shooter.attackCd, 60 / 3150);
  assert.ok(game.effects.some((effect) => effect.type === "laser"));
  assert.ok(game.beamReveals.length > 0);
  assert.equal(target.hp, target.maxHp - 2);
  assert.equal(far.hp, far.maxHp, "finite beam does not reach past max length through nearer foe");

  // No dropoff: same damage at near and mid beam range.
  target.hp = target.maxHp;
  shooter.attackCd = 0;
  game.effects = [];
  game.beamReveals = [];
  attack(shooter, game, () => .5);
  assert.equal(target.hp, target.maxHp - 2);

  // Beam reveal does not crash and can reveal beyond normal sight.
  target.dead = true;
  far.x = shooter.x + (shooter.sight || 820) + 200;
  far.y = shooter.y;
  shooter.aim = 0;
  shooter.attackCd = 0;
  game.effects = [];
  game.beamReveals = [];
  attack(shooter, game, () => .5);
  assert.ok(game.beamReveals.length > 0);
  assert.equal(visibleToTeam(game, shooter, far), true);
}

// Distinct rectangle silhouettes by weapon id (length / width / grip).
{
  const pulse = weaponVisual("pulse-rifle", { team: 0 });
  const sniper = weaponVisual("classic-sniper", { team: 0 });
  const blades = weaponVisual("daggers", { team: 0 });
  assert.ok(sniper.length > pulse.length, "classic sniper longer than pulse");
  assert.ok(sniper.width < pulse.width, "classic sniper thinner than pulse");
  assert.ok(blades.length < pulse.length, "daggers shorter than pulse");
  assert.ok(blades.width < pulse.width, "daggers thinner than pulse");
  assert.notEqual(pulse.length, sniper.length);
  assert.notEqual(pulse.width, blades.width);

  const ally = weaponVisual("laser", { team: 0 });
  const enemy = weaponVisual("laser", { team: 1 });
  const buddy = weaponVisual("laser", { team: 1, buddy: true });
  assert.notEqual(ally.color, enemy.color);
  assert.notEqual(buddy.color, enemy.color);
  assert.equal(buddy.color, weaponVisual("laser", { team: 0, buddy: true }).color);

  // Per-fighter body color tints enemy weapons; buddy/ally ignore body tint path.
  const tinted = weaponVisual("laser", { team: 1, color: "#ff3d9a" });
  assert.notEqual(tinted.color, enemy.color);
  assert.notEqual(tinted.color, "#ff3d9a");
  const buddyTintIgnored = weaponVisual("laser", { team: 1, buddy: true, color: "#ff3d9a" });
  assert.equal(buddyTintIgnored.color, buddy.color);
}

// Successful dodge face: iframes that negate a would-be hit flash ":P" (dodgeFace).
{
  const dodger = new Fighter({ x: 100, y: 100, team: 0, human: true, hp: 500 });
  const attacker = new Fighter({ x: 200, y: 100, team: 1 });
  const game = {
    effects: [], fighters: [dodger, attacker], stats: {}, mode: "conquest", elapsed: 1
  };
  triggerDodge(dodger, game, {});
  assert.ok(dodger.iframe > 0);
  hit(dodger, attacker, 40, 0, game);
  assert.equal(dodger.hp, 500);
  assert.ok(dodger.dodgeFace > 0);
  assert.equal(dodger.hitFace, 0);

  const open = new Fighter({ x: 100, y: 100, team: 0, hp: 500, iframe: 0 });
  hit(open, attacker, 40, 0, game);
  assert.ok(open.hp < 500);
  assert.ok(open.hitFace > 0);
  assert.equal(open.dodgeFace || 0, 0);

  const corpse = new Fighter({ x: 100, y: 100, team: 0, dead: true, iframe: .2, dodgeFace: 0 });
  hit(corpse, attacker, 40, 0, game);
  assert.equal(corpse.dodgeFace, 0);
}

console.log("Weapon, camera, and sight suite passed.");
