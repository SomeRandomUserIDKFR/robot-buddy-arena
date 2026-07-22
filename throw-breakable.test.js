import assert from "node:assert/strict";
import { applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, selectWeaponSlot } from "./equipment.js";
import { createMapRuntime } from "./maps.js";
import { damageProp } from "./maps.js";
import {
  createPowerCrate, damagePowerCrate, POWER_CRATE_HP
} from "./powerups.js";
import {
  attackThrowBreakable, bindThrowBreakablePowerCrateDamager, canGrabBreakable,
  dropHeldBreakable, isThrowBreakable, shatterBreakableAt,
  stepThrownBreakables, THROW_BREAKABLE_DAMAGE, THROW_BREAKABLE_ID,
  throwHeldBreakable, tickThrowBreakable, tryGrabBreakable
} from "./throw-breakable.js";

bindThrowBreakablePowerCrateDamager(damagePowerCrate);

assert.equal(GEAR_BY_ID[THROW_BREAKABLE_ID].slot, "secondaryWeapon");
assert.equal(GEAR_BY_ID[THROW_BREAKABLE_ID].throwBreakable, true);
assert.equal(GEAR_BY_ID[THROW_BREAKABLE_ID].weaponStats.baseDamage, THROW_BREAKABLE_DAMAGE);

{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  assert.equal(fighter.throwBreakable, false);
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  assert.equal(fighter.weaponId, THROW_BREAKABLE_ID);
  assert.ok(isThrowBreakable(fighter));
}

// Grab → hold (damageable) → throw → shatter at impact with relocated prop slot.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  assert.ok(crate);
  const startX = crate.x;
  const startY = crate.y;

  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  fighter.x = crate.x - 40;
  fighter.y = crate.y;
  fighter.aim = 0;
  selectWeaponSlot(fighter, "secondaryWeapon");

  const game = {
    props: yard.props,
    platforms: yard.platforms,
    fighters: [fighter],
    effects: [],
    groundDebris: [],
    thrownBreakables: [],
    reconquerQueue: []
  };

  assert.ok(tryGrabBreakable(fighter, game));
  assert.equal(fighter.heldProp, crate);
  assert.equal(crate.heldBy, fighter);
  assert.equal(crate.solid, false);
  assert.equal(crate.blocksProjectiles, true);

  // Enemy can still chip a held prop.
  const hpBefore = crate.hp;
  damageProp(crate, 10, game, crate.x + crate.w / 2, crate.y + crate.h / 2);
  assert.equal(crate.hp, hpBefore - 10);
  assert.ok(!crate.destroyed);

  tickThrowBreakable(fighter, game, 1 / 60);
  assert.ok(Math.abs((crate.x + crate.w / 2) - (fighter.x + 23 + 34)) < 30);

  assert.ok(throwHeldBreakable(fighter, game));
  assert.equal(fighter.heldProp, null);
  assert.equal(crate.thrownInFlight, true);
  assert.equal(game.thrownBreakables.length, 1);

  // Force an immediate ground impact ahead of the thrower.
  const thrown = game.thrownBreakables[0];
  thrown.x = 400;
  thrown.y = 200;
  thrown.vx = 0;
  thrown.vy = 800;
  // Fake a platform under the projectile.
  game.platforms = [{ x: 300, y: 220, w: 200, h: 20 }];
  stepThrownBreakables(game, 1 / 30, () => {});

  assert.equal(game.thrownBreakables.length, 0);
  assert.ok(crate.destroyed);
  assert.ok(game.groundDebris.length > 0);
  assert.ok(Math.abs(crate.x - startX) > 5 || Math.abs(crate.y - startY) > 5, "slot moved to impact");
  assert.ok(Math.abs((crate.y + crate.h) - 220) < 1, "reconquer slot feet on platform");
  assert.ok(game.groundDebris.every((p) => p.sourceProp === crate));
  const origin = game.groundDebris[0];
  assert.ok(Math.abs(origin.originX - (crate.x + crate.w / 2)) < 2);
}

// Destroy while held clears the hand.
{
  const yard = createMapRuntime("yard");
  const barrel = yard.props.find((p) => p.kind === "barrel");
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  fighter.x = barrel.x - 20;
  fighter.y = barrel.y;
  fighter.aim = 0;
  selectWeaponSlot(fighter, "secondaryWeapon");
  const game = {
    props: yard.props,
    platforms: yard.platforms,
    fighters: [fighter],
    effects: [],
    groundDebris: []
  };
  assert.ok(tryGrabBreakable(fighter, game));
  damageProp(barrel, 999, game, barrel.x, barrel.y);
  tickThrowBreakable(fighter, game, 0);
  assert.equal(fighter.heldProp, null);
}

// Attack helper toggles grab/throw cadence.
{
  const yard = createMapRuntime("city");
  const crate = yard.props.find((p) => p.kind === "crate");
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  fighter.x = crate.x - 30;
  fighter.y = crate.y;
  fighter.aim = 0;
  selectWeaponSlot(fighter, "secondaryWeapon");
  const game = {
    props: yard.props,
    platforms: yard.platforms,
    fighters: [fighter],
    effects: [],
    groundDebris: [],
    thrownBreakables: []
  };
  assert.ok(attackThrowBreakable(fighter, game));
  assert.ok(fighter.heldProp);
  assert.ok(fighter.attackCd > 0);
  fighter.attackCd = 0;
  assert.ok(attackThrowBreakable(fighter, game));
  assert.equal(fighter.heldProp, null);
  assert.equal(game.thrownBreakables.length, 1);
  dropHeldBreakable(fighter, game); // no-op when empty
}

