import assert from "node:assert/strict";
import {
  applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, selectWeaponSlot
} from "./equipment.js";
import { createMapProp, damageProp } from "./maps.js";
import { Fighter, stepFighter } from "./combat.js";
import {
  attackToolSecondary, bindToolHpDamager, bindToolPropDamager, BOLAS_SNARE_ID,
  createToolPickup, FRAG_GRENADE_ID, heldToolIdOf, heldToolUsesOf,
  HOOK_RANGE, HOOK_REEL_ARRIVE, HOOK_REEL_SPEED, HOOKSHOT_WINCH_ID,
  isHookAnchored, maybeDropToolFromBreakable,
  maybeDropToolFromCrate, rollToolUses, seedMapToolPickups, STICKY_CHARGE_ID,
  THROWING_SPEAR_ID, tickToolPickups, tickToolProjectiles,
  TOOL_BREAKABLE_DROP_CHANCE, TOOL_CRATE_DROP_CHANCE, TOOL_DEFS,
  TOOL_SECONDARY_IDS, TOOL_USE_TIERS, tryCollectToolPickup, tryGrabToolPickup
} from "./tool-secondaries.js";

bindToolHpDamager(applyHpDamage);
bindToolPropDamager(damageProp);

for (const id of TOOL_SECONDARY_IDS) {
  assert.ok(GEAR_BY_ID[id], `shop gear missing ${id}`);
  assert.equal(GEAR_BY_ID[id].slot, "secondaryWeapon");
  assert.equal(GEAR_BY_ID[id].toolSecondary, id);
  assert.ok(TOOL_DEFS[id].cd >= 5 && TOOL_DEFS[id].cd <= 10);
}

{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: THROWING_SPEAR_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  assert.equal(fighter.toolSecondary, THROWING_SPEAR_ID);
  fighter.x = 100;
  fighter.y = 100;
  fighter.aim = 0;
  const game = {
    fighters: [fighter],
    props: [],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    toolPickups: [],
    powerCrates: []
  };
  assert.equal(attackToolSecondary(fighter, game), true);
  assert.equal(fighter.toolCd, TOOL_DEFS[THROWING_SPEAR_ID].cd);
  assert.equal(game.toolProjectiles.length, 1);
  assert.equal(game.toolProjectiles[0].kind, "spear");
  assert.equal(attackToolSecondary(fighter, game), false, "cooldown blocks spam");
}

{
  // Ground tools are grab-only — walk-over / tryCollect never takes them.
  const fighter = applyLoadout({}, { ...DEFAULT_LOADOUT });
  fighter.x = 200;
  fighter.y = 200;
  fighter.aim = 0;
  const pickup = createToolPickup(FRAG_GRENADE_ID, 210, 210);
  const game = {
    fighters: [fighter],
    props: [],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    toolPickups: [pickup],
    powerCrates: []
  };
  assert.equal(tryCollectToolPickup(fighter, game), null);
  tickToolPickups(game, 0.05);
  assert.equal(game.toolPickups.length, 1);
  assert.equal(fighter.heldToolPickup, null);

  assert.ok(tryGrabToolPickup(fighter, game, 80));
  assert.equal(heldToolIdOf(fighter), FRAG_GRENADE_ID);
  assert.equal(heldToolUsesOf(fighter), 1);
  assert.equal(game.toolPickups.length, 0);
  assert.ok(attackToolSecondary(fighter, game));
  assert.equal(fighter.heldToolPickup, null);
  assert.equal(game.toolProjectiles[0].kind, "grenade");
  assert.equal(fighter.toolCd || 0, 0, "grabbed packs do not start equipped CD");
}

