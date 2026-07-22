import assert from "node:assert/strict";
import {
  ARMOR_DUMMY_COOL_DURATION, buildPropJigsaw, claimDebrisForMaterialConsume,
  consumeDebrisSource, damageArmorDummy, forgeCastColor, FORGE_PHASE_DURATIONS,
  MATERIAL_CONSUME_DURATION, NON_ARMOR_DEBRIS_LIFE, pickNearbyRestoreProp,
  PROP_DEBRIS_COLORS, pullSpawnTowardOrigin, RECONQUER_BONUS_INTERVAL, RECONQUER_NEAR_RANGE,
  restoreMapProp, spawnBrokenArmorDebris, spawnPropDebris, tickGroundDebris,
  tryReconquerAtSpawn, vacuumNearbyDebris
} from "./debris.js";
import { Fighter } from "./combat.js";
import {
  applyLoadout, beginRetractableMorph, chuckMaterialConsumerScrap, DEFAULT_LOADOUT,
  MATERIAL_CONSUMER_BEAM_RPM, MATERIAL_CONSUMER_BOTS_PER_PIECE,
  MATERIAL_CONSUMER_CHUCK_DAMAGE, MATERIAL_CONSUMER_ID,
  materialEjectionTank, selectWeaponSlot, tickMaterialConsumerVacuum,
  tickRetractableArmor, RETRACTABLE_MORPH_DURATION
} from "./equipment.js";
import { createMapRuntime, damageProp } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import {
  normalizeArmorDespawnStyle, normalizeArmorDespawnTimer, normalizeDebrisDespawnStyle,
  normalizeReconquerRate
} from "./settings.js";

assert.equal(normalizeDebrisDespawnStyle("decimate"), "decimate");
assert.equal(normalizeDebrisDespawnStyle("nope"), "fade");
assert.equal(normalizeReconquerRate(1), 1);
assert.equal(normalizeReconquerRate(2), 2);
assert.equal(normalizeReconquerRate(0.1), 0.1);
assert.equal(normalizeReconquerRate(1.5), 1.5);
assert.equal(normalizeReconquerRate(0), 0.1);
assert.equal(normalizeReconquerRate(9), 9);
assert.equal(normalizeReconquerRate(10), 10);
assert.equal(normalizeReconquerRate(99), 10);
assert.equal(normalizeArmorDespawnStyle("buildDummy"), "buildDummy");
assert.equal(normalizeArmorDespawnStyle("nope"), "fade");
assert.equal(normalizeArmorDespawnTimer(14), 14);
assert.equal(normalizeArmorDespawnTimer(1.24), 1.2);
assert.equal(normalizeArmorDespawnTimer(0), 0.1);

// Jagged jigsaw: unique polygons, source-region colors, full coverage.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const tiles = buildPropJigsaw(crate);
  assert.equal(tiles.length, 16, "4x4 crate jigsaw");
  assert.ok(tiles.every((t) => Array.isArray(t.verts) && t.verts.length >= 3), "jagged verts");
  assert.ok(tiles.every((t) => t.material === "wood"), "map crates are wood, not metal");
  // Source-region paint: edge shards darker, interior wood — not one mosaic color.
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.crate.fill));
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.crate.edge));
  assert.ok(tiles.some((t) => Array.isArray(t.marks) && t.marks.length), "crate X/border marks");
  const area = tiles.reduce((sum, t) => sum + (t.area || 0), 0);
  assert.ok(Math.abs(area - crate.w * crate.h) < 2, "shards cover ~100% of crate area");
  // Shared jags: neighboring shards have matching world-space edge midpoints.
  const a = tiles[0];
  const b = tiles[1];
  const world = (tile, v) => [tile.homeLx + v[0], tile.homeLy + v[1]];
  const aPts = a.verts.map((v) => world(a, v).map((n) => n.toFixed(3)).join(","));
  const bPts = new Set(b.verts.map((v) => world(b, v).map((n) => n.toFixed(3)).join(",")));
  assert.ok(aPts.some((p) => bPts.has(p)), "adjacent shards share edge vertices");
}

