import assert from "node:assert/strict";
import { Fighter } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, ILLUSIONIST_ID, TRAPPER_ID
} from "./equipment.js";
import {
  createFighterIllusion, isIllusionFighter, tryIllusionistPlant
} from "./illusionist.js";
import { RED_BARREL_BLAST_DAMAGE, RED_BARREL_BLAST_RADIUS } from "./explosive-barrel.js";
import {
  applyTrapLockToIntent, BEAR_TRAP_DAMAGE, BEAR_TRAP_LOCK,
  BEAR_TRAP_SHIELD_DAMAGE_MULT, BEAR_TRAP_SHIELD_LOCK_MULT, cycleTrapperType,
  FAKE_PLATFORM_DAMAGE, inSignalTripwireReveal, isTrapLocked, isTrapper,
  LAND_MINE_BLAST_DAMAGE, LAND_MINE_BLAST_RADIUS, LAND_MINE_W, listTrapperTraps,
  SIGNAL_TRIPWIRE_REVEAL, SIGNAL_TRIPWIRE_SNARE, SPRING_PAD_DAMAGE,
  SPRING_PAD_USES, tickTrapperFighter, tickTrapperWorld, TRAP_TYPES,
  TRAPPER_ARM_TIME, TRAPPER_COOLDOWN, tryTrapperPlant
} from "./trapper.js";
import { visibleToTeam } from "./vision.js";

assert.equal(GEAR_BY_ID[TRAPPER_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[TRAPPER_ID].trapper, true);
assert.equal(TRAPPER_ARM_TIME > 0, true);
assert.equal(BEAR_TRAP_LOCK, 5);
assert.equal(BEAR_TRAP_DAMAGE, 25);
assert.equal(FAKE_PLATFORM_DAMAGE, 10);
assert.deepEqual([...TRAP_TYPES], [
  "bear", "fakePlatform", "springPad", "signalTripwire", "landMine"
]);
assert.ok(LAND_MINE_BLAST_DAMAGE < RED_BARREL_BLAST_DAMAGE);
assert.ok(LAND_MINE_BLAST_RADIUS < RED_BARREL_BLAST_RADIUS);
assert.ok(LAND_MINE_W > 28);

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
  assert.equal(cycleTrapperType(fighter), "springPad");
  assert.equal(cycleTrapperType(fighter), "signalTripwire");
  assert.equal(cycleTrapperType(fighter), "landMine");
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
  // Spring pad: 3 uses, launches away from trapper, not spent on first hit.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  owner.trapperType = "springPad";
  const victim = new Fighter({
    x: 300, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true, vx: 0, vy: 0
  });
  const game = { traps: [], effects: [], fighters: [owner, victim] };
  const trap = tryTrapperPlant(owner, game);
  assert.equal(trap.trapType, "springPad");
  assert.equal(trap.usesLeft, SPRING_PAD_USES);
  trap.x = victim.x + 4;
  trap.y = victim.y + 36;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(trap.destroyed, false, "first launch does not spend spring");
  assert.equal(trap.usesLeft, SPRING_PAD_USES - 1);
  assert.ok(victim.hp <= 500 - SPRING_PAD_DAMAGE + 0.001);
  assert.ok(victim.vx > 100, "launched away from trapper to the right");
  assert.equal(victim.grounded, false);

  // Same continuous contact does not burn another use.
  victim.vx = 0;
  tickTrapperWorld(game, 0.05);
  assert.equal(trap.usesLeft, SPRING_PAD_USES - 1, "no re-launch while still on pad");

  // Leave and re-enter to consume remaining uses.
  for (let i = 0; i < SPRING_PAD_USES - 1; i++) {
    victim.x = 900;
    tickTrapperWorld(game, 0.05);
    victim.x = trap.x - 4;
    victim.y = trap.y - 36;
    victim.vx = 0;
    tickTrapperWorld(game, 0.05);
  }
  assert.equal(trap.destroyed, true, "spent after last use");
  assert.equal(trap.usesLeft, 0);
}

