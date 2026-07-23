import { SIZE, WORLD } from "./config.js";
import { updateCamera } from "./camera.js";
import {
  Fighter, hit, refreshCombatCaches, stepBullets, stepFighter, stepThrownProps,
  triggerDodge
} from "./combat.js";
import {
  isCombatClone, isCombatCloneGear, refreshCombatCloneCaches, tickCombatCloneWorld,
  tryCombatCloneSpawn
} from "./combat-clone.js";
import {
  cycleIllusionistType, cycleIllusionPropKind, isIllusionFighter, isIllusionist,
  isRealCombatant,
  refreshIllusionCaches, tickIllusionistWorld, tryIllusionistPlant
} from "./illusionist.js";
import { buddyChatReply, ensureCoaching } from "./coaching.js";
import { analyzeBuddyMessage } from "./language-analyzer.js";
import {
  acceptSuggestion, applyLoadout, awardConquest, cycleAdaptiveMode, cycleModularMode,
  cycleWeaponSlot, equipOwned, GEAR_BY_ID, hasNanotechChestplate, isAdaptiveNanotechWeapon,
  isMaterialConsumer, isModularWeapon, MATERIAL_CONSUMER_REFORM_KEY,
  NANOTECH_F_HOLD_THRESHOLD, pulseNanotechArmor,
  purchaseGear, reconcileLoadoutsToOwned, selectWeaponSlot, setBuddyMode,
  setNanotechChanneling, tickMaterialConsumerVacuum, tryMaterialConsumerReform,
  tryNanotechWeaponAction, toggleRetractableArmor, toggleShieldRaise, trainerLoadout,
  weaponKind
} from "./equipment.js";
import { tickGroundDebris } from "./debris.js";
import { tickThrowBreakable } from "./throw-breakable.js";
import {
  isLightCondensation, tickLightCondensation, tryLightCondensation
} from "./light-condensation.js";
import {
  cycleReconjurerType, isReconjurerBuilder, tickReconjurerBuilder, tryReconjurerBuild
} from "./reconjurer-builder.js";
import {
  cycleTrapperType, isTrapper, tickTrapperWorld, tryTrapperPlant
} from "./trapper.js";
import {
  getPendingEncounter, rerollEncounter, setPendingEncounter
} from "./conquest.js";
import {
  createMapRuntime, pickRandomMapId
} from "./maps.js";
import {
  initPowerCrates, tickFighterPowerBuffs, tickPowerCrateSpawns
} from "./powerups.js";
import {
  acceptPerkSuggestion, choosePerkUnlock, equipPerk as equipOwnedPerk, setBuddyPerkAutonomy
} from "./perks.js";
import { keys, mouse, installInput } from "./input.js";
import {
  advanceDirectiveTraining, createTrainingProposal, mimicUnlockLevel, normalizeAiMode,
  normalizeMimicIntensity, trackTraining, updateLearning
} from "./learning.js";
import { createRenderer } from "./rendering.js";
import { profile, saveProfile } from "./storage.js";
import {
  cloneSettings, ensureSettingsProfile, normalizeArmorDespawnStyle,
  normalizeArmorDespawnTimer, normalizeDebrisDespawnStyle,
  normalizeModularMorphStyle, normalizeOptimizeIllusions, normalizeReconquerRate,
  normalizeUnlockAllGearTemporary
} from "./settings.js";
import {
  bindUi, refreshConquestSelect, refreshCoaching, refreshMenu, refreshSettings, showBuildStamp,
  showConquestSelect, showGame, showMenu, showPause, showResults, showSettings, ui, updateHud
} from "./ui.js";
import { capitalize, clamp, formatTime, thoughtReason } from "./utils.js";

const canvas = document.querySelector("#game");
const renderer = createRenderer(canvas);
let game = null;
let lastTime = performance.now();
/** Nanotech F: accumulate hold time so a short press is +100 and a hold recalls. */
let nanoFHoldT = 0;
let nanoFHoldLatched = false;

