import {
  dominantHabit, isLearningLocked, mimicUnlockLevel, MIMIC_LOCKED_LINE, normalizeAiMode,
  normalizeMimicIntensity, readiness, topReadinessDetails
} from "./learning.js";
import { defaultQuickReplies, ensureCoaching } from "./coaching.js";
import { FAQ_TOPIC_CHIPS } from "./game-faq.js";
import { analyzerStatus, initializeLanguageAnalyzer } from "./language-analyzer.js";
import {
  ADAPTIVE_NANOTECH_ID, effectiveStats, effectiveOwned, GEAR, GEAR_BY_ID, nanotechArmorHp,
  nanotechArmorMaxHp, ownedForSlot, shieldStats, SLOT_LABELS, SLOT_ORDER, theoreticalDps,
  weaponKind, weaponStats
} from "./equipment.js";
import {
  beginConquestSelect, getPendingEncounter, hasFreeReroll, loadoutSummary,
  REROLL_CYBER_COST
} from "./conquest.js";
import {
  beginCampaignSelect, campaignBossHudLine, campaignShopCatalog, campaignStageCards,
  CAMPAIGN_STAGES, ensureCampaignProfile, getPendingCampaignEncounter
} from "./campaign.js";
import { countLivingSwarm, survivalHudLine } from "./survival.js";
import { listMaps } from "./maps.js";
import {
  estimateProfilePowers, formatPower, powerBarPercent
} from "./power.js";
import { listTimedBuffs } from "./powerups.js";
import {
  ensureProgressionProfile, getPerk, perkTradeoffLines
} from "./perks.js";
import { escapeHtml, formatTime } from "./utils.js";
import {
  findBraceTarget, normalizeReconjurerType, paintReconjurerPreview,
  reconjurerTypeLabel, RECONJURER_METAL_TYPE
} from "./reconjurer-builder.js";
import {
  heldToolUsesOf, TOOL_DEFS, toolDef
} from "./tool-secondaries.js";
import {
  illusionPropKindLabel, normalizeIllusionPropKind
} from "./illusionist.js";
import {
  ensureSettingsProfile, normalizeArmorDespawnTimer, normalizeOptimizeIllusions,
  normalizeReconquerRate, normalizeSfxEnabled, normalizeUseClassic100Hp
} from "./settings.js";
import {
  ensureBuddyCharacter, getBuddyCharacter, listBuddyCharacters, personalizeResultLines
} from "./buddy-characters.js";
import {
  ensureFightStyle, getFightStyle, listFightStyles
} from "./fight-styles.js";
import {
  ensureTutorialProfile, shouldRunGuidedFight, shouldShowBayTutorialHint
} from "./tutorial.js";
import { applySfxSettings } from "./sfx.js";
import { normalizeTrapType, trapTypeLabel } from "./trapper.js";
import { isSpellbook, normalizeSpellType, spellManaCost, spellTypeLabel } from "./spellbook.js";
import { gimmickLabel } from "./map-gimmicks.js";

const $ = (selector) => document.querySelector(selector);

export const ui = {
  menu: $("#menu"),
  pause: $("#pause"),
  results: $("#results"),
  hud: $("#hud"),
  buildStamp: $("#buildStamp"),
  name: $("#botName"),
  nameError: $("#nameError"),
  buddyCharacterList: $("#buddyCharacterList"),
  buddyCharacterHint: $("#buddyCharacterHint"),
  fightStyleList: $("#fightStyleList"),
  fightStyleHint: $("#fightStyleHint"),
  aiMode: $("#aiMode"),
  mimicControls: $("#mimicControls"),
  mimicIntensity: $("#mimicIntensity"),
  mimicLockReason: $("#mimicLockReason"),
  conquestSelect: $("#conquestSelect"),
  conquestRanking: $("#conquestRanking"),
  conquestLeague: $("#conquestLeague"),
  conquestCyber: $("#conquestCyber"),
  conquestOpponentPanel: $("#conquestOpponentPanel"),
  conquestSelectFeedback: $("#conquestSelectFeedback"),
  conquestRerollBtn: $("#conquestRerollBtn"),
  conquestFightBtn: $("#conquestFightBtn"),
  conquestBackBtn: $("#conquestBackBtn"),
  campaignSelect: $("#campaignSelect"),
  campaignStageRanking: $("#campaignStageRanking"),
  campaignCleared: $("#campaignCleared"),
  campaignCyber: $("#campaignCyber"),
  campaignStageList: $("#campaignStageList"),
  campaignOpponentPanel: $("#campaignOpponentPanel"),
  campaignShopPanel: $("#campaignShopPanel"),
  campaignLoadoutSummary: $("#campaignLoadoutSummary"),
  campaignSelectFeedback: $("#campaignSelectFeedback"),
  campaignFightBtn: $("#campaignFightBtn"),
  campaignBackBtn: $("#campaignBackBtn"),
  mapSelect: $("#mapSelect"),
  tutorialBanner: $("#tutorialBanner"),
  tutorialBtn: $("#tutorialBtn"),
  tutorialDismissBtn: $("#tutorialDismissBtn"),
  trainingBtn: $("#trainingBtn"),
  learningLock: $("#learningLock"),
  learningLockHint: $("#learningLockHint"),
  readiness: $("#menuReadiness"),
  habit: $("#habitSummary"),
  teamBars: $("#teamBars"),
  modeLabel: $("#modeLabel"),
  readinessLabel: $("#readinessLabel"),
  trapHud: $("#trapHud"),
  trapHudKicker: $("#trapHudKicker"),
  trapHudType: $("#trapHudType"),
  trapHudSub: $("#trapHudSub"),
  reconjurerPreview: $("#reconjurerPreview"),
  reconjurerPreviewCanvas: $("#reconjurerPreviewCanvas"),
  reconjurerPreviewKicker: $("#reconjurerPreviewKicker"),
  reconjurerPreviewLabel: $("#reconjurerPreviewLabel"),
  reconjurerPreviewHint: $("#reconjurerPreviewHint"),
  fuel: $("#fuelFill"),
  fuelMeter: $("#fuelMeter"),
  fuelLabel: $("#fuelLabel"),
  armor: $("#armorFill"),
  armorMeter: $("#armorMeter"),
  armorLabel: $("#armorLabel"),
  reserve: $("#reserveFill"),
  reserveMeter: $("#reserveMeter"),
  reserveLabel: $("#reserveLabel"),
  shield: $("#shieldFill"),
  shieldMeter: $("#shieldMeter"),
  shieldLabel: $("#shieldLabel"),
  dodge: $("#dodgeFill"),
  buffRow: $("#buffRow"),
  announcement: $("#announcement"),
  resultTitle: $("#resultTitle"),
  feedback: $("#feedback"),
  thoughts: $("#thoughtLog"),
  coachingPanel: $("#coachingPanel"),
  coachingMessages: $("#coachingMessages"),
  coachingQuickReplies: $("#coachingQuickReplies"),
  coachingForm: $("#coachingForm"),
  coachingInput: $("#coachingInput"),
  analyzerStatus: $("#analyzerStatus"),
  coachingTopicChips: $("#coachingTopicChips"),
  coachingTitle: $("#coachingTitle"),
  playerSlots: $("#playerSlots"),
  buddySlots: $("#buddySlots"),
  playerPerkSlot: $("#playerPerkSlot"),
  buddyPerkSlot: $("#buddyPerkSlot"),
  playerStats: $("#playerStats"),
  buddyStats: $("#buddyStats"),
  buddyMode: $("#buddyMode"),
  buddyPerkMode: $("#buddyPerkMode"),
  suggestionPanel: $("#suggestionPanel"),
  perkSuggestionPanel: $("#perkSuggestionPanel"),
  autonomyHint: $("#autonomyHint"),
  perkAutonomyHint: $("#perkAutonomyHint"),
  buddyColumnName: $("#buddyColumnName"),
  menuCyber: $("#menuCyber"),
  menuLevel: $("#menuLevel"),
  menuRanking: $("#menuRanking"),
  menuExpFill: $("#menuExpFill"),
  menuExpLabel: $("#menuExpLabel"),
  shopCyber: $("#shopCyber"),
  hudCyber: $("#hudCyber"),
  hudRanking: $("#hudRanking"),
  resultCyber: $("#resultCyber"),
  resultExp: $("#resultExp"),
  resultRanking: $("#resultRanking"),
  equipmentPanel: $("#equipmentPanel"),
  shopPanel: $("#shopPanel"),
  shopCategories: $("#shopCategories"),
  shopFeedback: $("#shopFeedback"),
  perkModal: $("#perkModal"),
  perkChoices: $("#perkChoices"),
  perkModalTitle: $("#perkModalTitle"),
  settingsModal: $("#settingsModal"),
  settingsBtn: $("#settingsBtn"),
  settingsCloseBtn: $("#settingsCloseBtn"),
  settingsVisualPanel: $("#settingsVisualPanel"),
  settingsGameplayPanel: $("#settingsGameplayPanel"),
  settingsDeveloperPanel: $("#settingsDeveloperPanel"),
  unlockAllGearTemporaryInput: $("#unlockAllGearTemporary"),
  optimizeIllusionsInput: $("#optimizeIllusions"),
  sfxEnabledInput: $("#sfxEnabled"),
  useClassic100HpInput: $("#useClassic100Hp"),
  modularMorphStyleInputs: [...document.querySelectorAll('input[name="modularMorphStyle"]')],
  debrisDespawnStyleInputs: [...document.querySelectorAll('input[name="debrisDespawnStyle"]')],
  reconquerRateInput: $("#reconquerRate"),
  reconquerRateValue: $("#reconquerRateValue"),
  reconquerRateControl: $("#reconquerRateControl"),
  armorDespawnStyleInputs: [...document.querySelectorAll('input[name="armorDespawnStyle"]')],
  armorDespawnTimerInput: $("#armorDespawnTimer"),
  armorDespawnTimerControl: $("#armorDespawnTimerControl")
};

