import assert from "node:assert/strict";
import { tickGroundDebris } from "./debris.js";
import {
  createMapRuntime, damageProp, MAPS, POWER_CRATE_MAP, POWER_CRATE_SPAWNS, solidProps
} from "./maps.js";
import { generateEncounter, resetConquestSelectSession } from "./conquest.js";

// Catalog: enough themed maps for the prototype.
{
  assert.ok(MAPS.length >= 6, `expected 6+ maps, got ${MAPS.length}`);
  const ids = MAPS.map((m) => m.id);
  for (const required of [
    "battlefield", "city", "desert", "forest", "yard", "ruins", "docks"
  ]) {
    assert.ok(ids.includes(required), `missing map ${required}`);
  }
  for (const map of MAPS) {
    assert.ok(map.platforms?.length, `${map.id} needs platforms`);
    assert.ok(map.spawnPoints?.training && map.spawnPoints?.conquest);
    assert.ok(map.name && map.theme && map.backdrop);
  }
}

// Power-up crate spawn anchors + density config on every map runtime.
{
  for (const map of MAPS) {
    assert.ok(POWER_CRATE_SPAWNS[map.id]?.length, `${map.id} power crate spawns`);
    assert.ok(POWER_CRATE_MAP[map.id], `${map.id} power crate density`);
    const runtime = createMapRuntime(map.id);
    assert.ok(runtime.powerCrateSpawns?.length);
    assert.ok(runtime.powerCrateConfig?.maxConcurrent >= 2);
  }
}

// Breakable prop is destroyed after enough damage.
{
  const runtime = createMapRuntime("desert");
  const cactus = runtime.props.find((p) => p.kind === "cactus");
  assert.ok(cactus, "desert should have cactus cover");
  const game = { effects: [], props: runtime.props, groundDebris: [], platforms: runtime.platforms };
  const hits = Math.ceil(cactus.hp / 12) + 1;
  for (let i = 0; i < hits; i++) {
    damageProp(cactus, 12, game, cactus.x + 10, cactus.y + 10);
  }
  assert.equal(cactus.destroyed, true);
  assert.equal(cactus.blocksProjectiles, false);
  assert.ok(game.effects.some((e) => e.type === "debris"));
  assert.ok(game.groundDebris.some((p) => p.material === "plant"));
}

// Trees leave wood + canopy scraps; map crates leave wood jigsaw; pipes leave metal.
{
  const forest = createMapRuntime("forest");
  const tree = forest.props.find((p) => p.kind === "tree");
  assert.ok(tree);
  const treeGame = {
    effects: [], props: forest.props, groundDebris: [], platforms: forest.platforms
  };
  damageProp(tree, tree.hp, treeGame, tree.x + 10, tree.y + 40);
  assert.equal(tree.destroyed, true);
  assert.ok(treeGame.groundDebris.filter((p) => p.material === "wood").length >= 8);
  assert.ok(treeGame.groundDebris.filter((p) => p.material === "plant").length >= 6);

  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  assert.ok(crate, "yard should have crates");
  const crateGame = {
    effects: [], props: yard.props, groundDebris: [], platforms: yard.platforms
  };
  damageProp(crate, crate.hp, crateGame, crate.x + 10, crate.y + 10);
  assert.equal(crate.destroyed, true);
  const wood = crateGame.groundDebris.filter((p) => p.material === "wood");
  assert.equal(wood.length, 16, "full 4x4 wood crate jigsaw");
  assert.ok(wood.every((p) => p.kind === "tile"));
  assert.ok(wood.every((p) => Array.isArray(p.verts) && p.verts.length >= 3));

  const pipe = yard.props.find((p) => p.kind === "pipe")
    || createMapRuntime("battlefield").props.find((p) => p.kind === "pipe");
  if (pipe) {
    const pipeGame = {
      effects: [], props: [pipe], groundDebris: [], platforms: yard.platforms
    };
    damageProp(pipe, pipe.hp, pipeGame, pipe.x + 10, pipe.y + 5);
    assert.ok(pipeGame.groundDebris.every((p) => p.material === "metal"));
  }
}

// Debris settled on a breakable falls again when that support is destroyed.
{
  const yard = createMapRuntime("yard");
  const crate = yard.props.find((p) => p.kind === "crate");
  assert.ok(crate);
  const groundY = crate.y;
  const game = {
    effects: [],
    props: yard.props,
    groundDebris: [],
    platforms: yard.platforms
  };
  // Pretend scrap already landed on top of the crate.
  const scrap = {
    material: "metal",
    kind: "panel",
    x: crate.x + crate.w / 2,
    y: groundY - 5,
    w: 14,
    h: 10,
    vx: 0,
    vy: 0,
    rot: 0,
    spin: 0,
    color: "#8a949e",
    grounded: true,
    settle: 1,
    testId: "support-check"
  };
  game.groundDebris.push(scrap);
  damageProp(crate, crate.hp, game, crate.x + 10, crate.y + 10);
  assert.equal(crate.destroyed, true);
  // Next ticks: support gone → wake and fall onto a real platform below.
  for (let i = 0; i < 180; i++) tickGroundDebris(game, 1 / 60);
  assert.ok(scrap.y > groundY - 5 + 8, `scrap fell (y=${scrap.y}, was ~${groundY - 5})`);
  assert.equal(scrap.grounded, true);
}

// Forest trunks are not solid — fighters walk through (no solid prop collision).
{
  const runtime = createMapRuntime("forest");
  const tree = runtime.props.find((p) => p.kind === "tree");
  assert.ok(tree, "forest should have trees");
  assert.equal(tree.solid, false);
  assert.equal(tree.blocksSight, false);
  assert.equal(tree.blocksProjectiles, true);
  const game = { props: runtime.props };
  assert.equal(solidProps(game).length, 0, "forest trees must not be solid landables");
  assert.ok(tree.canopy, "trees should have a canopy overlay");
}

// Conquest encounters include mapId (and name); reroll path uses generateEncounter.
{
  resetConquestSelectSession();
  const encounter = generateEncounter(100, () => 0.42);
  assert.ok(encounter.mapId, "encounter must include mapId");
  assert.ok(encounter.mapName, "encounter must include mapName");
  assert.ok(MAPS.some((m) => m.id === encounter.mapId));
}

console.log("maps.test.js passed.");
