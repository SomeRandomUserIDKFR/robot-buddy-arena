import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import {
  applyLoadout, awardConquest, CONQUEST_EXP, CONQUEST_REWARDS, DEFAULT_LOADOUT,
  ensureEconomyProfile, ensureEquipmentProfile
} from "./equipment.js";
import { Fighter } from "./combat.js";
import {
  choosePerkUnlock, CONQUEST_EXP as PERK_EXP, equipPerk, ensureProgressionProfile,
  expRequiredForLevel, grantExp, PERKS, rollPerkChoices, setBuddyPerkAutonomy,
  suggestBuddyPerk
} from "./perks.js";

const clone = (value) => structuredClone(value);

assert.equal(PERK_EXP.rookie, CONQUEST_EXP.rookie);
assert.ok(PERKS.length >= 10 && PERKS.length <= 14);

// Old saves migrate to level 1 / 0 EXP / no perks.
{
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const { migrateProfile } = await import("./storage.js");
  const migrated = migrateProfile({
    cyber: 40,
    playerWeapon: "gun",
    botName: "OldBot"
  });
  assert.equal(migrated.level, 1);
  assert.equal(migrated.exp, 0);
  assert.equal(migrated.expToNext, expRequiredForLevel(1));
  assert.deepEqual(migrated.unlockedPerks, []);
  assert.deepEqual(migrated.pendingPerkPicks, []);
  assert.equal(migrated.equipment.player.perk, null);
  assert.equal(migrated.equipment.buddy.perk, null);
  assert.equal(migrated.buddyPerkAutonomy, "user");
  assert.equal(migrated.cyber, 40);
  assert.equal(migrated.botName, "OldBot");
}

// Junk perk ids and pending picks are sanitized on load.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, {
    equipment: {
      owned: profile.equipment.owned,
      player: { ...DEFAULT_LOADOUT, perk: "not-a-perk" },
      buddy: { ...DEFAULT_LOADOUT, perk: "glass-sprint" }
    },
    unlockedPerks: ["glass-sprint", "garbage", 12],
    pendingPerkPicks: [
      { id: "p1", choices: ["glass-sprint", "deep-tank", "nope"] },
      { id: "p2", choices: ["garbage"] }
    ],
    level: -3,
    exp: -10,
    buddyPerkAutonomy: "hacked"
  });
  ensureProgressionProfile(profile, {
    unlockedPerks: ["glass-sprint", "garbage"],
    pendingPerkPicks: [
      { id: "p1", choices: ["glass-sprint", "deep-tank", "nope"] },
      { id: "p2", choices: ["garbage"] }
    ],
    level: -3,
    exp: -10,
    buddyPerkAutonomy: "hacked",
    equipment: profile.equipment
  });
  assert.deepEqual(profile.unlockedPerks, ["glass-sprint"]);
  assert.equal(profile.equipment.player.perk, null);
  assert.equal(profile.equipment.buddy.perk, "glass-sprint");
  assert.equal(profile.level, 1);
  assert.equal(profile.exp, 0);
  assert.equal(profile.buddyPerkAutonomy, "user");
  assert.equal(profile.pendingPerkPicks.length, 1);
  assert.deepEqual(profile.pendingPerkPicks[0].choices, ["deep-tank"]);
}

// EXP only on Conquest win; tier amounts; no double-award; Training/loss = 0.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEconomyProfile(profile, profile);
  ensureProgressionProfile(profile, profile);
  const initialCyber = profile.cyber;
  const win = awardConquest(profile, {
    id: "c-1", mode: "conquest", difficulty: "veteran", win: true
  });
  assert.equal(win.cyber, CONQUEST_REWARDS.veteran);
  assert.equal(win.exp, CONQUEST_EXP.veteran);
  assert.equal(profile.cyber, initialCyber + CONQUEST_REWARDS.veteran);
  assert.equal(profile.exp, CONQUEST_EXP.veteran);
  assert.deepEqual(awardConquest(profile, {
    id: "c-1", mode: "conquest", difficulty: "veteran", win: true
  }), { cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0 });
  assert.deepEqual(awardConquest(profile, {
    id: "t-1", mode: "training", difficulty: "elite", win: true
  }), { cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0 });
  const loss = awardConquest(profile, {
    id: "c-loss", mode: "conquest", difficulty: "elite", win: false
  });
  assert.equal(loss.cyber, 0);
  assert.equal(loss.exp, 0);
  assert.equal(loss.levelsGained, 0);
  assert.ok(loss.rankingDelta < 0);
  assert.equal(profile.exp, CONQUEST_EXP.veteran);
}