{
  // Signal tripwire: snare + team reveal + ping.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  owner.trapperType = "signalTripwire";
  owner.sight = 60;
  owner.directionalSightRange = 0;
  const victim = new Fighter({
    x: 900, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true
  });
  const game = {
    traps: [], effects: [], fighters: [owner, victim], pings: [], props: [],
    beamReveals: []
  };
  const trap = tryTrapperPlant(owner, game);
  assert.equal(trap.trapType, "signalTripwire");
  trap.x = victim.x;
  trap.y = victim.y + 20;
  assert.equal(visibleToTeam(game, owner, victim), false, "out of sight before trip");
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(trap.destroyed, true);
  assert.ok(victim.trapLockT >= SIGNAL_TRIPWIRE_SNARE - 0.01);
  assert.ok(victim.signalRevealT >= SIGNAL_TRIPWIRE_REVEAL - 0.01);
  assert.equal(victim.signalRevealTeam, 0);
  assert.ok(inSignalTripwireReveal(game, 0, victim));
  assert.equal(visibleToTeam(game, owner, victim), true, "signal reveals for team");
  assert.ok(game.pings.length >= 1);
}

{
  // Land mine: splash weaker than barrel; ally immune; spends trap.
  const owner = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  owner.trapperType = "landMine";
  const victim = new Fighter({
    x: 300, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true
  });
  const far = new Fighter({
    x: 900, y: 700, team: 1, hp: 500, maxHp: 500, grounded: true
  });
  const game = { traps: [], effects: [], fighters: [owner, victim, far] };
  const trap = tryTrapperPlant(owner, game);
  assert.equal(trap.trapType, "landMine");
  assert.ok(trap.w > 28);
  trap.x = victim.x + 4;
  trap.y = victim.y + 34;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(trap.destroyed, true);
  assert.ok(victim.hp < 500 - 10, "mine damages nearby foe");
  assert.ok(victim.hp > 500 - LAND_MINE_BLAST_DAMAGE - 1);
  assert.equal(far.hp, 500, "out of blast radius");
  assert.equal(owner.hp, 500, "owner immune to mine splash");
  assert.ok(game.effects.some((e) => e.type === "explosion"));
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
  // Bear trap pops decoys but stays armed (not spent).
  const trapper = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: TRAPPER_ID });
  const illu = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0, hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(illu, Fighter);
  decoy.x = 200;
  decoy.y = 700;
  const game = {
    traps: [], effects: [], fighters: [trapper, illu, decoy], illusions: []
  };
  const trap = tryTrapperPlant(trapper, game);
  trap.x = decoy.x + 4;
  trap.y = decoy.y + 36;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(decoy.dead, true, "decoy popped by bear trap");
  assert.ok(isIllusionFighter(decoy));
  assert.ok(game.effects.some((e) => e.type === "illusionBreak"));
  assert.equal(trap.destroyed, false, "bear trap not spent by illusion");
  assert.equal(trap.triggered, false);
  assert.ok(trap.life > 0);
}

{
  // Fake platform pops prop illusions on contact; trap remains.
  const trapper = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: TRAPPER_ID });
  trapper.trapperType = "fakePlatform";
  const illu = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  illu.illusionistType = "prop";
  const game = {
    traps: [], effects: [], fighters: [trapper, illu], illusions: [], theme: "yard"
  };
  const prop = tryIllusionistPlant(illu, game, Fighter);
  assert.ok(prop);
  const trap = tryTrapperPlant(trapper, game);
  trap.x = prop.x;
  trap.y = prop.y + prop.h - 8;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(prop.destroyed, true, "prop illusion popped by fake platform");
  assert.ok(game.effects.some((e) => e.type === "illusionBreak"));
  assert.equal(trap.destroyed, false, "fake plat not spent by illusion");
}

