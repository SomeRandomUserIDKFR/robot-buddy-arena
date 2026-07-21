import assert from "node:assert/strict";
import {
  NON_ARMOR_DEBRIS_LIFE, restoreMapProp, spawnPropDebris, tickGroundDebris,
  tryReconquerAtSpawn
} from "./debris.js";
import { createMapRuntime, damageProp } from "./maps.js";
import { normalizeDebrisDespawnStyle } from "./settings.js";

assert.equal(normalizeDebrisDespawnStyle("decimate"), "decimate");
assert.equal(normalizeDebrisDespawnStyle("nope"), "fade");

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
  assert.ok(game.groundDebris.length >= 6);
  assert.ok(game.groundDebris.every((p) => p.material === "metal" && !p.immortal));

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
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "decimate"));
  assert.ok(game.groundDebris.some((p) => Math.hypot(p.vx, p.vy) > 100));
  for (let i = 0; i < 90; i++) tickGroundDebris(game, 1 / 60);
  assert.equal(game.groundDebris.length, 0);
}

// Reconquer waits for a spawn opportunity, then restores a destroyed prop.
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
  for (const piece of game.groundDebris) piece.life = 0.01;
  tickGroundDebris(game, 0.02);
  assert.ok(game.reconquerQueue.length >= 1);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "reconquer-wait"));

  const fakeSpawn = { x: 800, y: 1200, w: 40, h: 40 };
  const used = tryReconquerAtSpawn(game, fakeSpawn, { preferPowerCrate: false });
  assert.equal(used, true);
  assert.ok(game.groundDebris.every((p) => p.despawnMode === "reconquer-home"));
  for (let i = 0; i < 90; i++) tickGroundDebris(game, 1 / 60);
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

assert.equal(restoreMapProp(null), false);

console.log("debris.test.js passed.");
