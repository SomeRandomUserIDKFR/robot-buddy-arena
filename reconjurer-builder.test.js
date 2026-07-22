import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  applyLoadout, DEFAULT_LOADOUT, ensureEquipmentProfile, equipOwned, GEAR_BY_ID,
  MATERIAL_CONSUMER_BOTS_PER_PIECE, MATERIAL_CONSUMER_ID, NO_EXTENSION_ID,
  NO_SECONDARY_ID, RECONJURER_BUILDER_ID, selectWeaponSlot, SLOT_LABELS, SLOT_ORDER,
  STARTER_GEAR
} from "./equipment.js";
import {
  hasExtensionSecondary, isReconjurerBuilder, RECONJURER_BOT_COST,
  RECONJURER_COOLDOWN, RECONJURER_METAL_SCRAP_COST, RECONJURER_SCRAP_COST,
  tryReconjurerBuild, tickReconjurerBuilder
} from "./reconjurer-builder.js";

const clone = (value) => structuredClone(value);

assert.ok(SLOT_ORDER.includes("extensionSecondary"));
assert.equal(SLOT_LABELS.extensionSecondary, "Extension");
assert.ok(STARTER_GEAR.includes(NO_EXTENSION_ID));
assert.equal(DEFAULT_LOADOUT.extensionSecondary, NO_EXTENSION_ID);
assert.equal(GEAR_BY_ID[RECONJURER_BUILDER_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[RECONJURER_BUILDER_ID].reconjurerBuilder, true);
assert.equal(RECONJURER_SCRAP_COST, 1);
assert.equal(RECONJURER_METAL_SCRAP_COST, 2);
assert.equal(RECONJURER_BOT_COST, MATERIAL_CONSUMER_BOTS_PER_PIECE);

// Profile migration fills extension slot; equip does not steal 1/2 secondary.
{
  const profile = clone(DEFAULT_PROFILE);
  delete profile.equipment.player.extensionSecondary;
  ensureEquipmentProfile(profile, profile);
  assert.equal(profile.equipment.player.extensionSecondary, NO_EXTENSION_ID);
  assert.ok(profile.equipment.owned.includes(NO_EXTENSION_ID));

  profile.equipment.owned.push(MATERIAL_CONSUMER_ID, RECONJURER_BUILDER_ID);
  assert.ok(equipOwned(profile, "player", "secondaryWeapon", MATERIAL_CONSUMER_ID));
  assert.ok(equipOwned(profile, "player", "extensionSecondary", RECONJURER_BUILDER_ID));
  assert.equal(profile.equipment.player.secondaryWeapon, MATERIAL_CONSUMER_ID);
  assert.equal(profile.equipment.player.extensionSecondary, RECONJURER_BUILDER_ID);

  const fighter = applyLoadout({}, profile.equipment.player);
  assert.equal(fighter.reconjurerBuilder, true);
  assert.ok(isReconjurerBuilder(fighter));
  assert.ok(hasExtensionSecondary(fighter));
  assert.equal(fighter.materialConsumer, false);
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  assert.equal(fighter.weaponId, MATERIAL_CONSUMER_ID);
  assert.equal(fighter.reconjurerBuilder, true, "extension survives 1/2 swap");
}

// Tank scraps pay first; bots untouched.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 400;
  fighter.y = 300;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [
    { bots: 0, ejection: true, color: "#aaa", w: 8, h: 8 }
  ];
  const game = {
    elapsed: 1,
    mapId: "yard",
    theme: "industrial",
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 420, w: 3600, h: 40 }],
    effects: []
  };
  const freeBefore = fighter.nanobotFree;
  const spawned = tryReconjurerBuild(fighter, game, () => 0.99);
  assert.ok(spawned, "spawned a breakable");
  assert.ok(!spawned.powerCrate, "forced non-metal with high roll");
  assert.equal(fighter.materialEjectionTank.length, 0);
  assert.equal(fighter.nanobotFree, freeBefore, "tank paid, bots untouched");
  assert.equal(game.props.length, 1);
  assert.ok(fighter.reconjurerCd > 0);
}

// Empty tank spends nanobots; cooldown blocks spam.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 500;
  fighter.y = 280;
  fighter.aim = -0.2;
  fighter.nanobotFree = 20;
  fighter.materialEjectionTank = [];
  const game = {
    elapsed: 2,
    mapId: "yard",
    theme: "industrial",
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 400, w: 3600, h: 40 }],
    effects: []
  };
  const spawned = tryReconjurerBuild(fighter, game, () => 0.99);
  assert.ok(spawned);
  assert.equal(fighter.nanobotFree, 20 - RECONJURER_BOT_COST);
  assert.equal(tryReconjurerBuild(fighter, game, () => 0.99), null, "on cooldown");
  tickReconjurerBuilder(fighter, RECONJURER_COOLDOWN + 0.01);
  assert.equal(fighter.reconjurerCd, 0);
}

// Broke: no tank scraps and not enough bots → no spawn.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  fighter.x = 200;
  fighter.y = 200;
  fighter.aim = 0;
  fighter.nanobotFree = 0;
  fighter.nanobotMax = 0;
  fighter.materialEjectionTank = [];
  const game = {
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 300, w: 800, h: 40 }],
    effects: []
  };
  assert.equal(tryReconjurerBuild(fighter, game), null);
  assert.equal(game.props.length, 0);
}

// Low roll can spawn a metal power crate (costs 2 scrap units).
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 600;
  fighter.y = 300;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [
    { bots: 0, ejection: true, color: "#aaa", w: 8, h: 8 },
    { bots: 0, ejection: true, color: "#bbb", w: 8, h: 8 }
  ];
  const game = {
    elapsed: 3,
    mapId: "yard",
    theme: "industrial",
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 420, w: 3600, h: 40 }],
    effects: []
  };
  const spawned = tryReconjurerBuild(fighter, game, () => 0.01);
  assert.ok(spawned?.powerCrate, "metal box on low roll");
  assert.equal(game.powerCrates.length, 1);
  assert.equal(fighter.materialEjectionTank.length, 0, "spent 2 tank scraps");
  assert.equal(fighter.nanobotFree, 40);
}

// Without extension equipped, key-3 path is a no-op.
{
  const fighter = applyLoadout({}, DEFAULT_LOADOUT);
  assert.equal(fighter.reconjurerBuilder, false);
  assert.equal(isReconjurerBuilder(fighter), false);
  assert.equal(tryReconjurerBuild(fighter, { props: [], powerCrates: [] }), null);
}

console.log("reconjurer-builder.test.js passed.");
