import assert from "node:assert/strict";
import { Fighter, hit } from "./combat.js";
import { tickGroundDebris } from "./debris.js";
import {
  applyHpDamage, applyLoadout, beginRetractableMorph, DEFAULT_LOADOUT, GEAR_BY_ID,
  healFighter, resolveRetractableArmor, RETRACTABLE_ARMOR_SPEED, RETRACTABLE_MORPH_DURATION,
  retractableSpeedMultiplier, syncRetractableDisplayedHp, tickRetractableArmor,
  toggleRetractableArmor
} from "./equipment.js";

const loadout = (overrides = {}) => ({ ...DEFAULT_LOADOUT, ...overrides });

function finishMorph(fighter) {
  tickRetractableArmor(fighter, RETRACTABLE_MORPH_DURATION + 0.01);
  assert.equal(fighter.retractableMorphing, false);
}

// Catalog: body + shield retractable options.
{
  const body = GEAR_BY_ID["retractable-armor"];
  const shell = GEAR_BY_ID["retractable-shell"];
  assert.ok(body?.retractableArmor?.hp > 0);
  assert.ok(shell?.retractableArmor?.hp > 0);
  assert.equal(body.slot, "body");
  assert.equal(shell.slot, "shield");
  assert.equal(shell.durability, 0);
}

// Higher pool wins when both equipped.
{
  const both = resolveRetractableArmor(loadout({
    body: "retractable-armor",
    shield: "retractable-shell"
  }));
  assert.equal(both.hp, GEAR_BY_ID["retractable-armor"].retractableArmor.hp);
  assert.equal(
    resolveRetractableArmor(loadout({ shield: "retractable-shell" })).hp,
    GEAR_BY_ID["retractable-shell"].retractableArmor.hp
  );
}

// F deploy adds armor HP to displayed max/current; retract removes it; speed slows while on.
{
  const fighter = applyLoadout(new Fighter({}), loadout({ body: "retractable-armor" }));
  const coreMax = fighter.coreMaxHp;
  const armorMax = fighter.retractableMax;
  assert.ok(armorMax >= 100);
  assert.equal(fighter.retractableDeployed, false);
  assert.equal(fighter.maxHp, coreMax);
  assert.equal(retractableSpeedMultiplier(fighter), 1);

  assert.equal(toggleRetractableArmor(fighter), true);
  assert.equal(fighter.retractableMorphing, true);
  assert.equal(retractableSpeedMultiplier(fighter), RETRACTABLE_ARMOR_SPEED);
  finishMorph(fighter);
  assert.equal(fighter.retractableDeployed, true);
  assert.equal(fighter.maxHp, coreMax + armorMax);
  assert.equal(fighter.hp, fighter.coreHp + fighter.retractableHp);
  assert.equal(retractableSpeedMultiplier(fighter), RETRACTABLE_ARMOR_SPEED);

  assert.equal(toggleRetractableArmor(fighter), true);
  finishMorph(fighter);
  assert.equal(fighter.retractableDeployed, false);
  assert.equal(fighter.maxHp, coreMax);
  assert.equal(fighter.hp, fighter.coreHp);
}

// Damage drains armor first while deployed, then core.
{
  const fighter = applyLoadout(new Fighter({}), loadout({ body: "retractable-armor" }));
  beginRetractableMorph(fighter, true);
  finishMorph(fighter);
  const coreBefore = fighter.coreHp;
  const armorBefore = fighter.retractableHp;
  applyHpDamage(fighter, 40);
  assert.equal(fighter.retractableHp, armorBefore - 40);
  assert.equal(fighter.coreHp, coreBefore);
  syncRetractableDisplayedHp(fighter);
  assert.equal(fighter.hp, fighter.coreHp + fighter.retractableHp);

  applyHpDamage(fighter, fighter.retractableHp + 25);
  assert.equal(fighter.retractableHp, 0);
  assert.equal(fighter.coreHp, coreBefore - 25);
  // Empty armor starts a retract morph.
  assert.equal(fighter.retractableMorphing, true);
  assert.equal(fighter.retractableMorphTo, "off");
}

// Heal prefers core, then armor while deployed.
{
  const fighter = applyLoadout(new Fighter({}), loadout({ body: "retractable-armor" }));
  beginRetractableMorph(fighter, true);
  finishMorph(fighter);
  fighter.coreHp = fighter.coreMaxHp - 30;
  fighter.retractableHp = fighter.retractableMax - 20;
  syncRetractableDisplayedHp(fighter);
  healFighter(fighter, 40);
  assert.equal(fighter.coreHp, fighter.coreMaxHp);
  assert.equal(fighter.retractableHp, fighter.retractableMax - 10);
}

// Combat hit path uses armor buffer.
{
  const defender = applyLoadout(new Fighter({
    x: 400, y: 400, team: 0, aim: 0
  }), loadout({ body: "retractable-armor" }));
  const attacker = applyLoadout(new Fighter({
    x: 520, y: 400, team: 1
  }), DEFAULT_LOADOUT);
  beginRetractableMorph(defender, true);
  finishMorph(defender);
  const game = {
    fighters: [defender, attacker],
    effects: [],
    mode: "conquest",
    stats: {},
    elapsed: 0,
    lastShotAtPlayer: -99
  };
  const armorBefore = defender.retractableHp;
  const coreBefore = defender.coreHp;
  hit(defender, attacker, 35, Math.PI, game);
  assert.equal(defender.coreHp, coreBefore);
  assert.equal(defender.retractableHp, armorBefore - 35);
}

// Breaking armor drops lasting helmet/plate debris for the match.
{
  const fighter = applyLoadout(new Fighter({
    x: 400, y: 300, team: 0, aim: 0, vx: 40
  }), loadout({ body: "retractable-armor" }));
  beginRetractableMorph(fighter, true);
  finishMorph(fighter);
  const game = {
    platforms: [{ x: 0, y: 500, w: 2000, h: 40 }],
    props: [],
    groundDebris: [],
    effects: []
  };
  applyHpDamage(fighter, fighter.retractableHp, game);
  assert.equal(fighter.retractableHp, 0);
  assert.equal(fighter.armorDebrisDropped, true);
  assert.ok(game.groundDebris.length >= 8, "helmet + plate shards");
  assert.ok(game.groundDebris.some((piece) => piece.kind === "helmet"));
  assert.ok(game.groundDebris.some((piece) => piece.kind === "breast"));
  assert.ok(game.effects.some((effect) => effect.type === "debris" && effect.kind === "armor"));

  // Pieces settle on the platform and stay for the match (no life expiry).
  for (let i = 0; i < 120; i++) tickGroundDebris(game, 1 / 60);
  assert.ok(game.groundDebris.every((piece) => piece.grounded));
  assert.equal(game.groundDebris.length >= 8, true);

  // Manual / second break does not duplicate debris.
  const count = game.groundDebris.length;
  applyHpDamage(fighter, 10, game);
  assert.equal(game.groundDebris.length, count);
}

console.log("Retractable armor suite passed.");