{
  const forest = createMapRuntime("forest");
  const tree = forest.props.find((p) => p.kind === "tree");
  const tiles = buildPropJigsaw(tree);
  assert.ok(tiles.length >= 16, "trunk + canopy fragments");
  assert.ok(tiles.every((t) => Array.isArray(t.verts) && t.verts.length >= 3));
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.tree.fill));
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.treeCanopy.fill
    || t.color === PROP_DEBRIS_COLORS.treeCanopy.fill2));
}

{
  // Barrel shards carry hoop bands from their source region.
  const yard = createMapRuntime("yard");
  const barrel = yard.props.find((p) => p.kind === "barrel")
    || { kind: "barrel", w: 34, h: 48, x: 0, y: 0 };
  const tiles = buildPropJigsaw(barrel, "barrel");
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.barrel.fill));
  assert.ok(tiles.some((t) => t.color === (PROP_DEBRIS_COLORS.barrel.hoop
    || PROP_DEBRIS_COLORS.barrel.edge)));
}

// Fade despawn removes non-armor debris after lifetime + animation.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "fade" } },
    platforms: yard.platforms,
    props: yard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: []
  };
  damageProp(crate, crate.hp, game, crate.x + 5, crate.y + 5);
  assert.equal(game.groundDebris.length, 16);
  assert.ok(game.groundDebris.every((p) => p.material === "wood" && !p.immortal));
  assert.ok(game.groundDebris.every((p) => Array.isArray(p.verts) && p.verts.length >= 3));
  assert.ok(game.groundDebris.every((p) => Number.isFinite(p.homeLx) && Number.isFinite(p.homeLy)));

  for (let i = 0; i < Math.ceil(NON_ARMOR_DEBRIS_LIFE * 60) + 5; i++) {
    game.elapsed += 1 / 60;
    tickGroundDebris(game, 1 / 60);
  }
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "fade"));
  for (let i = 0; i < 90; i++) {
    game.elapsed += 1 / 60;
    tickGroundDebris(game, 1 / 60);
  }
  assert.equal(game.groundDebris.length, 0, "fade clears scraps");
}

// Decimate flings pieces then clears them.
{
  const forest = createMapRuntime("forest");
  const tree = forest.props.find((p) => p.kind === "tree");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "decimate" } },
    platforms: forest.platforms,
    props: forest.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: []
  };
  spawnPropDebris(game, tree, tree.x + 10, tree.y + 40);
  assert.ok(game.groundDebris.length >= 16);
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "decimate"));
  assert.ok(game.groundDebris.some((p) => Math.hypot(p.vx, p.vy) > 100));
  for (let i = 0; i < 90; i++) tickGroundDebris(game, 1 / 60);
  assert.equal(game.groundDebris.length, 0);
}

// Reconquer jigsaw: tiles home to their slots, then the prop rebuilds.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer" } },
    platforms: yard.platforms,
    props: yard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    powerCrates: []
  };
  damageProp(crate, crate.hp, game, crate.x + 5, crate.y + 5);
  assert.equal(crate.destroyed, true);
  const slots = game.groundDebris.map((p) => `${p.homeLx},${p.homeLy}`);
  assert.equal(new Set(slots).size, slots.length, "unique jigsaw slots");
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.reconquerQueue.length >= 1);

  const fakeSpawn = { x: 800, y: 1200, w: 40, h: 40 };
  const used = tryReconquerAtSpawn(game, fakeSpawn, { preferPowerCrate: false });
  assert.equal(used, true);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "reconquer-home"));
  for (let i = 0; i < 120; i++) tickGroundDebris(game, 1 / 60);
  assert.equal(crate.destroyed, false, "crate rebuilt");
  assert.ok(crate.hp > 0);
  assert.equal(game.groundDebris.length, 0);
}

