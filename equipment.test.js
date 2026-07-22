import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  applyLoadout, awardConquest, cycleWeaponSlot, DEFAULT_LOADOUT, effectiveStats,
  ensureEconomyProfile, ensureEquipmentProfile, equipOwned, GEAR, GEAR_BY_ID,
  MATERIAL_CONSUMER_ID, nanotechPoolCapacity, NO_SECONDARY_ID, purchaseGear,
  rankingLossAmount, rankingWinGain, RANKING_FLOOR, selectWeaponSlot, setBuddyMode,
  SLOT_LABELS, SLOT_ORDER, STARTER_GEAR, STARTING_CYBER, STARTING_RANKING,
  suggestBuddyLoadout, trainerLoadout, weaponKind
} from "./equipment.js";

const clone = (value) => structuredClone(value);

// Rookie Conquest kits stay starter-ish; Elite keeps premium gear.
{
  const rookieTrainer = trainerLoadout("rookie");
  const rookieFollower = trainerLoadout("rookie", true);
  assert.equal(rookieTrainer.weapon, "pulse-rifle");
  assert.equal(rookieFollower.weapon, "pulse-rifle");
  assert.equal(rookieTrainer.shield, "light-buckler");
  assert.equal(rookieFollower.shield, "no-shield");
  assert.equal(rookieFollower.body, "scout-frame");
  assert.ok(!["marksman-rifle", "heavy-saber"].includes(rookieTrainer.weapon));
  assert.ok(rookieTrainer.body !== "bulwark-frame");
  assert.ok(rookieFollower.body !== "bulwark-frame");
  assert.ok(!["marksman-rifle", "heavy-saber"].includes(rookieFollower.weapon));

  const eliteTrainer = trainerLoadout("elite");
  const eliteFollower = trainerLoadout("elite", true);
  assert.equal(eliteTrainer.weapon, "heavy-saber");
  assert.equal(eliteFollower.weapon, "marksman-rifle");
  assert.equal(eliteTrainer.body, "bulwark-frame");
}

// Secondary slot + Material Consumer: normalize, pool, and 1/2 swap.
{
  assert.ok(SLOT_ORDER.includes("secondaryWeapon"));
  assert.equal(SLOT_LABELS.secondaryWeapon, "Secondary Weapon");
  assert.ok(STARTER_GEAR.includes(NO_SECONDARY_ID));
  assert.equal(DEFAULT_LOADOUT.secondaryWeapon, NO_SECONDARY_ID);
  assert.equal(GEAR_BY_ID[MATERIAL_CONSUMER_ID].slot, "secondaryWeapon");
  assert.equal(GEAR_BY_ID[MATERIAL_CONSUMER_ID].materialConsumer, true);
  assert.equal(weaponKind(MATERIAL_CONSUMER_ID), "saber");

  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  assert.equal(profile.equipment.player.secondaryWeapon, NO_SECONDARY_ID);
  profile.equipment.owned.push(MATERIAL_CONSUMER_ID);
  assert.ok(equipOwned(profile, "player", "secondaryWeapon", MATERIAL_CONSUMER_ID));
  assert.equal(profile.equipment.player.secondaryWeapon, MATERIAL_CONSUMER_ID);

  const fighter = applyLoadout({}, profile.equipment.player);
  assert.equal(fighter.activeWeaponSlot, "weapon");
  assert.equal(fighter.weaponId, "pulse-rifle");
  assert.equal(fighter.materialConsumer, false);
  assert.equal(nanotechPoolCapacity(fighter.loadout), 120);
  assert.equal(fighter.nanobotMax, 120);
  assert.ok(selectWeaponSlot(fighter, "secondaryWeapon"));
  assert.equal(fighter.weaponId, MATERIAL_CONSUMER_ID);
  assert.equal(fighter.activeWeaponSlot, "secondaryWeapon");
  assert.ok(cycleWeaponSlot(fighter));
  assert.equal(fighter.weaponId, "pulse-rifle");
  assert.equal(selectWeaponSlot(fighter, "secondaryWeapon"), true);
  // No secondary equipped → swap is a no-op.
  const bare = applyLoadout({}, DEFAULT_LOADOUT);
  assert.equal(cycleWeaponSlot(bare), false);
  assert.equal(selectWeaponSlot(bare, "secondaryWeapon"), false);
}

