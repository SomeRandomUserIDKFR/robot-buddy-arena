import assert from "node:assert/strict";
import {
  awardPowerup, COUNTER_SLASH_BLADE_WEIGHT, COUNTER_SLASH_COOLDOWN,
  COUNTER_SLASH_DAGGER_WEIGHT, crateVisibleToTeam, createPowerCrate,
  damagePowerCrate, FIRE_RATE_DURATION, FIRE_RATE_MULT, fireRateBuffMult,
  HEAL_AMOUNT, initPowerCrates, isBladeFighter, isDaggerFighter,
  isMeleeFighter, pickPowerupType, pickRespawnSpot, POWER_CRATE_HP,
  POWER_CRATE_MAP, POWER_CRATE_SPAWNS, POWERUP_BASE_WEIGHT, powerupRollWeights,
  REGEN_DURATION, REGEN_TOTAL, tickFighterPowerBuffs, tryCounterSlash
} from "./powerups.js";
import { Fighter, hit, stepBullets } from "./combat.js";
import { createMapRuntime } from "./maps.js";
import { SIZE } from "./config.js";

function fighter(opts = {}) {
  return {
    x: 100, y: 100, team: 0, dead: false, hp: 200, maxHp: 500,
    weapon: "gun", weaponStats: { kind: "gun" },
    fuel: 0.2, sight: 820, aim: 0,
    shieldMaxDurability: 0, shieldDurability: 0, shieldBroken: false,
    shieldRaised: false, powerBuffs: {},
    ...opts
  };
}

function counterSlashShare(weights) {
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  return total > 0 ? (weights.counterSlash || 0) / total : 0;
}

// Kill credit — last damager receives the power-up.
{
  const killer = fighter({ weapon: "saber", weaponStats: { kind: "melee" } });
  const other = fighter({ x: 900, name: "other" });
  const crate = createPowerCrate({ x: 400, y: 1200 }, "forest", "forest", "t1");
  const game = { effects: [], fighters: [killer], elapsed: 0, powerCrateState: { pending: [] } };
  damagePowerCrate(crate, 20, other, game);
  assert.equal(crate.lastDamager, other);
  assert.equal(crate.destroyed, false);
  damagePowerCrate(crate, POWER_CRATE_HP, killer, game);
  assert.equal(crate.destroyed, true);
  assert.equal(crate.lastDamager, killer);
  assert.ok(crate.lastAward, "killing blow should award a power-up");
  assert.ok(game.effects.some((e) => e.type === "lootPopup" || e.type === "crateBreak"));
}

// Heal clamps to maxHp.
{
  const bot = fighter({ hp: 480, maxHp: 500 });
  awardPowerup(bot, "heal", { effects: [] });
  assert.equal(bot.hp, 500);
  bot.hp = 100;
  awardPowerup(bot, "heal", { effects: [] });
  assert.equal(bot.hp, 100 + HEAL_AMOUNT);
}

// Fire-rate buff duration + multiplier.
{
  const bot = fighter();
  awardPowerup(bot, "fireRate", { effects: [] });
  assert.equal(fireRateBuffMult(bot), FIRE_RATE_MULT);
  assert.ok(Math.abs(bot.powerBuffs.fireRate.remaining - FIRE_RATE_DURATION) < 1e-9);
  tickFighterPowerBuffs(bot, FIRE_RATE_DURATION / 2);
  assert.ok(bot.powerBuffs.fireRate.remaining > 0);
  assert.equal(fireRateBuffMult(bot), FIRE_RATE_MULT);
  tickFighterPowerBuffs(bot, FIRE_RATE_DURATION);
  assert.equal(bot.powerBuffs.fireRate, undefined);
  assert.equal(fireRateBuffMult(bot), 1);
}

// Regen totals ~50 HP over 15s.
{
  const bot = fighter({ hp: 100, maxHp: 500 });
  awardPowerup(bot, "regen", { effects: [] });
  const start = bot.hp;
  const steps = 30;
  const dt = REGEN_DURATION / steps;
  for (let i = 0; i < steps; i++) tickFighterPowerBuffs(bot, dt);
  const gained = bot.hp - start;
  assert.ok(Math.abs(gained - REGEN_TOTAL) < 0.75, `regen gained ${gained}, expected ~${REGEN_TOTAL}`);
  assert.equal(bot.powerBuffs.regen, undefined);
}

