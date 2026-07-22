import assert from "node:assert/strict";
import { Fighter } from "./combat.js";
import {
  RED_BARREL_BLAST_DAMAGE, RED_BARREL_BLAST_RADIUS, RED_BARREL_KIND
} from "./explosive-barrel.js";
import {
  createMapProp, createMapRuntime, damageProp, MAP_PROP_KINDS
} from "./maps.js";
import { SIZE } from "./config.js";

assert.ok(MAP_PROP_KINDS.includes("redBarrel"));
assert.equal(RED_BARREL_KIND, "redBarrel");
assert.equal(RED_BARREL_BLAST_DAMAGE, 48);
assert.equal(RED_BARREL_BLAST_RADIUS, 150);

{
  const barrel = createMapProp("redBarrel", 400, 700);
  assert.equal(barrel.kind, "redBarrel");
  assert.equal(barrel.explosive, true);
  assert.equal(barrel.hp, 40);
  assert.equal(barrel.w, 34);
  assert.equal(barrel.h, 48);
}

{
  // Destroying a red barrel deals mid-tier splash to a nearby fighter.
  const barrel = createMapProp("redBarrel", 500, 800);
  const fighter = new Fighter({
    x: 520, y: 760, team: 1, aim: 0, hp: 500, maxHp: 500
  });
  fighter.shieldMaxDurability = 0;
  fighter.shieldDurability = 0;
  const before = fighter.hp;
  const game = {
    effects: [],
    props: [barrel],
    fighters: [fighter],
    groundDebris: [],
    platforms: []
  };
  damageProp(barrel, barrel.hp, game, barrel.x + barrel.w / 2, barrel.y + barrel.h / 2);
  assert.equal(barrel.destroyed, true);
  assert.ok(barrel._blastDone);
  assert.ok(fighter.hp < before, "blast should damage nearby fighter");
  const lost = before - fighter.hp;
  assert.ok(lost > 15 && lost <= RED_BARREL_BLAST_DAMAGE + 1, `mid-tier splash, lost=${lost}`);
  assert.ok(game.effects.some((e) => e.type === "explosion"));
  assert.ok(game.groundDebris.some((p) => p.material === "metal"));
}

{
  // Far fighter is outside the blast.
  const barrel = createMapProp("redBarrel", 400, 800);
  const fighter = new Fighter({
    x: 400 + RED_BARREL_BLAST_RADIUS + 80,
    y: 760,
    team: 1,
    aim: 0,
    hp: 500,
    maxHp: 500
  });
  fighter.shieldMaxDurability = 0;
  const before = fighter.hp;
  const game = {
    effects: [],
    props: [barrel],
    fighters: [fighter],
    groundDebris: [],
    platforms: []
  };
  damageProp(barrel, barrel.hp, game);
  assert.equal(fighter.hp, before);
}

{
  // Chain reaction: one red barrel can cook another nearby.
  const a = createMapProp("redBarrel", 600, 900);
  const b = createMapProp("redBarrel", 640, 900);
  const game = {
    effects: [],
    props: [a, b],
    fighters: [],
    groundDebris: [],
    platforms: []
  };
  damageProp(a, a.hp, game);
  assert.equal(a.destroyed, true);
  assert.equal(b.destroyed, true, "nearby red barrel should chain");
  assert.ok(game.effects.filter((e) => e.type === "explosion").length >= 2);
}

{
  // Brown barrels do not explode.
  const barrel = createMapProp("barrel", 400, 700);
  const fighter = new Fighter({
    x: 410, y: 660, team: 1, aim: 0, hp: 500, maxHp: 500
  });
  const before = fighter.hp;
  const game = {
    effects: [],
    props: [barrel],
    fighters: [fighter],
    groundDebris: [],
    platforms: []
  };
  damageProp(barrel, barrel.hp, game);
  assert.equal(barrel.destroyed, true);
  assert.equal(fighter.hp, before);
  assert.ok(!game.effects.some((e) => e.type === "explosion"));
}

{
  // Maps place a sparse handful of red barrels.
  const yard = createMapRuntime("yard");
  const reds = yard.props.filter((p) => p.kind === "redBarrel");
  assert.ok(reds.length >= 1, "yard should place red barrels");
  assert.ok(reds.every((p) => p.explosive));

  const docks = createMapRuntime("docks");
  assert.ok(docks.props.some((p) => p.kind === "redBarrel"));

  const city = createMapRuntime("city");
  assert.ok(city.props.some((p) => p.kind === "redBarrel"));
}

{
  // Centered fighter takes near-full blast (SIZE-aware centers).
  const barrel = createMapProp("redBarrel", 1000, 1000);
  const cx = barrel.x + barrel.w / 2;
  const cy = barrel.y + barrel.h / 2;
  const fighter = new Fighter({
    x: cx - SIZE / 2,
    y: cy - SIZE / 2,
    team: 0,
    aim: 0,
    hp: 500,
    maxHp: 500
  });
  fighter.shieldMaxDurability = 0;
  const game = {
    effects: [],
    props: [barrel],
    fighters: [fighter],
    groundDebris: [],
    platforms: []
  };
  damageProp(barrel, barrel.hp, game, cx, cy);
  const lost = 500 - fighter.hp;
  assert.ok(
    Math.abs(lost - RED_BARREL_BLAST_DAMAGE) < 0.5,
    `center should take full ${RED_BARREL_BLAST_DAMAGE}, got ${lost}`
  );
}

console.log("explosive-barrel.test.js passed.");