// Catalog modifiers combine into the effective fighter, not just the menu.
{
  const loadout = {
    body: "scout-frame", helmet: "wideband-array",
    weapon: "arc-saber", jetpack: "sprinter-pack"
  };
  const stats = effectiveStats(loadout);
  assert.equal(stats.hp, 418);
  assert.ok(stats.speed > 520);
  assert.ok(stats.fuel < 3);
  assert.ok(stats.sight > 820);
  const fighter = applyLoadout({}, loadout);
  assert.equal(fighter.weapon, "saber");
  assert.equal(fighter.maxHp, stats.hp);
  assert.equal(fighter.hp, stats.hp);
  assert.equal(fighter.damageTaken, 1.08);
  assert.ok(fighter.jetThrust > 4000);
}

// Suggestions and autonomous choices never manufacture locked gear.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  profile.equipment.owned = [
    "field-frame", "survey-visor", "pulse-rifle", "vector-pack", "no-shield", NO_SECONDARY_ID
  ];
  const suggestion = suggestBuddyLoadout(profile);
  assert.ok(SLOT_ORDER.every((slot) => profile.equipment.owned.includes(suggestion.loadout[slot])));
  setBuddyMode(profile, "choice");
  assert.ok(SLOT_ORDER.every((slot) => profile.equipment.owned.includes(profile.equipment.buddy[slot])));
}

// Learned range evidence favors a sensor/rifle support kit; saber play favors mobility.
{
  const ranged = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(ranged, ranged);
  Object.assign(ranged.weapons.gun.habits.engagementRange, {
    samples: 8, successes: 7, failures: 1, estimate: .78
  });
  const rangedPick = suggestBuddyLoadout(ranged);
  assert.equal(rangedPick.style, "ranged");
  assert.equal(rangedPick.loadout.weapon, "pulse-rifle");
  assert.equal(rangedPick.loadout.helmet, "wideband-array");

  const rusher = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(rusher, rusher);
  rusher.equipment.player.weapon = "arc-saber";
  const rushPick = suggestBuddyLoadout(rusher);
  assert.equal(rushPick.style, "rusher");
  assert.equal(weaponKind(rushPick.loadout.weapon), "saber");
  assert.equal(rushPick.loadout.body, "scout-frame");
}

// Weapon-only saves migrate to complete, valid loadouts.
{
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { migrateProfile } = await import("./storage.js");
  const profile = migrateProfile({ playerWeapon: "saber", buddyWeapon: "gun" });
  assert.equal(profile.cyber, STARTING_CYBER);
  assert.equal(profile.ranking, STARTING_RANKING);
  assert.ok(STARTER_GEAR.every((id) => profile.equipment.owned.includes(id)));
  assert.equal(profile.equipment.player.weapon, "arc-saber");
  assert.equal(profile.equipment.buddy.weapon, "pulse-rifle");
  for (const slot of SLOT_ORDER) {
    assert.ok(profile.equipment.player[slot] || DEFAULT_LOADOUT[slot]);
  }
}

// Existing economy values and unrelated profile records survive migration.
{
  const { migrateProfile } = await import("./storage.js");
  const old = clone(DEFAULT_PROFILE);
  old.cyber = 0;
  old.coaching.learnedVocabulary = [{
    phrase: "hold fast", terms: ["hold", "fast"], intents: ["stayClose"],
    uses: 1, confirmedAt: 1
  }];
  old.priority = { retreat: 3 };
  const migrated = migrateProfile(old);
  assert.equal(migrated.cyber, 0);
  assert.deepEqual(migrated.coaching.learnedVocabulary, old.coaching.learnedVocabulary);
  assert.deepEqual(migrated.priority, old.priority);
}

