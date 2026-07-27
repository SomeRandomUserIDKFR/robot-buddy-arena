import assert from "node:assert/strict";
import {
  awardSurvival, countLivingSwarm, ensureSurvivalProfile, initSurvivalState,
  listSurvivalSpawnPoints, pruneDeadSwarm, rollSurvivalEnemySpec, spawnSurvivalEnemy,
  survivalBand, SURVIVAL_KITS, tickSurvival
} from "./survival.js";
import {
  ensureEconomyProfile, ensureEquipmentProfile, STARTING_CYBER
} from "./equipment.js";
import { DEFAULT_PROFILE } from "./config.js";
import { Fighter } from "./combat.js";

const clone = (value) => structuredClone(value);

function freshProfile() {
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  ensureEconomyProfile(profile, profile);
  ensureSurvivalProfile(profile, profile);
  return profile;
}

function seeded(seq) {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    return v;
  };
}

// Bands ramp with time.
{
  assert.equal(survivalBand(0).id, "green");
  assert.equal(survivalBand(0).kitPool, "bare");
  assert.ok(survivalBand(0).aiPool.includes("recruit"));
  assert.equal(survivalBand(60).id, "stir");
  assert.equal(survivalBand(120).id, "press");
  assert.equal(survivalBand(200).id, "heavy");
  assert.equal(survivalBand(300).id, "siege");
  assert.ok(survivalBand(0).maxAlive < survivalBand(300).maxAlive);
  assert.ok(survivalBand(0).spawnInterval > survivalBand(300).spawnInterval);
}

// Kits stay lower-tier (no elite nanotech toys).
{
  for (const [tier, kits] of Object.entries(SURVIVAL_KITS)) {
    assert.ok(kits.length >= 2, tier);
    for (const kit of kits) {
      assert.ok(kit.weapon);
      assert.notEqual(kit.weapon, "adaptive-nanotech-unit");
      assert.notEqual(kit.weapon, "strong-sniper");
    }
  }
}

// Enemy specs roll from the active band.
{
  const early = rollSurvivalEnemySpec(10, seeded([0, 0.1, 0.2, 0.3]));
  assert.ok(["recruit", "rookie"].includes(early.ai));
  assert.equal(early.loadout.weapon, "pulse-rifle");
  const late = rollSurvivalEnemySpec(300, seeded([0.9, 0.8, 0.7, 0.6]));
  assert.ok(["contender", "veteran"].includes(late.ai));
}

// Spawn points prefer far-side / conquest enemy anchors.
{
  const map = {
    id: "battlefield",
    spawnPoints: {
      conquest: {
        player: { x: 360, y: 1300 },
        buddy: { x: 580, y: 1300 },
        enemy1: { x: 2920, y: 1300 },
        enemy2: { x: 3150, y: 1300 }
      }
    }
  };
  const points = listSurvivalSpawnPoints(map);
  assert.ok(points.length >= 2);
  assert.ok(points.some((p) => p.x >= 2700));
}

// Init + spawn + prune + tick.
{
  const map = {
    id: "yard",
    spawnPoints: {
      conquest: {
        player: { x: 360, y: 1300 },
        buddy: { x: 580, y: 1300 },
        enemy1: { x: 2920, y: 1300 },
        enemy2: { x: 3150, y: 1300 }
      }
    }
  };
  const game = {
    mode: "survival",
    over: false,
    mapId: "yard",
    spawnPoints: map.spawnPoints,
    fighters: [
      { team: 0, human: true, dead: false, name: "YOU" },
      { team: 0, buddy: true, dead: false, name: "Pixel" }
    ],
    survival: initSurvivalState(map, () => 0),
    announcement: 0
  };
  assert.equal(game.survival.wave, 0);
  const enemy = spawnSurvivalEnemy(game, Fighter, seeded([0.2, 0.3, 0.4, 0.5]));
  assert.ok(enemy);
  assert.equal(enemy.team, 1);
  assert.equal(enemy.survivalSwarm, true);
  assert.equal(countLivingSwarm(game), 1);

  enemy.dead = true;
  tickSurvival(game, 0.016, Fighter, () => 0.5);
  assert.equal(game.survival.kills, 1);
  assert.equal(countLivingSwarm(game), 0);
  assert.equal(pruneDeadSwarm(game), 0);

  // Empty field + timer expiry starts a new wave burst.
  game.survival.nextSpawnIn = 0;
  tickSurvival(game, 0.05, Fighter, seeded([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  assert.ok(game.survival.wave >= 1);
  assert.ok(countLivingSwarm(game) >= 1);
}

// Awards: cyber/exp from performance; Ranking untouched; idempotent.
{
  const profile = freshProfile();
  const ranking = profile.ranking;
  const cyberBefore = profile.cyber;
  const lossy = awardSurvival(profile, {
    id: "surv-1", mode: "survival", waves: 4, kills: 12, time: 120
  });
  assert.ok(lossy.cyber > 0);
  assert.ok(lossy.exp > 0);
  assert.equal(lossy.rankingDelta, 0);
  assert.equal(profile.ranking, ranking);
  assert.equal(profile.cyber, cyberBefore + lossy.cyber);
  assert.equal(profile.survival.bestWaves, 4);
  assert.ok(lossy.best);

  const again = awardSurvival(profile, {
    id: "surv-1", mode: "survival", waves: 4, kills: 12, time: 120
  });
  assert.equal(again.cyber, 0);

  const train = awardSurvival(profile, {
    id: "t1", mode: "training", waves: 9, kills: 9, time: 999
  });
  assert.equal(train.cyber, 0);
  assert.equal(profile.cyber, cyberBefore + lossy.cyber);
  assert.ok(profile.cyber >= STARTING_CYBER);
}

console.log("survival.test.js: ok");