// Armor scraps fade out after the armor timer.
{
  const game = {
    elapsed: 0,
    settings: {
      visual: {
        debrisDespawnStyle: "fade",
        armorDespawnStyle: "fade",
        armorDespawnTimer: 0.5
      }
    },
    platforms: [{ x: 0, y: 500, w: 2000, h: 40 }],
    props: [],
    groundDebris: [{
      material: "armor",
      kind: "helmet",
      x: 100,
      y: 480,
      w: 20,
      h: 10,
      baseW: 20,
      baseH: 10,
      vx: 0,
      vy: 0,
      rot: 0,
      spin: 0,
      color: "#8aa4b0",
      grounded: true,
      settle: 1,
      immortal: false,
      life: 0.5,
      maxLife: 0.5,
      alpha: 1,
      scale: 1,
      despawnMode: null,
      sourceId: "armor-1",
      sourceType: "armor"
    }],
    armorDummyBuilds: [],
    armorDummies: []
  };
  for (let i = 0; i < 40; i++) tickGroundDebris(game, 1 / 60);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "fade"));
  for (let i = 0; i < 90; i++) tickGroundDebris(game, 1 / 60);
  assert.equal(game.groundDebris.length, 0, "armor fade clears scraps");
}

// Build dummy: furnace ingests armor scraps, then casts a lasting training dummy.
{
  const fighter = applyLoadout(new Fighter({
    x: 400, y: 300, team: 0, aim: 0
  }), { ...DEFAULT_LOADOUT, body: "retractable-armor" });
  beginRetractableMorph(fighter, true);
  tickRetractableArmor(fighter, RETRACTABLE_MORPH_DURATION + 0.01);
  const game = {
    elapsed: 0,
    settings: {
      visual: {
        armorDespawnStyle: "buildDummy",
        armorDespawnTimer: 0.2
      }
    },
    platforms: [{ x: 0, y: 500, w: 2000, h: 40 }],
    props: [],
    groundDebris: [],
    effects: [],
    forgeCasts: [],
    armorDummyBuilds: [],
    armorDummies: []
  };
  spawnBrokenArmorDebris(game, fighter);
  assert.ok(game.groundDebris.length >= 8);
  assert.ok(game.groundDebris.every((p) => p.material === "armor" && !p.immortal));
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.forgeCasts.length >= 1, "armor build starts a furnace cast");
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "forge-ingest"));
  const totalForge = Object.values(FORGE_PHASE_DURATIONS).reduce((a, b) => a + b, 0);
  for (let i = 0; i < Math.ceil(totalForge * 60) + 10; i++) {
    tickGroundDebris(game, 1 / 60);
  }
  assert.equal(game.groundDebris.length, 0, "scraps consumed by furnace");
  assert.ok(game.armorDummies.length >= 1, "training dummy spawned");
  assert.equal(game.forgeCasts.length, 0);
  const dummy = game.armorDummies[0];
  assert.equal(dummy.maxHp, fighter.retractableMax, "dummy HP matches full armor pool");
  assert.equal(dummy.hp, fighter.retractableMax);

  // Destroyed dummy drops plates that remelt into a new nearby dummy with same HP.
  const oldX = dummy.x;
  const oldY = dummy.y;
  damageArmorDummy(dummy, dummy.hp, game, dummy.x + 10, dummy.y + 10);
  assert.equal(game.armorDummies.length, 0);
  assert.ok(game.groundDebris.length >= 8);
  assert.ok(game.groundDebris.every((p) => p.armorMaxHp === fighter.retractableMax));
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  for (let i = 0; i < Math.ceil((totalForge + ARMOR_DUMMY_COOL_DURATION) * 60) + 10; i++) {
    tickGroundDebris(game, 1 / 60);
  }
  assert.ok(game.armorDummies.length >= 1, "remelted into a new dummy");
  const rebuilt = game.armorDummies[0];
  assert.equal(rebuilt.maxHp, fighter.retractableMax);
  assert.ok(Math.hypot(rebuilt.x - oldX, rebuilt.y - oldY) < 120, "remelt stays nearby");
}