// Conquest wins pay once by trainer tier; Training and losses never pay Cyber.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEconomyProfile(profile, profile);
  const initial = profile.cyber;
  assert.equal(awardConquest(profile, {
    id: "win-1", mode: "conquest", difficulty: "veteran", win: true
  }).cyber, 60);
  assert.equal(awardConquest(profile, {
    id: "win-1", mode: "conquest", difficulty: "veteran", win: true
  }).cyber, 0);
  assert.equal(awardConquest(profile, {
    id: "train-1", mode: "training", difficulty: "elite", win: true
  }).cyber, 0);
  assert.equal(awardConquest(profile, {
    id: "loss-1", mode: "conquest", difficulty: "elite", win: false
  }).cyber, 0);
  assert.equal(profile.cyber, initial + 60);
}

// Conquest ranking: win/loss formulas, floor, Training noop, migration, no double award.
{
  assert.equal(rankingWinGain(100), 100);
  assert.equal(rankingWinGain(200), 150);
  assert.equal(rankingWinGain(50), 75);
  assert.equal(rankingLossAmount(100), 25);
  assert.equal(rankingLossAmount(200), 38);

  const profile = clone(DEFAULT_PROFILE);
  ensureEconomyProfile(profile, profile);
  assert.equal(profile.ranking, STARTING_RANKING);

  const win100 = awardConquest(profile, {
    id: "rank-win-100", mode: "conquest", difficulty: "rookie", win: true
  });
  assert.equal(win100.rankingDelta, 100);
  assert.equal(profile.ranking, 200);

  const win200 = awardConquest(profile, {
    id: "rank-win-200", mode: "conquest", difficulty: "rookie", win: true
  });
  assert.equal(win200.rankingDelta, 150);
  assert.equal(profile.ranking, 350);

  profile.ranking = 100;
  profile.rewardedConquests = [];
  const loss100 = awardConquest(profile, {
    id: "rank-loss-100", mode: "conquest", difficulty: "veteran", win: false
  });
  assert.equal(loss100.rankingDelta, -25);
  assert.equal(loss100.cyber, 0);
  assert.equal(loss100.exp, 0);
  assert.equal(profile.ranking, 75);

  profile.ranking = 200;
  const loss200 = awardConquest(profile, {
    id: "rank-loss-200", mode: "conquest", difficulty: "elite", win: false
  });
  assert.equal(loss200.rankingDelta, -38);
  assert.equal(profile.ranking, 162);

  // Double award: same match id changes nothing.
  const again = awardConquest(profile, {
    id: "rank-loss-200", mode: "conquest", difficulty: "elite", win: false
  });
  assert.equal(again.rankingDelta, 0);
  assert.equal(profile.ranking, 162);

  // Training never changes ranking.
  const beforeTrain = profile.ranking;
  const train = awardConquest(profile, {
    id: "rank-train", mode: "training", difficulty: "elite", win: true
  });
  assert.equal(train.rankingDelta, 0);
  assert.equal(profile.ranking, beforeTrain);

  // Floor at 0 on repeated losses.
  profile.ranking = 10;
  profile.rewardedConquests = [];
  for (let i = 0; i < 8; i++) {
    awardConquest(profile, {
      id: `floor-loss-${i}`, mode: "conquest", difficulty: "rookie", win: false
    });
  }
  assert.equal(profile.ranking, RANKING_FLOOR);
  assert.ok(profile.ranking >= RANKING_FLOOR);

  // Old saves without ranking migrate to 100.
  {
    const { migrateProfile } = await import("./storage.js");
    const old = clone(DEFAULT_PROFILE);
    delete old.ranking;
    const migrated = migrateProfile(old);
    assert.equal(migrated.ranking, STARTING_RANKING);
  }
}

// Purchases charge exactly once, reject insufficient funds, and persist.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  profile.cyber = 120;
  profile.rewardedConquests = [];
  const bought = purchaseGear(profile, "bulwark-frame");
  assert.equal(bought.ok, true);
  assert.equal(profile.cyber, 10);
  assert.equal(purchaseGear(profile, "bulwark-frame").reason, "owned");
  assert.equal(profile.cyber, 10);
  assert.equal(purchaseGear(profile, "hunter-optics").reason, "insufficient");
  assert.equal(profile.cyber, 10);
}

