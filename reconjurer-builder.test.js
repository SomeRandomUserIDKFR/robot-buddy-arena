import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  applyLoadout, DEFAULT_LOADOUT, ensureEquipmentProfile, equipOwned, GEAR_BY_ID,
  MATERIAL_CONSUMER_ID, NO_EXTENSION_ID, RECONJURER_BUILDER_ID, selectWeaponSlot,
  SLOT_LABELS, SLOT_ORDER, STARTER_GEAR
} from "./equipment.js";
import { spawnPropDebris, spawnPowerCrateDebris } from "./debris.js";
import { createMapRuntime, damageProp } from "./maps.js";
import { createPowerCrate, damagePowerCrate, POWER_CRATE_HP } from "./powerups.js";
import {
  applyBraceCasing, braceMaterialFor, canBraceBreakable, cycleReconjurerType,
  findBraceTarget, hasExtensionSecondary, isReconjurerBuilder,
  listReconjurerChoices, paintReconjurerPreview, RECONJURER_BOT_COST,
  RECONJURER_BRACE_BOT_COST, RECONJURER_BRACE_HP, RECONJURER_COOLDOWN,
  RECONJURER_METAL_BOT_COST, RECONJURER_METAL_COOLDOWN, RECONJURER_METAL_TYPE,
  RECONJURER_SCRAP_REWARD, reconjurerTypeLabel, tryReconjurerBuild,
  tickReconjurerBuilder
} from "./reconjurer-builder.js";

const clone = (value) => structuredClone(value);

assert.ok(SLOT_ORDER.includes("extensionSecondary"));
assert.equal(SLOT_LABELS.extensionSecondary, "Extension");
assert.ok(STARTER_GEAR.includes(NO_EXTENSION_ID));
assert.equal(GEAR_BY_ID[RECONJURER_BUILDER_ID].reconjurerBuilder, true);
assert.equal(RECONJURER_SCRAP_REWARD, 2);
assert.equal(RECONJURER_METAL_COOLDOWN, 10);

{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  profile.equipment.owned.push(MATERIAL_CONSUMER_ID, RECONJURER_BUILDER_ID);
  assert.ok(equipOwned(profile, "player", "secondaryWeapon", MATERIAL_CONSUMER_ID));
  assert.ok(equipOwned(profile, "player", "extensionSecondary", RECONJURER_BUILDER_ID));
  const fighter = applyLoadout({}, profile.equipment.player);
  assert.ok(isReconjurerBuilder(fighter));
  assert.ok(hasExtensionSecondary(fighter));
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  assert.equal(fighter.reconjurerBuilder, true);
}

// Press 3 near prop debris: rebuilds that prop for free and grants +2 scraps.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  assert.ok(crate);
  crate.destroyed = true;
  crate.solid = false;
  crate.hp = 0;
  crate.groundDebrisDropped = false;

  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  fighter.x = crate.x - 10;
  fighter.y = crate.y;
  fighter.aim = 0;
  fighter.materialEjectionTank = [];

  const game = {
    props: yard.props,
    powerCrates: [],
    platforms: yard.platforms,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    mapId: "yard",
    theme: "industrial"
  };
  spawnPropDebris(game, crate, crate.x + crate.w / 2, crate.y + crate.h / 2);
  assert.ok(game.groundDebris.length > 0);

  const botsBefore = fighter.nanobotFree || 0;
  const restored = tryReconjurerBuild(fighter, game);
  assert.ok(restored);
  assert.equal(restored, crate);
  assert.equal(crate.destroyed, false);
  assert.ok(crate.hp > 0);
  assert.equal(game.groundDebris.length, 0, "debris consumed on rebuild");
  assert.equal(fighter.nanobotFree || 0, botsBefore, "rebuild is free");
  assert.equal(fighter.materialEjectionTank.length, RECONJURER_SCRAP_REWARD);
  assert.ok(fighter.reconjurerCd > 0);
}

// No nearby debris → paid selected conjure (bots), still +2 scraps.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 100;
  fighter.y = 100;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [];
  fighter.reconjurerType = "crate";
  const game = {
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 200, w: 800, h: 40 }],
    groundDebris: [],
    effects: [],
    mapId: "yard",
    theme: "industrial",
    elapsed: 1
  };
  const spawned = tryReconjurerBuild(fighter, game, () => 0.5);
  assert.ok(spawned);
  assert.ok(!spawned.powerCrate, "selected crate is a normal breakable");
  assert.equal(spawned.kind, "crate");
  assert.equal(game.props.length, 1);
  assert.equal(fighter.nanobotFree, 40 - RECONJURER_BOT_COST);
  assert.equal(fighter.materialEjectionTank.length, RECONJURER_SCRAP_REWARD);
}