// Dummy stands on a real platform, not the mid-air average of multi-height scraps.
{
  const upper = { x: 0, y: 400, w: 800, h: 40 };
  const lower = { x: 0, y: 900, w: 800, h: 40 };
  const game = {
    elapsed: 0,
    settings: {
      visual: {
        armorDespawnStyle: "buildDummy",
        armorDespawnTimer: 0.2
      }
    },
    platforms: [upper, lower],
    props: [],
    groundDebris: [],
    effects: [],
    forgeCasts: [],
    armorDummyBuilds: [],
    armorDummies: []
  };
  const sourceId = "test-multi-height";
  // Most scraps on the upper ledge; a few on the lower — old average Y was mid-air (~650).
  for (let i = 0; i < 6; i++) {
    game.groundDebris.push({
      material: "armor",
      sourceId,
      x: 200 + i * 12,
      y: upper.y - 6,
      w: 12,
      h: 12,
      life: 0.01,
      immortal: false,
      armorMaxHp: 80,
      color: "#7a848e",
      grounded: true,
      vx: 0,
      vy: 0,
      scale: 1,
      alpha: 1
    });
  }
  for (let i = 0; i < 2; i++) {
    game.groundDebris.push({
      material: "armor",
      sourceId,
      x: 220 + i * 12,
      y: lower.y - 6,
      w: 12,
      h: 12,
      life: 0.01,
      immortal: false,
      armorMaxHp: 80,
      color: "#7a848e",
      grounded: true,
      vx: 0,
      vy: 0,
      scale: 1,
      alpha: 1
    });
  }
  tickGroundDebris(game, 0.02);
  assert.ok(game.forgeCasts.length >= 1, "multi-height furnace starts");
  const forge = game.forgeCasts[0];
  assert.ok(
    Math.abs(forge.castY - (upper.y - 58 * 0.5)) < 1,
    "forge cast snaps to upper floor, not scrap average"
  );
  const totalForge = Object.values(FORGE_PHASE_DURATIONS).reduce((a, b) => a + b, 0);
  for (let i = 0; i < Math.ceil(totalForge * 60) + 10; i++) {
    tickGroundDebris(game, 1 / 60);
  }
  const dummy = game.armorDummies[0];
  assert.ok(dummy, "dummy spawned on floor");
  assert.ok(Math.abs((dummy.y + dummy.h) - upper.y) < 1, "dummy feet on upper platform");
  assert.ok(dummy.y + dummy.h < lower.y - 40, "dummy is not mid-air between platforms");
}

// Metal reconquer: furnace ingest → cast → cool restores the prop.
{
  const yard = createMapRuntime("yard");
  const barrel = yard.props.find((p) => p.kind === "barrel");
  assert.ok(barrel, "yard has a metal barrel");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer" } },
    platforms: yard.platforms,
    props: yard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    powerCrates: []
  };
  damageProp(barrel, barrel.hp, game, barrel.x + 5, barrel.y + 5);
  assert.equal(barrel.destroyed, true);
  assert.ok(game.groundDebris.every((p) => p.material === "metal"));
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.reconquerQueue.length >= 1);

  const used = tryReconquerAtSpawn(game, { x: 10, y: 10, w: 40, h: 40 }, {
    preferPowerCrate: false
  });
  assert.equal(used, true);
  assert.ok(game.forgeCasts.length >= 1, "metal starts a forge cast");
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "forge-ingest"));

  const totalForge = Object.values(FORGE_PHASE_DURATIONS).reduce((a, b) => a + b, 0);
  for (let i = 0; i < Math.ceil(totalForge * 60) + 10; i++) {
    game.elapsed += 1 / 60;
    tickGroundDebris(game, 1 / 60);
  }
  assert.equal(barrel.destroyed, false, "barrel recast after cool");
  assert.equal(game.forgeCasts.length, 0);
  assert.equal(game.groundDebris.length, 0);
}

