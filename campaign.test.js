import assert from "node:assert/strict";
import {
  awardCampaign, beginCampaignSelect, buildStageEncounter, CAMPAIGN_STAGES,
  campaignEquip, campaignShopCatalog, campaignStageCards, ensureCampaignProfile,
  getPendingCampaignEncounter, isStageCleared, isStageUnlocked, markStageCleared,
  selectCampaignStage, shopPoolForStage, validateCampaignCatalog
} from "./campaign.js";
import {
  DEFAULT_LOADOUT, ensureEconomyProfile, ensureEquipmentProfile, STARTING_CYBER
} from "./equipment.js";
import { DEFAULT_PROFILE } from "./config.js";

const clone = (value) => structuredClone(value);

function freshProfile(overrides = {}) {
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  ensureEconomyProfile(profile, profile);
  ensureCampaignProfile(profile, profile);
  Object.assign(profile, overrides);
  if (overrides.campaign) ensureCampaignProfile(profile, { ...profile, campaign: overrides.campaign });
  return profile;
}

// Catalog integrity — every shop/enemy gear id exists.
{
  assert.deepEqual(validateCampaignCatalog(), []);
  assert.equal(CAMPAIGN_STAGES.length, 8);
  assert.equal(CAMPAIGN_STAGES[0].index, 1);
  assert.equal(CAMPAIGN_STAGES[7].id, "c8-apex");
}

// Unlock chain: only stage 1 open at start; clearing unlocks next.
{
  const profile = freshProfile();
  assert.equal(isStageUnlocked(profile, "c1-shakedown"), true);
  assert.equal(isStageUnlocked(profile, "c2-gridlock"), false);
  assert.equal(isStageCleared(profile, "c1-shakedown"), false);
  markStageCleared(profile, "c1-shakedown");
  assert.equal(isStageCleared(profile, "c1-shakedown"), true);
  assert.equal(isStageUnlocked(profile, "c2-gridlock"), true);
  assert.equal(isStageUnlocked(profile, "c3-canopy"), false);
  assert.equal(profile.campaign.selectedStageId, "c2-gridlock");
}

// Shop pool grows with depth; stage 1 subset of stage 8.
{
  const early = shopPoolForStage("c1-shakedown");
  const late = shopPoolForStage("c8-apex");
  assert.ok(early.length >= 3);
  assert.ok(late.length > early.length);
  for (const id of early) assert.ok(late.includes(id));
  assert.ok(late.includes("mechanical-modularity"));
  assert.ok(!early.includes("mechanical-modularity"));
}

// Stage encounter is fixed (no jitter) with map + power.
{
  const encounter = buildStageEncounter("c1-shakedown");
  assert.equal(encounter.stageId, "c1-shakedown");
  assert.equal(encounter.mapId, "yard");
  assert.equal(encounter.rewardTier, "rookie");
  assert.equal(encounter.ranking, 60);
  assert.equal(encounter.trainer.name, "Yard Overseer");
  assert.equal(encounter.follower.ai, "recruit");
  assert.ok(encounter.power > 0);
  assert.equal(encounter.powerJitter, 0);
  assert.equal(encounter.trainer.loadout.weapon, "pulse-rifle");
}

// beginCampaignSelect sets pending encounter from selected stage.
{
  const profile = freshProfile();
  const encounter = beginCampaignSelect(profile);
  assert.equal(encounter.stageId, "c1-shakedown");
  assert.equal(getPendingCampaignEncounter()?.stageId, "c1-shakedown");
  assert.equal(selectCampaignStage(profile, "c3-canopy"), false);
  markStageCleared(profile, "c1-shakedown");
  markStageCleared(profile, "c2-gridlock");
  assert.equal(selectCampaignStage(profile, "c3-canopy"), true);
  beginCampaignSelect(profile);
  assert.equal(getPendingCampaignEncounter()?.stageId, "c3-canopy");
}