// No debris + broke (no bots) → no-op.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  fighter.x = 100;
  fighter.y = 100;
  fighter.nanobotFree = 0;
  fighter.nanobotMax = 0;
  const game = {
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 200, w: 800, h: 40 }],
    groundDebris: [],
    effects: []
  };
  assert.equal(tryReconjurerBuild(fighter, game, () => 0.99), null);
}

// No debris + metal selected conjures metal when CD ready (costs metal bot fee).
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 300;
  fighter.y = 200;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [];
  fighter.reconjurerMetalCd = 0;
  fighter.reconjurerType = RECONJURER_METAL_TYPE;
  const game = {
    props: [],
    powerCrates: [],
    platforms: [{ x: 0, y: 300, w: 800, h: 40 }],
    groundDebris: [],
    effects: [],
    mapId: "yard",
    theme: "industrial",
    elapsed: 2
  };
  const spawned = tryReconjurerBuild(fighter, game, () => 0.5);
  assert.ok(spawned?.powerCrate);
  assert.equal(game.powerCrates.length, 1);
  assert.equal(fighter.nanobotFree, 40 - RECONJURER_METAL_BOT_COST);
  assert.ok(Math.abs(fighter.reconjurerMetalCd - RECONJURER_METAL_COOLDOWN) < 0.001);
}

// T cycles theme pool + metal; preview paint is a no-throw.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  const game = { theme: "industrial", mapId: "yard" };
  const choices = listReconjurerChoices(game);
  assert.ok(choices.includes("crate"));
  assert.ok(choices.includes(RECONJURER_METAL_TYPE));
  fighter.reconjurerType = choices[0];
  const next = cycleReconjurerType(fighter, game);
  assert.equal(next, choices[1]);
  assert.equal(reconjurerTypeLabel(RECONJURER_METAL_TYPE), "METAL");
  // Node canvas may be unavailable — paint no-ops without a real context.
  const fake = {
    width: 104,
    height: 104,
    getContext: () => ({
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      ellipse() {},
      fill() {},
      stroke() {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1
    })
  };
  paintReconjurerPreview(fake, "crate", game);
  paintReconjurerPreview(fake, RECONJURER_METAL_TYPE, game);
}

// Metal box debris rebuild uses the 10s user CD.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  const crate = createPowerCrate({ x: 400, y: 400 }, "yard", "industrial", "pc-rj");
  crate.destroyed = true;
  crate.solid = false;
  crate.hp = 0;
  crate.groundDebrisDropped = false;
  fighter.x = crate.x;
  fighter.y = crate.y;
  fighter.materialEjectionTank = [];
  fighter.reconjurerMetalCd = 0;

  const game = {
    props: [],
    powerCrates: [crate],
    platforms: [{ x: 0, y: 400, w: 800, h: 40 }],
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    powerCrateState: { pending: [{ spawnKey: crate.spawnKey, readyAt: 99 }], spawnIndex: 0 },
    mapId: "yard",
    theme: "industrial"
  };
  spawnPowerCrateDebris(game, crate);
  assert.ok(game.groundDebris.every((p) => p.sourceType === "powerCrate"));

  const restored = tryReconjurerBuild(fighter, game);
  assert.ok(restored?.powerCrate);
  assert.equal(crate.destroyed, false);
  assert.equal(crate.hp, POWER_CRATE_HP);
  assert.equal(game.groundDebris.length, 0);
  assert.equal(fighter.materialEjectionTank.length, RECONJURER_SCRAP_REWARD);
  assert.ok(Math.abs(fighter.reconjurerMetalCd - RECONJURER_METAL_COOLDOWN) < 0.001);
  assert.equal(game.powerCrateState.pending.length, 0, "pending respawn cancelled");

  // Second metal pile while CD hot: skipped; nearby prop debris still rebuilds.
  tickReconjurerBuilder(fighter, RECONJURER_COOLDOWN + 0.01);
  const crate2 = createPowerCrate({ x: 420, y: 400 }, "yard", "industrial", "pc-rj-2");
  crate2.destroyed = true;
  crate2.hp = 0;
  crate2.groundDebrisDropped = false;
  game.powerCrates.push(crate2);
  spawnPowerCrateDebris(game, crate2);

  const barrel = {
    kind: "barrel",
    breakable: true,
    destroyed: true,
    solid: false,
    x: fighter.x + 20,
    y: fighter.y,
    w: 34,
    h: 48,
    hp: 0,
    maxHp: 40,
    groundDebrisDropped: false,
    baseSolid: true,
    baseBlocksProjectiles: true,
    baseBlocksSight: false
  };
  game.props.push(barrel);
  spawnPropDebris(game, barrel, barrel.x + 17, barrel.y + 24);

  const again = tryReconjurerBuild(fighter, game);
  assert.ok(again);
  assert.equal(again, barrel, "skips metal-on-CD, rebuilds prop debris");
  assert.equal(crate2.destroyed, true, "metal still broken during CD");
  assert.ok(game.groundDebris.some((p) => p.sourceType === "powerCrate"));
}

