import assert from "node:assert/strict";
import {
  buildPropJigsaw, forgeCastColor, FORGE_PHASE_DURATIONS, NON_ARMOR_DEBRIS_LIFE,
  PROP_DEBRIS_COLORS, RECONQUER_BONUS_INTERVAL, restoreMapProp, spawnPropDebris,
  tickGroundDebris, tryReconquerAtSpawn
} from "./debris.js";
import { createMapRuntime, damageProp } from "./maps.js";
import { createPowerCrate } from "./powerups.js";
import { normalizeDebrisDespawnStyle, normalizeReconquerRate } from "./settings.js";

assert.equal(normalizeDebrisDespawnStyle("decimate"), "decimate");
assert.equal(normalizeDebrisDespawnStyle("nope"), "fade");
assert.equal(normalizeReconquerRate(1), 1);
assert.equal(normalizeReconquerRate(2), 2);
assert.equal(normalizeReconquerRate(1.5), 1.5);
assert.equal(normalizeReconquerRate(0), 1);
assert.equal(normalizeReconquerRate(9), 2);

// Jigsaw uses exact prop colors and full fragment coverage.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  const tiles = buildPropJigsaw(crate);
  assert.equal(tiles.length, 16, "4x4 crate jigsaw");
  assert.ok(tiles.every((t) => t.color === PROP_DEBRIS_COLORS.crate.fill));
  assert.ok(tiles.every((t) => t.material === "wood"), "map crates are wood, not metal");
  const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0);
  assert.ok(Math.abs(area - crate.w * crate.h) < 1, "tiles cover 100% of crate area");
}

{
  const forest = createMapRuntime("forest");
  const tree = forest.props.find((p) => p.kind === "tree");
  const tiles = buildPropJigsaw(tree);
  assert.ok(tiles.length >= 16, "trunk + canopy fragments");
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.tree.fill));
  assert.ok(tiles.some((t) => t.color === PROP_DEBRIS_COLORS.treeCanopy.fill
    || t.color === PROP_DEBRIS_COLORS.treeCanopy.fill2));
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
  assert.ok(game.groundDebris.every((p) => p.color === PROP_DEBRIS_COLORS.crate.fill));
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

// Armor scraps ignore despawn timers.
{
  const game = {
    elapsed: 0,
    settings: { visual: { debrisDespawnStyle: "fade" } },
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
      immortal: true,
      life: Infinity,
      maxLife: Infinity,
      alpha: 1,
      scale: 1,
      despawnMode: null
    }]
  };
  for (let i = 0; i < 200; i++) tickGroundDebris(game, 1 / 60);
  assert.equal(game.groundDebris.length, 1);
  assert.equal(game.groundDebris[0].despawnMode, null);
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

assert.equal(restoreMapProp(null), false);

console.log("debris.test.js passed.");