// Manual and autonomous paths cannot select locked gear.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  assert.equal(equipOwned(profile, "player", "body", "reactive-frame"), false);
  assert.equal(profile.equipment.player.body, "field-frame");
  profile.equipment.player.body = "reactive-frame";
  ensureEquipmentProfile(profile, profile);
  assert.equal(profile.equipment.player.body, "field-frame");
  profile.equipment.owned.push("reactive-frame");
  assert.equal(equipOwned(profile, "player", "body", "reactive-frame"), true);
  setBuddyMode(profile, "choice");
  assert.equal(equipOwned(profile, "buddy", "body", "reactive-frame"), false);
}

// Every slot has enough choices; every primary weapon keeps a known base mechanic.
{
  for (const slot of SLOT_ORDER) {
    const min = slot === "secondaryWeapon" ? 2 : 4;
    assert.ok(
      GEAR.filter((gear) => gear.slot === slot).length >= min,
      `${slot} should have >= ${min} options`
    );
  }
  assert.ok(STARTER_GEAR.includes("no-shield"));
  assert.ok(STARTER_GEAR.includes("light-buckler"));
  assert.ok(STARTER_GEAR.includes(NO_SECONDARY_ID));
  for (const gear of GEAR.filter((item) => item.slot === "weapon")) {
    const loadout = { ...DEFAULT_LOADOUT, weapon: gear.id };
    const fighter = applyLoadout({}, loadout);
    assert.equal(fighter.weapon, gear.baseKind);
    assert.equal(fighter.weaponDamage, gear.modifiers.damage);
    assert.equal(fighter.weaponFireRate, gear.modifiers.fireRate);
    assert.equal(fighter.weaponRange, gear.modifiers.range);
  }
  const marksman = applyLoadout({}, { ...DEFAULT_LOADOUT, weapon: "marksman-rifle" });
  assert.equal(marksman.weapon, "gun");
  assert.ok(marksman.weaponFireRate < 1 && marksman.weaponRange > 1);
  const heavy = applyLoadout({}, { ...DEFAULT_LOADOUT, weapon: "heavy-saber" });
  assert.equal(heavy.weapon, "saber");
  assert.ok(heavy.weaponDamage > 1 && heavy.weaponFireRate < 1);
}

// A later-than-second option remains selected through save migration.
{
  const { migrateProfile } = await import("./storage.js");
  const saved = clone(DEFAULT_PROFILE);
  saved.equipment.owned.push("reactive-frame");
  saved.equipment.player.body = "reactive-frame";
  const migrated = migrateProfile(saved);
  assert.equal(migrated.equipment.player.body, "reactive-frame");
}

// Developer unlock-all overlays catalog without mutating permanent owned.
{
  const { ensureSettingsProfile } = await import("./settings.js");
  const {
    effectiveOwned, ownedForSlot, reconcileLoadoutsToOwned
  } = await import("./equipment.js");
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  ensureSettingsProfile(profile, profile);
  const permanentCount = profile.equipment.owned.length;
  assert.equal(equipOwned(profile, "player", "weapon", "nanotech-rifle"), false);

  profile.settings.developer.unlockAllGearTemporary = true;
  assert.equal(effectiveOwned(profile).length, GEAR.length);
  assert.ok(ownedForSlot(profile, "weapon").some((g) => g.id === "nanotech-rifle"));
  assert.equal(equipOwned(profile, "player", "weapon", "nanotech-rifle"), true);
  assert.equal(profile.equipment.player.weapon, "nanotech-rifle");
  assert.equal(profile.equipment.owned.length, permanentCount, "permanent owned unchanged");
  assert.equal(purchaseGear(profile, "nanotech-rifle").reason, "owned");

  profile.settings.developer.unlockAllGearTemporary = false;
  reconcileLoadoutsToOwned(profile);
  assert.equal(profile.equipment.player.weapon, DEFAULT_LOADOUT.weapon);
  assert.equal(equipOwned(profile, "player", "weapon", "nanotech-rifle"), false);
  assert.equal(profile.equipment.owned.length, permanentCount);
}

console.log("Equipment suite passed.");