{
  // Spring pad launches decoys away without killing them (uses a charge).
  const trapper = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: TRAPPER_ID });
  trapper.trapperType = "springPad";
  const illu = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0, hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(illu, Fighter);
  decoy.x = 220;
  decoy.y = 700;
  decoy.vx = 0;
  decoy.vy = 0;
  const game = {
    traps: [], effects: [], fighters: [trapper, illu, decoy], illusions: []
  };
  const trap = tryTrapperPlant(trapper, game);
  trap.x = decoy.x + 4;
  trap.y = decoy.y + 36;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(decoy.dead, false, "spring does not kill decoy");
  assert.ok(decoy.vx > 100, "decoy launched away from trapper");
  assert.equal(trap.destroyed, false, "spring stays armed");
  assert.equal(trap.usesLeft, SPRING_PAD_USES, "illusion launch is free");
}

{
  // Signal tripwire ignores illusions entirely.
  const trapper = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: TRAPPER_ID });
  trapper.trapperType = "signalTripwire";
  const illu = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0, hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(illu, Fighter);
  decoy.x = 230;
  decoy.y = 700;
  const game = {
    traps: [], effects: [], fighters: [trapper, illu, decoy], illusions: [],
    pings: []
  };
  const trap = tryTrapperPlant(trapper, game);
  trap.x = decoy.x;
  trap.y = decoy.y + 20;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(decoy.dead, false, "signal ignores decoy");
  assert.equal(trap.destroyed, false, "signal not spent by decoy");
  assert.equal(trap.triggered, false);
  assert.equal(game.pings.length, 0);
  assert.ok(!(decoy.signalRevealT > 0));
}

{
  // Land mine: illusion contact pops decoy without detonating.
  const trapper = applyLoadout(new Fighter({
    x: 100, y: 700, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, extensionSecondary: TRAPPER_ID });
  trapper.trapperType = "landMine";
  const illu = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0, hp: 500, maxHp: 500
  }), { ...DEFAULT_LOADOUT, extensionSecondary: ILLUSIONIST_ID });
  const decoy = createFighterIllusion(illu, Fighter);
  decoy.x = 240;
  decoy.y = 700;
  const game = {
    traps: [], effects: [], fighters: [trapper, illu, decoy], illusions: []
  };
  const trap = tryTrapperPlant(trapper, game);
  trap.x = decoy.x + 4;
  trap.y = decoy.y + 34;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  assert.equal(decoy.dead, true, "decoy popped by land mine contact");
  assert.equal(trap.destroyed, false, "mine not detonated by illusion");
  assert.equal(trap.triggered, false);
  assert.ok(!game.effects.some((e) => e.type === "explosion"));
}

{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  assert.ok(listTrapperTraps({ traps: [] }).length === 0);
  assert.equal(isTrapper(fighter), true);
}

{
  // Raised shield softens bear trap damage + lock, still spends the trap.
  const owner = applyLoadout(new Fighter({
    x: 200, y: 700, team: 0, aim: 0, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: TRAPPER_ID
  });
  const victim = applyLoadout(new Fighter({
    x: 400, y: 700, team: 1, aim: Math.PI, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    shield: "kinetic-targe"
  });
  victim.shieldRaised = true;
  victim.shieldBroken = false;
  victim.shieldDurability = victim.shieldMaxDurability;
  const beforeShield = victim.shieldDurability;
  const game = { traps: [], effects: [], fighters: [owner, victim] };
  const trap = tryTrapperPlant(owner, game);
  assert.ok(trap);
  trap.x = victim.x + 8;
  trap.y = victim.y + 36;
  tickTrapperWorld(game, TRAPPER_ARM_TIME + 0.01);
  const expectedDmg = BEAR_TRAP_DAMAGE * BEAR_TRAP_SHIELD_DAMAGE_MULT;
  const expectedLock = BEAR_TRAP_LOCK * BEAR_TRAP_SHIELD_LOCK_MULT;
  assert.ok(Math.abs((500 - victim.hp) - expectedDmg) < 0.001);
  assert.ok(Math.abs(victim.trapLockT - expectedLock) < 0.001);
  assert.ok(victim.shieldDurability < beforeShield);
  assert.equal(BEAR_TRAP_SHIELD_DAMAGE_MULT, 0.4);
  assert.equal(BEAR_TRAP_SHIELD_LOCK_MULT, 0.4);
}

console.log("trapper.test.js passed.");
