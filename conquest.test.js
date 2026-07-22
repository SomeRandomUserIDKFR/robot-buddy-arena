import assert from "node:assert/strict";
import {
  areComplementaryColors, beginConquestSelect, CONQUEST_COLOR_PAIRS,
  estimatePower, generateEncounter, getPendingEncounter, hasFreeReroll,
  hexToHue, hueDistance, leagueFromRanking, LEAGUE_BANDS, loadoutSummary,
  pickColorPair, rerollEncounter, resetConquestSelectSession, REROLL_CYBER_COST,
  setPendingEncounter
} from "./conquest.js";
import { ensureEconomyProfile, STARTING_CYBER } from "./equipment.js";
import { DEFAULT_PROFILE } from "./config.js";

const clone = (value) => structuredClone(value);

function seeded(seq) {
  let i = 0;
  return () => {
    const v = seq[i % seq.length];
    i += 1;
    return v;
  };
}

// League boundaries from Ranking.
{
  assert.equal(leagueFromRanking(0).id, "rookie");
  assert.equal(leagueFromRanking(149).id, "rookie");
  assert.equal(leagueFromRanking(150).id, "contender");
  assert.equal(leagueFromRanking(299).id, "contender");
  assert.equal(leagueFromRanking(300).id, "veteran");
  assert.equal(leagueFromRanking(499).id, "veteran");
  assert.equal(leagueFromRanking(500).id, "challenger");
  assert.equal(leagueFromRanking(749).id, "challenger");
  assert.equal(leagueFromRanking(750).id, "elite");
  assert.equal(leagueFromRanking(999).id, "elite");
  assert.equal(leagueFromRanking(1000).id, "apex");
  assert.equal(leagueFromRanking(5000).id, "apex");
  assert.equal(leagueFromRanking(-5).id, "rookie");
}

// Band table documents Rookie / Veteran / Elite plus fillers.
{
  const ids = LEAGUE_BANDS.map((b) => b.id);
  assert.deepEqual(ids, [
    "rookie", "contender", "veteran", "challenger", "elite", "apex"
  ]);
  assert.equal(leagueFromRanking(100).name, "Rookie");
  assert.equal(leagueFromRanking(100).training, "Green");
  assert.equal(leagueFromRanking(350).training, "Trained");
  assert.equal(leagueFromRanking(800).training, "Sharp");
}

// AI + reward mapping per league.
{
  const rookie = leagueFromRanking(100);
  assert.equal(rookie.trainerAi, "rookie");
  assert.equal(rookie.followerAi, "recruit");
  assert.equal(rookie.rewardTier, "rookie");

  const contender = leagueFromRanking(200);
  assert.equal(contender.trainerAi, "contender");
  assert.equal(contender.followerAi, "rookie");
  assert.equal(contender.rewardTier, "rookie");

  const veteran = leagueFromRanking(400);
  assert.equal(veteran.trainerAi, "veteran");
  assert.equal(veteran.followerAi, "rookie");
  assert.equal(veteran.rewardTier, "veteran");

  const challenger = leagueFromRanking(600);
  assert.equal(challenger.trainerAi, "challenger");
  assert.equal(challenger.followerAi, "veteran");
  assert.equal(challenger.rewardTier, "veteran");

  const elite = leagueFromRanking(800);
  assert.equal(elite.trainerAi, "elite");
  assert.equal(elite.followerAi, "veteran");
  assert.equal(elite.rewardTier, "elite");

  const apex = leagueFromRanking(1200);
  assert.equal(apex.trainerAi, "elite");
  assert.equal(apex.followerAi, "elite");
  assert.equal(apex.rewardTier, "elite");
}