// Metal CD ticks down for the user.
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID
  });
  fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN;
  tickReconjurerBuilder(fighter, 4);
  assert.ok(Math.abs(fighter.reconjurerMetalCd - 6) < 0.001);
  tickReconjurerBuilder(fighter, 7);
  assert.equal(fighter.reconjurerMetalCd, 0);
}


assert.equal(RECONJURER_BRACE_HP, 48);
assert.equal(RECONJURER_BRACE_BOT_COST, RECONJURER_BOT_COST);

// Near intact cover (no debris): Patching / Bracing welds a metal casing.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate" && !p.destroyed);
  assert.ok(crate);
  const startHp = crate.hp;
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = crate.x - 20;
  fighter.y = crate.y;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [];
  const game = {
    props: yard.props,
    powerCrates: [],
    platforms: yard.platforms,
    groundDebris: [],
    effects: [],
    mapId: "yard",
    theme: "industrial"
  };
  assert.ok(canBraceBreakable(crate));
  assert.equal(findBraceTarget(game, fighter), crate);
  const botsBefore = fighter.nanobotFree;
  const braced = tryReconjurerBuild(fighter, game);
  assert.ok(braced);
  assert.equal(braced, crate);
  assert.equal(crate.braced, true);
  assert.equal(crate.braceMaterial, "metal");
  assert.equal(crate.braceHp, RECONJURER_BRACE_HP);
  assert.equal(crate.hp, startHp, "core HP unchanged by bracing");
  assert.equal(fighter.nanobotFree, botsBefore - RECONJURER_BRACE_BOT_COST);
  assert.equal(fighter.materialEjectionTank.length, RECONJURER_SCRAP_REWARD);
  assert.equal(fighter.reconjurerMetalCd || 0, 0, "brace does not start metal CD");
  assert.ok(fighter.reconjurerCd > 0);

  // Already braced → falls through to conjure (no second casing).
  // Isolate so other yard props aren't also brace targets.
  game.props = [crate];
  tickReconjurerBuilder(fighter, RECONJURER_COOLDOWN + 0.01);
  fighter.nanobotFree = 40;
  fighter.reconjurerType = "barrel";
  const propsBefore = game.props.length;
  const conjured = tryReconjurerBuild(fighter, game, () => 0.5);
  assert.ok(conjured);
  assert.notEqual(conjured, crate);
  assert.equal(game.props.length, propsBefore + 1);
}

