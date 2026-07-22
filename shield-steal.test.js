import assert from "node:assert/strict";
import { Fighter, stepFighter } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, selectWeaponSlot, SHIELD_STEAL_ID
} from "./equipment.js";
import {
  findShieldStealTarget, isShieldSteal, SHIELD_STEAL_DRAIN_PER_SEC,
  SHIELD_STEAL_RANGE, SHIELD_STEAL_TRANSFER, tickShieldStealBeam
} from "./shield-steal.js";
import { updateAiShieldSteal } from "./ai.js";

assert.equal(GEAR_BY_ID[SHIELD_STEAL_ID].slot, "secondaryWeapon");
assert.equal(GEAR_BY_ID[SHIELD_STEAL_ID].shieldSteal, true);
assert.ok(GEAR_BY_ID[SHIELD_STEAL_ID].price > 160);
assert.ok(GEAR_BY_ID[SHIELD_STEAL_ID].price < 220);
assert.equal(SHIELD_STEAL_RANGE, 160);
assert.equal(SHIELD_STEAL_DRAIN_PER_SEC, 90);
assert.equal(SHIELD_STEAL_TRANSFER, 0.55);

{
  const stealer = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, name: "YOU", color: "#fff",
    hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: SHIELD_STEAL_ID,
    shield: "kinetic-targe",
    weapon: "pulse-rifle"
  });
  assert.ok(selectWeaponSlot(stealer, "secondaryWeapon"));
  assert.ok(isShieldSteal(stealer));
  assert.ok(stealer.shieldMaxDurability > 0);
  stealer.shieldDurability = 40;

  const victim = applyLoadout(new Fighter({
    x: 520, y: 700, team: 1, aim: Math.PI, name: "E", color: "#f00",
    hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    shield: "kinetic-targe"
  });
  victim.shieldRaised = true;
  victim.shieldBroken = false;
  victim.shieldDurability = 200;
  victim.shieldMaxDurability = 320;

  const game = {
    fighters: [stealer, victim],
    effects: [],
    bullets: [],
    platforms: []
  };

  assert.equal(findShieldStealTarget(stealer, game), victim);

  const beforeV = victim.shieldDurability;
  const beforeS = stealer.shieldDurability;
  const result = tickShieldStealBeam(stealer, game, 0.2);
  assert.ok(result);
  assert.ok(victim.shieldDurability < beforeV);
  assert.ok(stealer.shieldDurability > beforeS);
  const drained = beforeV - victim.shieldDurability;
  const gained = stealer.shieldDurability - beforeS;
  assert.ok(Math.abs(gained - drained * SHIELD_STEAL_TRANSFER) < 0.001);
}

{
  // Lowered shield = no steal.
  const stealer = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: SHIELD_STEAL_ID,
    shield: "light-buckler"
  });
  selectWeaponSlot(stealer, "secondaryWeapon");
  const victim = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: Math.PI
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  victim.shieldRaised = false;
  victim.shieldDurability = 100;
  const game = { fighters: [stealer, victim], effects: [] };
  assert.equal(findShieldStealTarget(stealer, game), null);
  assert.equal(tickShieldStealBeam(stealer, game, 0.2), null);
}

{
  // Facing away = no steal.
  const stealer = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: SHIELD_STEAL_ID,
    shield: "light-buckler"
  });
  selectWeaponSlot(stealer, "secondaryWeapon");
  const victim = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: 0
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  victim.shieldRaised = true;
  victim.shieldDurability = 100;
  const game = { fighters: [stealer, victim], effects: [] };
  assert.equal(findShieldStealTarget(stealer, game), null);
}

{
  // Hold-fire via stepFighter drains over time; breaking drops the raise.
  const stealer = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, aim: 0, human: true
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: SHIELD_STEAL_ID,
    shield: "kinetic-targe"
  });
  selectWeaponSlot(stealer, "secondaryWeapon");
  stealer.shieldDurability = 10;
  const victim = applyLoadout(new Fighter({
    x: 500, y: 700, team: 1, aim: Math.PI
  }), { ...DEFAULT_LOADOUT, shield: "light-buckler" });
  victim.shieldRaised = true;
  victim.shieldDurability = 20;
  victim.shieldMaxDurability = 175;
  const game = {
    fighters: [stealer, victim],
    effects: [],
    bullets: [],
    platforms: [],
    ceiling: 12
  };
  const intent = () => ({
    mx: 0, jump: false, jet: false, jetHeld: false,
    attack: true, chuck: false, ejectVacuum: false, dodge: false
  });
  for (let i = 0; i < 30; i++) {
    stepFighter(stealer, 1 / 30, game, { weapons: {} }, {}, intent);
  }
  assert.ok(victim.shieldDurability < 20 || victim.shieldBroken);
  if (victim.shieldBroken) assert.equal(victim.shieldRaised, false);
}

{
  // AI aims and holds fire on a raised shield.
  const buddy = applyLoadout(new Fighter({
    x: 500, y: 700, team: 0, buddy: true, ai: "balanced", aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: SHIELD_STEAL_ID,
    shield: "kinetic-targe"
  });
  selectWeaponSlot(buddy, "secondaryWeapon");
  const enemy = applyLoadout(new Fighter({
    x: 620, y: 700, team: 1, aim: Math.PI
  }), { ...DEFAULT_LOADOUT, shield: "kinetic-targe" });
  enemy.shieldRaised = true;
  enemy.shieldDurability = 200;
  const state = { plan: "idle", desiredAim: null, attack: false };
  updateAiShieldSteal(buddy, state, { fighters: [buddy, enemy] }, [enemy], enemy);
  assert.equal(state.plan, "stealing shield");
  assert.equal(state.attack, true);
}

console.log("shield-steal.test.js passed.");