/** Show git commit / sync identity so localhost builds are easy to verify. */
export async function showBuildStamp() {
  const el = ui.buildStamp || $("#buildStamp");
  if (!el) return;
  try {
    const response = await fetch("/__sync", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const features = Array.isArray(data.features) ? data.features : [];
    const patched = features.includes("ai-retractable-on-sight")
      && features.includes("dodge-face");
    el.textContent = patched
      ? `build ${data.commit || "?"} · patched · ${data.branch || "master"}`
      : `build ${data.commit || "?"} · ${data.branch || "?"} · incomplete`;
    el.title = data.lastSyncNote
      ? `${data.lastSyncNote} · features: ${features.join(", ") || "none"}`
      : features.join(", ") || "no feature list";
    el.dataset.patched = patched ? "1" : "0";
  } catch {
    el.textContent = "build unknown · not sync server (use npm run serve)";
    el.title = "Open /__sync — if it 404s, this is not the patched auto-pull server";
    el.dataset.patched = "0";
  }
}

let coachingWeapon = "gun";

function renderAnalyzerStatus() {
  const status = analyzerStatus();
  ui.analyzerStatus.textContent = status.label;
  ui.analyzerStatus.dataset.state = status.state;
}

renderAnalyzerStatus();
initializeLanguageAnalyzer().then(() => {
  renderAnalyzerStatus();
  // Keep the status label fresh if the worker finishes after first paint.
  const timer = setInterval(() => {
    renderAnalyzerStatus();
    if (analyzerStatus().state !== "loading") clearInterval(timer);
  }, 400);
}).catch(renderAnalyzerStatus);

function renderTopicChips() {
  if (!ui.coachingTopicChips) return;
  ui.coachingTopicChips.innerHTML = FAQ_TOPIC_CHIPS.map((topic) => `
    <button type="button" class="topic-chip" data-coaching-reply="${escapeHtml(topic)}">${escapeHtml(topic)}</button>
  `).join("");
}

renderTopicChips();

function renderCoachingMessages(profile, quickReplies) {
  const coaching = ensureCoaching(profile);
  const messages = coaching.history.slice(-10);
  ui.coachingMessages.innerHTML = messages.length
    ? messages.map((message) => `
      <div class="coaching-message ${message.role}">
        <small>${message.role === "player" ? "You" : escapeHtml(profile.botName || "Buddy")}</small>
        ${escapeHtml(message.text)}
      </div>`).join("")
    : `<div class="coaching-message"><small>${escapeHtml(profile.botName || "Buddy")}</small>Ask a game question or coach me after Training.</div>`;
  ui.coachingMessages.scrollTop = ui.coachingMessages.scrollHeight;
  const replies = (quickReplies || defaultQuickReplies(profile, coachingWeapon)).slice(0, 3);
  ui.coachingQuickReplies.innerHTML = replies
    .map((reply) => `<button type="button" data-coaching-reply="${escapeHtml(reply)}">${escapeHtml(reply)}</button>`)
    .join("");
}

export function refreshCoaching(profile, quickReplies) {
  renderCoachingMessages(profile, quickReplies);
  ui.coachingInput.value = "";
  ui.coachingInput.focus();
}

function refreshProgression(profile) {
  ensureProgressionProfile(profile, profile);
  if (ui.menuLevel) ui.menuLevel.textContent = String(profile.level);
  const pct = profile.expToNext > 0
    ? Math.min(100, Math.round((profile.exp / profile.expToNext) * 100))
    : 0;
  if (ui.menuExpFill) ui.menuExpFill.style.width = `${pct}%`;
  if (ui.menuExpLabel) {
    ui.menuExpLabel.textContent = `${profile.exp} / ${profile.expToNext} EXP`;
  }
  const ranking = Number.isInteger(profile.ranking) ? profile.ranking : 100;
  if (ui.menuRanking) ui.menuRanking.textContent = String(ranking);
  if (ui.hudRanking) ui.hudRanking.textContent = `RANK ${ranking}`;
}

export function refreshMenu(profile) {
  ensureBuddyCharacter(profile);
  ensureFightStyle(profile);
  ui.name.value = profile.botName || "Pixel";
  ui.buddyColumnName.textContent = profile.botName || "Pixel";
  refreshBuddyCharacters(profile);
  refreshFightStyles(profile);
  const weaponType = weaponKind(profile.equipment.player.weapon);
  const data = profile.weapons[weaponType];
  ui.readiness.textContent = readiness(data);
  ui.habit.textContent = dominantHabit(data);
  const balance = `${profile.cyber}¢`;
  ui.menuCyber.textContent = balance;
  ui.shopCyber.textContent = balance;
  ui.hudCyber.textContent = balance;
  refreshProgression(profile);
  refreshMindControls(profile, data);
  refreshLearningLock(profile);
  refreshTutorialBanner(profile);
  renderEquipment(profile);
  renderShop(profile);
  renderPerkModal(profile);
  refreshSettings(profile);
}

function refreshTutorialBanner(profile) {
  ensureTutorialProfile(profile);
  const show = shouldShowBayTutorialHint(profile);
  ui.tutorialBanner?.classList.toggle("hidden", !show);
  ui.trainingBtn?.classList.toggle("tutorial-pulse", shouldRunGuidedFight(profile));
  if (ui.tutorialBtn) {
    ui.tutorialBtn.textContent = "Start Tutorial";
  }
}

function refreshBuddyCharacters(profile) {
  if (!ui.buddyCharacterList) return;
  ensureBuddyCharacter(profile);
  const selected = getBuddyCharacter(profile);
  ui.buddyCharacterList.innerHTML = listBuddyCharacters().map((character) => {
    const active = character.id === selected.id;
    return `
      <button type="button" class="buddy-character-card${active ? " active" : ""}"
        data-buddy-character="${escapeHtml(character.id)}"
        role="radio" aria-checked="${active ? "true" : "false"}"
        style="--character-accent:${escapeHtml(character.accent)}">
        <strong><i class="swatch" aria-hidden="true"></i>${escapeHtml(character.name)}</strong>
        <span>${escapeHtml(character.blurb)}</span>
      </button>
    `;
  }).join("");
  if (ui.buddyCharacterHint) {
    const suggested = selected.suggestedFightStyle || "balanced";
    ui.buddyCharacterHint.textContent = (
      `${selected.name} — ${selected.blurb} Suggested style: ${suggested}.`
    );
  }
}

function refreshFightStyles(profile) {
  if (!ui.fightStyleList) return;
  ensureFightStyle(profile);
  const selected = getFightStyle(profile);
  const suggestedId = getBuddyCharacter(profile).suggestedFightStyle || "balanced";
  ui.fightStyleList.innerHTML = listFightStyles().map((style) => {
    const active = style.id === selected.id;
    const suggested = style.id === suggestedId;
    return `
      <button type="button" class="fight-style-card${active ? " active" : ""}${suggested ? " suggested" : ""}"
        data-fight-style="${escapeHtml(style.id)}"
        role="radio" aria-checked="${active ? "true" : "false"}">
        <strong>${escapeHtml(style.name)}</strong>
        <span>${escapeHtml(style.blurb)}</span>
      </button>
    `;
  }).join("");
  if (ui.fightStyleHint) {
    const tip = suggestedId !== selected.id
      ? `${selected.name} — ${selected.blurb} (${getBuddyCharacter(profile).name} suggests ${suggestedId}.)`
      : `${selected.name} — ${selected.blurb}`;
    ui.fightStyleHint.textContent = tip;
  }
}

function refreshLearningLock(profile) {
  const locked = isLearningLocked(profile);
  if (!ui.learningLock) return;
  for (const button of ui.learningLock.querySelectorAll("[data-learning-lock]")) {
    const isLock = button.dataset.learningLock === "true";
    const active = isLock === locked;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  }
  if (ui.learningLockHint) {
    ui.learningLockHint.textContent = locked
      ? "Spar only — Training fights write no habit, readiness, or practice evidence."
      : "Learn — Training updates habits, readiness, and coaching practice evidence.";
  }
}

function refreshMindControls(profile, learned) {
  const unlock = mimicUnlockLevel(learned);
  const mimicOption = ui.aiMode.querySelector('option[value="mimic"]');
  if (mimicOption) {
    mimicOption.disabled = unlock === "locked";
    mimicOption.textContent = unlock === "locked"
      ? "Mimic — locked (need more style evidence)"
      : "Mimic — copy your style";
  }
  let mode = normalizeAiMode(profile.aiMode);
  if (mode === "mimic" && unlock === "locked") mode = "balanced";
  ui.aiMode.value = mode;
  profile.aiMode = mode;

  let intensity = normalizeMimicIntensity(profile.mimicIntensity);
  if (intensity === "full" && unlock !== "full") intensity = "quite";
  profile.mimicIntensity = intensity;

  const showMimic = mode === "mimic";
  const showPanel = showMimic || unlock === "locked";
  ui.mimicControls?.classList.toggle("hidden", !showPanel);
  ui.mimicControls?.classList.toggle("mimic-locked-only", unlock === "locked");
  if (!ui.mimicIntensity) return;
  for (const button of ui.mimicIntensity.querySelectorAll("[data-mimic-intensity]")) {
    const key = button.dataset.mimicIntensity;
    const allowed = unlock !== "locked"
      && (key !== "full" || unlock === "full");
    button.disabled = !allowed;
    button.classList.toggle("active", showMimic && key === intensity);
    button.setAttribute("aria-checked", String(showMimic && key === intensity));
  }
  if (ui.mimicLockReason) {
    if (unlock === "locked") {
      ui.mimicLockReason.textContent = MIMIC_LOCKED_LINE;
    } else if (showMimic && unlock === "partial") {
      ui.mimicLockReason.textContent = "Full unlocks when I'm ready.";
    } else {
      ui.mimicLockReason.textContent = showMimic
        ? "Copies your range, rush, dodge, jet, low-HP, and shield habits."
        : "";
    }
  }
}

export function showGame(mode, profile, mapName = "") {
  ui.menu.classList.add("hidden");
  ui.conquestSelect?.classList.add("hidden");
  ui.campaignSelect?.classList.add("hidden");
  ui.results.classList.add("hidden");
  ui.pause.classList.add("hidden");
  ui.perkModal?.classList.add("hidden");
  showSettings(false);
  ui.hud.classList.remove("hidden");
  const lockedSpar = mode === "training" && isLearningLocked(profile);
  const mapTag = mapName ? ` · ${mapName}` : "";
  ui.modeLabel.textContent = mode === "tutorial"
    ? `TUTORIAL // SPAR DUMMY${mapTag}`
    : lockedSpar
      ? `SPAR — learning locked // ${ui.aiMode.value.toUpperCase()} BUDDY${mapTag}`
      : `${mode.toUpperCase()} // ${ui.aiMode.value.toUpperCase()} BUDDY${mapTag}`;
  const loadout = mode === "campaign"
    ? (profile.campaign?.player || profile.equipment.player)
    : profile.equipment.player;
  const weapon = weaponKind(loadout.weapon);
  ui.readinessLabel.textContent = mode === "tutorial"
    ? "Tutorial spar"
    : lockedSpar
      ? "SPAR — learning locked"
      : readiness(profile.weapons[weapon]);
  ui.announcement.textContent = mode === "tutorial"
    ? `TUTORIAL · MOVE — hold A or D${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
    : lockedSpar
      ? `SPAR — LEARNING LOCKED${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
      : mode === "training"
        ? `TRAIN YOUR BUDDY${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
        : mode === "campaign"
          ? `CLEAR THE STAGE${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
          : mode === "survival"
            ? `HOLD THE LINE${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
            : `PROTECT YOUR TEAM${mapName ? ` · ${mapName.toUpperCase()}` : ""}`;
}

export function updateHud(game) {
  const player = game.fighters[0];
  if (ui.reconjurerPreview) {
    const showBuild = !!player?.reconjurerBuilder && !player.dead;
    ui.reconjurerPreview.classList.toggle("hidden", !showBuild);
    if (showBuild) {
      const type = normalizeReconjurerType(player.reconjurerType, game);
      const metal = type === RECONJURER_METAL_TYPE;
      const metalLocked = metal && (player.reconjurerMetalCd || 0) > 0;
      const cd = player.reconjurerCd || 0;
      ui.reconjurerPreview.classList.toggle("metal", metal);
      ui.reconjurerPreview.classList.toggle("locked", metalLocked);
      if (ui.reconjurerPreviewKicker) {
        ui.reconjurerPreviewKicker.textContent = "NEXT BUILD · T cycle";
      }
      if (ui.reconjurerPreviewLabel) {
        ui.reconjurerPreviewLabel.textContent = reconjurerTypeLabel(type);
      }
      if (ui.reconjurerPreviewHint) {
        // Brace ignores metal CD — show it whenever ready and a target is near.
        const braceTarget = cd <= 0 ? findBraceTarget(game, player) : null;
        ui.reconjurerPreviewHint.textContent = cd > 0
          ? `ready in ${Math.ceil(cd)}s`
          : braceTarget
            ? (braceTarget.powerCrate || braceTarget.kind === "powerCrate"
              ? "3 brace · wood casing"
              : "3 brace · metal casing")
            : metalLocked
              ? `metal cd ${Math.ceil(player.reconjurerMetalCd)}s`
              : "3 place · debris rebuild · brace cover";
      }
      if (ui.reconjurerPreviewCanvas) {
        paintReconjurerPreview(ui.reconjurerPreviewCanvas, type, game);
      }
    }
  }
  if (ui.trapHud) {
    const showTrap = !!player?.trapper && !player.dead;
    const showIllu = !!player?.illusionist && !player.dead;
    const showDoppel = !!player?.combatCloneGear && !player.dead;
    const showSpell = !!player && isSpellbook(player) && !player.dead
      && !showTrap && !showIllu && !showDoppel;
    const showTool = !player?.dead
      && !showTrap && !showIllu && !showDoppel && !showSpell
      && (!!player?.toolSecondary || !!player?.heldToolPickup);
    ui.trapHud.classList.toggle(
      "hidden",
      !showTrap && !showIllu && !showDoppel && !showSpell && !showTool
    );
    ui.trapHud.classList.toggle("illusion", showIllu);
    ui.trapHud.classList.toggle("doppel", showDoppel && !showIllu);
    ui.trapHud.classList.toggle("spell", showSpell);
    const clearTrapHudKinds = () => {
      ui.trapHud.classList.toggle("fake", false);
      ui.trapHud.classList.toggle("bear", false);
      ui.trapHud.classList.toggle("spring", false);
      ui.trapHud.classList.toggle("signal", false);
      ui.trapHud.classList.toggle("mine", false);
      ui.trapHud.classList.toggle("ice", false);
      ui.trapHud.classList.toggle("fire", false);
      ui.trapHud.classList.toggle("lightning", false);
    };
    if (showIllu) {
      const t = player.illusionistType === "prop"
        ? "prop"
        : player.illusionistType === "platform"
          ? "plat"
          : "fighter";
      clearTrapHudKinds();
      if (ui.trapHudKicker) ui.trapHudKicker.textContent = "NEXT ILLUSION · T cycle";
      if (ui.trapHudType) {
        ui.trapHudType.textContent = t === "prop" ? "PROP" : t === "plat" ? "PLAT" : "FIGHTER";
      }
      if (ui.trapHudSub) {
        if (t === "prop") {
          const kind = normalizeIllusionPropKind(player.illusionPropKind, game);
          ui.trapHudSub.textContent = `${illusionPropKindLabel(kind)} · Y`;
          ui.trapHudSub.classList.remove("hidden");
          ui.trapHudSub.classList.toggle("metal", kind === "metal");
        } else {
          ui.trapHudSub.textContent = "";
          ui.trapHudSub.classList.add("hidden");
          ui.trapHudSub.classList.remove("metal");
        }
      }
    } else if (showDoppel) {
      clearTrapHudKinds();
      const cd = player.combatCloneCd || 0;
      if (ui.trapHudKicker) {
        ui.trapHudKicker.textContent = cd > 0 ? "DOPPEL · COOLDOWN" : "DOPPEL · PRESS 3";
      }
      if (ui.trapHudType) {
        ui.trapHudType.textContent = cd > 0 ? `${Math.ceil(cd)}s` : "READY";
      }
      if (ui.trapHudSub) {
        ui.trapHudSub.textContent = "";
        ui.trapHudSub.classList.add("hidden");
      }
    } else if (showTrap) {
      const type = normalizeTrapType(player.trapperType);
      clearTrapHudKinds();
      ui.trapHud.classList.toggle("fake", type === "fakePlatform");
      ui.trapHud.classList.toggle("bear", type === "bear");
      ui.trapHud.classList.toggle("spring", type === "springPad");
      ui.trapHud.classList.toggle("signal", type === "signalTripwire");
      ui.trapHud.classList.toggle("mine", type === "landMine");
      if (ui.trapHudKicker) ui.trapHudKicker.textContent = "NEXT TRAP · T cycle";
      if (ui.trapHudType) ui.trapHudType.textContent = trapTypeLabel(type);
      if (ui.trapHudSub) {
        ui.trapHudSub.textContent = "";
        ui.trapHudSub.classList.add("hidden");
      }
    } else if (showSpell) {
      const type = normalizeSpellType(player.spellType);
      clearTrapHudKinds();
      ui.trapHud.classList.toggle("ice", type === "ice");
      ui.trapHud.classList.toggle("fire", type === "fire");
      ui.trapHud.classList.toggle("lightning", type === "lightning");
      if (ui.trapHudKicker) ui.trapHudKicker.textContent = "SPELL · E cycle";
      if (ui.trapHudType) ui.trapHudType.textContent = spellTypeLabel(type);
      if (ui.trapHudSub) {
        const cost = spellManaCost(type);
        const mana = Math.floor(player.mana || 0);
        ui.trapHudSub.textContent = `${cost} mana · ${mana} ready`;
        ui.trapHudSub.classList.remove("hidden");
        ui.trapHudSub.classList.remove("metal");
      }
    } else if (showTool) {
      clearTrapHudKinds();
      const held = player.heldToolPickup ? toolDef(player.heldToolPickup) : null;
      const eq = player.toolSecondary ? toolDef(player.toolSecondary) : null;
      if (held) {
        const uses = heldToolUsesOf(player);
        if (ui.trapHudKicker) ui.trapHudKicker.textContent = "PICKUP · CLICK TO USE";
        if (ui.trapHudType) {
          ui.trapHudType.textContent = uses > 1 ? `${held.label}×${uses}` : held.label;
        }
        if (ui.trapHudSub) {
          ui.trapHudSub.textContent = uses > 1 ? `${uses} uses left` : "one-shot";
          ui.trapHudSub.classList.remove("hidden");
        }
      } else if (eq) {
        const cd = player.toolCd || 0;
        if (ui.trapHudKicker) {
          ui.trapHudKicker.textContent = cd > 0 ? "TOOL · COOLDOWN" : "TOOL · READY";
        }
        if (ui.trapHudType) {
          ui.trapHudType.textContent = cd > 0 ? `${Math.ceil(cd)}s` : eq.label;
        }
        if (ui.trapHudSub) {
          ui.trapHudSub.textContent = `${eq.cd}s CD · infinite`;
          ui.trapHudSub.classList.remove("hidden");
        }
      }
    }
  }
  ui.teamBars.innerHTML = (() => {
    const real = game.fighters.filter((f) => !f.illusion && !f.combatClone);
    const shown = game.mode === "survival"
      ? real.filter((f) => f.team === 0 || (!f.survivalSwarm && f.team === 1))
      : real;
    const bars = shown.map((fighter) => {
      // Illusionists see real HP; everyone else can be gaslit by phantom damage.
      const showHp = player?.illusionist
        ? Math.max(0, fighter.hp || 0)
        : Math.max(0, (fighter.hp || 0) - (fighter.phantomDamage || 0));
      const pct = fighter.maxHp > 0 ? (showHp / fighter.maxHp) * 100 : 0;
      return `
    <div class="fighter-bar" style="opacity:${fighter.dead ? .38 : 1}">
      <b style="color:${fighter.color}">${escapeHtml(fighter.name)}</b>
      <div class="hp-track"><i class="hp-fill" style="width:${pct}%;background:${fighter.team ? "#ff665c" : "#42dff5"}"></i></div>
      <span>${Math.ceil(showHp)}</span>
    </div>`;
    });
    if (game.mode === "survival" && game.survival) {
      const live = countLivingSwarm(game);
      const line = survivalHudLine(game);
      bars.push(`
    <div class="fighter-bar survival-swarm-bar">
      <b style="color:#ff665c">SWARM ×${live}</b>
      <div class="hp-track"><i class="hp-fill" style="width:${Math.min(100, live * 12)}%;background:#ff665c"></i></div>
      <span>${escapeHtml(line)}</span>
    </div>`);
    }
    return bars.join("");
  })();
  // Band flash on survival announcements
  if (game.mode === "survival" && (game.survival?.announcement || 0) > 0 && ui.announcement) {
    const line = survivalHudLine(game);
    if (line) ui.announcement.textContent = line.toUpperCase();
  }
  if (
    game.mode === "campaign"
    && (game.campaignBoss?.announcement || 0) > 0
    && ui.announcement
  ) {
    const line = campaignBossHudLine(game);
    if (line) ui.announcement.textContent = line.toUpperCase();
  }
  ui.fuel.style.width = `${player.fuel * 100}%`;
  ui.fuelMeter.classList.toggle("exhausted", !!player.jetLocked);
  ui.fuelLabel.textContent = player.jetLocked ? "EXHAUSTED" : "FUEL";
  const hasNanoArmor = !!player.hasNanotechChestplate;
  const hasNanoPool = (player.nanobotMax || 0) > 0;
  const hasArmor = (player.retractableMax || 0) > 0 || hasNanoArmor;
  if (ui.armorMeter) {
    ui.armorMeter.classList.toggle("hidden", !hasArmor);
    if (hasNanoArmor) {
      const maxHp = nanotechArmorMaxHp(player);
      const curHp = nanotechArmorHp(player);
      const armorPct = maxHp > 0 ? (curHp / maxHp) * 100 : 0;
      ui.armor.style.width = `${armorPct}%`;
      ui.armorMeter.classList.toggle("deployed", curHp > 0 && !player.nanotechArmorSpawning);
      ui.armorMeter.classList.toggle("morphing", !!player.nanotechArmorSpawning);
      ui.armorMeter.classList.toggle("empty", curHp <= 0 && !player.nanotechArmorSpawning);
      const recalling = !!player.nanotechChanneling && curHp > 0;
      ui.armorLabel.textContent = player.nanotechArmorSpawning
        ? "ARMOR FORM…"
        : recalling
          ? "ARMOR RECALL…"
          : curHp <= 0
            ? "ARMOR 0"
            : `ARMOR ${curHp}/${maxHp}`;
    } else if (hasArmor) {
      const armorPct = player.retractableMax > 0
        ? (player.retractableHp / player.retractableMax) * 100
        : 0;
      ui.armor.style.width = `${armorPct}%`;
      ui.armorMeter.classList.toggle("deployed", !!player.retractableDeployed && !player.retractableMorphing);
      ui.armorMeter.classList.toggle("morphing", !!player.retractableMorphing);
      ui.armorMeter.classList.toggle("empty", player.retractableHp <= 0);
      ui.armorLabel.textContent = player.retractableMorphing
        ? "ARMOR…"
        : player.retractableHp <= 0
          ? "ARMOR EMPTY"
          : player.retractableDeployed
            ? "ARMOR ON"
            : "ARMOR OFF";
    }
  }
  if (ui.reserveMeter) {
    const showMana = !!player && isSpellbook(player) && !player.dead && !hasNanoPool;
    ui.reserveMeter.classList.toggle("hidden", !hasNanoPool && !showMana);
    ui.reserveMeter.classList.toggle("mana", showMana);
    ui.reserveMeter.classList.toggle("reserve", !showMana);
    if (hasNanoPool) {
      const max = player.nanobotMax || 0;
      const free = Math.max(0, Math.floor(player.nanobotFree || 0));
      const weapon = Math.max(0, Math.floor(player.nanobotWeapon || 0));
      const cost = player.nanotechWeaponCost || 0;
      const shotCost = player.nanobotShotCost || 0;
      ui.reserve.style.width = `${max > 0 ? (free / max) * 100 : 0}%`;
      ui.reserveMeter.classList.toggle(
        "low",
        (shotCost > 0 && weapon > 0 && free < shotCost)
          || (cost > 0 && weapon < cost && free < cost - weapon)
      );
      ui.reserveMeter.classList.toggle("empty", free <= 0);
      if (player.nanotechWeaponAbsorbing) {
        ui.reserveLabel.textContent = `RESERVE ${free} · ABSORB…`;
      } else if (cost > 0 && shotCost > 0 && weapon > 0) {
        ui.reserveLabel.textContent = free < shotCost
          ? `RESERVE ${free} · NEED ${shotCost}`
          : `RESERVE ${free} · ${shotCost}/shot`;
      } else if (weapon > 0) {
        const formTag = cost > 0 && weapon < cost ? `W ${weapon}/${cost}` : `W ${weapon}`;
        ui.reserveLabel.textContent = `RESERVE ${free} · ${formTag}`;
      } else if (cost > 0) {
        ui.reserveLabel.textContent = `RESERVE ${free} · W OFF`;
      } else {
        ui.reserveLabel.textContent = `RESERVE ${free}`;
      }
    } else if (showMana) {
      const max = player.manaMax || 100;
      const mana = Math.max(0, player.mana || 0);
      const cost = spellManaCost(player.spellType);
      ui.reserve.style.width = `${max > 0 ? (mana / max) * 100 : 0}%`;
      ui.reserveMeter.classList.toggle("low", mana < cost);
      ui.reserveMeter.classList.toggle("empty", mana <= 0);
      ui.reserveLabel.textContent = `MANA ${Math.floor(mana)}/${Math.floor(max)}`;
    }
  }
  const hasShield = (player.shieldMaxDurability || 0) > 0;
  ui.shieldMeter.classList.toggle("hidden", !hasShield);
  if (hasShield) {
    ui.shield.style.width = `${(player.shieldDurability / player.shieldMaxDurability) * 100}%`;
    ui.shieldMeter.classList.toggle("broken", !!player.shieldBroken);
    ui.shieldMeter.classList.toggle("raised", !!player.shieldRaised && !player.shieldBroken);
    let shieldText = player.shieldBroken
      ? "BROKEN"
      : player.shieldRaised ? "SHIELD UP" : "SHIELD";
    if (player.modularWeapon && player.modularMode === "shield") {
      shieldText = player.shieldBroken
        ? "PLATE BROKEN"
        : player.shieldRaised ? "PLATE UP" : "MOD PLATE";
    }
    ui.shieldLabel.textContent = shieldText;
  }
  if (ui.modeLabel && player.modularWeapon) {
    const modeTag = player.modularMorphing
      ? "MORPH…"
      : ({ sword: "SWORD", shield: "SHIELD", rifle: "RIFLE" }[player.modularMode] || "MOD");
    const base = ui.modeLabel.textContent.replace(/\s*·\s*(SWORD|SHIELD|RIFLE|SNIPER|MORPH…)\s*$/, "");
    ui.modeLabel.textContent = `${base} · ${modeTag}`;
  }
  if (ui.modeLabel && player.adaptiveNanotechWeapon) {
    const modeTag = player.adaptiveMorphing
      ? "MORPH…"
      : ({ sword: "SWORD", rifle: "RIFLE", sniper: "SNIPER" }[player.adaptiveMode] || "ADAPT");
    const base = ui.modeLabel.textContent.replace(/\s*·\s*(SWORD|SHIELD|RIFLE|SNIPER|MORPH…)\s*$/, "");
    ui.modeLabel.textContent = `${base} · ${modeTag}`;
  }
  const dodgeBase = 1.2 * (player.dodgeCooldownMult || 1);
  ui.dodge.style.width = `${(1 - Math.max(0, Math.min(1, player.dodgeCd / dodgeBase))) * 100}%`;
  const buffs = listTimedBuffs(player);
  if (ui.buffRow) {
    ui.buffRow.innerHTML = buffs.map((buff) => {
      const pct = buff.charges
        ? (buff.remaining / Math.max(1, buff.duration)) * 100
        : (buff.remaining / Math.max(0.01, buff.duration)) * 100;
      const clock = buff.charges
        ? `${buff.remaining}`
        : `${Math.ceil(buff.remaining)}s`;
      return `<span class="buff-chip" title="${escapeHtml(buff.label)}" style="--buff:${escapeHtml(buff.color)};--pct:${pct}%"><i></i>${escapeHtml(buff.label)} ${clock}</span>`;
    }).join("");
  }
  const sparLocked = game.mode === "training" && !!game.learningLocked;
  const mapBit = game.mapName ? ` · ${String(game.mapName).toUpperCase()}` : "";
  const gimmickBit = game.gimmick?.label
    ? ` · ${gimmickLabel(game.gimmick.kind) || game.gimmick.label}`
    : "";
  if (game.mode === "tutorial" && game.tutorial?.prompt && ui.announcement) {
    ui.announcement.textContent = game.tutorial.prompt;
    return;
  }
  if (
    game.mode === "campaign"
    && (game.campaignBoss?.announcement || 0) > 0
    && ui.announcement
  ) {
    return;
  }
  ui.announcement.textContent = game.announcement > 0
    ? (sparLocked
      ? `SPAR — LEARNING LOCKED${mapBit}${gimmickBit}`
      : game.mode === "training"
        ? `TRAIN YOUR BUDDY${mapBit}${gimmickBit}`
        : game.mode === "campaign" && game.campaignBoss
          ? `APEX BOSS${mapBit}${gimmickBit}`
          : `PROTECT YOUR TEAM${mapBit}${gimmickBit}`)
    : "";
}

export function showResults(
  game, profile, win, practiceLines = [], rewards = {}, learningChanged = []
) {
  const earnedCyber = typeof rewards === "number" ? rewards : (rewards.cyber || 0);
  const earnedExp = typeof rewards === "number" ? 0 : (rewards.exp || 0);
  const levelsGained = typeof rewards === "number" ? 0 : (rewards.levelsGained || 0);
  const pendingCount = typeof rewards === "number"
    ? 0
    : (rewards.pendingPicks?.length || 0);
  const rankingDelta = typeof rewards === "number" ? 0 : (rewards.rankingDelta || 0);
  const rankingNow = Number.isInteger(profile.ranking) ? profile.ranking : 100;

  ui.hud.classList.add("hidden");
  ui.results.classList.remove("hidden");
  if (game.mode === "survival") {
    const waves = rewards?.waves || game.survival?.wave || 0;
    const secs = Math.floor(rewards?.time || game.survival?.elapsed || game.elapsed || 0);
    ui.resultTitle.textContent = waves > 0 || secs >= 20
      ? `Survived ${waves} wave${waves === 1 ? "" : "s"}`
      : "Overrun";
  } else if (game.mode === "tutorial") {
    ui.resultTitle.textContent = win ? "Tutorial complete" : "Tutorial wrapped";
  } else {
    ui.resultTitle.textContent = win ? "Victory" : "Defeat";
  }
  ui.resultCyber.textContent = earnedCyber > 0
    ? `+${earnedCyber}¢ CYBER EARNED · BALANCE ${profile.cyber}¢`
    : `${
      game.mode === "training" || game.mode === "tutorial"
        ? (game.mode === "tutorial" ? "TUTORIAL PAYS NO CYBER" : "TRAINING PAYS NO CYBER")
        : "NO CYBER LOST"
    } · BALANCE ${profile.cyber}¢`;
  if (ui.resultExp) {
    if (game.mode === "tutorial") {
      ui.resultExp.textContent = win
        ? "Basics locked in — try Training, Conquest, or Campaign next"
        : "You can rerun Training anytime to keep practicing";
    } else if (game.mode === "survival") {
      const mileCount = rewards?.milestones?.length || 0;
      const mileBit = mileCount > 0
        ? ` · ${mileCount} MILESTONE${mileCount > 1 ? "S" : ""}`
        : "";
      if (earnedExp > 0) {
        const levelBit = levelsGained > 0
          ? ` · LEVEL UP ×${levelsGained} → LVL ${profile.level}`
          : ` · LVL ${profile.level}`;
        const pickBit = pendingCount > 0
          ? ` · ${pendingCount} PERK PICK${pendingCount > 1 ? "S" : ""} READY`
          : "";
        ui.resultExp.textContent = `+${earnedExp} EXP${levelBit}${pickBit}${mileBit}`;
      } else {
        ui.resultExp.textContent = (
          `LVL ${profile.level} · ${profile.exp} / ${profile.expToNext} EXP${mileBit}`
        );
      }
    } else if (game.mode !== "conquest" && game.mode !== "campaign") {
      ui.resultExp.textContent = "TRAINING / SPAR GRANTS NO CONQUEST EXP";
    } else if (earnedExp > 0) {
      const levelBit = levelsGained > 0
        ? ` · LEVEL UP ×${levelsGained} → LVL ${profile.level}`
        : ` · LVL ${profile.level}`;
      const pickBit = pendingCount > 0
        ? ` · ${pendingCount} PERK PICK${pendingCount > 1 ? "S" : ""} READY`
        : "";
      ui.resultExp.textContent = `+${earnedExp} EXP${levelBit}${pickBit}`;
    } else if (win) {
      ui.resultExp.textContent = `LVL ${profile.level} · ${profile.exp} / ${profile.expToNext} EXP`;
    } else {
      ui.resultExp.textContent = "NO EXP LOST ON DEFEAT";
    }
  }
  if (ui.resultRanking) {
    if (game.mode === "survival") {
      const kills = rewards?.kills || game.survival?.kills || 0;
      const secs = Math.floor(rewards?.time || game.survival?.elapsed || 0);
      const best = rewards?.best ? " · NEW BEST" : "";
      const bestLine = profile.survival
        ? ` · Best ${Math.floor(profile.survival.bestTime || 0)}s / ${profile.survival.bestWaves || 0} waves`
        : "";
      const mileTotal = profile.survival?.milestones?.length || 0;
      const mileLine = mileTotal > 0
        ? ` · ${mileTotal} milestone${mileTotal === 1 ? "" : "s"}`
        : "";
      ui.resultRanking.textContent = (
        `${kills} kills · ${secs}s held${best}${bestLine}${mileLine} · Ranking unchanged (${rankingNow})`
      );
    } else if (game.mode === "campaign") {
      const cleared = rewards?.stageCleared
        ? ` · Stage cleared`
        : "";
      ui.resultRanking.textContent = `Campaign — Ranking unchanged (now ${rankingNow})${cleared}`;
    } else if (game.mode === "tutorial") {
      ui.resultRanking.textContent = "TUTORIAL — RANKING UNCHANGED";
    } else if (game.mode !== "conquest") {
      ui.resultRanking.textContent = "TRAINING / SPAR — RANKING UNCHANGED";
    } else if (rankingDelta > 0) {
      ui.resultRanking.textContent = `Ranking +${rankingDelta} (now ${rankingNow})`;
    } else if (rankingDelta < 0) {
      ui.resultRanking.textContent = `Ranking −${-rankingDelta} (now ${rankingNow})`;
    } else {
      ui.resultRanking.textContent = `Ranking unchanged (now ${rankingNow})`;
    }
  }
  const player = game.fighters[0];
  const buddy = game.fighters.find((fighter) => fighter.buddy);
  const lines = [];
  if (game.mode === "tutorial") {
    lines.push(win
      ? "Tutorial complete. You can kit up and jump into Training or Conquest."
      : "Tutorial wrapped. Rematch becomes normal Training — try again anytime.");
    lines.push("Basics: A/D move · W jump · click fire · C dodge. Shift jets when you need height.");
  } else if (game.mode === "training") {
    const data = profile.weapons[player.weapon];
    if (isLearningLocked(profile)) {
      lines.push("SPAR — learning was locked. Nothing I know changed this match.");
      if (buddy?.dead) lines.push("You got the better of me that round.");
      else if (win) lines.push("You held your own — good spar.");
      else lines.push("I edged that fight, but it was practice pressure only.");
      lines.push(`I dealt ${Math.round(buddy?.totalDamage || 0)} damage. Ask me questions anytime; coaching goals still save, but this spar did not advance practice evidence.`);
    } else {
      lines.push("Only judged predictions and attempted counters changed what I know.");
      lines.push(readiness(data));
      lines.push(...topReadinessDetails(data));
      if (practiceLines.length) lines.push(`Coaching progress: ${practiceLines.join(" · ")}`);
      if (learningChanged.includes("precisionAim")) {
        lines.push("My long-range aim settled a little.");
      }
    }
  } else if (game.mode === "survival") {
    const waves = rewards?.waves || game.survival?.wave || 0;
    const kills = rewards?.kills || game.survival?.kills || 0;
    if (buddy?.dead) lines.push("I went down in the swarm. Cover me next time and I'll last longer.");
    else lines.push("I stayed up with you until the end. That horde got thick.");
    lines.push(`We cleared ${kills} bots across ${waves} wave${waves === 1 ? "" : "s"}.`);
    lines.push(`I contributed ${Math.round(buddy?.totalDamage || 0)} damage before the line broke.`);
    const unlocked = rewards?.milestones || [];
    if (unlocked.length) {
      const names = unlocked.map((m) => m.label).join(", ");
      const bonus = (rewards.milestoneCyber || 0) + (rewards.milestoneExp || 0) > 0
        ? ` (+${rewards.milestoneCyber || 0}¢ / +${rewards.milestoneExp || 0} EXP)`
        : "";
      lines.push(`New milestones: ${names}${bonus}.`);
    }
  } else {
    if (buddy?.dead) lines.push("I got isolated and went down. That was my fault.");
    else if ((buddy?.fuel || 0) < .15) lines.push("I spent too much jetpack fuel chasing. I'll budget it better.");
    else lines.push("I stayed available for your engagements. My positioning can still improve.");
    lines.push(`I contributed ${Math.round(buddy?.totalDamage || 0)} damage and followed ${game.pings.length ? "your ping" : "our shared vision"}.`);
    lines.push(win ? "We handled that together." : "I own my part of the loss. Let's adjust and try again.");
  }
  const voiced = personalizeResultLines(profile, lines);
  ui.feedback.innerHTML = voiced.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const thoughts = game.thoughts.length
    ? game.thoughts.slice(-3)
    : [`${formatTime(game.elapsed)} — Held position: no safe target was visible`];
  ui.thoughts.innerHTML = thoughts.map((thought) => `<li>${escapeHtml(thought)}</li>`).join("");
  coachingWeapon = player.weapon;
  const training = game.mode === "training";
  const tutorialMode = game.mode === "tutorial";
  ui.coachingPanel.classList.toggle("read-only", !training);
  ui.coachingForm.classList.toggle("hidden", tutorialMode);
  ui.coachingQuickReplies.classList.toggle("hidden", tutorialMode);
  if (ui.coachingTitle) {
    ui.coachingTitle.textContent = tutorialMode
      ? "Tutorial notes"
      : training
        ? (isLearningLocked(profile) ? "Post-spar coaching" : "Post-match coaching")
        : "Post-match Q&A";
  }
  if (ui.coachingInput) {
    ui.coachingInput.placeholder = training
      ? (isLearningLocked(profile)
        ? "Ask about the game or set a practice goal for later…"
        : "Ask about the game or tell me what to practice…")
      : "Ask about controls, learning, vision, shop, jetpack…";
  }
  renderCoachingMessages(profile, training
    ? undefined
    : FAQ_TOPIC_CHIPS.slice(0, 3));
  requestAnimationFrame(() => ui.coachingInput.focus());
}

export function showPause(paused) {
  ui.pause.classList.toggle("hidden", !paused);
}

export function showMenu(fromResults = false, profile = null) {
  if (fromResults) ui.results.classList.add("hidden");
  ui.pause.classList.add("hidden");
  ui.hud.classList.add("hidden");
  ui.conquestSelect?.classList.add("hidden");
  ui.campaignSelect?.classList.add("hidden");
  ui.menu.classList.remove("hidden");
  showSettings(false);
  if (profile) renderPerkModal(profile);
}

export function refreshSettings(profile) {
  ensureSettingsProfile(profile);
  const style = profile.settings.visual.modularMorphStyle;
  for (const input of ui.modularMorphStyleInputs) {
    input.checked = input.value === style;
  }
  const debrisStyle = profile.settings.visual.debrisDespawnStyle;
  for (const input of ui.debrisDespawnStyleInputs) {
    input.checked = input.value === debrisStyle;
  }
  const rate = normalizeReconquerRate(profile.settings.visual.reconquerRate);
  if (ui.reconquerRateInput) {
    ui.reconquerRateInput.value = String(rate);
    ui.reconquerRateInput.disabled = debrisStyle !== "reconquer";
  }
  if (ui.reconquerRateValue) {
    ui.reconquerRateValue.textContent = `${rate.toFixed(1)}×`;
  }
  ui.reconquerRateControl?.classList.toggle("is-disabled", debrisStyle !== "reconquer");

  const armorStyle = profile.settings.visual.armorDespawnStyle;
  for (const input of ui.armorDespawnStyleInputs) {
    input.checked = input.value === armorStyle;
  }
  const armorTimer = normalizeArmorDespawnTimer(profile.settings.visual.armorDespawnTimer);
  if (ui.armorDespawnTimerInput) {
    ui.armorDespawnTimerInput.value = armorTimer.toFixed(1);
  }
  if (ui.unlockAllGearTemporaryInput) {
    ui.unlockAllGearTemporaryInput.checked = !!profile.settings.developer?.unlockAllGearTemporary;
  }
  if (ui.optimizeIllusionsInput) {
    ui.optimizeIllusionsInput.checked = normalizeOptimizeIllusions(
      profile.settings.gameplay?.optimizeIllusions
    );
  }
  if (ui.sfxEnabledInput) {
    ui.sfxEnabledInput.checked = normalizeSfxEnabled(
      profile.settings.gameplay?.sfxEnabled
    );
  }
  if (ui.useClassic100HpInput) {
    ui.useClassic100HpInput.checked = normalizeUseClassic100Hp(
      profile.settings.visual?.useClassic100Hp
    );
  }
  applySfxSettings(profile.settings);
}

export function showSettings(open) {
  ui.settingsModal?.classList.toggle("hidden", !open);
}

function statMarkup(loadout, powerInfo = null) {
  const stats = effectiveStats(loadout);
  const shield = shieldStats(loadout.shield);
  const perk = getPerk(loadout.perk);
  const power = powerInfo
    ? formatPower(powerInfo.power ?? powerInfo)
    : null;
  return `
    ${power ? `<span class="power-stat" title="Danger estimate — not HP"><b>${power.value}</b> POWER<small>${escapeHtml(power.label)}</small></span>` : ""}
    <span><b>${stats.hp}</b> HP</span>
    <span><b>${stats.speed}</b> SPEED</span>
    <span><b>${stats.fuel}s</b> FUEL</span>
    <span><b>${stats.dps}</b> DPS</span>
    ${shield.durability > 0 ? `<span><b>${shield.durability}</b> SHIELD</span>` : ""}
    ${(() => {
      const body = GEAR_BY_ID[loadout.body];
      const shell = GEAR_BY_ID[loadout.shield];
      const armorHp = Math.max(
        body?.retractableArmor?.hp || 0,
        shell?.retractableArmor?.hp || 0
      );
      return armorHp > 0
        ? `<span><b>${armorHp}</b> ARMOR (F)</span>`
        : "";
    })()}
    ${perk ? `<span><b>PERK</b> ${escapeHtml(perk.name)}</span>` : ""}`;
}

function slotsMarkup(profile, owner) {
  const equipment = profile.equipment;
  const loadout = equipment[owner];
  const locked = owner === "buddy" && equipment.buddyMode === "choice";
  return SLOT_ORDER.map((slot) => {
    const options = ownedForSlot(profile, slot);
    const hint = slot === "secondaryWeapon"
      ? `<div class="slot-hint">1 / 2 or scroll to swap in a match</div>`
      : slot === "extensionSecondary"
        ? `<div class="slot-hint">Bound to 3 in a match · does not replace 1/2</div>`
        : "";
    const slotClass = slot === "secondaryWeapon"
      ? " gear-slot-secondary"
      : slot === "extensionSecondary"
        ? " gear-slot-extension"
        : "";
    return `
      <div class="gear-slot${slotClass}">
        <div class="slot-label-wrap">
          <div class="slot-label">${escapeHtml(SLOT_LABELS[slot])}</div>
          ${hint}
        </div>
        <div class="scroll-row-shell">
          <button type="button" class="scroll-arrow prev" data-scroll-dir="-1" aria-label="Previous ${escapeHtml(SLOT_LABELS[slot])} options">‹</button>
          <div class="gear-options hidden-scroll-row" tabindex="0" aria-label="${escapeHtml(SLOT_LABELS[slot])} options">
          ${options.map((gear) => `
            <button type="button" class="gear-card ${loadout[slot] === gear.id ? "selected" : ""}"
              data-owner="${owner}" data-slot="${slot}" data-gear="${gear.id}"
              ${locked ? "disabled" : ""}>
              <strong>${escapeHtml(gear.name)}</strong>
              <small>${escapeHtml(gear.tradeoff)}</small>
            </button>`).join("")}
          </div>
          <button type="button" class="scroll-arrow next" data-scroll-dir="1" aria-label="Next ${escapeHtml(SLOT_LABELS[slot])} options">›</button>
        </div>
      </div>`;
  }).join("");
}

function perkSlotMarkup(profile, owner) {
  ensureProgressionProfile(profile, profile);
  const equipped = profile.equipment[owner].perk;
  const locked = owner === "buddy" && profile.buddyPerkAutonomy === "choice";
  const unlocked = profile.unlockedPerks
    .map((id) => getPerk(id))
    .filter(Boolean);
  if (!unlocked.length) {
    return `
      <div class="gear-slot">
        <div class="slot-label">Perk</div>
        <div class="perk-empty">No perks unlocked yet — win Conquest to earn milestone picks.</div>
      </div>`;
  }
  return `
    <div class="gear-slot">
      <div class="slot-label">Perk</div>
      <div class="perk-options">
        <button type="button" class="perk-card ${!equipped ? "selected" : ""}"
          data-owner="${owner}" data-perk="none" ${locked ? "disabled" : ""}>
          <strong>None</strong>
          <small>No perk equipped</small>
        </button>
        ${unlocked.map((entry) => `
          <button type="button" class="perk-card ${equipped === entry.id ? "selected" : ""}"
            data-owner="${owner}" data-perk="${entry.id}" ${locked ? "disabled" : ""}>
            <strong>${escapeHtml(entry.name)}</strong>
            <small>${escapeHtml(entry.tradeoff)}</small>
          </button>`).join("")}
      </div>
    </div>`;
}

export function renderPerkModal(profile) {
  if (!ui.perkModal || !ui.perkChoices) return;
  ensureProgressionProfile(profile, profile);
  const pick = profile.pendingPerkPicks[0];
  if (!pick) {
    ui.perkModal.classList.add("hidden");
    return;
  }
  if (ui.perkModalTitle) {
    ui.perkModalTitle.textContent = `Level ${profile.level} — choose a perk`;
  }
  ui.perkChoices.innerHTML = pick.choices.map((id) => {
    const entry = getPerk(id);
    if (!entry) return "";
    const lines = perkTradeoffLines(id);
    return `
      <button type="button" class="perk-choice" data-pick-id="${escapeHtml(pick.id)}" data-unlock-perk="${id}">
        <strong>${escapeHtml(entry.name)}</strong>
        <p>${escapeHtml(entry.tradeoff)}</p>
        <div class="modifier-list">${lines.map((line) => `
          <span class="${line.good ? "stat-up" : "stat-down"}">${escapeHtml(line.text)}</span>
        `).join("")}</div>
      </button>`;
  }).join("");
  const menuVisible = ui.menu && !ui.menu.classList.contains("hidden");
  ui.perkModal.classList.toggle("hidden", !menuVisible);
}

export function renderEquipment(profile) {
  const equipment = profile.equipment;
  ensureProgressionProfile(profile, profile);
  const powers = estimateProfilePowers(profile);
  ui.playerSlots.innerHTML = slotsMarkup(profile, "player");
  ui.buddySlots.innerHTML = slotsMarkup(profile, "buddy");
  if (ui.playerPerkSlot) ui.playerPerkSlot.innerHTML = perkSlotMarkup(profile, "player");
  if (ui.buddyPerkSlot) ui.buddyPerkSlot.innerHTML = perkSlotMarkup(profile, "buddy");
  refreshBayScrollRows();
  ui.playerStats.innerHTML = statMarkup(equipment.player, powers.playerDetail);
  ui.buddyStats.innerHTML = statMarkup(equipment.buddy, powers.buddyDetail);
  for (const button of ui.buddyMode.querySelectorAll("[data-mode]")) {
    const active = button.dataset.mode === equipment.buddyMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", String(active));
  }
  ui.autonomyHint.textContent = equipment.buddyMode === "choice"
    ? "Locked: your buddy equips itself from owned gear."
    : equipment.buddyMode === "suggested"
      ? "Review, accept, reject, or edit the recommendation."
      : "You control every buddy slot.";
  if (ui.buddyPerkMode) {
    for (const button of ui.buddyPerkMode.querySelectorAll("[data-perk-mode]")) {
      const active = button.dataset.perkMode === profile.buddyPerkAutonomy;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    }
  }
  if (ui.perkAutonomyHint) {
    ui.perkAutonomyHint.textContent = profile.buddyPerkAutonomy === "choice"
      ? "Locked: buddy auto-equips one unlocked perk."
      : profile.buddyPerkAutonomy === "suggested"
        ? "Review the perk recommendation from unlocked picks."
        : "You pick the buddy perk from unlocked list.";
  }
  const suggestion = equipment.suggestion;
  ui.suggestionPanel.classList.toggle(
    "hidden", equipment.buddyMode === "user" || !suggestion
  );
  if (suggestion) {
    const names = SLOT_ORDER.map((slot) => GEAR_BY_ID[suggestion.loadout[slot]]?.name).join(" · ");
    ui.suggestionPanel.innerHTML = `
      <div><strong>${equipment.buddyMode === "choice" ? "Buddy selected" : "Buddy suggestion"}</strong>
      <p>${escapeHtml(suggestion.reason)}</p><small>${escapeHtml(names)}</small></div>
      ${equipment.buddyMode === "suggested" ? `
        <div class="suggestion-actions">
          <button type="button" data-suggestion="accept" class="primary">Accept</button>
          <button type="button" data-suggestion="reject">Reject</button>
        </div>` : ""}`;
  }
  const perkSuggestion = profile.perkSuggestion;
  if (ui.perkSuggestionPanel) {
    ui.perkSuggestionPanel.classList.toggle(
      "hidden",
      profile.buddyPerkAutonomy === "user" || !perkSuggestion
    );
    if (perkSuggestion) {
      const perk = getPerk(perkSuggestion.perkId);
      ui.perkSuggestionPanel.innerHTML = `
        <div><strong>${profile.buddyPerkAutonomy === "choice" ? "Buddy perk selected" : "Buddy perk suggestion"}</strong>
        <p>${escapeHtml(perkSuggestion.reason)}</p>
        <small>${escapeHtml(perk?.name || "None")}${perk ? ` — ${escapeHtml(perk.tradeoff)}` : ""}</small></div>
        ${profile.buddyPerkAutonomy === "suggested" ? `
          <div class="suggestion-actions">
            <button type="button" data-perk-suggestion="accept" class="primary">Accept</button>
            <button type="button" data-perk-suggestion="reject">Reject</button>
          </div>` : ""}`;
    }
  }
}

function modifierMarkup(gear) {
  if (gear.retractableArmor?.hp) {
    return [
      `<span class="stat-up">+${gear.retractableArmor.hp} armor HP (F)</span>`,
      "<span class=\"stat-down\">~10% slower while deployed</span>",
      "<span>Separate pool · no mid-match recharge</span>"
    ].join("");
  }
  const nanoCostLine = gear.nanotech && gear.nanobotCost
    ? `<span class="stat-up">${gear.nanobotCost} nanobot pool</span>`
    : "";
  const nanoFormLine = gear.nanotech && gear.nanobotFormCost
    ? `<span class="stat-up">${gear.nanobotFormCost} bots form/absorb</span>`
    : "";
  const nanoShotLine = gear.nanotech && gear.nanobotShotCost
    ? `<span class="stat-up">${gear.nanobotShotCost} bots/shot from reserve</span>`
    : "";
  if (gear.slot === "weapon" || gear.slot === "secondaryWeapon") {
    if (gear.id === "mechanical-modularity") {
      return [
        "<span>Morph weapon (E)</span>",
        "<span>Sword ≈ Arc Saber</span>",
        "<span class=\"stat-down\">Rifle ~92% Pulse</span>",
        "<span class=\"stat-down\">Plate &lt; Light Buckler</span>"
      ].join("");
    }
    if (gear.id === ADAPTIVE_NANOTECH_ID) {
      return [
        "<span>Morph body (R) · E forms/absorbs</span>",
        "<span class=\"stat-up\">195 nanobot pool</span>",
        "<span>Sword ≈ Arc Saber</span>",
        "<span>Rifle ≈ Pulse Rifle</span>",
        "<span>Sniper ≈ Classic Sniper</span>"
      ].join("");
    }
    if (gear.id === "no-secondary") {
      return "<span>Empty secondary slot · primary only</span>";
    }
    if (gear.materialConsumer) {
      const stats = weaponStats(gear);
      return [
        nanoCostLine,
        "<span>Secondary tool-sword · 1/2 or scroll</span>",
        `<span>${stats.baseDamage} slash · hold RMB debris beam</span>`,
        "<span class=\"stat-up\">Vacuums debris → free bots</span>",
        "<span class=\"stat-up\">Hold V · excess → ejection tank</span>",
        "<span class=\"stat-up\">Tank shoots first · then remembered scraps</span>",
        "<span class=\"stat-up\">Tap B · reform at cursor from tip</span>",
        "<span class=\"stat-down\">Chucked scrap blocks that source</span>"
      ].filter(Boolean).join("");
    }
    if (gear.reconjurerBuilder) {
      return [
        "<span>Extension · T cycle · 3 place</span>",
        "<span class=\"stat-up\">Left preview · see the breakable look</span>",
        "<span class=\"stat-up\">Near debris · free rebuild +2 scraps</span>",
        "<span class=\"stat-up\">Near cover · metal casing · metal boxes · wood casing</span>",
        "<span class=\"stat-up\">Casing absorbs hits before the core</span>",
        "<span class=\"stat-up\">No target · conjure selected type</span>",
        "<span>Metal box · select · 10s user CD</span>",
        "<span class=\"stat-down\">Does not replace 1/2 secondary</span>"
      ].join("");
    }
    if (gear.lightCondensation) {
      return [
        "<span>Extension · press 3</span>",
        "<span class=\"stat-up\">Tiny neon glare square</span>",
        "<span class=\"stat-up\">Reveals allies · 40× size</span>",
        "<span class=\"stat-up\">Blocks sight · 20× size box</span>",
        "<span>Break the square to end both · 10s CD</span>",
        "<span class=\"stat-down\">Does not replace 1/2 secondary</span>"
      ].join("");
    }
    if (gear.trapper) {
      return [
        "<span>Extension · T cycle · 3 plant</span>",
        "<span class=\"stat-up\">Bear · 25 dmg + 5s no mobility</span>",
        "<span class=\"stat-up\">Fake plat · looks almost real, 10 dmg fall</span>",
        "<span class=\"stat-up\">Spring · launches away from you</span>",
        "<span class=\"stat-up\">Signal wire · snare + team reveal</span>",
        "<span class=\"stat-up\">Land mine · splash under red barrel</span>",
        "<span class=\"stat-up\">Bear / fake / mine pop illusions (stay armed)</span>",
        "<span class=\"stat-up\">Spring · 3 uses · decoys flung for free</span>",
        "<span>Signal ignores illusions</span>",
        "<span>Short arm time before triggers</span>",
        "<span class=\"stat-down\">Owner immune · max 3 active</span>"
      ].join("");
    }
    if (gear.combatClone) {
      return [
        "<span>Extension · press 3 to spawn</span>",
        "<span class=\"stat-up\">Real twin · looks like an illusion fighter</span>",
        "<span class=\"stat-up\">25% of your max HP · real damage</span>",
        "<span>Max 2 alive · 30s cooldown</span>",
        "<span>Ally outline only · dies with you</span>",
        "<span class=\"stat-down\">Under Illusionist on price</span>"
      ].join("");
    }
    if (gear.illusionist) {
      return [
        "<span>Premium Extension · T cycle · 3 plant</span>",
        "<span class=\"stat-up\">Fighter decoy · kit + fake HP bar</span>",
        "<span class=\"stat-up\">Gaslight hits · ≥40 phantom HP</span>",
        "<span class=\"stat-up\">Truth sight · outline fakes · ghost rounds · real HP</span>",
        "<span>Shots 'vanish' on decoy · keep going invisible</span>",
        "<span class=\"stat-up\">PROP · Y cycles look · metal crate bait</span>",
        "<span>Platform · visual only, no cues to others</span>",
        "<span class=\"stat-down\">No real damage · most expensive</span>"
      ].join("");
    }
    if (gear.id === "no-extension") {
      return "<span>Empty extension slot · key 3 idle</span>";
    }
    if (gear.spellbook) {
      return [
        "<span>Primary · cast with fire · E cycles</span>",
        "<span class=\"stat-up\">Mana pool · regens over time</span>",
        "<span class=\"stat-up\">Ice spike · unblockable pin 2s → slow 5s</span>",
        "<span class=\"stat-up\">Fire burst · ignites + spreads on cover</span>",
        "<span class=\"stat-up\">Lightning · chains crates/pipes/barrels</span>",
        "<span class=\"stat-up\">Metal nodes take heavier lightning</span>",
        "<span class=\"stat-down\">No bullets · casts gated by mana</span>"
      ].join("");
    }
    if (gear.throwBreakable) {
      const stats = weaponStats(gear);
      return [
        "<span>Secondary · click grab / click throw</span>",
        `<span>${stats.baseDamage} throw damage</span>`,
        "<span class=\"stat-up\">Grab any breakable cover</span>",
        "<span class=\"stat-up\">Grab ground tools only · throw to fire</span>",
        "<span>Walk-over will not pick tools up</span>",
        "<span class=\"stat-up\">Power crates grabbable at ≤50% HP</span>",
        "<span>Held props stay damageable</span>",
        "<span class=\"stat-down\">Shatters at impact · reconquer there</span>"
      ].join("");
    }
    if (gear.shieldSteal) {
      return [
        "<span>Secondary · hold fire siphon beam</span>",
        "<span class=\"stat-up\">Drains shield HP into yours</span>",
        "<span class=\"stat-up\">75% transfer while their shield is up</span>",
        "<span class=\"stat-up\">100% transfer while lowered</span>",
        "<span>Raised plates must face you</span>",
        "<span>Drop your Q to fire</span>",
        "<span class=\"stat-down\">No effect on broken shields</span>"
      ].join("");
    }
    if (gear.toolSecondary && TOOL_DEFS[gear.toolSecondary]) {
      const def = TOOL_DEFS[gear.toolSecondary];
      return [
        `<span>Secondary · ${def.label} tool</span>`,
        `<span class="stat-up">Infinite uses · ${def.cd}s cooldown</span>`,
        "<span class=\"stat-up\">Drops from crates / breakables / maps</span>",
        "<span>Packs with 1 / 3 / 5 / 10 uses · grab with Throw Breakable</span>",
        `<span>${def.damage} hit / blast power</span>`
      ].join("");
    }
    const stats = weaponStats(gear);
    const changes = [
      `<span>${stats.kind === "gun" ? "Ranged" : "Melee"} mechanics</span>`,
      `<span>${stats.baseDamage} damage</span>`,
      `<span>${stats.rpm} RPM</span>`,
      `<span>${Math.round(theoreticalDps(gear) * 10) / 10} DPS</span>`,
      `<span>${Math.round(stats.range)} reach</span>`
    ];
    if (nanoCostLine) changes.unshift(nanoCostLine);
    if (nanoFormLine) changes.unshift(nanoFormLine);
    if (nanoShotLine) changes.unshift(nanoShotLine);
    if ((stats.movementMultiplier || 1) > 1) {
      changes.push(`<span class="stat-up">Base speed +${Math.round((stats.movementMultiplier - 1) * 100)}%</span>`);
    }
    if ((stats.iframeMultiplier || 1) > 1) {
      changes.push(`<span class="stat-up">Dodge i-frames +${Math.round((stats.iframeMultiplier - 1) * 100)}%</span>`);
    }
    if (stats.aimSettle) changes.push(`<span class="stat-down">Settle ${stats.aimSettle}s</span>`);
    if (stats.hitscan) changes.push("<span>Hitscan beam</span>");
    if (!stats.dropoff && stats.kind === "gun") changes.push("<span>No damage dropoff</span>");
    if ((stats.shieldDamageMult || 1) > 1) {
      changes.push(`<span class="stat-up">Shield shred ×${stats.shieldDamageMult}</span>`);
    }
    if (stats.beamRevealRadius) changes.push("<span>Beam sight reveal</span>");
    return changes.join("");
  }
  if (gear.slot === "shield") {
    const stats = shieldStats(gear);
    if (stats.durability <= 0) return "<span>No blocking · no weight</span>";
    const cone = Math.round(stats.blockHalfAngle * 180 / Math.PI);
    return [
      `<span>${stats.durability} block HP / match</span>`,
      `<span>±${cone}° front cone</span>`,
      `<span class="stat-down">Raised speed ${Math.round(stats.raisedSpeed * 100)}%</span>`,
      `<span class="stat-down">Broken speed ${Math.round(stats.brokenSpeed * 100)}%</span>`
    ].join("");
  }
  const names = {
    hp: "HP", speed: "Speed", damageTaken: "Damage taken", sight: "Sight",
    damage: "Damage", fireRate: "Rate", range: "Range", projectileSpeed: "Shot speed",
    fuel: "Fuel", thrust: "Thrust", recharge: "Recharge"
  };
  const changes = Object.entries(gear.modifiers).map(([key, value]) => {
    const beneficialDown = key === "damageTaken";
    const percent = Math.round((value - 1) * 100);
    const sign = percent > 0 ? "+" : "";
    const good = beneficialDown ? percent < 0 : percent > 0;
    return `<span class="${good ? "stat-up" : percent ? "stat-down" : ""}">${escapeHtml(names[key] || key)} ${sign}${percent}%</span>`;
  });
  if (nanoCostLine) changes.unshift(nanoCostLine);
  if (gear.id === "nanotech-chestplate") {
    changes.push("<span>Tap F: +100 armor bots · hold F: return 50/s</span>");
  }
  return changes.length ? changes.join("") : "<span>Baseline stats</span>";
}

export function renderShop(profile) {
  ui.shopCategories.innerHTML = SLOT_ORDER.map((slot) => {
    const slotHint = slot === "secondaryWeapon"
      ? `<p class="shop-slot-hint">Buy here, then Equip — swap with 1/2 or scroll in a match.</p>`
      : slot === "extensionSecondary"
        ? `<p class="shop-slot-hint">Buy here, then Equip — press 3 in a match (keeps your 1/2 secondary).</p>`
        : "";
    const shopClass = slot === "secondaryWeapon"
      ? " shop-category-secondary"
      : slot === "extensionSecondary"
        ? " shop-category-extension"
        : "";
    return `
    <section class="shop-category${shopClass}">
      <div class="slot-label-wrap">
        <div class="slot-label">${escapeHtml(SLOT_LABELS[slot])}</div>
        ${slotHint}
      </div>
      <div class="scroll-row-shell shop-row-shell">
        <button type="button" class="scroll-arrow prev" data-scroll-dir="-1" aria-label="Previous shop items">‹</button>
        <div class="shop-row hidden-scroll-row" tabindex="0" aria-label="${escapeHtml(SLOT_LABELS[slot])} shop items">
          ${GEAR.filter((gear) => gear.slot === slot).map((gear) => {
            const owned = effectiveOwned(profile).includes(gear.id);
            const permanentlyOwned = profile.equipment.owned.includes(gear.id);
            const playerEquipped = profile.equipment.player[slot] === gear.id;
            const buddyEquipped = profile.equipment.buddy[slot] === gear.id;
            const equipped = playerEquipped || buddyEquipped;
            const unlockLabel = owned && !permanentlyOwned
              ? "TEMP"
              : playerEquipped
                ? "EQUIPPED"
                : owned
                  ? "OWNED"
                  : `${gear.price}¢`;
            let actionBtn;
            if (!owned && gear.price) {
              actionBtn = `<button type="button" data-buy="${gear.id}">Buy · ${gear.price}¢</button>`;
            } else if (!owned) {
              actionBtn = `<button type="button" disabled>Unlocked</button>`;
            } else if (playerEquipped) {
              actionBtn = `<button type="button" disabled>Equipped</button>`;
            } else {
              actionBtn = `<button type="button" data-shop-equip="${gear.id}">Equip</button>`;
            }
            return `<article class="shop-card ${owned ? "owned" : ""} ${playerEquipped ? "equipped" : ""}" data-shop-id="${gear.id}">
              <div class="shop-card-top"><strong>${escapeHtml(gear.name)}</strong>
                <span>${unlockLabel}</span></div>
              <p>${escapeHtml(gear.tradeoff)}</p>
              <div class="modifier-list">${modifierMarkup(gear)}</div>
              ${actionBtn}
            </article>`;
          }).join("")}
        </div>
        <button type="button" class="scroll-arrow next" data-scroll-dir="1" aria-label="Next shop items">›</button>
      </div>
    </section>`;
  }).join("");
  requestAnimationFrame(() => refreshBayScrollRows());
}

function syncScrollArrows(row) {
  const shell = row.closest(".scroll-row-shell");
  if (!shell) return;
  const prev = shell.querySelector(".scroll-arrow.prev");
  const next = shell.querySelector(".scroll-arrow.next");
  const max = Math.max(0, row.scrollWidth - row.clientWidth);
  const overflow = max > 2;
  const atStart = row.scrollLeft <= 2;
  const atEnd = row.scrollLeft >= max - 2;
  if (prev) {
    prev.disabled = !overflow || atStart;
    prev.classList.toggle("is-dim", prev.disabled);
  }
  if (next) {
    next.disabled = !overflow || atEnd;
    next.classList.toggle("is-dim", next.disabled);
    next.classList.toggle("has-more", overflow && !atEnd);
  }
}

let scrollResizeObserver;

function ensureScrollResizeObserver() {
  if (scrollResizeObserver) return;
  scrollResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.classList.contains("hidden-scroll-row")) {
        syncScrollArrows(entry.target);
      }
    }
  });
}

function syncScrollRows(root = document) {
  ensureScrollResizeObserver();
  for (const row of root.querySelectorAll(".hidden-scroll-row")) {
    if (!row.dataset.scrollSynced) {
      row.dataset.scrollSynced = "1";
      row.addEventListener("scroll", () => syncScrollArrows(row), { passive: true });
      scrollResizeObserver.observe(row);
    }
    syncScrollArrows(row);
  }
}

function refreshBayScrollRows() {
  requestAnimationFrame(() => {
    syncScrollRows(ui.playerSlots);
    syncScrollRows(ui.buddySlots);
    syncScrollRows(ui.shopCategories);
  });
}

function scrollRow(row, direction) {
  row.scrollBy({ left: direction * row.clientWidth * .75, behavior: "smooth" });
  const sync = () => syncScrollArrows(row);
  requestAnimationFrame(sync);
  row.addEventListener("scrollend", sync, { once: true });
  window.setTimeout(sync, 350);
}

function fighterCardMarkup(fighter, fighterPower = null) {
  const slots = loadoutSummary(fighter.loadout);
  const power = fighterPower != null ? formatPower(fighterPower) : null;
  const swatch = fighter.color
    ? `<span class="conquest-color-swatch" style="background:${escapeHtml(fighter.color)}" title="Body color" aria-hidden="true"></span>`
    : "";
  return `
    <article class="conquest-fighter-card">
      <div class="role">${swatch}${escapeHtml(fighter.label || fighter.role)}</div>
      <h2>${escapeHtml(fighter.name)}</h2>
      <p class="training-line">Training: ${escapeHtml(fighter.training)} · AI ${escapeHtml(fighter.ai)}</p>
      ${power ? `<p class="fighter-power" title="Danger estimate — not HP">Power <strong>${power.value}</strong> <span>${escapeHtml(power.label)}</span></p>` : ""}
      <ul class="conquest-loadout-list">
        ${slots.map((slot) => `
          <li><span>${escapeHtml(SLOT_LABELS[slot.slot] || slot.slot)}</span>
            ${escapeHtml(slot.name)}</li>`).join("")}
      </ul>
    </article>`;
}

/** Render the pending encounter onto the Conquest select panel. */
export function refreshConquestSelect(profile, encounter = getPendingEncounter(), feedback = "") {
  if (!ui.conquestSelect) return;
  const ranking = Number.isInteger(profile?.ranking) ? profile.ranking : 100;
  const cyber = Number.isInteger(profile?.cyber) ? profile.cyber : 0;
  if (ui.conquestRanking) ui.conquestRanking.textContent = String(ranking);
  if (ui.conquestLeague) {
    ui.conquestLeague.textContent = encounter?.leagueName || "—";
  }
  if (ui.conquestCyber) ui.conquestCyber.textContent = `${cyber}¢`;
  if (ui.conquestSelectFeedback) ui.conquestSelectFeedback.textContent = feedback || "";

  const free = hasFreeReroll();
  if (ui.conquestRerollBtn) {
    ui.conquestRerollBtn.textContent = free
      ? "Reroll opponent · Free"
      : `Reroll opponent · ${REROLL_CYBER_COST}¢`;
    ui.conquestRerollBtn.disabled = !free && cyber < REROLL_CYBER_COST;
  }

  if (!ui.conquestOpponentPanel || !encounter) {
    if (ui.conquestOpponentPanel) {
      ui.conquestOpponentPanel.innerHTML = "<p class=\"lede\">No opponent ready.</p>";
    }
    return;
  }

  const power = encounter.power || 0;
  const powerPct = powerBarPercent(power);
  const duoFmt = formatPower(power);
  ui.conquestOpponentPanel.innerHTML = `
    <div class="conquest-duo-meta">
      <span>Map <strong>${escapeHtml(encounter.mapName || "Battlefield")}</strong></span>
      <span>Est. training <strong>${escapeHtml(encounter.training)}</strong></span>
      <span>Duo power <strong>${duoFmt.value}</strong> <em>${escapeHtml(duoFmt.label)}</em></span>
      <span class="conquest-power-split">Trainer <strong>${encounter.trainerPower ?? "—"}</strong>
        · Follower <strong>${encounter.followerPower ?? "—"}</strong></span>
      <div class="conquest-power-bar" title="Duo power ${power} (danger estimate, not HP)" aria-hidden="true">
        <i style="width:${powerPct}%"></i>
      </div>
      ${encounter.mapBlurb ? `<p class="conquest-map-blurb">${escapeHtml(encounter.mapBlurb)}</p>` : ""}
    </div>
    ${fighterCardMarkup(encounter.trainer, encounter.trainerPower)}
    ${fighterCardMarkup(encounter.follower, encounter.followerPower)}
  `;
}

export function showConquestSelect(profile) {
  const ranking = Number.isInteger(profile?.ranking) ? profile.ranking : 100;
  const encounter = beginConquestSelect(ranking);
  ui.menu.classList.add("hidden");
  ui.results.classList.add("hidden");
  ui.pause.classList.add("hidden");
  ui.hud.classList.add("hidden");
  ui.perkModal?.classList.add("hidden");
  ui.campaignSelect?.classList.add("hidden");
  ui.conquestSelect?.classList.remove("hidden");
  refreshConquestSelect(profile, encounter);
}

/** @type {"player"|"buddy"} */
let campaignKitOwner = "player";

function campaignLoadoutMarkup(profile, owner) {
  ensureCampaignProfile(profile);
  const loadout = profile.campaign[owner];
  const slots = loadoutSummary(loadout);
  return `
    <div class="campaign-equipped">
      <span class="campaign-equipped-label">${owner === "buddy" ? "Buddy kit" : "Your kit"}</span>
      ${slots.map((slot) => (
        `<span><em>${escapeHtml(SLOT_LABELS[slot.slot] || slot.slot)}</em> ${escapeHtml(slot.name)}</span>`
      )).join("")}
    </div>
  `;
}

function campaignShopMarkup(profile, stageId) {
  const rows = campaignShopCatalog(profile, stageId);
  if (!rows.length) {
    return "<p class=\"lede\">No shop offers on this stage yet.</p>";
  }
  return rows.map((row) => {
    const action = row.owned ? "Equip" : `Buy ${row.price}¢`;
    const disabled = !row.affordable && !row.owned ? " disabled" : "";
    const ownedTag = row.owned ? " · owned" : "";
    return `
      <button type="button" class="campaign-shop-item" data-campaign-buy="${escapeHtml(row.id)}"${disabled}>
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.slot)}${ownedTag}</span>
        <em>${escapeHtml(action)}</em>
      </button>
    `;
  }).join("");
}

function campaignOpponentMarkup(encounter) {
  if (!encounter) return "<p class=\"lede\">Select a stage.</p>";
  const power = encounter.power || 0;
  const powerPct = powerBarPercent(power);
  const duoFmt = formatPower(power);
  const solo = !!(encounter.solo || encounter.boss || !encounter.follower);
  const powerLabel = solo ? "Boss power" : "Duo power";
  const split = solo
    ? `<span class="conquest-power-split">Boss <strong>${encounter.trainerPower ?? "—"}</strong></span>`
    : `<span class="conquest-power-split">Trainer <strong>${encounter.trainerPower ?? "—"}</strong>
        · Follower <strong>${encounter.followerPower ?? "—"}</strong></span>`;
  return `
    <div class="conquest-duo-meta">
      <span>Map <strong>${escapeHtml(encounter.mapName || "Battlefield")}</strong></span>
      <span>Est. training <strong>${escapeHtml(encounter.training)}</strong></span>
      <span>Stage Ranking <strong>${encounter.ranking ?? "—"}</strong></span>
      <span>${powerLabel} <strong>${duoFmt.value}</strong> <em>${escapeHtml(duoFmt.label)}</em></span>
      ${split}
      <div class="conquest-power-bar" title="${powerLabel} ${power}" aria-hidden="true">
        <i style="width:${powerPct}%"></i>
      </div>
      ${encounter.blurb ? `<p class="conquest-map-blurb">${escapeHtml(encounter.blurb)}</p>` : ""}
    </div>
    ${fighterCardMarkup(encounter.trainer, encounter.trainerPower)}
    ${solo ? "" : fighterCardMarkup(encounter.follower, encounter.followerPower)}
  `;
}

/** Render Campaign stage select + shop for the selected stage. */
export function refreshCampaignSelect(profile, feedback = "") {
  if (!ui.campaignSelect) return;
  ensureCampaignProfile(profile);
  const cards = campaignStageCards(profile);
  const selected = cards.find((c) => c.selected) || cards[0];
  const encounter = getPendingCampaignEncounter()
    || (selected ? beginCampaignSelect(profile) : null);
  const cyber = Number.isInteger(profile?.cyber) ? profile.cyber : 0;
  const clearedCount = profile.campaign.cleared.length;

  if (ui.campaignStageRanking) {
    ui.campaignStageRanking.textContent = String(selected?.ranking ?? "—");
  }
  if (ui.campaignCleared) {
    ui.campaignCleared.textContent = `${clearedCount} / ${CAMPAIGN_STAGES.length}`;
  }
  if (ui.campaignCyber) ui.campaignCyber.textContent = `${cyber}¢`;
  if (ui.campaignSelectFeedback) ui.campaignSelectFeedback.textContent = feedback || "";

  if (ui.campaignStageList) {
    ui.campaignStageList.innerHTML = cards.map((card) => {
      const state = !card.unlocked
        ? "locked"
        : card.cleared ? "cleared" : "open";
      const disabled = card.unlocked ? "" : " disabled";
      const active = card.selected ? " active" : "";
      return `
        <button type="button" class="campaign-stage-card ${state}${active}"
          data-campaign-stage="${escapeHtml(card.id)}" role="listitem"${disabled}>
          <span class="campaign-stage-index">Stage ${card.index}</span>
          <strong>${escapeHtml(card.name)}</strong>
          <span>${escapeHtml(card.mapName)} · R${card.ranking}</span>
          <em>${card.unlocked ? (card.cleared ? "Cleared" : "Ready") : "Locked"}</em>
        </button>
      `;
    }).join("");
  }

  if (ui.campaignOpponentPanel) {
    ui.campaignOpponentPanel.innerHTML = campaignOpponentMarkup(encounter);
  }
  if (ui.campaignLoadoutSummary) {
    ui.campaignLoadoutSummary.innerHTML = campaignLoadoutMarkup(profile, campaignKitOwner);
  }
  if (ui.campaignShopPanel) {
    ui.campaignShopPanel.innerHTML = campaignShopMarkup(
      profile, selected?.id || profile.campaign.selectedStageId
    );
  }
  for (const btn of ui.campaignSelect.querySelectorAll("[data-campaign-owner]")) {
    const on = btn.dataset.campaignOwner === campaignKitOwner;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  }
  if (ui.campaignFightBtn) {
    ui.campaignFightBtn.disabled = !selected?.unlocked;
  }
}

export function showCampaignSelect(profile) {
  ensureCampaignProfile(profile);
  beginCampaignSelect(profile);
  ui.menu.classList.add("hidden");
  ui.results.classList.add("hidden");
  ui.pause.classList.add("hidden");
  ui.hud.classList.add("hidden");
  ui.perkModal?.classList.add("hidden");
  ui.conquestSelect?.classList.add("hidden");
  ui.campaignSelect?.classList.remove("hidden");
  refreshCampaignSelect(profile);
}

function fillMapSelect() {
  if (!ui.mapSelect) return;
  const current = ui.mapSelect.value || "random";
  ui.mapSelect.innerHTML = `<option value="random">Random</option>${
    listMaps().map((map) => (
      `<option value="${escapeHtml(map.id)}">${escapeHtml(map.name)}</option>`
    )).join("")
  }`;
  ui.mapSelect.value = [...ui.mapSelect.options].some((o) => o.value === current)
    ? current
    : "random";
}

export function bindUi(handlers) {
  fillMapSelect();
  $("#trainingBtn").addEventListener("click", () => handlers.start("training"));
  ui.tutorialBtn?.addEventListener("click", () => {
    // Dismiss the banner strip, then run the guided spar (do not opt out).
    handlers.start?.("tutorial");
  });
  ui.tutorialDismissBtn?.addEventListener("click", () => {
    handlers.dismissTutorialHint?.();
  });
  $("#conquestBtn").addEventListener("click", () => handlers.openConquest?.());
  $("#campaignBtn")?.addEventListener("click", () => handlers.openCampaign?.());
  $("#survivalBtn")?.addEventListener("click", () => handlers.start("survival"));
  ui.conquestBackBtn?.addEventListener("click", () => handlers.conquestBack?.());
  ui.conquestRerollBtn?.addEventListener("click", () => handlers.conquestReroll?.());
  ui.conquestFightBtn?.addEventListener("click", () => handlers.conquestFight?.());
  ui.campaignBackBtn?.addEventListener("click", () => handlers.campaignBack?.());
  ui.campaignFightBtn?.addEventListener("click", () => handlers.campaignFight?.());
  ui.campaignSelect?.addEventListener("click", (event) => {
    const stageBtn = event.target.closest("[data-campaign-stage]");
    if (stageBtn && !stageBtn.disabled) {
      handlers.campaignSelectStage?.(stageBtn.dataset.campaignStage);
      return;
    }
    const ownerBtn = event.target.closest("[data-campaign-owner]");
    if (ownerBtn) {
      campaignKitOwner = ownerBtn.dataset.campaignOwner === "buddy" ? "buddy" : "player";
      handlers.campaignRefresh?.();
      return;
    }
    const buyBtn = event.target.closest("[data-campaign-buy]");
    if (buyBtn && !buyBtn.disabled) {
      handlers.campaignBuy?.(buyBtn.dataset.campaignBuy, campaignKitOwner);
    }
  });
  $("#resumeBtn").addEventListener("click", handlers.resume);
  $("#quitBtn").addEventListener("click", handlers.quit);
  $("#menuBtn").addEventListener("click", handlers.menu);
  $("#againBtn").addEventListener("click", handlers.again);
  ui.name.addEventListener("input", () => {
    ui.buddyColumnName.textContent = ui.name.value.trim() || "Buddy";
  });
  ui.aiMode.addEventListener("change", () => {
    handlers.aiMode?.(ui.aiMode.value);
  });
  $("#menu").addEventListener("click", (event) => {
    const character = event.target.closest("[data-buddy-character]");
    if (character) {
      handlers.buddyCharacter?.(character.dataset.buddyCharacter);
      return;
    }
    const fightStyle = event.target.closest("[data-fight-style]");
    if (fightStyle) {
      handlers.fightStyle?.(fightStyle.dataset.fightStyle);
      return;
    }
    const mode = event.target.closest("[data-mode]");
    const perkMode = event.target.closest("[data-perk-mode]");
    const intensity = event.target.closest("[data-mimic-intensity]");
    const learningLock = event.target.closest("[data-learning-lock]");
    const gear = event.target.closest("[data-gear]");
    const perk = event.target.closest("[data-perk]");
    const suggestion = event.target.closest("[data-suggestion]");
    const perkSuggestion = event.target.closest("[data-perk-suggestion]");
    const tab = event.target.closest("[data-bay-tab]");
    const buy = event.target.closest("[data-buy]");
    const shopEquip = event.target.closest("[data-shop-equip]");
    const arrow = event.target.closest("[data-scroll-dir]");
    if (mode && !perkMode) handlers.buddyMode(mode.dataset.mode);
    if (perkMode) handlers.buddyPerkMode?.(perkMode.dataset.perkMode);
    if (intensity && !intensity.disabled) {
      handlers.mimicIntensity?.(intensity.dataset.mimicIntensity);
    }
    if (learningLock) {
      handlers.learningLock?.(learningLock.dataset.learningLock === "true");
    }
    if (gear && !gear.disabled) {
      handlers.equip(gear.dataset.owner, gear.dataset.slot, gear.dataset.gear);
    }
    if (perk && !perk.disabled) {
      handlers.equipPerk?.(perk.dataset.owner, perk.dataset.perk);
    }
    if (suggestion?.dataset.suggestion === "accept") handlers.acceptSuggestion();
    if (suggestion?.dataset.suggestion === "reject") handlers.rejectSuggestion();
    if (perkSuggestion?.dataset.perkSuggestion === "accept") {
      handlers.acceptPerkSuggestion?.();
    }
    if (perkSuggestion?.dataset.perkSuggestion === "reject") {
      handlers.rejectPerkSuggestion?.();
    }
    if (tab) {
      const shop = tab.dataset.bayTab === "shop";
      ui.equipmentPanel.classList.toggle("hidden", shop);
      ui.shopPanel.classList.toggle("hidden", !shop);
      for (const button of document.querySelectorAll("[data-bay-tab]")) {
        const active = button === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      }
      refreshBayScrollRows();
    }
    if (buy) handlers.purchase(buy.dataset.buy);
    if (shopEquip) handlers.shopEquip?.(shopEquip.dataset.shopEquip);
    if (arrow) {
      const row = arrow.parentElement.querySelector(".hidden-scroll-row");
      if (row) scrollRow(row, Number(arrow.dataset.scrollDir));
    }
  });
  ui.perkModal?.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-unlock-perk]");
    if (choice) {
      handlers.choosePerk?.(choice.dataset.pickId, choice.dataset.unlockPerk);
    }
  });
  ui.settingsBtn?.addEventListener("click", () => {
    handlers.refreshSettings?.();
    showSettings(true);
  });
  ui.settingsCloseBtn?.addEventListener("click", () => showSettings(false));
  ui.settingsModal?.addEventListener("click", (event) => {
    if (event.target === ui.settingsModal) showSettings(false);
    const tab = event.target.closest("[data-settings-tab]");
    if (!tab) return;
    for (const button of ui.settingsModal.querySelectorAll("[data-settings-tab]")) {
      const active = button === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    const which = tab.dataset.settingsTab;
    ui.settingsVisualPanel?.classList.toggle("hidden", which !== "visual");
    ui.settingsGameplayPanel?.classList.toggle("hidden", which !== "gameplay");
    ui.settingsDeveloperPanel?.classList.toggle("hidden", which !== "developer");
  });
  ui.settingsModal?.addEventListener("change", (event) => {
    const morph = event.target.closest('input[name="modularMorphStyle"]');
    if (morph) {
      handlers.settingsChange?.({ modularMorphStyle: morph.value });
      return;
    }
    const debris = event.target.closest('input[name="debrisDespawnStyle"]');
    if (debris) {
      handlers.settingsChange?.({ debrisDespawnStyle: debris.value });
      return;
    }
    const rate = event.target.closest('input[name="reconquerRate"]');
    if (rate) {
      handlers.settingsChange?.({ reconquerRate: rate.value });
      return;
    }
    const armor = event.target.closest('input[name="armorDespawnStyle"]');
    if (armor) {
      handlers.settingsChange?.({ armorDespawnStyle: armor.value });
      return;
    }
    const armorTimer = event.target.closest('input[name="armorDespawnTimer"]');
    if (armorTimer) {
      handlers.settingsChange?.({ armorDespawnTimer: armorTimer.value });
      return;
    }
    const useClassic100Hp = event.target.closest('input[name="useClassic100Hp"]');
    if (useClassic100Hp) {
      handlers.settingsChange?.({ useClassic100Hp: useClassic100Hp.checked });
      return;
    }
    const optimizeIllusions = event.target.closest('input[name="optimizeIllusions"]');
    if (optimizeIllusions) {
      handlers.settingsChange?.({ optimizeIllusions: optimizeIllusions.checked });
      return;
    }
    const sfxEnabled = event.target.closest('input[name="sfxEnabled"]');
    if (sfxEnabled) {
      handlers.settingsChange?.({ sfxEnabled: sfxEnabled.checked });
      return;
    }
    const unlockAll = event.target.closest('input[name="unlockAllGearTemporary"]');
    if (unlockAll) {
      handlers.settingsChange?.({ unlockAllGearTemporary: unlockAll.checked });
    }
  });
  ui.reconquerRateInput?.addEventListener("input", () => {
    const rate = normalizeReconquerRate(ui.reconquerRateInput.value);
    if (ui.reconquerRateValue) {
      ui.reconquerRateValue.textContent = `${rate.toFixed(1)}×`;
    }
  });
  ui.armorDespawnTimerInput?.addEventListener("change", () => {
    const timer = normalizeArmorDespawnTimer(ui.armorDespawnTimerInput.value);
    ui.armorDespawnTimerInput.value = timer.toFixed(1);
    handlers.settingsChange?.({ armorDespawnTimer: timer });
  });
  $("#menu").addEventListener("keydown", (event) => {
    const row = event.target.closest(".hidden-scroll-row");
    if (row && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      scrollRow(row, event.key === "ArrowLeft" ? -1 : 1);
    }
  });
  $("#menu").addEventListener("wheel", (event) => {
    const row = event.target.closest(".hidden-scroll-row");
    if (row && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault();
      row.scrollLeft += event.deltaY;
    }
  }, { passive: false });
  ui.coachingForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.coachingInput.value.trim();
    if (text) {
      handlers.coaching(text, coachingWeapon);
      requestAnimationFrame(() => ui.coachingInput.focus());
    }
  });
  ui.coachingQuickReplies.addEventListener("click", (event) => {
    const button = event.target.closest("[data-coaching-reply]");
    if (button) handlers.coaching(button.dataset.coachingReply, coachingWeapon);
  });
  ui.coachingTopicChips?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-coaching-reply]");
    if (button) handlers.coaching(button.dataset.coachingReply, coachingWeapon);
  });
  ui.coachingInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
}
