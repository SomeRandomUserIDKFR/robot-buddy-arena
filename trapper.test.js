import assert from "node:assert/strict";
import { Fighter } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, TRAPPER_ID
} from "./equipment.js";
import {
  applyTrapLockToIntent, BEAR_TRAP_DAMAGE, BEAR_TRAP_LOCK, cycleTrapperType,
  FAKE_PLATFORM_DAMAGE, isTrapLocked, isTrapper, listTrapperTraps,
  tickTrapperFighter, tickTrapperWorld, TRAPPER_ARM_TIME, TRAPPER_COOLDOWN,
  tryTrapperPlant
} from "./trapper.js";

assert.equal(GEAR_BY_ID[TRAPPER_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[TRAPPER_ID].trapper, true);
assert.equal(TRAPPER_ARM_TIME > 0, true);
assert.equal(BEAR_TRAP_LOCK, 5);
assert.equal(BEAR_TRAP_DAMAGE, 25);
assert.equal(FAKE_PLATFORM_DAMAGE, 10);

{
  const fighter = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, grounded: true
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  assert.ok(isTrapper(fighter));
  assert.equal(fighter.trapperType, "bear");
  assert.equal(cycleTrapperType(fighter), "fakePlatform");
  assert.equal(cycleTrapperType(fighter), "bear");

  const game = { traps: [], effects: [], fighters: [fighter] };
  const trap = tryTrapperPlant(fighter, game);
  assert.ok(trap);
  assert.equal(trap.trapType, "bear");
  assert.equal(trap.armed, false);
  assert.ok(trap.armT > 0);
  assert.ok(fighter.trapperCd > 0);
  assert.equal(tryTrapperPlant(fighter, game), null, "cooldown gates plant");
}

{
  // Arm time then bear trigger — owner immune, enemy locked.
  const owner = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  const victim = new Fighter({
    x: 480, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true
  });
  const game = { traps: [], effects: [], fighters: [owner, victim] };
  const trap = tryTrapperPlant(owner, game);
  assert.ok(trap);
  // Place trap under the victim.
  trap.x = victim.x + 8;
  trap.y = victim.y + 36;

  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(trap.armed, true);
  assert.equal(victim.trapLockT > 0, true);
  assert.ok(victim.hp <= 500 - BEAR_TRAP_DAMAGE + 0.001);
  assert.ok(isTrapLocked(victim));

  // Owner standing on own trap does nothing after re-plant.
  tickTrapperFighter(owner, TRAPPER_COOLDOWN + 0.01);
  owner.trapperType = "bear";
  const trap2 = tryTrapperPlant(owner, game);
  trap2.x = owner.x + 4;
  trap2.y = owner.y + 36;
  const hpOwner = owner.hp;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(owner.hp, hpOwner, "owner immune to own bear trap");
  assert.equal(isTrapLocked(owner), false);
}

{
  // Fake platform: fall-through damage once; no collision implied (not in platforms).
  const owner = applyLoadout(new Fighter({
    x: 200, y: 500, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  owner.trapperType = "fakePlatform";
  const victim = new Fighter({
    x: 280, y: 400, team: 1, hp: 500, maxHp: 500, vy: 200, grounded: false
  });
  const game = { traps: [], effects: [], fighters: [owner, victim], platforms: [] };
  const trap = tryTrapperPlant(owner, game);
  assert.equal(trap.trapType, "fakePlatform");
  trap.x = 260;
  trap.y = 450;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(trap.armed, true);

  const oldY = 420;
  victim.y = 430;
  victim.vy = 300;
  const prev = new Map([[victim, oldY]]);
  // feet: old 466, new 476; trap top 450 — need wasAbove then through
  victim.y = 450 - 46 + 10; // SIZE=46 → feet near trap
  const prev2 = new Map([[victim, 450 - 46 - 5]]);
  tickTrapperWorld(game, 0.05, prev2);
  assert.ok(victim.hp <= 500 - FAKE_PLATFORM_DAMAGE + 0.001);
  const hpAfter = victim.hp;
  tickTrapperWorld(game, 0.05, prev2);
  assert.equal(victim.hp, hpAfter, "fake platform damages once per victim");
}

{
  // Mobility lock strips jump/jet/dodge.
  const fighter = new Fighter({ x: 0, y: 0, trapLockT: 2 });
  const intent = applyTrapLockToIntent(fighter, {
    mx: 1, jump: true, jet: true, jetHeld: true, dodge: true, attack: true
  });
  assert.equal(intent.jump, false);
  assert.equal(intent.jet, false);
  assert.equal(intent.dodge, false);
  assert.ok(Math.abs(intent.mx) < 1);
  assert.equal(intent.attack, true);
}

{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  assert.ok(listTrapperTraps({ traps: [] }).length === 0);
  assert.equal(isTrapper(fighter), true);
}

console.log("trapper.test.js passed.");