{
  // Multi-use pack spends charges and keeps the tool until empty.
  assert.deepEqual(TOOL_USE_TIERS, [1, 3, 5, 10]);
  const rolls = new Set();
  for (let i = 0; i < 200; i++) rolls.add(rollToolUses(() => i / 200));
  assert.ok(rolls.has(1) && rolls.has(3) && rolls.has(5) && rolls.has(10));

  const fighter = applyLoadout({}, { ...DEFAULT_LOADOUT });
  fighter.x = 200;
  fighter.y = 200;
  fighter.aim = 0;
  const pack = createToolPickup(HOOKSHOT_WINCH_ID, 210, 210, 3);
  assert.equal(pack.uses, 3);
  assert.equal(pack.maxUses, 3);
  assert.equal(pack.label, "HOOK×3");
  const game = {
    fighters: [fighter],
    props: [createMapProp("crate", 320, 240)],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    toolPickups: [pack],
    powerCrates: []
  };
  assert.ok(tryGrabToolPickup(fighter, game, 80));
  assert.equal(heldToolUsesOf(fighter), 3);
  assert.ok(attackToolSecondary(fighter, game));
  assert.equal(heldToolIdOf(fighter), HOOKSHOT_WINCH_ID);
  assert.equal(heldToolUsesOf(fighter), 2);
  assert.ok(attackToolSecondary(fighter, game));
  assert.equal(heldToolUsesOf(fighter), 1);
  assert.ok(attackToolSecondary(fighter, game));
  assert.equal(fighter.heldToolPickup, null, "empty pack clears the hand");
}

{
  // Equipped tool CD is unaffected by nearby ground pickups (grab-only world).
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: BOLAS_SNARE_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  fighter.toolCd = 4;
  fighter.x = 50;
  fighter.y = 50;
  const game = {
    fighters: [fighter],
    toolPickups: [createToolPickup(BOLAS_SNARE_ID, 55, 55)],
    props: [],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    powerCrates: []
  };
  tickToolPickups(game, 0.05);
  assert.equal(fighter.toolCd, 4);
  assert.equal(game.toolPickups.length, 1);
}

