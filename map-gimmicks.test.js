import assert from "node:assert/strict";
import { Fighter } from "./combat.js";
import { createMapRuntime } from "./maps.js";
import {
  GIMMICK_BY_MAP, gimmickSightMult, initMapGimmicks, isPlatformLandable,
  tickMapGimmicks
} from "./map-gimmicks.js";

const MAP_IDS = [
  "battlefield", "city", "desert", "forest", "yard", "ruins", "docks"
];

{
  for (const id of MAP_IDS) {
    assert.ok(GIMMICK_BY_MAP[id], `${id} needs a gimmick`);
    const runtime = createMapRuntime(id);
    const game = {
      mapId: runtime.id,
      platforms: runtime.platforms,
      props: runtime.props,
      fighters: [],
      effects: []
    };
    const g = initMapGimmicks(game);
    assert.ok(g, `${id} init gimmick`);
    assert.equal(g.kind, GIMMICK_BY_MAP[id]);
    tickMapGimmicks(game, 0.05);
  }
}

{
  // City elevators move platforms over time.
  const runtime = createMapRuntime("city");
  const game = {
    mapId: "city",
    platforms: runtime.platforms,
    props: runtime.props,
    fighters: [],
    effects: []
  };
  initMapGimmicks(game);
  assert.ok(game.gimmick.elevators?.length >= 1, "city has elevators");
  const el = game.gimmick.elevators[0];
  const y0 = el.platform.y;
  tickMapGimmicks(game, 1.5);
  assert.notEqual(el.platform.y, y0, "elevator platform shifted");
}

{
  // Desert sandstorm cuts sight.
  const runtime = createMapRuntime("desert");
  const game = {
    mapId: "desert",
    platforms: runtime.platforms,
    props: runtime.props,
    fighters: [],
    effects: []
  };
  initMapGimmicks(game);
  game.gimmick.cooldown = 0;
  tickMapGimmicks(game, 0.05);
  assert.ok(game.gimmick.stormT > 0, "storm started");
  assert.ok(gimmickSightMult(game) < 1, "sight reduced in storm");
}

{
  // Ruins crumble after standing long enough.
  const runtime = createMapRuntime("ruins");
  const game = {
    mapId: "ruins",
    platforms: runtime.platforms,
    props: runtime.props,
    fighters: [],
    effects: []
  };
  initMapGimmicks(game);
  const ledge = game.gimmick.unstable?.[0];
  assert.ok(ledge, "ruins has unstable ledge");
  const victim = new Fighter({
    x: ledge.x + 4,
    y: ledge.y - 46,
    grounded: true,
    hp: 500,
    maxHp: 500
  });
  game.fighters = [victim];
  for (let i = 0; i < 40; i++) tickMapGimmicks(game, 0.1);
  assert.equal(ledge.crumbled, true, "ledge crumbled under feet");
  assert.equal(isPlatformLandable(ledge), false);
}

{
  // Docks tide line moves and soaks a fighter below it.
  const runtime = createMapRuntime("docks");
  const game = {
    mapId: "docks",
    platforms: runtime.platforms,
    props: runtime.props,
    fighters: [],
    effects: []
  };
  initMapGimmicks(game);
  const swimmer = new Fighter({
    x: 600, y: 1500, hp: 500, maxHp: 500, grounded: false, vy: 0, vx: 0
  });
  game.fighters = [swimmer];
  game.gimmick.t = game.gimmick.period * 0.25; // near high tide
  const hp0 = swimmer.hp;
  tickMapGimmicks(game, 0.2);
  assert.ok(game.gimmick.tideY < game.gimmick.baseY, "tide rose");
  assert.ok(swimmer.hp < hp0 || swimmer.vy < 0, "tide affects submerged fighter");
}

{
  // Battlefield wind eventually pulses.
  const runtime = createMapRuntime("battlefield");
  const game = {
    mapId: "battlefield",
    platforms: runtime.platforms,
    props: runtime.props,
    fighters: [
      new Fighter({ x: 400, y: 700, grounded: false, vx: 0, hp: 500, maxHp: 500 })
    ],
    effects: []
  };
  initMapGimmicks(game);
  game.gimmick.cooldown = 0;
  tickMapGimmicks(game, 0.05);
  assert.ok(game.gimmick.pulseT > 0, "crosswind pulse");
  const vx0 = game.fighters[0].vx;
  tickMapGimmicks(game, 0.1);
  assert.notEqual(game.fighters[0].vx, vx0, "wind pushes fighter");
}

console.log("map-gimmicks.test.js passed.");
