/**
 * Campaign mode — fixed stage select, stage Cyber shops, separate loadouts.
 *
 * Unlike Conquest (Ranking climb + reroll), Campaign is a level-select loop:
 *   clear stages in order → shops grow with depth → spend Cyber on gear for
 *   campaign-only player/buddy kits. Wins grant Cyber + EXP; Ranking is untouched.
 *
 * Profile.campaign:
 *   cleared: string[]           stage ids beaten
 *   player / buddy: loadout     separate from meta equipment.*
 *   selectedStageId: string
 *   rewardedResults: string[]   idempotent award ids (like rewardedConquests)
 */

import {
  CONQUEST_EXP, CONQUEST_REWARDS, DEFAULT_LOADOUT, GEAR, GEAR_BY_ID,
  NO_EXTENSION_ID, NO_SECONDARY_ID, SLOT_ORDER, STARTER_GEAR,
  ensureEconomyProfile, normalizeLoadout, purchaseGear
} from "./equipment.js";
import {
  cyberWinMultiplier, ensureProgressionProfile, grantExp
} from "./perks.js";
import { estimateEncounterPower } from "./power.js";
import { getMap } from "./maps.js";
import { loadoutSummary } from "./conquest.js";

export { loadoutSummary };

/** @type {{ id: string, index: number, name: string, blurb: string, ranking: number, rewardTier: string, training: string, mapId: string, trainer: object, follower: object, shopAdds: string[] }[]} */
export const CAMPAIGN_STAGES = Object.freeze([
  Object.freeze({
    id: "c1-shakedown",
    index: 1,
    name: "Shakedown Yard",
    blurb: "Green patrol duo. Starter kits only — learn the stage shop.",
    ranking: 60,
    rewardTier: "rookie",
    training: "Green",
    mapId: "yard",
    trainer: Object.freeze({
      name: "Yard Overseer",
      ai: "recruit",
      color: "#ff6b5a",
      loadout: Object.freeze({
        body: "field-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "vector-pack", shield: "no-shield"
      })
    }),
    follower: Object.freeze({
      name: "Scrap Runner",
      ai: "recruit",
      color: "#2ac4b8",
      loadout: Object.freeze({
        body: "scout-frame", helmet: "survey-visor", weapon: "pulse-rifle",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "sprinter-pack", shield: "no-shield"
      })
    }),
    shopAdds: Object.freeze(["guard-helm", "endurance-pack", "light-buckler"])
  }),
  Object.freeze({
    id: "c2-gridlock",
    index: 2,
    name: "Gridlock Field",
    blurb: "Rookie trainer with a buckler. Shop opens light sidegrades.",
    ranking: 100,
    rewardTier: "rookie",
    training: "Green",
    mapId: "battlefield",
    trainer: Object.freeze({
      name: "Hex Coil",
      ai: "rookie",
      color: "#ff4d5c",
      loadout: Object.freeze({
        body: "field-frame", helmet: "survey-visor", weapon: "arc-saber",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "vector-pack", shield: "light-buckler"
      })
    }),
    follower: Object.freeze({
      name: "Unit 7",
      ai: "recruit",
      color: "#2ab8c8",
      loadout: Object.freeze({
        body: "scout-frame", helmet: "wideband-array", weapon: "pulse-rifle",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "sprinter-pack", shield: "no-shield"
      })
    }),
    shopAdds: Object.freeze(["burst-carbine", "duelist-blade", "recycler-pack"])
  }),
  Object.freeze({
    id: "c3-canopy",
    index: 3,
    name: "Canopy Ambush",
    blurb: "Contender pressure. Marksman reach and a secondary tool unlock.",
    ranking: 180,
    rewardTier: "rookie",
    training: "Developing",
    mapId: "forest",
    trainer: Object.freeze({
      name: "Nora Quill",
      ai: "contender",
      color: "#ff8c3a",
      loadout: Object.freeze({
        body: "field-frame", helmet: "guard-helm", weapon: "arc-saber",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "endurance-pack", shield: "light-buckler"
      })
    }),
    follower: Object.freeze({
      name: "Clip",
      ai: "rookie",
      color: "#3a8cff",
      loadout: Object.freeze({
        body: "scout-frame", helmet: "wideband-array", weapon: "marksman-rifle",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "vector-pack", shield: "no-shield"
      })
    }),
    shopAdds: Object.freeze([
      "marksman-rifle", "bulwark-frame", "throw-breakable", "frag-grenade"
    ])
  }),
  Object.freeze({
    id: "c4-skyline",
    index: 4,
    name: "Skyline Sweep",
    blurb: "Hardened Contender duo. Mid-tier frames and shields enter the pool.",
    ranking: 260,
    rewardTier: "rookie",
    training: "Developing",
    mapId: "city",
    trainer: Object.freeze({
      name: "Ash Relay",
      ai: "contender",
      color: "#ff3d9a",
      loadout: Object.freeze({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "heavy-saber",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: NO_EXTENSION_ID,
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    }),
    follower: Object.freeze({
      name: "Nix",
      ai: "rookie",
      color: "#3dff7a",
      loadout: Object.freeze({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "burst-carbine",
        secondaryWeapon: "frag-grenade", extensionSecondary: NO_EXTENSION_ID,
        jetpack: "recycler-pack", shield: "light-buckler"
      })
    }),
    shopAdds: Object.freeze([
      "heavy-saber", "reactive-frame", "hunter-optics", "kinetic-targe", "bolas-snare"
    ])
  }),
  Object.freeze({
    id: "c5-dune",
    index: 5,
    name: "Dune Relay",
    blurb: "Veteran league kits. Shop depth opens snipers and extensions.",
    ranking: 380,
    rewardTier: "veteran",
    training: "Trained",
    mapId: "desert",
    trainer: Object.freeze({
      name: "Kade Voss",
      ai: "veteran",
      color: "#ffb020",
      loadout: Object.freeze({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "arc-saber",
        secondaryWeapon: "shield-steal", extensionSecondary: NO_EXTENSION_ID,
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    }),
    follower: Object.freeze({
      name: "Driftlet",
      ai: "rookie",
      color: "#4588ff",
      loadout: Object.freeze({
        body: "field-frame", helmet: "hunter-optics", weapon: "marksman-rifle",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: "trapper",
        jetpack: "vector-pack", shield: "light-buckler"
      })
    }),
    shopAdds: Object.freeze([
      "quick-fire-sniper", "retractable-armor", "shield-steal", "trapper", "hookshot-winch"
    ])
  }),
  Object.freeze({
    id: "c6-pier",
    index: 6,
    name: "Pier Breach",
    blurb: "Challenger trainer. Exotic primaries and Illusionist tools.",
    ranking: 560,
    rewardTier: "veteran",
    training: "Hardened",
    mapId: "docks",
    trainer: Object.freeze({
      name: "Sable Drift",
      ai: "challenger",
      color: "#e82d4a",
      loadout: Object.freeze({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "mechanical-modularity",
        secondaryWeapon: "throwing-spear", extensionSecondary: NO_EXTENSION_ID,
        jetpack: "recycler-pack", shield: "kinetic-targe"
      })
    }),
    follower: Object.freeze({
      name: "Wisp",
      ai: "veteran",
      color: "#2ecfc0",
      loadout: Object.freeze({
        body: "scout-frame", helmet: "wideband-array", weapon: "gattler",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: "illusionist",
        jetpack: "sprinter-pack", shield: "light-buckler"
      })
    }),
    shopAdds: Object.freeze([
      "mechanical-modularity", "gattler", "throwing-spear", "illusionist", "sticky-charge"
    ])
  }),
  Object.freeze({
    id: "c7-ruins",
    index: 7,
    name: "Ruins Gauntlet",
    blurb: "Elite pressure. Deep shop — Spellbook, Laser, Reconjurer.",
    ranking: 820,
    rewardTier: "elite",
    training: "Sharp",
    mapId: "ruins",
    trainer: Object.freeze({
      name: "Juno Pike",
      ai: "elite",
      color: "#9a4dff",
      loadout: Object.freeze({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "heavy-saber",
        secondaryWeapon: "material-consumer-nanotech", extensionSecondary: NO_EXTENSION_ID,
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    }),
    follower: Object.freeze({
      name: "Proxy",
      ai: "veteran",
      color: "#a8e82a",
      loadout: Object.freeze({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "laser",
        secondaryWeapon: NO_SECONDARY_ID, extensionSecondary: "reconjurer-builder",
        jetpack: "recycler-pack", shield: "light-buckler"
      })
    }),
    shopAdds: Object.freeze([
      "laser", "spellbook", "classic-sniper", "material-consumer-nanotech",
      "reconjurer-builder", "daggers"
    ])
  }),
  Object.freeze({
    id: "c8-apex",
    index: 8,
    name: "Apex Circuit",
    blurb: "Peak duo. Full shop depth. Ranking label is display-only.",
    ranking: 1100,
    rewardTier: "elite",
    training: "Peak",
    mapId: "city",
    trainer: Object.freeze({
      name: "Rook Halcyon",
      ai: "elite",
      color: "#ff3a40",
      loadout: Object.freeze({
        body: "reactive-frame", helmet: "hunter-optics", weapon: "strong-sniper",
        secondaryWeapon: "hookshot-winch", extensionSecondary: "doppel",
        jetpack: "recycler-pack", shield: "kinetic-targe"
      })
    }),
    follower: Object.freeze({
      name: "Gasket",
      ai: "elite",
      color: "#1ab8a8",
      loadout: Object.freeze({
        body: "bulwark-frame", helmet: "guard-helm", weapon: "spellbook",
        secondaryWeapon: "sticky-charge", extensionSecondary: "light-condensation",
        jetpack: "endurance-pack", shield: "kinetic-targe"
      })
    }),
    shopAdds: Object.freeze([
      "strong-sniper", "doppel", "light-condensation", "adaptive-nanotech-unit"
    ])
  })
]);

const STAGE_BY_ID = Object.fromEntries(CAMPAIGN_STAGES.map((s) => [s.id, s]));

/** @type {ReturnType<typeof buildStageEncounter>|null} */
let pendingEncounter = null;

export function getStage(stageId) {
  return STAGE_BY_ID[stageId] || null;
}

export function listStages() {
  return CAMPAIGN_STAGES.slice();
}

/** Cumulative shop pool through `stage` (inclusive). Filters unknown ids. */
export function shopPoolForStage(stageOrId) {
  const stage = typeof stageOrId === "string" ? getStage(stageOrId) : stageOrId;
  if (!stage) return [];
  const ids = [];
  const seen = new Set();
  for (const s of CAMPAIGN_STAGES) {
    for (const id of s.shopAdds || []) {
      if (!GEAR_BY_ID[id] || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (s.id === stage.id) break;
  }
  return ids;
}

export function isStageUnlocked(profile, stageOrId) {
  const stage = typeof stageOrId === "string" ? getStage(stageOrId) : stageOrId;
  if (!stage) return false;
  if (stage.index <= 1) return true;
  const prev = CAMPAIGN_STAGES.find((s) => s.index === stage.index - 1);
  if (!prev) return false;
  return (profile?.campaign?.cleared || []).includes(prev.id);
}

export function isStageCleared(profile, stageOrId) {
  const stage = typeof stageOrId === "string" ? getStage(stageOrId) : stageOrId;
  if (!stage) return false;
  return (profile?.campaign?.cleared || []).includes(stage.id);
}

export function ensureCampaignProfile(profile, saved = profile) {
  ensureEconomyProfile(profile, saved);
  const raw = saved?.campaign && typeof saved.campaign === "object" ? saved.campaign : {};
  const owned = Array.from(new Set([
    ...STARTER_GEAR,
    "no-shield",
    NO_SECONDARY_ID,
    NO_EXTENSION_ID,
    ...(Array.isArray(profile?.equipment?.owned) ? profile.equipment.owned : []),
    ...(Array.isArray(saved?.equipment?.owned) ? saved.equipment.owned : [])
  ])).filter((id) => !!GEAR_BY_ID[id]);

  const cleared = Array.from(new Set(
    Array.isArray(raw.cleared) ? raw.cleared : []
  )).filter((id) => !!STAGE_BY_ID[id]);

  let selectedStageId = typeof raw.selectedStageId === "string" ? raw.selectedStageId : null;
  if (!selectedStageId || !STAGE_BY_ID[selectedStageId]) {
    selectedStageId = CAMPAIGN_STAGES[0].id;
  }

  profile.campaign = {
    cleared,
    player: normalizeLoadout(raw.player || DEFAULT_LOADOUT, owned),
    buddy: normalizeLoadout(raw.buddy || DEFAULT_LOADOUT, owned),
    selectedStageId,
    rewardedResults: Array.from(new Set(
      Array.isArray(raw.rewardedResults) ? raw.rewardedResults : []
    )).filter((id) => typeof id === "string").slice(-100)
  };
  // Carry perks from meta equipment so campaign fights stay consistent.
  profile.campaign.player.perk = profile.equipment?.player?.perk ?? null;
  profile.campaign.buddy.perk = profile.equipment?.buddy?.perk ?? null;
  return profile;
}

export function selectCampaignStage(profile, stageId) {
  ensureCampaignProfile(profile);
  const stage = getStage(stageId);
  if (!stage || !isStageUnlocked(profile, stage)) return false;
  profile.campaign.selectedStageId = stage.id;
  return true;
}

export function campaignLoadout(profile, owner = "player") {
  ensureCampaignProfile(profile);
  return profile.campaign[owner === "buddy" ? "buddy" : "player"];
}

/**
 * Buy (if needed) and equip gear onto the campaign loadout.
 * Must be in the cumulative shop pool for the selected / given stage.
 */
export function campaignEquip(profile, gearId, owner = "player", stageId = null) {
  ensureCampaignProfile(profile);
  const gear = GEAR_BY_ID[gearId];
  if (!gear || !SLOT_ORDER.includes(gear.slot)) {
    return { ok: false, reason: "invalid" };
  }
  const stage = getStage(stageId || profile.campaign.selectedStageId);
  if (!stage || !isStageUnlocked(profile, stage)) {
    return { ok: false, reason: "locked" };
  }
  const pool = shopPoolForStage(stage);
  const starters = new Set(STARTER_GEAR);
  const freeAlways = new Set([
    ...STARTER_GEAR, "no-shield", NO_SECONDARY_ID, NO_EXTENSION_ID
  ]);
  if (!pool.includes(gearId) && !freeAlways.has(gearId)) {
    return { ok: false, reason: "not-in-shop" };
  }

  const owned = profile.equipment?.owned || [];
  let purchased = false;
  let spent = 0;
  if (!owned.includes(gearId) && !starters.has(gearId) && !freeAlways.has(gearId)) {
    if (!Number.isInteger(gear.price)) {
      return { ok: false, reason: "not-for-sale" };
    }
    const buy = purchaseGear(profile, gearId);
    if (!buy.ok) return buy;
    purchased = true;
    spent = buy.spent;
  }

  const key = owner === "buddy" ? "buddy" : "player";
  profile.campaign[key][gear.slot] = gearId;
  // Keep normalize happy after purchase expands owned.
  const ownedNow = Array.from(new Set([
    ...STARTER_GEAR, "no-shield", NO_SECONDARY_ID, NO_EXTENSION_ID,
    ...(profile.equipment?.owned || [])
  ]));
  profile.campaign[key] = {
    ...normalizeLoadout(profile.campaign[key], ownedNow),
    perk: profile.equipment?.[key]?.perk ?? null
  };
  return {
    ok: true, purchased, spent, gear, owner: key, balance: profile.cyber
  };
}

export function buildStageEncounter(stageOrId) {
  const stage = typeof stageOrId === "string" ? getStage(stageOrId) : stageOrId;
  if (!stage) return null;
  const map = getMap(stage.mapId);
  const encounter = {
    stageId: stage.id,
    stageName: stage.name,
    stageIndex: stage.index,
    blurb: stage.blurb,
    ranking: stage.ranking,
    rewardTier: stage.rewardTier,
    training: stage.training,
    mapId: stage.mapId,
    mapName: map?.name || stage.mapId,
    mapBlurb: stage.blurb,
    trainer: {
      name: stage.trainer.name,
      ai: stage.trainer.ai,
      color: stage.trainer.color,
      loadout: { ...DEFAULT_LOADOUT, ...stage.trainer.loadout }
    },
    follower: {
      name: stage.follower.name,
      ai: stage.follower.ai,
      color: stage.follower.color,
      loadout: { ...DEFAULT_LOADOUT, ...stage.follower.loadout }
    }
  };
  const powers = estimateEncounterPower(encounter, 0);
  encounter.trainerPower = powers.trainer;
  encounter.followerPower = powers.follower;
  encounter.power = powers.duo;
  encounter.powerJitter = 0;
  return encounter;
}

export function getPendingCampaignEncounter() {
  return pendingEncounter;
}

export function setPendingCampaignEncounter(encounter) {
  pendingEncounter = encounter || null;
  return pendingEncounter;
}

export function beginCampaignSelect(profile) {
  ensureCampaignProfile(profile);
  const selected = getStage(profile.campaign.selectedStageId) || CAMPAIGN_STAGES[0];
  if (!isStageUnlocked(profile, selected)) {
    profile.campaign.selectedStageId = CAMPAIGN_STAGES[0].id;
  }
  const encounter = buildStageEncounter(profile.campaign.selectedStageId);
  setPendingCampaignEncounter(encounter);
  return encounter;
}

export function markStageCleared(profile, stageId) {
  ensureCampaignProfile(profile);
  if (!STAGE_BY_ID[stageId]) return false;
  if (!profile.campaign.cleared.includes(stageId)) {
    profile.campaign.cleared.push(stageId);
  }
  // Auto-select next unlocked stage when current clears.
  const stage = getStage(stageId);
  const next = CAMPAIGN_STAGES.find((s) => s.index === (stage?.index || 0) + 1);
  if (next && isStageUnlocked(profile, next)) {
    profile.campaign.selectedStageId = next.id;
  }
  return true;
}

/**
 * Award Campaign rewards once per result id.
 * Wins: Cyber + EXP + stage clear. Losses: nothing (Ranking untouched).
 */
export function awardCampaign(profile, result, random = Math.random) {
  const empty = {
    cyber: 0, exp: 0, levelsGained: 0, pendingPicks: [], rankingDelta: 0, stageCleared: null
  };
  if (result?.mode !== "campaign") return empty;
  ensureCampaignProfile(profile);
  ensureProgressionProfile(profile, profile);
  const resultId = String(result.id || "");
  if (!resultId || profile.campaign.rewardedResults.includes(resultId)) return empty;
  profile.campaign.rewardedResults.push(resultId);
  profile.campaign.rewardedResults = profile.campaign.rewardedResults.slice(-100);

  if (!result.win) return empty;

  const tier = result.difficulty || "rookie";
  const baseCyber = CONQUEST_REWARDS[tier] || CONQUEST_REWARDS.rookie;
  const cyber = Math.round(baseCyber * cyberWinMultiplier(profile));
  const exp = CONQUEST_EXP[tier] || CONQUEST_EXP.rookie;
  profile.cyber += cyber;
  const progression = grantExp(profile, exp, random);
  const stageId = result.stageId || getPendingCampaignEncounter()?.stageId || null;
  if (stageId) markStageCleared(profile, stageId);
  return {
    cyber,
    exp: progression.expGranted,
    levelsGained: progression.levelsGained,
    pendingPicks: progression.pendingPicks,
    rankingDelta: 0,
    stageCleared: stageId
  };
}

/** Shop catalog rows for UI: pool gear + always-available starters for slots. */
export function campaignShopCatalog(profile, stageOrId) {
  ensureCampaignProfile(profile);
  const stage = typeof stageOrId === "string" ? getStage(stageOrId) : stageOrId;
  if (!stage) return [];
  const pool = shopPoolForStage(stage);
  const owned = new Set([
    ...STARTER_GEAR, "no-shield", NO_SECONDARY_ID, NO_EXTENSION_ID,
    ...(profile.equipment?.owned || [])
  ]);
  return pool.map((id) => {
    const gear = GEAR_BY_ID[id];
    if (!gear) return null;
    const isOwned = owned.has(id);
    const price = Number.isInteger(gear.price) ? gear.price : 0;
    return {
      id,
      name: gear.name,
      slot: gear.slot,
      blurb: gear.blurb || gear.tradeoff || "",
      price,
      owned: isOwned,
      affordable: isOwned || price <= (profile.cyber || 0)
    };
  }).filter(Boolean);
}

export function campaignStageCards(profile) {
  ensureCampaignProfile(profile);
  return CAMPAIGN_STAGES.map((stage) => {
    const unlocked = isStageUnlocked(profile, stage);
    const cleared = isStageCleared(profile, stage);
    const selected = profile.campaign.selectedStageId === stage.id;
    const encounter = buildStageEncounter(stage);
    return {
      ...stage,
      unlocked,
      cleared,
      selected,
      power: encounter?.power || 0,
      mapName: encounter?.mapName || stage.mapId
    };
  });
}

/** Soft check that shopAdds reference real gear (used by tests). */
export function validateCampaignCatalog() {
  const missing = [];
  for (const stage of CAMPAIGN_STAGES) {
    for (const id of stage.shopAdds || []) {
      if (!GEAR_BY_ID[id]) missing.push(`${stage.id}:${id}`);
    }
    for (const role of ["trainer", "follower"]) {
      for (const slot of SLOT_ORDER) {
        const id = stage[role]?.loadout?.[slot];
        if (id && !GEAR_BY_ID[id] && id !== NO_SECONDARY_ID && id !== NO_EXTENSION_ID) {
          missing.push(`${stage.id}:${role}.${slot}:${id}`);
        }
      }
    }
  }
  return missing;
}

// Touch GEAR so tree-shaking / unused-import lint stays quiet in check scripts.
void GEAR;