// Level-up enqueues a 3-choice pick; choosing unlocks exactly one; locked cannot equip.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  ensureProgressionProfile(profile, profile);
  let seq = 0;
  const random = () => {
    seq += 1;
    return (seq % 10) / 10;
  };
  const gained = grantExp(profile, expRequiredForLevel(1), random);
  assert.equal(gained.levelsGained, 1);
  assert.equal(profile.level, 2);
  assert.equal(profile.pendingPerkPicks.length, 1);
  const pick = profile.pendingPerkPicks[0];
  assert.equal(pick.choices.length, 3);
  assert.ok(pick.choices.every((id) => PERKS.some((perk) => perk.id === id)));
  assert.equal(equipPerk(profile, "player", pick.choices[0]), false);
  const chosen = choosePerkUnlock(profile, pick.id, pick.choices[0]);
  assert.equal(chosen.ok, true);
  assert.deepEqual(profile.unlockedPerks, [pick.choices[0]]);
  assert.equal(profile.pendingPerkPicks.length, 0);
  assert.equal(choosePerkUnlock(profile, pick.id, pick.choices[1]).ok, false);
  assert.equal(equipPerk(profile, "player", "wide-lens"), false);
  assert.equal(equipPerk(profile, "player", pick.choices[0]), true);
  assert.equal(profile.equipment.player.perk, pick.choices[0]);
}

// Perk modifiers apply through applyLoadout / effectiveStats.
{
  const base = applyLoadout(new Fighter({}), { ...DEFAULT_LOADOUT });
  const glass = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, perk: "glass-sprint"
  });
  assert.ok(glass.maxHp < base.maxHp);
  assert.ok(glass.moveSpeed > base.moveSpeed);

  const heavy = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, perk: "heavy-trigger"
  });
  assert.ok(heavy.weaponBaseDamage > base.weaponBaseDamage);
  assert.ok(heavy.weaponRpm < base.weaponRpm);

  const deep = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, perk: "deep-tank"
  });
  assert.ok(deep.jetFuelCapacity > base.jetFuelCapacity);
  assert.ok(deep.jetRechargeScale < base.jetRechargeScale);

  const ghost = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, perk: "ghost-step"
  });
  assert.ok(ghost.iframeMultiplier > base.iframeMultiplier);
  assert.ok(ghost.dodgeCooldownMult > 1);

  const brace = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, shield: "light-buckler", perk: "bastion-brace"
  });
  const plainShield = applyLoadout(new Fighter({}), {
    ...DEFAULT_LOADOUT, shield: "light-buckler"
  });
  assert.ok(brace.shieldMaxDurability > plainShield.shieldMaxDurability);
  assert.ok(brace.shieldRaisedSpeed < plainShield.shieldRaisedSpeed);
}

// AI Suggested / Choice only use unlocked perks.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEquipmentProfile(profile, profile);
  ensureProgressionProfile(profile, profile);
  profile.unlockedPerks = ["glass-sprint", "wide-lens"];
  Object.assign(profile.weapons.gun.habits.engagementRange, {
    samples: 8, successes: 7, failures: 1, estimate: .8
  });
  const suggestion = suggestBuddyPerk(profile);
  assert.ok(profile.unlockedPerks.includes(suggestion.perkId));
  setBuddyPerkAutonomy(profile, "choice");
  assert.ok(
    profile.equipment.buddy.perk == null
    || profile.unlockedPerks.includes(profile.equipment.buddy.perk)
  );
  assert.equal(equipPerk(profile, "buddy", "deep-tank"), false);
  profile.buddyPerkAutonomy = "user";
  assert.equal(equipPerk(profile, "buddy", "deep-tank"), false);
  assert.equal(equipPerk(profile, "buddy", "glass-sprint"), true);
}

// Cyber Broker multiplies Conquest Cyber payout.
{
  const profile = clone(DEFAULT_PROFILE);
  ensureEconomyProfile(profile, profile);
  ensureProgressionProfile(profile, profile);
  profile.unlockedPerks = ["cyber-broker"];
  profile.equipment.player.perk = "cyber-broker";
  profile.rewardedConquests = [];
  const before = profile.cyber;
  const reward = awardConquest(profile, {
    id: "cyber-perk", mode: "conquest", difficulty: "rookie", win: true
  });
  assert.equal(reward.cyber, Math.round(CONQUEST_REWARDS.rookie * 1.2));
  assert.equal(profile.cyber, before + reward.cyber);
  assert.equal(reward.exp, CONQUEST_EXP.rookie);
}

// rollPerkChoices never returns already unlocked ids.
{
  const unlocked = PERKS.slice(0, 9).map((perk) => perk.id);
  const choices = rollPerkChoices(unlocked, 3, () => .2);
  assert.ok(choices.every((id) => !unlocked.includes(id)));
  assert.ok(choices.length <= 3);
}

console.log("perks.test.js: ok");