// Power-crate metal forge hides the crate until cool finishes.
{
  const scrapCrate = createPowerCrate({ x: 400, y: 500 }, "yard", "industrial", "pc-forge-scrap");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer" } },
    platforms: [{ x: 0, y: 500, w: 2000, h: 40 }],
    props: [],
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    powerCrates: []
  };
  spawnPropDebris(game, scrapCrate, scrapCrate.x + 20, scrapCrate.y + 20, {
    forceKind: "powerCrate",
    sourceType: "powerCrate"
  });
  assert.ok(game.groundDebris.every((p) => p.material === "metal"));
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.reconquerQueue.some((e) => e.sourceType === "powerCrate"));

  const spawned = createPowerCrate({ x: 800, y: 500 }, "yard", "industrial", "pc-forge-spawn");
  game.powerCrates.push(spawned);
  const used = tryReconquerAtSpawn(game, spawned, { preferPowerCrate: true });
  assert.equal(used, false, "power-crate forge does not consume prop restore");
  assert.equal(spawned.forgeHidden, true);
  assert.equal(game.forgeCasts.length, 1);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "forge-ingest"));

  const hot = forgeCastColor({ phase: "cool", cool: 0.1, finalColor: "#6a7078" });
  const cooled = forgeCastColor({ phase: "cool", cool: 1, finalColor: "#6a7078" });
  assert.notEqual(hot, cooled);
  assert.equal(cooled, "#6a7078");

  const totalForge = Object.values(FORGE_PHASE_DURATIONS).reduce((a, b) => a + b, 0);
  for (let i = 0; i < Math.ceil(totalForge * 60) + 10; i++) {
    tickGroundDebris(game, 1 / 60);
  }
  assert.equal(spawned.forgeHidden, false, "crate revealed after cool");
  assert.equal(game.forgeCasts.length, 0);
}

// Reconquer rate 2× ages scraps into the queue twice as fast.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const baseGame = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer", reconquerRate: 1 } },
    platforms: yard.platforms,
    props: yard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    reconquerBonusAcc: 0,
    powerCrates: []
  };
  damageProp(crate, crate.hp, baseGame, crate.x + 5, crate.y + 5);
  const halfLife = NON_ARMOR_DEBRIS_LIFE / 2;
  for (let i = 0; i < Math.ceil(halfLife * 60); i++) {
    tickGroundDebris(baseGame, 1 / 60);
  }
  assert.equal(baseGame.reconquerQueue.length, 0, "1× not ready at half life");

  const fastYard = createMapRuntime("yard");
  const fastCrate = fastYard.props.find((p) => p.kind === "crate");
  const fastGame = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer", reconquerRate: 2 } },
    platforms: fastYard.platforms,
    props: fastYard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    reconquerBonusAcc: 0,
    powerCrates: []
  };
  damageProp(fastCrate, fastCrate.hp, fastGame, fastCrate.x + 5, fastCrate.y + 5);
  for (let i = 0; i < Math.ceil(halfLife * 60) + 5; i++) {
    tickGroundDebris(fastGame, 1 / 60);
  }
  assert.ok(fastGame.reconquerQueue.length >= 1, "2× ready by half life");
}

// Bonus pulses only accrue above 1× and can rebuild without a crate spawn.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "reconquer", reconquerRate: 2 } },
    platforms: yard.platforms,
    props: yard.props,
    groundDebris: [],
    effects: [],
    reconquerQueue: [],
    forgeCasts: [],
    reconquerBonusAcc: 0,
    powerCrates: []
  };
  damageProp(crate, crate.hp, game, crate.x + 5, crate.y + 5);
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.reconquerQueue.length >= 1);
  assert.equal(crate.destroyed, true);

  // Accrue one full bonus interval at +1× (rate 2 → bonus 1), then let jigsaw finish.
  for (let i = 0; i < Math.ceil(RECONQUER_BONUS_INTERVAL * 60) + 120; i++) {
    tickGroundDebris(game, 1 / 60);
  }
  assert.equal(crate.destroyed, false, "bonus pulse reconquers without crate spawn");
}

// Reconquer prefers the original break site over far same-kind slots.
{
  const near = { kind: "crate", x: 100, y: 200, w: 40, h: 40, destroyed: true };
  const far = { kind: "crate", x: 3000, y: 200, w: 40, h: 40, destroyed: true };
  const entry = { sourceProp: near, originX: 120, originY: 220, sourceKind: "crate" };
  const picked = pickNearbyRestoreProp(entry, [far, near], []);
  assert.equal(picked, near, "original prop wins over far alternate");

  const orphan = { sourceProp: null, originX: 110, originY: 210, sourceKind: "crate" };
  const nearest = pickNearbyRestoreProp(orphan, [far, near], []);
  assert.equal(nearest, near, "nearest slot when original is gone");
}