// Intact cover + nearby scrap: brace wins (debris must not steal the press).
{
  const yard = createMapRuntime("yard");
  const intact = yard.props.find((p) => p.kind === "crate" && !p.destroyed);
  assert.ok(intact);
  const scrap = yard.props.find(
    (p) => p !== intact && p.kind === "crate" && !p.destroyed
  ) || {
    kind: "crate",
    breakable: true,
    destroyed: false,
    solid: true,
    x: intact.x + 80,
    y: intact.y,
    w: 40,
    h: 40,
    hp: 40,
    maxHp: 40,
    groundDebrisDropped: false,
    baseSolid: true,
    baseBlocksProjectiles: true,
    baseBlocksSight: false
  };
  if (!yard.props.includes(scrap)) yard.props.push(scrap);
  scrap.destroyed = true;
  scrap.solid = false;
  scrap.hp = 0;
  scrap.groundDebrisDropped = false;

  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = intact.x - 10;
  fighter.y = intact.y;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [];
  fighter.reconjurerType = RECONJURER_METAL_TYPE;
  fighter.reconjurerMetalCd = RECONJURER_METAL_COOLDOWN; // metal CD must not block brace

  const game = {
    props: yard.props,
    powerCrates: [],
    platforms: yard.platforms,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    mapId: "yard",
    theme: "industrial"
  };
  spawnPropDebris(game, scrap, scrap.x + scrap.w / 2, scrap.y + scrap.h / 2);
  assert.ok(game.groundDebris.length > 0, "scrap debris present");
  assert.equal(findBraceTarget(game, fighter), intact);

  const botsBefore = fighter.nanobotFree;
  const result = tryReconjurerBuild(fighter, game);
  assert.ok(result);
  assert.equal(result, intact, "braces intact cover instead of rebuilding scrap");
  assert.equal(intact.braced, true);
  assert.equal(intact.braceMaterial, "metal");
  assert.equal(intact.braceHp, RECONJURER_BRACE_HP);
  assert.equal(scrap.destroyed, true, "scrap stays destroyed");
  assert.ok(game.groundDebris.length > 0, "debris not consumed");
  assert.equal(fighter.nanobotFree, botsBefore - RECONJURER_BRACE_BOT_COST);
  assert.equal(fighter.reconjurerMetalCd, RECONJURER_METAL_COOLDOWN, "brace ignores metal CD");
}

// Metal boxes get wood bracing (same shell HP, contrasting look).
{
  const metal = createPowerCrate({ x: 400, y: 400 }, "yard", "industrial", "brace-metal");
  assert.equal(braceMaterialFor(metal), "wood");
  assert.ok(canBraceBreakable(metal));
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    extensionSecondary: RECONJURER_BUILDER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = metal.x;
  fighter.y = metal.y;
  fighter.aim = 0;
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [];
  const game = {
    props: [],
    powerCrates: [metal],
    platforms: [],
    groundDebris: [],
    effects: [],
    mapId: "yard",
    theme: "industrial"
  };
  assert.equal(findBraceTarget(game, fighter), metal);
  const startHp = metal.hp;
  const braced = tryReconjurerBuild(fighter, game);
  assert.ok(braced);
  assert.equal(braced, metal);
  assert.equal(metal.braced, true);
  assert.equal(metal.braceMaterial, "wood");
  assert.equal(metal.braceHp, RECONJURER_BRACE_HP);
  assert.equal(metal.hp, startHp, "metal core unchanged by wood bracing");
  assert.equal(fighter.reconjurerMetalCd || 0, 0, "wood brace does not start metal CD");
}

// Casing absorbs hits before the wood core.
{
  const prop = {
    kind: "crate",
    breakable: true,
    destroyed: false,
    solid: true,
    x: 0,
    y: 0,
    w: 40,
    h: 40,
    hp: 40,
    maxHp: 40
  };
  applyBraceCasing(prop, 20);
  assert.equal(prop.braceMaterial, "metal");
  const game = { effects: [], groundDebris: [] };
  damageProp(prop, 12, game, 20, 20);
  assert.equal(prop.braceHp, 8);
  assert.equal(prop.hp, 40, "wood untouched while casing holds");
  damageProp(prop, 20, game, 20, 20);
  assert.equal(prop.braced, false);
  assert.equal(prop.braceHp, 0);
  assert.equal(prop.hp, 28, "overflow chips the core");
}

// Wood casing absorbs hits before the metal box core.
{
  const metal = createPowerCrate({ x: 100, y: 200 }, "yard", "industrial", "brace-dmg");
  applyBraceCasing(metal, 20);
  assert.equal(metal.braceMaterial, "wood");
  const game = { effects: [], groundDebris: [], powerCrateState: { pending: [] }, fighters: [] };
  const core = metal.hp;
  damagePowerCrate(metal, 12, null, game, 120, 180);
  assert.equal(metal.braceHp, 8);
  assert.equal(metal.hp, core, "metal untouched while wood casing holds");
  damagePowerCrate(metal, 20, null, game, 120, 180);
  assert.equal(metal.braced, false);
  assert.equal(metal.braceHp, 0);
  assert.equal(metal.hp, core - 12, "overflow chips the metal core");
}

console.log("reconjurer-builder.test.js passed.");
