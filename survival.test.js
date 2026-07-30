import assert from "node:assert/strict";
import {
  awardSurvival, countLivingSwarm, ensureSurvivalProfile, initSurvivalState,
  listNewSurvivalMilestones, listSurvivalSpawnPoints, pruneDeadSwarm,
  rollSurvivalEnemySpec, spawnSurvivalEnemy, survivalBand, survivalMilestoneMet,
  SURVIVAL_BAND_ORDER, SURVIVAL_KITS, SURVIVAL_MILESTONES, tickSurvival,
  tickSurvivalMilestones
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

// Bands ramp with time — including post-siege milestones.
{
  assert.equal(survivalBand(0).id, "green");
  assert.equal(survivalBand(0).kitPool, "bare");
  assert.ok(survivalBand(0).aiPool.includes("recruit"));
  assert.equal(survivalBand(60).id, "stir");
  assert.equal(survivalBand(120).id, "press");
  assert.equal(survivalBand(200).id, "heavy");
  assert.equal(survivalBand(300).id, "siege");
  assert.equal(survivalBand(400).id, "breach");
  assert.equal(survivalBand(520).id, "onslaught");
  assert.equal(survivalBand(700).id, "collapse");
  assert.equal(survivalBand(400).kitPool, "peak");
  assert.ok(survivalBand(0).maxAlive < survivalBand(700).maxAlive);
  assert.ok(survivalBand(0).spawnInterval > survivalBand(700).spawnInterval);
  assert.ok(SURVIVAL_BAND_ORDER.includes("collapse"));
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

// Milestone thresholds + one-time unlock bonuses.
{
  assert.ok(SURVIVAL_MILESTONES.length >= 12);
  assert.equal(survivalMilestoneMet(
    SURVIVAL_MILESTONES.find((m) => m.id === "hold-60"),
    { time: 59 }
  ), false);
  assert.equal(survivalMilestoneMet(
    SURVIVAL_MILESTONES.find((m) => m.id === "hold-60"),
    { time: 60 }
  ), true);
  assert.equal(survivalMilestoneMet(
    SURVIVAL_MILESTONES.find((m) => m.id === "band-breach"),
    { time: 400, bandId: "breach" }
  ), true);
  assert.equal(survivalMilestoneMet(
    SURVIVAL_MILESTONES.find((m) => m.id === "band-siege"),
    { bandId: "collapse" }
  ), true);

  const profile = freshProfile();
  const fresh = listNewSurvivalMilestones(profile, {
    time: 200, waves: 6, kills: 30, bandId: "heavy"
  });
  assert.ok(fresh.some((m) => m.id === "hold-60"));
  assert.ok(fresh.some((m) => m.id === "waves-5"));
  assert.ok(fresh.some((m) => m.id === "kills-25"));
  assert.ok(!fresh.some((m) => m.id === "band-siege"));

  const cyberBefore = profile.cyber;
  const awarded = awardSurvival(profile, {
    id: "surv-mile-1", mode: "survival",
    waves: 6, kills: 30, time: 200, bandId: "heavy"
  });
  assert.ok(awarded.milestones.length >= 3);
  assert.ok(awarded.milestoneCyber > 0);
  assert.ok(profile.survival.milestones.includes("hold-60"));
  assert.ok(profile.cyber > cyberBefore);

  // Second long run does not re-pay the same milestones.
  const again = awardSurvival(profile, {
    id: "surv-mile-2", mode: "survival",
    waves: 6, kills: 30, time: 200, bandId: "heavy"
  });
  assert.equal(again.milestones.length, 0);
  assert.equal(again.milestoneCyber, 0);
}

// Mid-run milestone flash.
{
  const state = initSurvivalState({
    id: "yard",
    spawnPoints: {
      conquest: {
        enemy1: { x: 2920, y: 1300 },
        enemy2: { x: 3150, y: 1300 }
      }
    }
  }, () => 0);
  state.elapsed = 60;
  state.wave = 5;
  state.kills = 0;
  state.bandId = "stir";
  const hit = tickSurvivalMilestones(state, []);
  assert.ok(hit);
  assert.ok(state.milestonesFlashed.includes(hit.id));
  assert.ok(state.announcement > 0);
  assert.ok(state.milestoneAnnounce);
  const again = tickSurvivalMilestones(state, []);
  // May unlock another unmet milestone in the same stats — but never re-flash same id.
  if (again) assert.notEqual(again.id, hit.id);
  assert.ok(state.milestonesFlashed.includes(hit.id));
}

console.log("survival.test.js: ok");