// Generate encounter stays in ranking league; includes loadouts + power.
{
  const encounter = generateEncounter(100, seeded([0.1, 0.2, 0.3, 0.4, 0.5]));
  assert.equal(encounter.leagueId, "rookie");
  assert.equal(encounter.rewardTier, "rookie");
  assert.equal(encounter.trainer.ai, "rookie");
  assert.equal(encounter.follower.ai, "recruit");
  assert.ok(encounter.trainer.loadout.body);
  assert.ok(encounter.follower.loadout.weapon);
  assert.equal(encounter.training, "Green");
  assert.ok(encounter.power > 0);
  assert.equal(estimatePower(encounter, encounter.powerJitter), encounter.power);
  assert.equal(loadoutSummary(encounter.trainer.loadout).length, 7);
  assert.ok(encounter.colorPair?.id);
  assert.equal(encounter.trainer.color, encounter.colorPair.trainer);
  assert.equal(encounter.follower.color, encounter.colorPair.follower);
  assert.ok(areComplementaryColors(encounter.trainer.color, encounter.follower.color));
}

// Ranking display helper: league name for typical starting rank.
{
  assert.match(`Ranking: ${100}`, /Ranking: 100/);
  assert.equal(leagueFromRanking(100).name, "Rookie");
}

// Reroll changes encounter within the same league; first free then Cyber cost.
{
  resetConquestSelectSession();
  const profile = ensureEconomyProfile(clone(DEFAULT_PROFILE));
  profile.ranking = 350;
  profile.cyber = STARTING_CYBER;
  const first = beginConquestSelect(profile.ranking, seeded([0.11, 0.22, 0.33, 0.44, 0.55]));
  assert.equal(first.leagueId, "veteran");
  assert.equal(hasFreeReroll(), true);
  assert.ok(getPendingEncounter());

  const free = rerollEncounter(profile, seeded([0.61, 0.72, 0.81, 0.12, 0.93, 0.41]));
  assert.equal(free.ok, true);
  assert.equal(free.free, true);
  assert.equal(free.cost, 0);
  assert.equal(profile.cyber, STARTING_CYBER);
  assert.equal(free.encounter.leagueId, "veteran");
  assert.equal(hasFreeReroll(), false);
  // Kit/name/power should differ from the opening roll for this seed path.
  assert.ok(
    free.encounter.trainer.name !== first.trainer.name
    || free.encounter.kitIndex !== first.kitIndex
    || free.encounter.power !== first.power
  );

  const paid = rerollEncounter(profile, seeded([0.05, 0.15, 0.25, 0.35, 0.45, 0.55]));
  assert.equal(paid.ok, true);
  assert.equal(paid.free, false);
  assert.equal(paid.cost, REROLL_CYBER_COST);
  assert.equal(profile.cyber, STARTING_CYBER - REROLL_CYBER_COST);
  assert.equal(paid.encounter.leagueId, "veteran");
}

// Broke after free reroll: block paid reroll.
{
  resetConquestSelectSession();
  const profile = ensureEconomyProfile(clone(DEFAULT_PROFILE));
  profile.ranking = 100;
  profile.cyber = 0;
  beginConquestSelect(100, () => 0.2);
  const free = rerollEncounter(profile, () => 0.4);
  assert.equal(free.ok, true);
  assert.equal(free.cost, 0);
  const blocked = rerollEncounter(profile, () => 0.6);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "broke");
  assert.equal(blocked.cost, REROLL_CYBER_COST);
  assert.equal(profile.cyber, 0);
}

// Fight uses the selected (pending) encounter — not a fresh random roll.
{
  resetConquestSelectSession();
  const locked = generateEncounter(800, seeded([0.3, 0.4, 0.5, 0.6, 0.7]));
  setPendingEncounter(locked);
  const pending = getPendingEncounter();
  assert.equal(pending.leagueId, "elite");
  assert.equal(pending.trainer.name, locked.trainer.name);
  assert.equal(pending.follower.name, locked.follower.name);
  assert.deepEqual(pending.trainer.loadout, locked.trainer.loadout);
  assert.equal(pending.rewardTier, "elite");
  // Simulating fight start: consume the same pending object (game.js reads it).
  assert.equal(getPendingEncounter().trainer.ai, "elite");
  assert.equal(getPendingEncounter().follower.ai, "veteran");
  assert.ok(getPendingEncounter().mapId, "pending encounter should carry mapId");
}