// Respawn prefers unseen spots when available.
{
  const mapId = "forest";
  const spots = POWER_CRATE_SPAWNS[mapId];
  assert.ok(spots.length >= 2);
  const occupied = createPowerCrate(spots[0], mapId, "forest", "occ");
  const watcher = fighter({
    x: spots[1].x - 10,
    y: spots[1].y - 80,
    sight: 2000,
    team: 0
  });
  const far = fighter({ x: 10, y: 10, sight: 50, team: 1 });
  const game = {
    mapId,
    theme: "forest",
    fighters: [watcher, far],
    powerCrates: [occupied],
    platforms: createMapRuntime(mapId).platforms,
    props: [],
    beamReveals: []
  };
  // Deterministic: always pick index 0 of the filtered pool.
  const spot = pickRespawnSpot(game, () => 0);
  assert.ok(spot, "should find a free spawn");
  assert.notEqual(`${spot.x},${spot.y}`, occupied.spawnKey);
  // Unseen pool preferred: watcher sees spots[1], so index-0 of unseen should not be spots[1].
  assert.notEqual(spot.x, spots[1].x);
}

// Gun excludes Counter Slash; blade/dagger weights differ.
{
  const gunner = fighter({ weapon: "gun", weaponStats: { kind: "gun" } });
  const blade = fighter({
    weapon: "saber", weaponId: "arc-saber", weaponStats: { kind: "melee" }
  });
  const dagger = fighter({
    weapon: "saber", weaponId: "daggers", weaponStats: { kind: "melee" }
  });
  const legacySaber = fighter({ weapon: "saber", weaponStats: { kind: "melee" } });

  assert.equal(isMeleeFighter(gunner), false);
  assert.equal(isBladeFighter(blade), true);
  assert.equal(isDaggerFighter(dagger), true);
  assert.equal(isBladeFighter(dagger), false);
  assert.equal(isBladeFighter(legacySaber), true);

  const gunW = powerupRollWeights(gunner);
  const bladeW = powerupRollWeights(blade);
  const daggerW = powerupRollWeights(dagger);
  assert.equal(gunW.counterSlash, 0);
  assert.equal(bladeW.counterSlash, COUNTER_SLASH_BLADE_WEIGHT);
  assert.equal(daggerW.counterSlash, COUNTER_SLASH_DAGGER_WEIGHT);
  assert.ok(COUNTER_SLASH_BLADE_WEIGHT >= 2 * POWERUP_BASE_WEIGHT);
  assert.ok(COUNTER_SLASH_BLADE_WEIGHT <= 3 * POWERUP_BASE_WEIGHT);
  assert.ok(daggerW.counterSlash <= POWERUP_BASE_WEIGHT);
  assert.ok(counterSlashShare(bladeW) > counterSlashShare(daggerW));
  assert.ok(counterSlashShare(daggerW) > counterSlashShare(gunW));

  for (let i = 0; i < 40; i++) {
    assert.notEqual(pickPowerupType(gunner, Math.random), "counterSlash");
  }
  // Blade weight band for Counter Slash is [3, 5.5) of total 9.5.
  assert.equal(pickPowerupType(blade, () => 3.1 / 9.5), "counterSlash");
}

// Monte Carlo: saber breakers roll Counter Slash more often than dagger or gun.
{
  const blade = fighter({
    weapon: "saber", weaponId: "heavy-saber", weaponStats: { kind: "melee" }
  });
  const dagger = fighter({
    weapon: "saber", weaponId: "daggers", weaponStats: { kind: "melee" }
  });
  const gunner = fighter({ weapon: "gun", weaponStats: { kind: "gun" } });
  const n = 8000;
  let bladeHits = 0;
  let daggerHits = 0;
  let gunHits = 0;
  for (let i = 0; i < n; i++) {
    if (pickPowerupType(blade, Math.random) === "counterSlash") bladeHits++;
    if (pickPowerupType(dagger, Math.random) === "counterSlash") daggerHits++;
    if (pickPowerupType(gunner, Math.random) === "counterSlash") gunHits++;
  }
  assert.equal(gunHits, 0);
  assert.ok(
    bladeHits > daggerHits * 1.5,
    `blade ${bladeHits}/${n} should beat dagger ${daggerHits}/${n}`
  );
  assert.ok(daggerHits > 0, "daggers remain eligible for Counter Slash");
}

// Sight gating — unseen crates are not visible to the team.
{
  const crate = createPowerCrate({ x: 3000, y: 1200 }, "battlefield", "battlefield", "far");
  const observer = fighter({ x: 100, y: 1300, sight: 200, team: 0 });
  const game = {
    fighters: [observer],
    platforms: createMapRuntime("battlefield").platforms,
    props: [],
    beamReveals: []
  };
  assert.equal(crateVisibleToTeam(game, observer, crate), false);
  const close = fighter({ x: crate.x - 20, y: crate.y - 10, sight: 820, team: 0 });
  game.fighters = [close];
  assert.equal(crateVisibleToTeam(game, close, crate), true);
}

// Map density / spawn catalog present for every arena.
{
  for (const id of Object.keys(POWER_CRATE_MAP)) {
    assert.ok(POWER_CRATE_SPAWNS[id]?.length, `${id} needs power-crate spawns`);
    assert.ok(POWER_CRATE_MAP[id].maxConcurrent >= 2);
  }
  const seeded = initPowerCrates("yard", "industrial", () => 0.1);
  assert.ok(seeded.crates.length >= 1);
  assert.ok(seeded.crates.length <= POWER_CRATE_MAP.yard.maxConcurrent);
  assert.ok(seeded.crates.every((c) => c.kind === "powerCrate" && c.look));
}

