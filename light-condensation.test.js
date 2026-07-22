import assert from "node:assert/strict";
import { Fighter } from "./combat.js";
import {
  applyLoadout, DEFAULT_LOADOUT, GEAR_BY_ID, LIGHT_CONDENSATION_ID, SLOT_LABELS,
  SLOT_ORDER
} from "./equipment.js";
import {
  createLightCondensationProp, inLightCondensationReveal, isLightCondensation,
  LIGHT_CONDENSATION_BLOCK_MULT, LIGHT_CONDENSATION_COOLDOWN,
  LIGHT_CONDENSATION_REVEAL_MULT, LIGHT_CONDENSATION_SIZE,
  lightCondensationBlockSide, lightCondensationRevealRadius,
  lightCondensationSightBox, listLightCondensationProps, tickLightCondensation,
  tryLightCondensation
} from "./light-condensation.js";
import { damageProp, sightBlockers } from "./maps.js";
import { canGrabBreakable } from "./throw-breakable.js";
import { hasLineOfSight, visibleToTeam } from "./vision.js";

assert.equal(GEAR_BY_ID[LIGHT_CONDENSATION_ID].slot, "extensionSecondary");
assert.equal(GEAR_BY_ID[LIGHT_CONDENSATION_ID].lightCondensation, true);
assert.ok(SLOT_ORDER.includes("extensionSecondary"));
assert.equal(SLOT_LABELS.extensionSecondary, "Extension");
assert.equal(LIGHT_CONDENSATION_COOLDOWN, 10);
assert.equal(
  lightCondensationRevealRadius(),
  LIGHT_CONDENSATION_SIZE * LIGHT_CONDENSATION_REVEAL_MULT
);
assert.equal(
  lightCondensationBlockSide(),
  LIGHT_CONDENSATION_SIZE * LIGHT_CONDENSATION_BLOCK_MULT
);

{
  const fighter = applyLoadout(new Fighter({
    x: 400, y: 700, team: 0, grounded: true, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: LIGHT_CONDENSATION_ID
  });
  assert.ok(isLightCondensation(fighter));
  assert.equal(fighter.lightCondensation, true);

  const game = {
    props: [],
    effects: [],
    fighters: [fighter],
    platforms: [{ x: 0, y: 760, w: 2000, h: 40 }]
  };
  const prop = tryLightCondensation(fighter, game);
  assert.ok(prop);
  assert.equal(game.props.length, 1);
  assert.equal(prop.kind, "lightCondensation");
  assert.equal(prop.w, LIGHT_CONDENSATION_SIZE);
  assert.equal(prop.h, LIGHT_CONDENSATION_SIZE);
  assert.equal(prop.solid, false);
  assert.equal(prop.blocksProjectiles, true);
  assert.equal(prop.groundDebrisDropped, true);
  assert.ok(fighter.lightCondensationCd > 0);
  assert.equal(canGrabBreakable(prop), false, "glare nodes are not grabbable");

  // Inflated sight box is 5× the sprite.
  const box = lightCondensationSightBox(prop);
  assert.ok(box);
  assert.equal(box.w, LIGHT_CONDENSATION_SIZE * LIGHT_CONDENSATION_BLOCK_MULT);
  assert.equal(box.h, LIGHT_CONDENSATION_SIZE * LIGHT_CONDENSATION_BLOCK_MULT);
  const blockers = sightBlockers(game);
  assert.ok(blockers.some((b) => b.lightCondensation && b.w === box.w));

  // Ally reveal: target inside 10× radius is team-visible via glare.
  const enemy = new Fighter({
    x: prop.x + 40, y: prop.y, team: 1, grounded: true
  });
  game.fighters.push(enemy);
  assert.equal(inLightCondensationReveal(game, 0, enemy), true);
  assert.equal(visibleToTeam(game, fighter, enemy), true);

  // Break clears reveal + sight block.
  damageProp(prop, 999, game, prop.x + prop.w / 2, prop.y + prop.h / 2);
  assert.equal(prop.destroyed, true);
  assert.equal(listLightCondensationProps(game).length, 0);
  assert.equal(inLightCondensationReveal(game, 0, enemy), false);
}

{
  // Cooldown gate.
  const fighter = applyLoadout(new Fighter({
    x: 200, y: 500, team: 0, aim: 0
  }), {
    ...DEFAULT_LOADOUT,
    extensionSecondary: LIGHT_CONDENSATION_ID
  });
  const game = { props: [], effects: [], fighters: [fighter] };
  assert.ok(tryLightCondensation(fighter, game));
  assert.equal(tryLightCondensation(fighter, game), null);
  tickLightCondensation(fighter, LIGHT_CONDENSATION_COOLDOWN + 0.01);
  assert.ok(tryLightCondensation(fighter, game));
  assert.equal(game.props.length, 2);
}

{
  // Inflated glare blocks LOS even though the sprite is tiny.
  const glare = createLightCondensationProp(500, 500, { team: 0 });
  const left = new Fighter({ x: 400, y: 500 - 23, team: 0 });
  const right = new Fighter({ x: 600, y: 500 - 23, team: 1 });
  const game = {
    props: [glare],
    platforms: [],
    fighters: [left, right]
  };
  assert.equal(
    hasLineOfSight(game, left, right),
    false,
    "5× glare box should cut LOS across the node"
  );
}

{
  // Without the extension equipped, plant is a no-op.
  const fighter = applyLoadout(new Fighter({ x: 100, y: 100 }), DEFAULT_LOADOUT);
  assert.equal(isLightCondensation(fighter), false);
  assert.equal(tryLightCondensation(fighter, { props: [] }), null);
}

console.log("light-condensation.test.js passed.");