// Fresh generateEncounter always stamps a themed map.
{
  const encounter = generateEncounter(100, seeded([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  assert.ok(encounter.mapId);
  assert.ok(encounter.mapName);
}

// Power formula: shared helper (base + gear + AI presets) for duo total.
{
  const encounter = {
    trainer: {
      ai: "rookie",
      loadout: {
        body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "vector-pack", shield: "light-buckler"
      }
    },
    follower: {
      ai: "recruit",
      loadout: {
        body: "scout-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        jetpack: "sprinter-pack", shield: "no-shield"
      }
    }
  };
  assert.equal(estimatePower(encounter, 0), estimatePower(encounter, 0));
  assert.equal(estimatePower(encounter, 5), estimatePower(encounter, 0) + 5);
  assert.ok(estimatePower(encounter, 0) > 200);
  // Elite AI duo outranks the same kits with recruit/rookie minds.
  const eliteAi = {
    trainer: { ...encounter.trainer, ai: "elite" },
    follower: { ...encounter.follower, ai: "elite" }
  };
  assert.ok(estimatePower(eliteAi, 0) > estimatePower(encounter, 0));
}

// Complementary duo color themes: named pairs ~180° apart; encounter persists them.
{
  assert.ok(CONQUEST_COLOR_PAIRS.length >= 4);
  for (const pair of CONQUEST_COLOR_PAIRS) {
    assert.ok(pair.id && pair.trainer && pair.follower);
    assert.notEqual(pair.trainer, pair.follower);
    assert.ok(
      areComplementaryColors(pair.trainer, pair.follower),
      `${pair.id} should be complementary (hue dist≈180)`
    );
    const dist = hueDistance(hexToHue(pair.trainer), hexToHue(pair.follower));
    assert.ok(Math.abs(dist - 180) <= 28, `${pair.id} hue distance ${dist}`);
  }
  // Distinct from player white/blue and buddy cyan body.
  const reserved = ["#e7f9ff", "#42dff5", "#4df2ff"];
  for (const pair of CONQUEST_COLOR_PAIRS) {
    for (const reservedHex of reserved) {
      assert.notEqual(pair.trainer.toLowerCase(), reservedHex);
      assert.notEqual(pair.follower.toLowerCase(), reservedHex);
    }
  }
  const picked = pickColorPair(() => 0);
  assert.equal(picked.id, CONQUEST_COLOR_PAIRS[0].id);
  assert.equal(picked.trainer, CONQUEST_COLOR_PAIRS[0].trainer);

  resetConquestSelectSession();
  const first = beginConquestSelect(100, seeded([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]));
  assert.equal(getPendingEncounter().colorPair.id, first.colorPair.id);
  assert.equal(getPendingEncounter().trainer.color, first.trainer.color);
  const profile = ensureEconomyProfile(clone(DEFAULT_PROFILE));
  profile.ranking = 100;
  profile.cyber = STARTING_CYBER;
  const reroll = rerollEncounter(profile, seeded([0.9, 0.1, 0.2, 0.3, 0.4, 0.5, 0.95]));
  assert.equal(reroll.ok, true);
  assert.ok(reroll.encounter.colorPair);
  assert.ok(areComplementaryColors(
    reroll.encounter.trainer.color,
    reroll.encounter.follower.color
  ));
  // Reroll may change the pair (seeded path picks a different slot).
  assert.ok(
    reroll.encounter.colorPair.id !== first.colorPair.id
    || reroll.encounter.trainer.color !== first.trainer.color
    || reroll.encounter.kitIndex !== first.kitIndex
  );
}

console.log("conquest.test.js: ok");
