export const WORLD = { w: 3600, h: 1600 };
// Hard world ceiling: fighters are clamped to y >= CEILING and bullets expire
// above it, so nothing can leave the arena through the top.
export const CEILING = 12;
export const GRAVITY = 1850;
export const JUMP = 950;
// Jetpack: thrust must beat GRAVITY or holding jet can never gain height.
export const JET_THRUST = 4000;
export const JET_MAX_RISE = 460;
export const JET_BURN_TIME = 3;      // seconds of continuous thrust from a full tank
export const JET_RECHARGE_TIME = 5;  // seconds from empty back to full
// Running the tank dry locks the jet out. It only re-arms after the thrust
// input has been released AND fuel has recovered to this reserve (20% of a
// tank = ~1s of recharge), so regen ticks or rapid tapping can never feed
// thrust pulses during the forced downtime.
export const JET_RESTART_FUEL = .2;
export const SIZE = 46;
export const SIGHT = 820;

export const STORAGE_KEY = "robotBuddyArena.v1";

const evidence = () => ({
  successes: 0, failures: 0, samples: 0, estimate: null, settled: false
});
const weaponProfile = () => ({
  schema: 2,
  habits: {
    engagementRange: evidence(),
    rushPrediction: evidence(),
    dodgeTiming: evidence(),
    jetpackUse: evidence(),
    lowHpBehavior: evidence(),
    // High estimate = camp / long holds; low = pop-block / conserve durability.
    shieldUse: evidence()
  },
  capabilities: {
    aim: evidence(),
    dodgeTiming: evidence(),
    fuelManagement: evidence(),
    // Only accrues from Training while the buddy used a marksman/sniper.
    // Tiny long-range aim-error reduction; never a big accuracy unlock.
    precisionAim: evidence()
  }
});

// Mimic intensity → how strongly player-habit estimates override default spacing
// and tempo. Slight / Quite a bit / Full.
export const MIMIC_BLEND = {
  slight: .25,
  quite: .55,
  full: .85
};

export const DEFAULT_PROFILE = {
  botName: "Pixel",
  matches: 0,
  cyber: 120,
  ranking: 100,
  level: 1,
  exp: 0,
  expToNext: 100,
  unlockedPerks: [],
  pendingPerkPicks: [],
  buddyPerkAutonomy: "user",
  perkSuggestion: null,
  // When true, Training still fights but writes no learning / practice evidence.
  learningLocked: false,
  // Buddy mind + Mimic dial (persisted; migrated for older saves).
  aiMode: "balanced",
  mimicIntensity: "quite",
  settings: {
    visual: {
      modularMorphStyle: "fold",
      debrisDespawnStyle: "fade",
      // 0.1×–10× baseline reconquer cadence (1× = default).
      reconquerRate: 1,
      armorDespawnStyle: "fade",
      // Seconds before armor scraps despawn / build a dummy (tenths).
      armorDespawnTimer: 14
    },
    developer: {
      unlockAllGearTemporary: false
    }
  },
  rewardedConquests: [],
  equipment: {
    owned: [
      "field-frame", "scout-frame", "survey-visor", "wideband-array",
      "pulse-rifle", "arc-saber", "vector-pack", "sprinter-pack",
      "no-shield", "light-buckler", "no-secondary", "no-extension"
    ],
    player: {
      body: "field-frame", helmet: "survey-visor",
      weapon: "pulse-rifle", secondaryWeapon: "no-secondary",
      extensionSecondary: "no-extension",
      jetpack: "vector-pack", shield: "no-shield",
      perk: null
    },
    buddy: {
      body: "field-frame", helmet: "survey-visor",
      weapon: "pulse-rifle", secondaryWeapon: "no-secondary",
      extensionSecondary: "no-extension",
      jetpack: "vector-pack", shield: "no-shield",
      perk: null
    },
    buddyMode: "user",
    suggestion: null
  },
  coaching: {
    directives: [],
    history: [],
    pending: null,
    proposal: null,
    clarification: null,
    learnedVocabulary: [],
    topicPrefs: {},
    recentProposals: {},
    responseVariants: {}
  },
  weapons: {
    gun: weaponProfile(),
    saber: weaponProfile()
  }
};

// Battlefield layout lives in maps.js; re-exported for legacy imports.
export { PLATFORMS } from "./maps.js";

// aimTurnRate is max angular speed (rad/s) when AI moves its crosshair toward a
// desired aim — mouse-like linear turning, not an instant snap. Rates are high so a
// 180° re-aim finishes in ~0.05–0.14s (brief sweep, near-snap feel). Flash is
// quickest; Thinker is slower. Buddy training scales up to the mind-mode cap;
// it never exceeds it.
//
// Conquest enemy tiers (rookie / recruit / contender / veteran / challenger /
// elite): higher `aim` and `reaction` = worse. Rookie trainer is clearly below
// Veteran and below a mid-trained player buddy; `recruit` is the weaker
// Rookie-tier follower. Contender / Challenger are mid presets for Ranking
// league fillers between the classic three reward tiers.
export const AI_PRESETS = {
  flash: { reaction: .10, aim: .16, prediction: .08, fuelCare: .22, change: .12, aimTurnRate: 60 },
  balanced: { reaction: .25, aim: .10, prediction: .35, fuelCare: .58, change: .5, aimTurnRate: 40 },
  thinker: { reaction: .45, aim: .055, prediction: .72, fuelCare: .85, change: .85, aimTurnRate: 28 },
  // Mimic reuses Balanced motor constraints; style copy is a separate blend layer.
  mimic: { reaction: .25, aim: .10, prediction: .35, fuelCare: .58, change: .5, aimTurnRate: 40 },
  // Green Conquest duo — hesitant, scattershot, poor fuel; not semi-pro.
  rookie: { reaction: .58, aim: .58, prediction: .05, fuelCare: .16, change: .16, aimTurnRate: 12 },
  recruit: { reaction: .72, aim: .75, prediction: 0, fuelCare: .08, change: .1, aimTurnRate: 9 },
  // Contender: soft veteran — between Rookie and Veteran (league filler).
  contender: { reaction: .38, aim: .28, prediction: .22, fuelCare: .38, change: .38, aimTurnRate: 26 },
  veteran: { reaction: .24, aim: .085, prediction: .48, fuelCare: .62, change: .65, aimTurnRate: 42 },
  // Challenger: hard veteran / soft elite (league filler).
  challenger: { reaction: .2, aim: .062, prediction: .62, fuelCare: .74, change: .74, aimTurnRate: 47 },
  elite: { reaction: .16, aim: .045, prediction: .78, fuelCare: .85, change: .82, aimTurnRate: 52 }
};