{
  // Hookshot reels the user to the latch point (not cancelled by walk friction).
  assert.ok(HOOK_REEL_SPEED >= 600 && HOOK_REEL_SPEED <= 900, "pull is a deliberate winch");
  assert.ok(HOOK_RANGE >= 600, "hook reach is long");
  const fighter = applyLoadout(new Fighter({
    x: 80, y: 220, team: 0, aim: 0, human: true, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: HOOKSHOT_WINCH_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  const wall = createMapProp("crate", 520, 250);
  const game = {
    fighters: [fighter],
    props: [wall],
    platforms: [{ x: 0, y: 500, w: 900, h: 40 }],
    effects: [],
    toolProjectiles: [],
    toolPickups: [],
    powerCrates: [],
    ceiling: 12
  };
  assert.ok(attackToolSecondary(fighter, game));
  assert.ok(fighter.hookReel, "hook should reel toward cover");
  assert.ok(fighter.hookReel.t >= 0.45, "far latch gets a longer pull window");
  assert.ok(game.effects.some((e) => e.type === "hookLine"));
  const latchX = fighter.hookReel.x;
  const latchY = fighter.hookReel.y;
  const start = fighter.center();
  const startDist = Math.hypot(latchX - start.x, latchY - start.y);
  assert.ok(startDist > 200, "test latch should be meaningfully far");

  const idle = () => ({
    mx: 0, jump: false, jet: false, jetHeld: false,
    attack: false, chuck: false, ejectVacuum: false, dodge: false
  });
  for (let i = 0; i < 180 && fighter.hookReel; i++) {
    stepFighter(fighter, 1 / 60, game, { weapons: {} }, {}, idle);
  }
  const end = fighter.center();
  const endDist = Math.hypot(latchX - end.x, latchY - end.y);
  assert.equal(fighter.hookReel, null, "reel completes");
  assert.ok(fighter.hookHang, "arriving latches into a hang");
  assert.ok(isHookAnchored(fighter));
  assert.ok(
    endDist <= HOOK_REEL_ARRIVE + 8,
    `should arrive near latch (endDist=${endDist.toFixed(1)})`
  );
  assert.ok(fighter.x > 300, "should have traveled toward the wall");

  // Idle hang: no gravity drift while the player stays still.
  const hangX = fighter.x;
  const hangY = fighter.y;
  for (let i = 0; i < 45; i++) {
    stepFighter(fighter, 1 / 60, game, { weapons: {} }, {}, idle);
  }
  assert.ok(fighter.hookHang, "hang holds without input");
  assert.ok(Math.abs(fighter.x - hangX) < 0.5);
  assert.ok(Math.abs(fighter.y - hangY) < 0.5);

  // Move input releases the hang.
  const move = () => ({
    mx: 1, jump: false, jet: false, jetHeld: false,
    attack: false, chuck: false, ejectVacuum: false, dodge: false
  });
  stepFighter(fighter, 1 / 60, game, { weapons: {} }, {}, move);
  assert.equal(fighter.hookHang, null, "move input drops the hang");
}

{
  // Jetpack input also releases a hang.
  const fighter = applyLoadout(new Fighter({
    x: 200, y: 200, team: 0, aim: 0, human: true, hp: 500, maxHp: 500
  }), {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: HOOKSHOT_WINCH_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  fighter.hookHang = { x: 223, y: 223 };
  fighter.vx = 0;
  fighter.vy = 0;
  const game = {
    fighters: [fighter],
    props: [],
    platforms: [{ x: 0, y: 500, w: 900, h: 40 }],
    effects: [],
    toolProjectiles: [],
    toolPickups: [],
    powerCrates: [],
    ceiling: 12
  };
  const jet = () => ({
    mx: 0, jump: false, jet: true, jetHeld: true,
    attack: false, chuck: false, ejectVacuum: false, dodge: false
  });
  stepFighter(fighter, 1 / 60, game, { weapons: {} }, {}, jet);
  assert.equal(fighter.hookHang, null, "jetpack input drops the hang");
}

{
  // Sticky sticks then blasts.
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: STICKY_CHARGE_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  fighter.x = 100;
  fighter.y = 100;
  fighter.aim = 0;
  const game = {
    fighters: [fighter],
    props: [createMapProp("crate", 180, 140)],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    toolPickups: [],
    powerCrates: []
  };
  attackToolSecondary(fighter, game);
  // Advance until fuse ends.
  for (let i = 0; i < 90; i++) tickToolProjectiles(game, 1 / 30);
  assert.ok(game.effects.some((e) => e.type === "explosion"));
}

{
  // Crate / breakable / metal box destroy can drop multi-use tool packs.
  const crate = createMapProp("crate", 400, 400);
  const game = { effects: [], toolPickups: [], groundDebris: [], props: [crate] };
  let drops = 0;
  for (let i = 0; i < 80; i++) {
    const c = createMapProp("crate", 400, 400);
    maybeDropToolFromCrate(c, game, 410, 390, () => 0); // always roll succeed
    drops++;
  }
  assert.equal(game.toolPickups.length, drops);
  assert.ok(game.toolPickups.every((p) => TOOL_USE_TIERS.includes(p.uses)));
  assert.ok(TOOL_CRATE_DROP_CHANCE > 0);
  assert.ok(TOOL_BREAKABLE_DROP_CHANCE > 0);
  // Random gate: high roll skips.
  const before = game.toolPickups.length;
  maybeDropToolFromCrate(crate, game, 410, 390, () => 0.99);
  assert.equal(game.toolPickups.length, before);

  // Non-crate breakables also drop.
  const barrel = createMapProp("barrel", 200, 200);
  const beforeBarrel = game.toolPickups.length;
  maybeDropToolFromBreakable(barrel, game, 210, 190, () => 0);
  assert.equal(game.toolPickups.length, beforeBarrel + 1);

  // Metal power crates drop too.
  const metal = {
    powerCrate: true,
    kind: "powerCrate",
    breakable: true,
    x: 100,
    y: 100,
    w: 40,
    h: 40
  };
  const beforeMetal = game.toolPickups.length;
  maybeDropToolFromBreakable(metal, game, 120, 120, () => 0);
  assert.equal(game.toolPickups.length, beforeMetal + 1);
}

{
  const game = {
    platforms: [
      { x: 0, y: 400, w: 500, h: 24 },
      { x: 600, y: 300, w: 400, h: 24 }
    ],
    toolPickups: []
  };
  seedMapToolPickups(game, () => 0.25);
  assert.ok(game.toolPickups.length >= 2);
  tickToolPickups(game, 50);
  assert.ok(game.toolPickups.every((p) => p.life < 45));
}

console.log("tool-secondaries.test.js passed.");
