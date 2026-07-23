import assert from "node:assert/strict";
import {
  applyHpDamage, applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, selectWeaponSlot
} from "./equipment.js";
import { createMapProp, damageProp } from "./maps.js";
import {
  attackToolSecondary, bindToolHpDamager, bindToolPropDamager, BOLAS_SNARE_ID,
  createToolPickup, FRAG_GRENADE_ID, HOOKSHOT_WINCH_ID, maybeDropToolFromCrate,
  seedMapToolPickups, STICKY_CHARGE_ID, THROWING_SPEAR_ID, tickToolPickups,
  tickToolProjectiles, TOOL_CRATE_DROP_CHANCE, TOOL_DEFS, TOOL_SECONDARY_IDS,
  tryCollectToolPickup, tryGrabToolPickup
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
  assert.equal(fighter.heldToolPickup, FRAG_GRENADE_ID);
  assert.equal(game.toolPickups.length, 0);
  assert.ok(attackToolSecondary(fighter, game));
  assert.equal(fighter.heldToolPickup, null);
  assert.equal(game.toolProjectiles[0].kind, "grenade");
  assert.equal(fighter.toolCd || 0, 0, "grabbed one-shots do not start equipped CD");
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
  // Hookshot reels the user toward solid cover.
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: HOOKSHOT_WINCH_ID
  });
  selectWeaponSlot(fighter, "secondaryWeapon");
  fighter.x = 100;
  fighter.y = 200;
  fighter.aim = 0;
  const wall = createMapProp("crate", 320, 240);
  const game = {
    fighters: [fighter],
    props: [wall],
    platforms: [],
    effects: [],
    toolProjectiles: [],
    toolPickups: [],
    powerCrates: []
  };
  assert.ok(attackToolSecondary(fighter, game));
  assert.ok(fighter.hookReel, "hook should reel toward cover");
  assert.ok(game.effects.some((e) => e.type === "hookLine"));
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
  // Crate destroy can drop a tool.
  const crate = createMapProp("crate", 400, 400);
  const game = { effects: [], toolPickups: [], groundDebris: [], props: [crate] };
  let drops = 0;
  for (let i = 0; i < 80; i++) {
    const c = createMapProp("crate", 400, 400);
    maybeDropToolFromCrate(c, game, 410, 390, () => 0); // always roll succeed
    drops++;
  }
  assert.equal(game.toolPickups.length, drops);
  assert.ok(TOOL_CRATE_DROP_CHANCE > 0);
  // Random gate: high roll skips.
  const before = game.toolPickups.length;
  maybeDropToolFromCrate(crate, game, 410, 390, () => 0.99);
  assert.equal(game.toolPickups.length, before);
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