// Campaign equip purchases into owned and sets campaign loadout.
{
  const profile = freshProfile();
  profile.cyber = 200;
  const beforeOwned = profile.equipment.owned.slice();
  const result = campaignEquip(profile, "guard-helm", "player", "c1-shakedown");
  assert.equal(result.ok, true);
  assert.equal(result.purchased, true);
  assert.equal(result.spent, 85);
  assert.equal(profile.cyber, 115);
  assert.ok(profile.equipment.owned.includes("guard-helm"));
  assert.ok(!beforeOwned.includes("guard-helm"));
  assert.equal(profile.campaign.player.helmet, "guard-helm");

  // Re-equip owned is free.
  const again = campaignEquip(profile, "guard-helm", "buddy", "c1-shakedown");
  assert.equal(again.ok, true);
  assert.equal(again.purchased, false);
  assert.equal(profile.cyber, 115);
  assert.equal(profile.campaign.buddy.helmet, "guard-helm");
}

// Cannot buy gear not yet in shop depth.
{
  const profile = freshProfile();
  profile.cyber = 9999;
  const blocked = campaignEquip(profile, "mechanical-modularity", "player", "c1-shakedown");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "not-in-shop");
}

// Starter equip is free even if not listed in shopAdds.
{
  const profile = freshProfile();
  const result = campaignEquip(profile, "arc-saber", "player", "c1-shakedown");
  assert.equal(result.ok, true);
  assert.equal(result.purchased, false);
  assert.equal(profile.campaign.player.weapon, "arc-saber");
  assert.equal(profile.cyber, STARTING_CYBER);
}

// Awards: win grants cyber+exp+clear; loss no ranking change; idempotent.
{
  const profile = freshProfile();
  const rankingBefore = profile.ranking;
  const loss = awardCampaign(profile, {
    id: "camp-loss-1", mode: "campaign", difficulty: "rookie", win: false,
    stageId: "c1-shakedown"
  });
  assert.equal(loss.cyber, 0);
  assert.equal(loss.rankingDelta, 0);
  assert.equal(profile.ranking, rankingBefore);
  assert.equal(isStageCleared(profile, "c1-shakedown"), false);

  const win = awardCampaign(profile, {
    id: "camp-win-1", mode: "campaign", difficulty: "rookie", win: true,
    stageId: "c1-shakedown"
  });
  assert.ok(win.cyber > 0);
  assert.ok(win.exp > 0);
  assert.equal(win.rankingDelta, 0);
  assert.equal(win.stageCleared, "c1-shakedown");
  assert.equal(profile.ranking, rankingBefore);
  assert.equal(isStageCleared(profile, "c1-shakedown"), true);

  const again = awardCampaign(profile, {
    id: "camp-win-1", mode: "campaign", difficulty: "rookie", win: true,
    stageId: "c1-shakedown"
  });
  assert.equal(again.cyber, 0);

  const train = awardCampaign(profile, {
    id: "train-1", mode: "training", difficulty: "rookie", win: true
  });
  assert.equal(train.cyber, 0);
}

// Stage cards expose unlock/clear/selected for UI.
{
  const profile = freshProfile();
  const cards = campaignStageCards(profile);
  assert.equal(cards.length, 8);
  assert.equal(cards[0].unlocked, true);
  assert.equal(cards[0].selected, true);
  assert.equal(cards[1].unlocked, false);
  const catalog = campaignShopCatalog(profile, "c1-shakedown");
  assert.ok(catalog.some((row) => row.id === "guard-helm"));
  assert.equal(catalog.find((row) => row.id === "guard-helm").owned, false);
}

// Campaign loadouts default to starter kit.
{
  const profile = freshProfile();
  assert.equal(profile.campaign.player.weapon, DEFAULT_LOADOUT.weapon);
  assert.equal(profile.campaign.buddy.body, DEFAULT_LOADOUT.body);
}

console.log("campaign.test.js: ok");