// Far power-crate spawns pull back toward the scrap origin when a nearer slot exists.
{
  const spot = { x: 3000, y: 200, w: 40, h: 40, spawnKey: "3000,240" };
  const origin = { x: 120, y: 220 };
  const free = [{ x: 100, y: 240 }, { x: 2800, y: 240 }];
  pullSpawnTowardOrigin(spot, origin, free);
  assert.ok(Math.abs(spot.x - 100) < 1, "crate relocated near origin");
  assert.ok(pointNear(spot, origin) <= RECONQUER_NEAR_RANGE);
}

function pointNear(spot, origin) {
  return Math.hypot(spot.x + spot.w / 2 - origin.x, spot.y + spot.h / 2 - origin.y);
}

assert.equal(restoreMapProp(null), false);

// Instant vacuum consumes whole source groups and clears reconquer leftovers.
{
  const game = {
    groundDebris: [
      { x: 10, y: 10, sourceId: "vac-a", despawnMode: null },
      { x: 12, y: 12, sourceId: "vac-a", despawnMode: null },
      { x: 500, y: 500, sourceId: "vac-far", despawnMode: null }
    ],
    reconquerQueue: [
      { sourceId: "vac-a", sourceKind: "crate" },
      { sourceId: "vac-far", sourceKind: "crate" }
    ],
    forgeCasts: [],
    armorDummyBuilds: []
  };
  const result = vacuumNearbyDebris(game, 10, 10, 40);
  assert.equal(result.sources, 1);
  assert.equal(result.pieces, 2);
  assert.equal(game.groundDebris.length, 1);
  assert.equal(game.groundDebris[0].sourceId, "vac-far");
  assert.equal(game.reconquerQueue.length, 1);
  assert.equal(game.reconquerQueue[0].sourceId, "vac-far");
  assert.equal(consumeDebrisSource(game, "vac-far"), 1);
  assert.equal(game.groundDebris.length, 0);
  assert.equal(game.reconquerQueue.length, 0);
}

// Claim starts tip-suction and cancels reconquer without instant delete.
{
  const owner = { id: "vac-owner" };
  const game = {
    groundDebris: [
      { x: 10, y: 10, w: 8, h: 8, sourceId: "claim-a", despawnMode: null, color: "#888" },
      { x: 14, y: 12, w: 8, h: 8, sourceId: "claim-a", despawnMode: null, color: "#888" }
    ],
    reconquerQueue: [{ sourceId: "claim-a" }],
    forgeCasts: [],
    armorDummyBuilds: [],
    effects: []
  };
  const claimed = claimDebrisForMaterialConsume(game, 10, 10, 40, owner, 4);
  assert.equal(claimed.pieces, 2);
  assert.equal(game.reconquerQueue.length, 0, "reconquer cancelled on claim");
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "material-consume"));
  assert.ok(game.groundDebris.every((p) => p.consumeOwner === owner));
}