// City is sparser than forest/yard.
{
  assert.ok(POWER_CRATE_MAP.city.density < POWER_CRATE_MAP.forest.density);
  assert.ok(POWER_CRATE_MAP.city.maxConcurrent < POWER_CRATE_MAP.yard.maxConcurrent);
}

function meleeWithCounter(opts = {}) {
  const bot = new Fighter({
    x: 400, y: 400, team: 0, weapon: "saber", name: "Blade",
    ...opts
  });
  bot.weapon = "saber";
  bot.weaponStats = { kind: "melee" };
  bot.weaponBaseDamage = 40;
  bot.weaponReach = 120;
  bot.shieldRaised = true;
  bot.shieldBroken = false;
  bot.shieldDurability = 100;
  bot.shieldMaxDurability = 100;
  bot.shieldBlockHalfAngle = Math.PI;
  bot.aim = 0;
  bot.powerBuffs = {
    counterSlash: { remaining: 18, duration: 18, cooling: 0 }
  };
  return bot;
}

function gunnerAt(x, y) {
  return new Fighter({
    x, y, team: 1, weapon: "gun", name: "Gun",
    weaponStats: { kind: "gun" }
  });
}

function counterGame(fighters) {
  return {
    fighters,
    effects: [],
    bullets: [],
    elapsed: 0,
    stats: {},
    mode: "skirmish",
    pings: [],
    _powerupHit: hit,
    ceiling: 0
  };
}

// Projectile hit with Counter Slash active dashes toward the bullet owner.
{
  const target = meleeWithCounter();
  const shooter = gunnerAt(800, 400);
  const game = counterGame([target, shooter]);
  game.bullets.push({
    x: 450, y: 420, px: 500, py: 420, vx: -900, vy: 0,
    owner: shooter, life: 1, traveled: 20, damage: 12,
    dropoff: null, shieldDamageMult: 1
  });
  const vxBefore = target.vx;
  stepBullets(game, 0.05);
  assert.ok(target.vx > vxBefore, "counter should dash toward owner (+x)");
  assert.ok(target.vx > 100, "dash impulse should be significant");
  assert.equal(target.powerBuffs.counterSlash.cooling, COUNTER_SLASH_COOLDOWN);
  assert.ok(game.effects.some((e) => e.type === "dash"));
  assert.ok(game.effects.some((e) => e.type === "saber"));
}

// Rapid bullets respect per-trigger cooldown (no gattler multi-counter).
{
  const target = meleeWithCounter();
  const shooter = gunnerAt(800, 400);
  const game = counterGame([target, shooter]);
  assert.equal(tryCounterSlash(target, shooter, game), true);
  assert.equal(target.powerBuffs.counterSlash.cooling, COUNTER_SLASH_COOLDOWN);
  const vx = target.vx;
  assert.equal(tryCounterSlash(target, shooter, game), false, "cooling blocks");
  assert.equal(target.vx, vx, "no second dash while cooling");
  // Simulate hose of hits through hit() — still one cooling window.
  hit(target, shooter, 5, Math.PI, game);
  assert.ok(target.powerBuffs.counterSlash.cooling > 0);
  tickFighterPowerBuffs(target, COUNTER_SLASH_COOLDOWN + 0.01);
  assert.ok(!(target.powerBuffs.counterSlash.cooling > 0));
  assert.equal(tryCounterSlash(target, shooter, game), true);
}

// Without Counter Slash buff, a gun hit does not trigger dash+slash VFX.
{
  const target = meleeWithCounter();
  delete target.powerBuffs.counterSlash;
  const shooter = gunnerAt(800, 400);
  const game = counterGame([target, shooter]);
  const vxBefore = target.vx;
  hit(target, shooter, 12, Math.PI, game);
  assert.equal(game.effects.filter((e) => e.type === "saber").length, 0);
  assert.ok(Math.abs(target.vx - vxBefore) < 280, "no full counter dash");
}

// Shield-break on a blocking hit still allows one counter (eligibility snapshotted).
{
  const target = meleeWithCounter();
  target.shieldDurability = 10;
  const shooter = gunnerAt(target.x + SIZE + 40, 400);
  const game = counterGame([target, shooter]);
  hit(target, shooter, 40, Math.PI, game);
  assert.equal(target.shieldBroken, true);
  assert.ok(game.effects.some((e) => e.type === "dash"), "counter on break");
}

assert.ok(COUNTER_SLASH_COOLDOWN >= 0.6 && COUNTER_SLASH_COOLDOWN <= 1.0);

console.log("powerups.test.js: ok");
