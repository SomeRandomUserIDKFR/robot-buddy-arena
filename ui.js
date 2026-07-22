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
  ensureSettingsProfile, normalizeArmorDespawnTimer, normalizeReconquerRate
} from "./settings.js";

const $ = (selector) => document.querySelector(selector);

export const ui = {
  menu: $("#menu"),
  pause: $("#pause"),
  results: $("#results"),
  hud: $("#hud"),
  buildStamp: $("#buildStamp"),
  name: $("#botName"),
  nameError: $("#nameError"),
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
  mapSelect: $("#mapSelect"),
  learningLock: $("#learningLock"),
  learningLockHint: $("#learningLockHint"),
  readiness: $("#menuReadiness"),
  habit: $("#habitSummary"),
  teamBars: $("#teamBars"),
  modeLabel: $("#modeLabel"),
  readinessLabel: $("#readinessLabel"),
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
  settingsDeveloperPanel: $("#settingsDeveloperPanel"),
  unlockAllGearTemporaryInput: $("#unlockAllGearTemporary"),
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
  ui.name.value = profile.botName || "Pixel";
  ui.buddyColumnName.textContent = profile.botName || "Pixel";
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
  renderEquipment(profile);
  renderShop(profile);
  renderPerkModal(profile);
  refreshSettings(profile);
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
  ui.results.classList.add("hidden");
  ui.pause.classList.add("hidden");
  ui.perkModal?.classList.add("hidden");
  showSettings(false);
  ui.hud.classList.remove("hidden");
  const lockedSpar = mode === "training" && isLearningLocked(profile);
  const mapTag = mapName ? ` · ${mapName}` : "";
  ui.modeLabel.textContent = lockedSpar
    ? `SPAR — learning locked // ${ui.aiMode.value.toUpperCase()} BUDDY${mapTag}`
    : `${mode.toUpperCase()} // ${ui.aiMode.value.toUpperCase()} BUDDY${mapTag}`;
  const weapon = weaponKind(profile.equipment.player.weapon);
  ui.readinessLabel.textContent = lockedSpar
    ? "SPAR — learning locked"
    : readiness(profile.weapons[weapon]);
  ui.announcement.textContent = lockedSpar
    ? `SPAR — LEARNING LOCKED${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
    : mode === "training"
      ? `TRAIN YOUR BUDDY${mapName ? ` · ${mapName.toUpperCase()}` : ""}`
      : `PROTECT YOUR TEAM${mapName ? ` · ${mapName.toUpperCase()}` : ""}`;
}

export function updateHud(game) {
  const player = game.fighters[0];
  ui.teamBars.innerHTML = game.fighters.map((fighter) => `
    <div class="fighter-bar" style="opacity:${fighter.dead ? .38 : 1}">
      <b style="color:${fighter.color}">${escapeHtml(fighter.name)}</b>
      <div class="hp-track"><i class="hp-fill" style="width:${fighter.hp / fighter.maxHp * 100}%;background:${fighter.team ? "#ff665c" : "#42dff5"}"></i></div>
      <span>${Math.ceil(fighter.hp)}</span>
    </div>`).join("");
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
    ui.reserveMeter.classList.toggle("hidden", !hasNanoPool);
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
  ui.announcement.textContent = game.announcement > 0
    ? (sparLocked
      ? `SPAR — LEARNING LOCKED${game.mapName ? ` · ${String(game.mapName).toUpperCase()}` : ""}`
      : game.mode === "training"
        ? `TRAIN YOUR BUDDY${game.mapName ? ` · ${String(game.mapName).toUpperCase()}` : ""}`
        : `PROTECT YOUR TEAM${game.mapName ? ` · ${String(game.mapName).toUpperCase()}` : ""}`)
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
  ui.resultTitle.textContent = win ? "Victory" : "Defeat";
  ui.resultCyber.textContent = earnedCyber > 0
    ? `+${earnedCyber}¢ CYBER EARNED · BALANCE ${profile.cyber}¢`
    : `${game.mode === "training" ? "TRAINING PAYS NO CYBER" : "NO CYBER LOST"} · BALANCE ${profile.cyber}¢`;
  if (ui.resultExp) {
    if (game.mode !== "conquest") {
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
    if (game.mode !== "conquest") {
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
  if (game.mode === "training") {
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
  } else {
    if (buddy?.dead) lines.push("I got isolated and went down. That was my fault.");
    else if ((buddy?.fuel || 0) < .15) lines.push("I spent too much jetpack fuel chasing. I'll budget it better.");
    else lines.push("I stayed available for your engagements. My positioning can still improve.");
    lines.push(`I contributed ${Math.round(buddy?.totalDamage || 0)} damage and followed ${game.pings.length ? "your ping" : "our shared vision"}.`);
    lines.push(win ? "We handled that together." : "I own my part of the loss. Let's adjust and try again.");
  }
  ui.feedback.innerHTML = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  const thoughts = game.thoughts.length
    ? game.thoughts.slice(-3)
    : [`${formatTime(game.elapsed)} — Held position: no safe target was visible`];
  ui.thoughts.innerHTML = thoughts.map((thought) => `<li>${escapeHtml(thought)}</li>`).join("");
  coachingWeapon = player.weapon;
  const training = game.mode === "training";
  ui.coachingPanel.classList.toggle("read-only", !training);
  ui.coachingForm.classList.remove("hidden");
  ui.coachingQuickReplies.classList.remove("hidden");
  if (ui.coachingTitle) {
    ui.coachingTitle.textContent = training
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
        "<span class=\"stat-down\">Vacuumed scraps cannot reconquer</span>"
      ].filter(Boolean).join("");
    }
    if (gear.reconjurerBuilder) {
      return [
        "<span>Extension · press 3</span>",
        "<span class=\"stat-up\">Near debris · free rebuild +2 scraps</span>",
        "<span class=\"stat-up\">No debris · paid random conjure</span>",
        "<span>Metal box · 8% / 10s user CD</span>",
        "<span class=\"stat-down\">Does not replace 1/2 secondary</span>"
      ].join("");
    }
    if (gear.id === "no-extension") {
      return "<span>Empty extension slot · key 3 idle</span>";
    }
    if (gear.throwBreakable) {
      const stats = weaponStats(gear);
      return [
        "<span>Secondary · click grab / click throw</span>",
        `<span>${stats.baseDamage} throw damage</span>`,
        "<span class=\"stat-up\">Grab any breakable cover</span>",
        "<span class=\"stat-up\">Power crates grabbable at ≤50% HP</span>",
        "<span>Held props stay damageable</span>",
        "<span class=\"stat-down\">Shatters at impact · reconquer there</span>"
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
  ui.conquestSelect?.classList.remove("hidden");
  refreshConquestSelect(profile, encounter);
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
  $("#conquestBtn").addEventListener("click", () => handlers.openConquest?.());
  ui.conquestBackBtn?.addEventListener("click", () => handlers.conquestBack?.());
  ui.conquestRerollBtn?.addEventListener("click", () => handlers.conquestReroll?.());
  ui.conquestFightBtn?.addEventListener("click", () => handlers.conquestFight?.());
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