// Material Consumer: scraps stream to tip, ingest FX, then free bots (pool-capped).
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 100;
  fighter.y = 200;
  fighter.aim = 0;
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  assert.equal(fighter.weaponId, MATERIAL_CONSUMER_ID);
  assert.equal(fighter.materialConsumer, true);
  assert.equal(fighter.weapon, "saber");
  // Pool starts full; vacuum only fills missing bots (same cap as regen).
  fighter.nanobotFree = fighter.nanobotMax - 50;
  const freeBefore = fighter.nanobotFree;
  const pieces = 3;
  const game = {
    elapsed: 0,
    groundDebris: Array.from({ length: pieces }, (_, i) => ({
      x: fighter.x + 20 + i,
      y: fighter.y + 20,
      w: 10,
      h: 9,
      sourceId: "mc-src",
      despawnMode: null,
      color: i === 0 ? "#8a6a3a" : "#4a3818",
      edge: "#4a3818",
      shape: "poly",
      verts: [[-5, -4], [0, -5], [5, -3], [4, 4], [-4, 5], [-6, 0]],
      marks: [{ x1: -4, y1: -3, x2: 4, y2: 3, color: "#4a3818" }],
      vx: 0,
      vy: 0,
      spin: 0,
      rot: 0
    })),
    reconquerQueue: [{ sourceId: "mc-src" }],
    forgeCasts: [],
    armorDummyBuilds: [],
    effects: [],
    materialConsumeArrivals: []
  };

  // Claim on first vacuum tick — scraps stay visible and start streaming.
  assert.equal(tickMaterialConsumerVacuum(fighter, game, 1 / 60), 0, "bots after ingest, not on claim");
  assert.equal(game.reconquerQueue.length, 0);
  assert.equal(game.groundDebris.length, pieces);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "material-consume"));

  let gained = 0;
  const frames = Math.ceil(MATERIAL_CONSUME_DURATION * 60) + 20;
  for (let i = 0; i < frames; i++) {
    game.elapsed += 1 / 60;
    tickGroundDebris(game, 1 / 60);
    gained += tickMaterialConsumerVacuum(fighter, game, 1 / 60);
  }
  assert.equal(gained, pieces * MATERIAL_CONSUMER_BOTS_PER_PIECE);
  assert.equal(fighter.nanobotFree, freeBefore + gained);
  assert.equal(game.groundDebris.length, 0);
  assert.ok(game.effects.some((e) => e.type === "nanoIngest"), "ingest swirl at tip");
  assert.ok(game.effects.some((e) => e.type === "nanoBotGrant"), "bots bloom from tip");
  assert.equal(fighter.materialScrapBank.length, pieces, "remembers inhaled scraps");
  assert.ok(fighter.materialScrapBank.every((s) => s.bots === MATERIAL_CONSUMER_BOTS_PER_PIECE));
  assert.ok(
    fighter.materialScrapBank.every((s) => Array.isArray(s.verts) && s.verts.length >= 3),
    "bank keeps jagged shard shapes"
  );
  assert.ok(fighter.materialScrapBank.every((s) => Array.isArray(s.marks)));

  // Chuck spends those bots and fires a scrap projectile with the same silhouette.
  game.bullets = [];
  fighter.attackCd = 0;
  const freeBeforeChuck = fighter.nanobotFree;
  assert.ok(chuckMaterialConsumerScrap(fighter, game));
  assert.equal(fighter.materialScrapBank.length, pieces - 1);
  assert.equal(fighter.nanobotFree, freeBeforeChuck - MATERIAL_CONSUMER_BOTS_PER_PIECE);
  assert.equal(game.bullets.length, 1);
  assert.equal(game.bullets[0].scrapChuck, true);
  assert.equal(game.bullets[0].damage, MATERIAL_CONSUMER_CHUCK_DAMAGE);
  assert.ok(Array.isArray(game.bullets[0].scrapVerts) && game.bullets[0].scrapVerts.length >= 3);

  // Cannot chuck without enough free bots (spend them elsewhere).
  fighter.attackCd = 0;
  fighter.nanobotFree = 0;
  assert.equal(chuckMaterialConsumerScrap(fighter, game), false);
  assert.equal(fighter.materialScrapBank.length, pieces - 1);

  // Full pool without V: leave debris alone.
  fighter.nanobotFree = fighter.nanobotMax;
  fighter.nanobotArmor = 0;
  fighter.nanobotWeapon = 0;
  fighter.materialScrapBank = [];
  fighter.materialEjectionTank = [];
  fighter.materialEjectHeld = false;
  game.groundDebris = [{
    x: fighter.x + 10, y: fighter.y + 10, w: 8, h: 8,
    sourceId: "mc-full", despawnMode: null, color: "#888", vx: 0, vy: 0, spin: 0, rot: 0
  }];
  game.reconquerQueue = [{ sourceId: "mc-full" }];
  assert.equal(tickMaterialConsumerVacuum(fighter, game, 1 / 60), 0);
  assert.equal(game.groundDebris.length, 1);
  assert.equal(game.groundDebris[0].despawnMode, null);
  assert.equal(game.reconquerQueue.length, 1);
}