function resolveMapId(mode) {
  if (mode === "conquest") {
    const encounter = getPendingEncounter();
    if (encounter?.mapId) return encounter.mapId;
  }
  const picked = ui.mapSelect?.value || "random";
  if (picked && picked !== "random") return picked;
  return pickRandomMapId();
}

function makeGame(mode) {
  const buddyName = ui.name.value.trim() || "Pixel";
  profile.botName = buddyName;
  const learned = profile.weapons[weaponKind(profile.equipment.player.weapon)];
  let mind = normalizeAiMode(ui.aiMode.value);
  if (mind === "mimic" && mimicUnlockLevel(learned) === "locked") mind = "balanced";
  profile.aiMode = mind;
  ui.aiMode.value = mind;
  saveProfile();
  if (profile.equipment.buddyMode === "choice") setBuddyMode(profile, "choice");
  if (profile.buddyPerkAutonomy === "choice") setBuddyPerkAutonomy(profile, "choice");

  const mapId = resolveMapId(mode);
  const map = createMapRuntime(mapId);
  const powerCrateState = initPowerCrates(map.id, map.theme);
  const spawns = map.spawnPoints[mode === "training" ? "training" : "conquest"];

  const fighters = [
    applyLoadout(new Fighter({
      x: spawns.player.x, y: spawns.player.y, team: 0, color: "#e7f9ff", name: "YOU",
      human: true
    }), profile.equipment.player)
  ];
  if (mode === "training") {
    fighters.push(applyLoadout(new Fighter({
      x: spawns.buddy.x, y: spawns.buddy.y, team: 1, color: "#42dff5", name: buddyName,
      buddy: true, ai: mind
    }), profile.equipment.buddy));
  } else {
    fighters.push(applyLoadout(new Fighter({
      x: spawns.buddy.x, y: spawns.buddy.y, team: 0, color: "#42dff5", name: buddyName,
      buddy: true, ai: mind
    }), profile.equipment.buddy));
    const encounter = getPendingEncounter();
    // Prefer the select-screen encounter; fall back to classic Veteran duo.
    const trainer = encounter?.trainer || {
      name: "TRAINER", ai: "veteran", loadout: trainerLoadout("veteran")
    };
    const follower = encounter?.follower || {
      name: "FOLLOWER", ai: "rookie", loadout: trainerLoadout("veteran", true)
    };
    fighters.push(applyLoadout(new Fighter({
      x: spawns.enemy1.x, y: spawns.enemy1.y, team: 1,
      color: trainer.color || "#ff5e56",
      name: trainer.name || "TRAINER",
      ai: trainer.ai || "veteran"
    }), trainer.loadout || trainerLoadout("veteran")));
    fighters.push(applyLoadout(new Fighter({
      x: spawns.enemy2.x, y: spawns.enemy2.y, team: 1,
      color: follower.color || "#ff9b4a",
      name: follower.name || "FOLLOWER",
      ai: follower.ai || "rookie"
    }), follower.loadout || trainerLoadout("veteran", true)));
  }
  const difficulty = mode === "conquest"
    ? (getPendingEncounter()?.rewardTier || "veteran")
    : "veteran";
  ensureSettingsProfile(profile);
  return {
    id: `${Date.now()}-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
    mode,
    difficulty,
    encounter: mode === "conquest" ? getPendingEncounter() : null,
    mapId: map.id,
    mapName: map.name,
    theme: map.theme,
    platforms: map.platforms,
    props: map.props,
    powerCrates: powerCrateState.crates,
    powerCrateState,
    powerCrateSpawns: map.powerCrateSpawns || [],
    _powerupHit: hit,
    spawnPoints: map.spawnPoints,
    ceiling: map.ceiling,
    groundStyle: map.groundStyle,
    backdrop: map.backdrop,
    learningLocked: !!profile.learningLocked,
    settings: cloneSettings(profile.settings),
    fighters,
    bullets: [],
    effects: [],
    groundDebris: [],
    thrownBreakables: [],
    reconquerQueue: [],
    forgeCasts: [],
    armorDummyBuilds: [],
    armorDummies: [],
    reconquerBonusAcc: 0,
    beamReveals: [],
    traps: [],
    illusions: [],
    pings: [],
    camera: { x: 0, y: 0 },
    startedAt: Date.now(),
    elapsed: 0,
    over: false,
    paused: false,
    announcement: 2.2,
    thoughts: [],
    thoughtClock: 8,
    lastShotAtPlayer: -99,
    stats: {
      rangeSum: 0, samples: 0, closing: 0, dodges: 0, reactive: 0,
      attackRangeSum: 0, jetAggro: 0, jetEscape: 0, playerJetTime: 0,
      lowHpAttack: 0, lowHpTime: 0, lowHpOpportunities: 0,
      attacks: 0, buddyDamage: 0, buddyClosing: 0, buddyRetreat: 0,
      buddyClose: 0, buddyFar: 0, buddyMoving: 0, buddyJet: 0, buddyDodges: 0,
      rushOpportunities: 0, rushCounterSuccesses: 0, jetOpportunities: 0,
      buddyAttacks: 0, buddyHits: 0, buddyDamageTaken: 0,
      buddyDodgeAttempts: 0, buddyDodgeSuccesses: 0,
      fuelOpportunities: 0, fuelSuccesses: 0, pingTargetHits: 0,
      // Shield habits (Training only; ignored when player never equips a shield).
      shieldOpportunities: 0, shieldRaisesOnOpp: 0, shieldRaiseCount: 0,
      shieldPressureTime: 0, shieldRaisedUnderPressure: 0, shieldRaisedTime: 0,
      shieldHoldSum: 0, shieldHolds: 0, shieldBlocks: 0, shieldDamageAbsorbed: 0,
      shieldBroke: 0, shieldRaiseOnApproach: 0, shieldRaiseAfterShot: 0,
      shieldRaiseLowHp: 0
    }
  };
}

function start(mode) {
  const blockedWords = ["fuck", "shit", "bitch", "cunt", "nazi"];
  const name = ui.name.value.trim();
  if (!name || blockedWords.some((word) => name.toLowerCase().includes(word))) {
    ui.nameError.textContent = "Please pick another name for your buddy.";
    return;
  }
  ui.nameError.textContent = "";
  if (mode === "conquest" && !getPendingEncounter()) {
    showConquestSelect(profile);
    return;
  }
  game = makeGame(mode);
  showGame(mode, profile, game.mapName);
  mouse.down = false;
}

function openConquest() {
  const blockedWords = ["fuck", "shit", "bitch", "cunt", "nazi"];
  const name = ui.name.value.trim();
  if (!name || blockedWords.some((word) => name.toLowerCase().includes(word))) {
    ui.nameError.textContent = "Please pick another name for your buddy.";
    return;
  }
  ui.nameError.textContent = "";
  showConquestSelect(profile);
}

function conquestFight() {
  if (!getPendingEncounter()) {
    showConquestSelect(profile);
    return;
  }
  start("conquest");
}

function conquestReroll() {
  const result = rerollEncounter(profile);
  if (!result.ok) {
    refreshConquestSelect(
      profile,
      getPendingEncounter(),
      result.error === "broke"
        ? `Need ${result.cost}¢ Cyber to reroll.`
        : "Could not reroll."
    );
    return;
  }
  if (result.cost > 0) saveProfile();
  refreshMenu(profile);
  refreshConquestSelect(
    profile,
    result.encounter,
    result.free ? "Free reroll used." : `Spent ${result.cost}¢ on reroll.`
  );
}

function conquestBack() {
  setPendingEncounter(null);
  showMenu(false, profile);
  refreshMenu(profile);
}

function screenToWorld(x, y) {
  return game
    ? { x: x + game.camera.x, y: y + game.camera.y }
    : { x, y };
}

function humanIntent(fighter) {
  const cursor = screenToWorld(mouse.x, mouse.y);
  fighter.aim = Math.atan2(
    cursor.y - (fighter.y + SIZE / 2),
    cursor.x - (fighter.x + SIZE / 2)
  );
  return {
    mx: (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0),
    jump: !!(keys.KeyW || keys.Space),
    jet: !!(
      keys.ShiftLeft || keys.ShiftRight
      || (!fighter.grounded && (keys.KeyW || keys.Space))
    ),
    // Raw thrust-capable input: an exhausted jet only re-arms after ALL of
    // these are released, so holding jump or spamming Shift can't cheat it.
    jetHeld: !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyW || keys.Space),
    attack: mouse.down,
    chuck: mouse.right,
    // Hold V: Material Consumer excess vacuum → ejection tank.
    ejectVacuum: !!keys.KeyV,
    dodge: false
  };
}

function update(dt) {
  if (!game || game.paused || game.over) return;
  game.elapsed += dt;
  game.announcement -= dt;
  game.thoughtClock -= dt;
  const player = game.fighters[0];
  // Tap F = +100 armor; hold F = recall armor→reserve at 50/s (after threshold).
  if (player && hasNanotechChestplate(player) && !player.dead) {
    if (keys.KeyF) {
      nanoFHoldT += dt;
      if (nanoFHoldT >= NANOTECH_F_HOLD_THRESHOLD) {
        nanoFHoldLatched = true;
        setNanotechChanneling(player, true);
      }
    } else {
      if (nanoFHoldT > 0 && !nanoFHoldLatched) {
        pulseNanotechArmor(player);
      }
      nanoFHoldT = 0;
      nanoFHoldLatched = false;
      setNanotechChanneling(player, false);
    }
  } else {
    nanoFHoldT = 0;
    nanoFHoldLatched = false;
  }
  refreshCombatCaches(game);
  refreshIllusionCaches(game);
  refreshCombatCloneCaches(game);
  const trapPrevY = new Map();
  for (const fighter of game.fighters) {
    stepFighter(fighter, dt, game, profile, keys, humanIntent);
    if (fighter._trapPrevY != null) trapPrevY.set(fighter, fighter._trapPrevY);
    // Decoys / Doppels skip secondary/extension world ticks — they only fight.
    if (isIllusionFighter(fighter) || isCombatClone(fighter)) continue;
    tickFighterPowerBuffs(fighter, dt);
    tickThrowBreakable(fighter, game, dt);
    tickReconjurerBuilder(fighter, dt);
    tickLightCondensation(fighter, dt);
  }
  tickTrapperWorld(game, dt, trapPrevY);
  tickIllusionistWorld(game, dt);
  tickCombatCloneWorld(game);
  stepBullets(game, dt);
  stepThrownProps(game, dt);
  tickPowerCrateSpawns(game, dt);
  trackTraining(game, dt);
  if (game.mode === "training") {
    const buddy = game.fighters.find((fighter) => fighter.buddy);
    if (buddy && !buddy.grounded && buddy.fuel < .12 && !game.lowFuelJudged) {
      game.lowFuelJudged = true;
      game.stats.fuelOpportunities++;
    }
    if (game.lowFuelJudged && buddy?.grounded && !game.lowFuelResolved) {
      game.lowFuelResolved = true;
      game.stats.fuelSuccesses++;
    }
  }
  tickGroundDebris(game, dt);
  for (const fighter of game.fighters) {
    tickMaterialConsumerVacuum(fighter, game, dt);
  }
  for (const effect of game.effects) effect.life -= dt;
  for (const ping of game.pings) ping.life -= dt;
  for (const sample of game.beamReveals || []) sample.life -= dt;
  for (const prop of game.props || []) {
    if (prop.hitFlash > 0) prop.hitFlash -= dt;
  }
  game.effects = game.effects.filter((effect) => effect.life > 0);
  game.pings = game.pings.filter((ping) => ping.life > 0);
  game.beamReveals = (game.beamReveals || []).filter((sample) => sample.life > 0);

  if (game.thoughtClock <= 0) {
    const buddy = game.fighters.find((fighter) => fighter.buddy);
    if (buddy && !buddy.dead && game.thoughts.length < 6) {
      game.thoughts.push(
        `${formatTime(game.elapsed)} — ${capitalize(buddy.aiState.plan)}: ${thoughtReason(buddy.aiState.plan)}`
      );
    }
    game.thoughtClock = 10 + Math.random() * 8;
  }

  updateCamera(game.camera, player, { width: canvas.width, height: canvas.height }, dt);
  updateHud(game);

  const teamZeroAlive = game.fighters.some((fighter) => (
    fighter.team === 0 && isRealCombatant(fighter)
  ));
  const teamOneAlive = game.fighters.some((fighter) => (
    fighter.team === 1 && isRealCombatant(fighter)
  ));
  if (!teamZeroAlive || !teamOneAlive) finish(teamZeroAlive && !teamOneAlive);
}

function finish(win) {
  if (!game || game.over) return;
  game.over = true;
  profile.matches++;
  let practiceLines = [];
  let learningChanged = [];
  if (game.mode === "training") {
    practiceLines = advanceDirectiveTraining(game, profile);
    learningChanged = updateLearning(game, profile);
    createTrainingProposal(game, profile);
  }
  const rewards = awardConquest(profile, {
    id: game.id, mode: game.mode, difficulty: game.difficulty, win
  });
  saveProfile();
  showResults(game, profile, win, practiceLines, rewards, learningChanged);
  refreshMenu(profile);
}

function handleKeyDown(event) {
  if (!game || game.over) return;
  if (event.code === "KeyQ" && !event.repeat) {
    toggleShieldRaise(game.fighters[0]);
  }
  if (event.code === "KeyF" && !event.repeat) {
    const player = game.fighters[0];
    // Nanotech tap/hold is resolved in update(); F only toggles retractable without chestplate.
    if (!hasNanotechChestplate(player)) {
      toggleRetractableArmor(player);
    }
  }
  if (event.code === "KeyE" && !event.repeat) {
    const player = game.fighters[0];
    if (isModularWeapon(player)) {
      cycleModularMode(player);
    } else if ((player.nanotechWeaponCost || 0) > 0) {
      tryNanotechWeaponAction(player);
    }
  }
  if (event.code === "KeyR" && !event.repeat) {
    const player = game.fighters[0];
    if (isAdaptiveNanotechWeapon(player)) {
      cycleAdaptiveMode(player);
    }
  }
  if (event.code === "Digit1" && !event.repeat) {
    selectWeaponSlot(game.fighters[0], "weapon");
  }
  if (event.code === "Digit2" && !event.repeat) {
    selectWeaponSlot(game.fighters[0], "secondaryWeapon");
  }
  if (event.code === "Digit3" && !event.repeat) {
    const player = game.fighters[0];
    if (isIllusionist(player)) tryIllusionistPlant(player, game, Fighter);
    else if (isCombatCloneGear(player)) tryCombatCloneSpawn(player, game, Fighter);
    else if (isTrapper(player)) tryTrapperPlant(player, game);
    else if (isLightCondensation(player)) tryLightCondensation(player, game);
    else if (isReconjurerBuilder(player)) tryReconjurerBuild(player, game);
  }
  if (event.code === "KeyT" && !event.repeat) {
    const player = game.fighters[0];
    if (isIllusionist(player)) cycleIllusionistType(player);
    else if (isTrapper(player)) cycleTrapperType(player);
    else if (isReconjurerBuilder(player)) cycleReconjurerType(player, game);
  }
  if (event.code === "KeyY" && !event.repeat) {
    const player = game.fighters[0];
    if (isIllusionist(player)) cycleIllusionPropKind(player, game);
  }
  if (event.code === "KeyC") triggerDodge(game.fighters[0], game, keys);
  if (event.code === MATERIAL_CONSUMER_REFORM_KEY && !event.repeat) {
    const player = game.fighters[0];
    if (isMaterialConsumer(player)) {
      const point = screenToWorld(mouse.x, mouse.y);
      tryMaterialConsumerReform(
        player,
        game,
        clamp(point.x, 0, WORLD.w),
        clamp(point.y, 0, WORLD.h)
      );
    }
  }
  if (event.code === "KeyG") {
    const point = screenToWorld(mouse.x, mouse.y);
    game.pings.push({
      x: clamp(point.x, 0, WORLD.w),
      y: clamp(point.y, 0, WORLD.h),
      life: 3
    });
    game.thoughts.push(`${formatTime(game.elapsed)} — Answered your ping: you marked a priority`);
  }
  if (event.code === "Escape") {
    game.paused = !game.paused;
    if (game.paused) {
      const player = game.fighters[0];
      if (hasNanotechChestplate(player)) setNanotechChanneling(player, false);
    }
    showPause(game.paused);
  }
  if ([
    "Space", "KeyW", "KeyA", "KeyD", "KeyB", "KeyC", "KeyQ", "KeyE", "KeyF", "KeyR",
    "KeyT", "KeyY", "Digit1", "Digit2", "Digit3"
  ].includes(event.code)) {
    event.preventDefault();
  }
}

function handleKeyUp(event) {
  if (!game || game.over) return;
  // Nanotech channel release is handled by per-frame keys.KeyF sync in update().
}

function handleWheel(event) {
  if (!game || game.paused || game.over) return;
  event.preventDefault();
  cycleWeaponSlot(game.fighters[0]);
}

function loop(now) {
  const dt = Math.min(.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  renderer.draw(game);
  requestAnimationFrame(loop);
}

installInput(canvas, handleKeyDown, handleKeyUp, handleWheel);
bindUi({
  start,
  openConquest,
  conquestFight,
  conquestReroll,
  conquestBack,
  resume() {
    game.paused = false;
    showPause(false);
  },
  quit() {
    game = null;
    setPendingEncounter(null);
    showMenu(false, profile);
  },
  menu() {
    game = null;
    setPendingEncounter(null);
    showMenu(true, profile);
  },
  again() {
    if (game?.mode === "conquest") {
      openConquest();
      return;
    }
    start(game.mode);
  },
  aiMode(mode) {
    const learned = profile.weapons[weaponKind(profile.equipment.player.weapon)];
    let next = normalizeAiMode(mode);
    if (next === "mimic" && mimicUnlockLevel(learned) === "locked") next = "balanced";
    profile.aiMode = next;
    saveProfile();
    refreshMenu(profile);
  },
  mimicIntensity(level) {
    const learned = profile.weapons[weaponKind(profile.equipment.player.weapon)];
    let next = normalizeMimicIntensity(level);
    if (next === "full" && mimicUnlockLevel(learned) !== "full") next = "quite";
    if (mimicUnlockLevel(learned) === "locked") return;
    profile.mimicIntensity = next;
    saveProfile();
    refreshMenu(profile);
  },
  equip(owner, slot, gearId) {
    if (!equipOwned(profile, owner, slot, gearId)) return;
    saveProfile();
    refreshMenu(profile);
  },
  equipPerk(owner, perkId) {
    if (!equipOwnedPerk(profile, owner, perkId === "none" ? null : perkId)) return;
    saveProfile();
    refreshMenu(profile);
  },
  choosePerk(pickId, perkId) {
    const result = choosePerkUnlock(profile, pickId, perkId);
    if (!result.ok) return;
    saveProfile();
    refreshMenu(profile);
  },
  purchase(gearId) {
    const result = purchaseGear(profile, gearId);
    if (result.ok) {
      ui.shopFeedback.textContent = `${result.gear.name} unlocked for ${result.spent}¢.`;
      ui.shopFeedback.className = "shop-feedback success";
      saveProfile();
      refreshMenu(profile);
    } else {
      ui.shopFeedback.textContent = result.reason === "insufficient"
        ? `Insufficient Cyber — need ${result.shortfall}¢ more.`
        : result.reason === "owned" ? "That item is already owned." : "That item is not for sale.";
      ui.shopFeedback.className = "shop-feedback error";
    }
  },
  shopEquip(gearId) {
    const gear = GEAR_BY_ID[gearId];
    if (!gear) return;
    if (!equipOwned(profile, "player", gear.slot, gearId)) return;
    ui.shopFeedback.textContent = `${gear.name} equipped on your loadout.`;
    ui.shopFeedback.className = "shop-feedback success";
    saveProfile();
    refreshMenu(profile);
  },
  buddyMode(mode) {
    setBuddyMode(profile, mode);
    saveProfile();
    refreshMenu(profile);
  },
  buddyPerkMode(mode) {
    setBuddyPerkAutonomy(profile, mode);
    saveProfile();
    refreshMenu(profile);
  },
  learningLock(locked) {
    profile.learningLocked = !!locked;
    saveProfile();
    refreshMenu(profile);
  },
  acceptSuggestion() {
    acceptSuggestion(profile);
    saveProfile();
    refreshMenu(profile);
  },
  rejectSuggestion() {
    profile.equipment.suggestion = null;
    profile.equipment.buddyMode = "user";
    saveProfile();
    refreshMenu(profile);
  },
  acceptPerkSuggestion() {
    acceptPerkSuggestion(profile);
    saveProfile();
    refreshMenu(profile);
  },
  rejectPerkSuggestion() {
    profile.perkSuggestion = null;
    profile.buddyPerkAutonomy = "user";
    saveProfile();
    refreshMenu(profile);
  },
  refreshSettings() {
    refreshSettings(profile);
  },
  settingsChange({
    modularMorphStyle, debrisDespawnStyle, reconquerRate,
    armorDespawnStyle, armorDespawnTimer, optimizeIllusions, unlockAllGearTemporary
  } = {}) {
    ensureSettingsProfile(profile);
    if (modularMorphStyle != null) {
      profile.settings.visual.modularMorphStyle = normalizeModularMorphStyle(modularMorphStyle);
    }
    if (debrisDespawnStyle != null) {
      profile.settings.visual.debrisDespawnStyle = normalizeDebrisDespawnStyle(debrisDespawnStyle);
    }
    if (reconquerRate != null) {
      profile.settings.visual.reconquerRate = normalizeReconquerRate(reconquerRate);
    }
    if (armorDespawnStyle != null) {
      profile.settings.visual.armorDespawnStyle = normalizeArmorDespawnStyle(armorDespawnStyle);
    }
    if (armorDespawnTimer != null) {
      profile.settings.visual.armorDespawnTimer = normalizeArmorDespawnTimer(armorDespawnTimer);
    }
    if (optimizeIllusions != null) {
      profile.settings.gameplay.optimizeIllusions = normalizeOptimizeIllusions(optimizeIllusions);
    }
    let gearUnlockChanged = false;
    if (unlockAllGearTemporary != null) {
      const next = normalizeUnlockAllGearTemporary(unlockAllGearTemporary);
      const prev = !!profile.settings.developer.unlockAllGearTemporary;
      profile.settings.developer.unlockAllGearTemporary = next;
      if (prev && !next) reconcileLoadoutsToOwned(profile);
      gearUnlockChanged = prev !== next;
    }
    saveProfile();
    refreshSettings(profile);
    if (gearUnlockChanged) refreshMenu(profile);
    if (game) game.settings = cloneSettings(profile.settings);
  },
  coaching: async (text, weapon) => {
    ensureCoaching(profile);
    const allowDirectives = !ui.coachingPanel.classList.contains("read-only");
    const pendingOpen = Boolean(profile.coaching?.pending || profile.coaching?.clarification);
    const analysis = await analyzeBuddyMessage(
      text,
      profile.coaching?.learnedVocabulary || [],
      { allowRoute: !pendingOpen }
    );
    const response = buddyChatReply(profile, text, weapon, analysis, { allowDirectives });
    saveProfile();
    refreshCoaching(profile, response.quickReplies);
  }
});
refreshMenu(profile);
showBuildStamp();
requestAnimationFrame(loop);
