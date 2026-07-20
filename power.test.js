import assert from "node:assert/strict";
import { DEFAULT_PROFILE } from "./config.js";
import { ensureEconomyProfile } from "./equipment.js";
import {
  buddyTrainingContribution, estimateEncounterPower, estimateFighterPower,
  estimatePower, estimateProfilePowers, gearContribution, perkContribution,
  POWER_WEIGHTS, presetAiContribution
} from "./power.js";
import { HABIT_DOMAINS, CAPABILITY_DOMAINS, recordEvidence } from "./learning.js";

const clone = (value) => structuredClone(value);

const starterLoadout = {
  body: "field-frame",
  helmet: "survey-visor",
  weapon: "pulse-rifle",
  jetpack: "vector-pack",
  shield: "no-shield",
  perk: null
};

const eliteLoadout = {
  body: "bulwark-frame",
  helmet: "hunter-optics",
  weapon: "heavy-saber",
  jetpack: "endurance-pack",
  shield: "kinetic-targe",
  perk: null
};

function readyEvidence(record) {
  for (let i = 0; i < 12; i++) recordEvidence(record, true, 0.7);
}

function trainBuddyFully(learned) {
  for (const domain of HABIT_DOMAINS) {
    if (domain === "shieldUse") continue;
    readyEvidence(learned.habits[domain]);
  }
  for (const domain of CAPABILITY_DOMAINS) {
    if (domain === "precisionAim") continue;
    readyEvidence(learned.capabilities[domain]);
  }
  return learned;
}

// Stronger gear → higher Power.
{
  const weak = estimateFighterPower({ loadout: starterLoadout, role: "player" });
  const strong = estimateFighterPower({ loadout: eliteLoadout, role: "player" });
  assert.ok(gearContribution(eliteLoadout) > gearContribution(starterLoadout));
  assert.ok(strong.power > weak.power, `elite ${strong.power} vs starter ${weak.power}`);
  assert.ok(strong.parts.gear <= POWER_WEIGHTS.GEAR_CAP);
}

// Elite AI preset > Rookie AI (same gear).
{
  const rookie = estimateFighterPower({
    loadout: starterLoadout, role: "enemy", ai: "rookie"
  });
  const elite = estimateFighterPower({
    loadout: starterLoadout, role: "enemy", ai: "elite"
  });
  assert.ok(presetAiContribution("elite") > presetAiContribution("rookie"));
  assert.ok(elite.power > rookie.power);
  assert.equal(elite.parts.ai - rookie.parts.ai, presetAiContribution("elite") - presetAiContribution("rookie"));
}

// Player has no AI skill contribution.
{
  const player = estimateFighterPower({ loadout: starterLoadout, role: "player" });
  assert.equal(player.parts.ai, 0);
  assert.equal(player.parts.base, POWER_WEIGHTS.BASE);
}

// Untrained buddy < trained buddy (mock evidence).
{
  const empty = clone(DEFAULT_PROFILE).weapons.gun;
  const trained = trainBuddyFully(clone(DEFAULT_PROFILE).weapons.gun);
  const untrainedPower = buddyTrainingContribution(empty, "balanced");
  const trainedPower = buddyTrainingContribution(trained, "balanced");
  assert.ok(trainedPower > untrainedPower, `${trainedPower} > ${untrainedPower}`);

  const untrainedBuddy = estimateFighterPower({
    loadout: starterLoadout, role: "buddy", mindMode: "balanced", learned: empty
  });
  const trainedBuddy = estimateFighterPower({
    loadout: starterLoadout, role: "buddy", mindMode: "balanced", learned: trained
  });
  assert.ok(trainedBuddy.power > untrainedBuddy.power);
}

// Combat perk raises Power more than pure economy perk.
{
  const combat = perkContribution("heavy-trigger");
  const economy = perkContribution("cyber-broker");
  assert.ok(combat > economy, `combat ${combat} vs economy ${economy}`);
  const withCombat = estimateFighterPower({
    loadout: { ...starterLoadout, perk: "heavy-trigger" },
    role: "player"
  });
  const withEconomy = estimateFighterPower({
    loadout: { ...starterLoadout, perk: "cyber-broker" },
    role: "player"
  });
  assert.ok(withCombat.power > withEconomy.power);
}

// Profile helper + Conquest encounter share the same fighter math.
{
  const profile = ensureEconomyProfile(clone(DEFAULT_PROFILE));
  profile.equipment.player = { ...starterLoadout };
  profile.equipment.buddy = { ...starterLoadout };
  const powers = estimateProfilePowers(profile);
  assert.ok(powers.player > 0);
  assert.ok(powers.buddy > 0);
  assert.equal(powers.duo, powers.player + powers.buddy);

  const encounter = {
    trainer: { ai: "veteran", loadout: eliteLoadout },
    follower: { ai: "rookie", loadout: starterLoadout }
  };
  const breakdown = estimateEncounterPower(encounter, 0);
  assert.equal(estimatePower(encounter, 0), breakdown.duo);
  assert.equal(breakdown.duo, breakdown.trainer + breakdown.follower);
  assert.equal(
    breakdown.trainer,
    estimateFighterPower({
      loadout: eliteLoadout, role: "enemy", ai: "veteran"
    }).power
  );
}

console.log("power.test.js: ok");