// Hold V at full pool: excess scraps stream into the ejection tank (no bots).
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  fighter.x = 100;
  fighter.y = 200;
  fighter.aim = 0;
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  fighter.nanobotFree = fighter.nanobotMax;
  fighter.nanobotArmor = 0;
  fighter.nanobotWeapon = 0;
  fighter.materialScrapBank = [];
  fighter.materialEjectionTank = [];
  fighter.materialEjectHeld = true;
  const freeBefore = fighter.nanobotFree;
  const pieces = 2;
  const game = {
    elapsed: 0,
    groundDebris: Array.from({ length: pieces }, (_, i) => ({
      x: fighter.x + 16 + i,
      y: fighter.y + 16,
      w: 8,
      h: 8,
      sourceId: "mc-eject",
      despawnMode: null,
      color: "#b09070",
      vx: 0,
      vy: 0,
      spin: 0,
      rot: 0
    })),
    reconquerQueue: [{ sourceId: "mc-eject" }],
    forgeCasts: [],
    armorDummyBuilds: [],
    effects: [],
    materialConsumeArrivals: []
  };
  assert.equal(tickMaterialConsumerVacuum(fighter, game, 1 / 60), 0);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "material-consume"));
  assert.ok(game.groundDebris.every((p) => p.consumeToEjection === true));
  const frames = Math.ceil(MATERIAL_CONSUME_DURATION * 60) + 20;
  for (let i = 0; i < frames; i++) {
    game.elapsed += 1 / 60;
    tickGroundDebris(game, 1 / 60);
    tickMaterialConsumerVacuum(fighter, game, 1 / 60);
  }
  assert.equal(fighter.nanobotFree, freeBefore, "excess vacuum grants no bots");
  assert.equal(materialEjectionTank(fighter).length, pieces);
  assert.equal(fighter.materialScrapBank.length, 0);
  assert.ok(materialEjectionTank(fighter).every((s) => s.ejection && s.bots === 0));
}

// Debris beam: ejection tank fires first (free), then remembered bank (costs bots).
{
  const fighter = applyLoadout({}, {
    ...DEFAULT_LOADOUT,
    secondaryWeapon: MATERIAL_CONSUMER_ID,
    body: "nanotech-chestplate"
  });
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  fighter.nanobotFree = 40;
  fighter.materialEjectionTank = [{
    bots: 0, ejection: true, color: "#c8a878", w: 8, h: 8
  }];
  fighter.materialScrapBank = [{
    bots: MATERIAL_CONSUMER_BOTS_PER_PIECE, color: "#8a7a68", w: 8, h: 8
  }];
  const game = { bullets: [], effects: [] };
  fighter.attackCd = 0;
  const freeBefore = fighter.nanobotFree;
  assert.ok(chuckMaterialConsumerScrap(fighter, game));
  assert.equal(fighter.materialEjectionTank.length, 0, "tank emptied first");
  assert.equal(fighter.materialScrapBank.length, 1, "bank untouched until tank empty");
  assert.equal(fighter.nanobotFree, freeBefore, "tank scrap costs no bots");
  assert.equal(game.bullets[0].scrapSource, "tank");
  assert.equal(game.bullets[0].scrapBeam, true);
  assert.ok(fighter.attackCd > 0);
  assert.ok(
    Math.abs(fighter.attackCd - 60 / MATERIAL_CONSUMER_BEAM_RPM) < 0.001,
    "beam uses beam RPM"
  );

  fighter.attackCd = 0;
  assert.ok(chuckMaterialConsumerScrap(fighter, game));
  assert.equal(fighter.materialScrapBank.length, 0);
  assert.equal(fighter.nanobotFree, freeBefore - MATERIAL_CONSUMER_BOTS_PER_PIECE);
  assert.equal(game.bullets[1].scrapSource, "bank");
  assert.equal(game.bullets[1].damage, MATERIAL_CONSUMER_CHUCK_DAMAGE);
}

console.log("debris.test.js passed.");