// Direct shatter snaps reconquer slot onto a valid floor (not mid-air).
{
  const upper = { x: 0, y: 400, w: 800, h: 40 };
  const lower = { x: 0, y: 900, w: 800, h: 40 };
  const pipe = {
    kind: "pipe",
    breakable: true,
    solid: true,
    destroyed: false,
    x: 100,
    y: 100,
    w: 80,
    h: 22,
    hp: 40,
    maxHp: 40,
    groundDebrisDropped: false
  };
  const game = {
    props: [pipe],
    platforms: [upper, lower],
    effects: [],
    groundDebris: []
  };
  // Mid-air impact between platforms — old code left the slot floating at y≈500.
  // With no scrap votes, dummy logic picks the first floor at/below the impact.
  shatterBreakableAt(pipe, game, 200, 500);
  assert.ok(pipe.destroyed);
  assert.ok(Math.abs((pipe.y + pipe.h) - lower.y) < 1, "feet on floor below impact");
  assert.ok(pipe.y + pipe.h > upper.y + 40, "not stuck mid-air above lower floor");
  assert.ok(pipe.x + pipe.w / 2 >= lower.x);
  assert.ok(pipe.x + pipe.w / 2 <= lower.x + lower.w);
}

// Mid-air shatter clamps X onto the chosen surface.
{
  const ledge = { x: 400, y: 600, w: 120, h: 24 };
  const crate = {
    kind: "crate",
    breakable: true,
    solid: true,
    destroyed: false,
    x: 0,
    y: 0,
    w: 44,
    h: 44,
    hp: 50,
    maxHp: 50,
    groundDebrisDropped: false
  };
  const game = {
    props: [crate],
    platforms: [ledge],
    effects: [],
    groundDebris: []
  };
  shatterBreakableAt(crate, game, 40, 300);
  assert.ok(crate.destroyed);
  assert.ok(Math.abs((crate.y + crate.h) - ledge.y) < 1, "feet on ledge");
  const cx = crate.x + crate.w / 2;
  assert.ok(cx >= ledge.x + crate.w / 2 - 0.5);
  assert.ok(cx <= ledge.x + ledge.w - crate.w / 2 + 0.5);
}

// Power crates: only grabbable at ≤50% HP; throw awards loot to thrower.
{
  const full = createPowerCrate({ x: 500, y: 400 }, "yard", "industrial", "pc-full");
  assert.equal(canGrabBreakable(full), false, "full HP metal box locked");
  full.hp = POWER_CRATE_HP * 0.5;
  assert.equal(canGrabBreakable(full), true, "exactly 50% is grabbable");
  full.hp = POWER_CRATE_HP * 0.5 - 1;
  assert.equal(canGrabBreakable(full), true, "below 50% stays grabbable");

  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  fighter.x = full.x - 20;
  fighter.y = full.y;
  fighter.aim = 0;
  fighter.hp = 200;
  fighter.maxHp = 500;
  selectWeaponSlot(fighter, "secondaryWeapon");

  const game = {
    props: [],
    powerCrates: [full],
    platforms: [{ x: 0, y: 420, w: 800, h: 40 }],
    fighters: [fighter],
    effects: [],
    groundDebris: [],
    thrownBreakables: [],
    powerCrateState: { pending: [], spawnIndex: 0, nextSpawnCheck: 99 },
    elapsed: 0,
    mapId: "yard",
    theme: "industrial"
  };

  assert.ok(tryGrabBreakable(fighter, game));
  assert.equal(fighter.heldProp, full);
  assert.equal(full.heldBy, fighter);
  assert.equal(full.solid, false);

  assert.ok(throwHeldBreakable(fighter, game));
  assert.equal(game.thrownBreakables.length, 1);
  const thrown = game.thrownBreakables[0];
  thrown.x = 520;
  thrown.y = 200;
  thrown.vx = 0;
  thrown.vy = 800;
  // Platform just under the projectile (same geometry as cover-throw test).
  game.platforms = [{ x: 400, y: 220, w: 200, h: 20 }];
  stepThrownBreakables(game, 1 / 30, () => {});

  assert.equal(game.thrownBreakables.length, 0);
  assert.ok(full.destroyed);
  assert.equal(full.lastDamager, fighter);
  assert.ok(full.lastAward, "thrower receives power-up on shatter");
  assert.ok(game.groundDebris.some((p) => p.sourceType === "powerCrate"));
}

// Full-HP power crate is ignored even when closer than cover.
{
  const cover = {
    kind: "barrel",
    breakable: true,
    solid: true,
    destroyed: false,
    x: 240,
    y: 300,
    w: 34,
    h: 48,
    hp: 40,
    maxHp: 40
  };
  const metal = createPowerCrate({ x: 200, y: 340 }, "yard", "industrial", "pc-near");
  assert.equal(metal.hp, POWER_CRATE_HP);
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROW_BREAKABLE_ID
  });
  fighter.x = 190;
  fighter.y = 300;
  fighter.aim = 0;
  selectWeaponSlot(fighter, "secondaryWeapon");
  const game = {
    props: [cover],
    powerCrates: [metal],
    platforms: [],
    fighters: [fighter],
    effects: [],
    groundDebris: []
  };
  assert.ok(tryGrabBreakable(fighter, game));
  assert.equal(fighter.heldProp, cover, "skips full-HP power crate for cover");
}

console.log("throw-breakable.test.js passed.");
