/**
 * Themed arena maps — fixed layouts (~3-screen width), platforms, and props.
 * Props may be breakable soft cover; forest trunks let fighters walk through.
 * Ceiling / world size match `config.js` (avoid importing config — circular with PLATFORMS re-export).
 */
import { spawnPropDebris } from "./debris.js";
import {
  detonateExplosiveBarrel, isExplosiveBarrel, RED_BARREL_KIND
} from "./explosive-barrel.js";
import { playBreakableDestroySfx, playBreakableHitSfx } from "./sfx.js";

const MAP_CEILING = 12;
const MAP_WORLD = { w: 3600, h: 1600 };

const GROUND = { x: 0, y: 1420, w: 3600, h: 180 };

/** @param {Partial<{x:number,y:number,w:number,h:number,blocksSight?:boolean}>} p */
const plat = (p) => ({ blocksSight: false, ...p });

/** Tall solid stack used as a city wall / building face (blocks LOS). */
const wall = (x, y, w, h) => plat({ x, y, w, h, blocksSight: true });

/**
 * @typedef {{
 *   kind: string,
 *   x: number, y: number, w: number, h: number,
 *   hp: number, maxHp?: number,
 *   solid?: boolean,
 *   blocksProjectiles?: boolean,
 *   blocksSight?: boolean,
 *   breakable?: boolean,
 *   canopy?: { x: number, y: number, w: number, h: number } | null,
 *   hitFlash?: number,
 *   destroyed?: boolean
 * }} MapProp
 */

/** @type {Record<string, Omit<MapProp, 'x'|'y'> & { w: number, h: number }>} */
const PROP_PRESETS = {
  cactus: {
    kind: "cactus", w: 28, h: 72, hp: 45,
    solid: false, blocksProjectiles: true, blocksSight: false, breakable: true
  },
  bush: {
    kind: "bush", w: 48, h: 36, hp: 30,
    solid: false, blocksProjectiles: true, blocksSight: false, breakable: true
  },
  tree: {
    kind: "tree", w: 36, h: 160, hp: 70,
    solid: false, blocksProjectiles: true, blocksSight: false, breakable: true,
    canopy: { x: -40, y: -70, w: 116, h: 78 }
  },
  crate: {
    kind: "crate", w: 44, h: 44, hp: 55,
    solid: true, blocksProjectiles: true, blocksSight: true, breakable: true
  },
  pipe: {
    kind: "pipe", w: 80, h: 22, hp: 40,
    solid: true, blocksProjectiles: true, blocksSight: false, breakable: true
  },
  pillar: {
    kind: "pillar", w: 36, h: 110, hp: 80,
    solid: true, blocksProjectiles: true, blocksSight: true, breakable: true
  },
  barrel: {
    kind: "barrel", w: 34, h: 48, hp: 40,
    solid: true, blocksProjectiles: true, blocksSight: false, breakable: true
  },
  redBarrel: {
    kind: RED_BARREL_KIND, w: 34, h: 48, hp: 40,
    solid: true, blocksProjectiles: true, blocksSight: false, breakable: true,
    explosive: true
  },
  crateStack: {
    kind: "crate", w: 44, h: 88, hp: 90,
    solid: true, blocksProjectiles: true, blocksSight: true, breakable: true
  }
};

/** Breakable kinds that can be conjured at runtime. */
export const MAP_PROP_KINDS = Object.freeze(Object.keys(PROP_PRESETS));

/**
 * @param {keyof typeof PROP_PRESETS} kind
 * @param {number} x
 * @param {number} yBottom bottom resting y (prop.y is top of box)
 */
export function createMapProp(kind, x, yBottom) {
  return prop(kind, x, yBottom);
}

/**
 * @param {keyof typeof PROP_PRESETS} kind
 * @param {number} x
 * @param {number} y bottom-left resting y (prop.y is top of box)
 */
function prop(kind, x, yBottom) {
  const preset = PROP_PRESETS[kind];
  const y = yBottom - preset.h;
  const canopy = preset.canopy
    ? {
      x: x + (preset.canopy.x || 0),
      y: y + (preset.canopy.y || 0),
      w: preset.canopy.w,
      h: preset.canopy.h
    }
    : null;
  const solid = !!preset.solid;
  const blocksProjectiles = preset.blocksProjectiles !== false;
  const blocksSight = !!preset.blocksSight;
  return {
    kind: preset.kind,
    x,
    y,
    w: preset.w,
    h: preset.h,
    hp: preset.hp,
    maxHp: preset.hp,
    solid,
    blocksProjectiles,
    blocksSight,
    baseSolid: solid,
    baseBlocksProjectiles: blocksProjectiles,
    baseBlocksSight: blocksSight,
    breakable: preset.breakable !== false,
    explosive: !!preset.explosive,
    canopy,
    hitFlash: 0,
    destroyed: false,
    groundDebrisDropped: false
  };
}

const BATTLEFIELD_PLATFORMS = [
  GROUND,
  plat({ x: 180, y: 1190, w: 500, h: 26 }),
  plat({ x: 800, y: 1030, w: 430, h: 26 }),
  plat({ x: 1350, y: 1240, w: 500, h: 26 }),
  plat({ x: 1950, y: 980, w: 480, h: 26 }),
  plat({ x: 2580, y: 1190, w: 460, h: 26 }),
  plat({ x: 3150, y: 930, w: 350, h: 26 }),
  plat({ x: 520, y: 760, w: 330, h: 24 }),
  plat({ x: 1200, y: 690, w: 420, h: 24 }),
  plat({ x: 1840, y: 570, w: 380, h: 24 }),
  plat({ x: 2440, y: 720, w: 390, h: 24 }),
  plat({ x: 2950, y: 510, w: 390, h: 24 }),
  plat({ x: 80, y: 430, w: 300, h: 24 })
];

const DEFAULT_SPAWNS = {
  training: {
    player: { x: 360, y: 1300 },
    buddy: { x: 2860, y: 1100 }
  },
  conquest: {
    player: { x: 360, y: 1300 },
    buddy: { x: 580, y: 1300 },
    enemy1: { x: 2920, y: 1300 },
    enemy2: { x: 3150, y: 1300 }
  }
};

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   theme: string,
 *   blurb: string,
 *   unlocked: boolean,
 *   platforms: object[],
 *   props: MapProp[],
 *   spawnPoints: typeof DEFAULT_SPAWNS,
 *   ceiling: number,
 *   groundStyle: string,
 *   backdrop: { sky: string, mid: string, accent: string, pattern: string }
 * }} ArenaMap
 */

/** @type {ArenaMap[]} */
export const MAPS = Object.freeze([
  Object.freeze({
    id: "battlefield",
    name: "Battlefield",
    theme: "battlefield",
    blurb: "Open combat platforms — watch for crosswind gusts.",
    unlocked: true,
    platforms: BATTLEFIELD_PLATFORMS,
    props: [],
    spawnPoints: DEFAULT_SPAWNS,
    ceiling: MAP_CEILING,
    groundStyle: "plated",
    backdrop: {
      sky: "#08161f", mid: "#173542", accent: "#304b59", pattern: "grid"
    }
  }),

  Object.freeze({
    id: "city",
    name: "City",
    theme: "city",
    blurb: "Rooftops and alley gaps — freight elevators shift mid-fight.",
    unlocked: true,
    platforms: [
      GROUND,
      // Left tower stack
      wall(120, 980, 220, 440),
      plat({ x: 100, y: 980, w: 280, h: 24 }),
      plat({ x: 140, y: 760, w: 200, h: 24 }),
      plat({ x: 160, y: 540, w: 180, h: 24 }),
      plat({ x: 180, y: 340, w: 160, h: 24 }),
      // Mid alley ledges
      plat({ x: 520, y: 1180, w: 180, h: 24 }),
      plat({ x: 780, y: 1020, w: 200, h: 24 }),
      plat({ x: 1080, y: 860, w: 220, h: 24 }),
      plat({ x: 1380, y: 700, w: 200, h: 24 }),
      // Center towers
      wall(1680, 900, 200, 520),
      plat({ x: 1660, y: 900, w: 240, h: 24 }),
      plat({ x: 1700, y: 680, w: 180, h: 24 }),
      plat({ x: 1720, y: 460, w: 160, h: 24 }),
      // Right alley + tower
      plat({ x: 2100, y: 1100, w: 220, h: 24 }),
      plat({ x: 2420, y: 940, w: 200, h: 24 }),
      plat({ x: 2720, y: 780, w: 220, h: 24 }),
      wall(3080, 720, 240, 700),
      plat({ x: 3060, y: 720, w: 280, h: 24 }),
      plat({ x: 3100, y: 500, w: 200, h: 24 }),
      plat({ x: 3120, y: 300, w: 180, h: 24 })
    ],
    props: [
      prop("crate", 540, 1180),
      prop("crate", 2140, 1100),
      prop("barrel", 1120, 860),
      prop("redBarrel", 2460, 940)
    ],
    spawnPoints: {
      training: {
        player: { x: 400, y: 1300 },
        buddy: { x: 2900, y: 1300 }
      },
      conquest: {
        player: { x: 380, y: 1300 },
        buddy: { x: 560, y: 1300 },
        enemy1: { x: 2880, y: 1300 },
        enemy2: { x: 3100, y: 1300 }
      }
    },
    ceiling: MAP_CEILING,
    groundStyle: "concrete",
    backdrop: {
      sky: "#121820", mid: "#2a3340", accent: "#4a5568", pattern: "skyline"
    }
  }),

  Object.freeze({
    id: "desert",
    name: "Desert",
    theme: "desert",
    blurb: "Hilled dunes — sandstorms choke sight between fights.",
    unlocked: true,
    platforms: [
      GROUND,
      // Uneven hills / dune shelves
      plat({ x: 0, y: 1360, w: 520, h: 60 }),
      plat({ x: 480, y: 1280, w: 420, h: 40 }),
      plat({ x: 860, y: 1200, w: 380, h: 36 }),
      plat({ x: 1200, y: 1320, w: 500, h: 50 }),
      plat({ x: 1680, y: 1180, w: 360, h: 40 }),
      plat({ x: 2000, y: 1280, w: 480, h: 45 }),
      plat({ x: 2440, y: 1160, w: 400, h: 38 }),
      plat({ x: 2800, y: 1260, w: 420, h: 42 }),
      plat({ x: 3180, y: 1140, w: 420, h: 36 }),
      // High mesa shelves
      plat({ x: 300, y: 980, w: 280, h: 26 }),
      plat({ x: 900, y: 860, w: 320, h: 26 }),
      plat({ x: 1500, y: 740, w: 300, h: 26 }),
      plat({ x: 2100, y: 880, w: 340, h: 26 }),
      plat({ x: 2700, y: 700, w: 300, h: 26 }),
      plat({ x: 3200, y: 820, w: 280, h: 26 }),
      plat({ x: 600, y: 560, w: 260, h: 24 }),
      plat({ x: 1800, y: 500, w: 280, h: 24 }),
      plat({ x: 2500, y: 420, w: 260, h: 24 })
    ],
    props: [
      prop("cactus", 220, 1360),
      prop("bush", 620, 1280),
      prop("cactus", 980, 1200),
      prop("bush", 1400, 1320),
      prop("cactus", 1760, 1180),
      prop("bush", 2200, 1280),
      prop("cactus", 2560, 1160),
      prop("bush", 2920, 1260),
      prop("cactus", 3320, 1140),
      prop("bush", 380, 980),
      prop("cactus", 1020, 860),
      prop("bush", 2180, 880),
      prop("cactus", 2780, 700)
    ],
    spawnPoints: DEFAULT_SPAWNS,
    ceiling: MAP_CEILING,
    groundStyle: "sand",
    backdrop: {
      sky: "#2a2218", mid: "#c4a574", accent: "#8a7048", pattern: "dunes"
    }
  }),

  Object.freeze({
    id: "forest",
    name: "Forest",
    theme: "forest",
    blurb: "Walk-through trees — canopy drops crash down without warning.",
    unlocked: true,
    platforms: [
      GROUND,
      plat({ x: 200, y: 1180, w: 420, h: 26 }),
      plat({ x: 760, y: 1040, w: 380, h: 26 }),
      plat({ x: 1280, y: 1220, w: 460, h: 26 }),
      plat({ x: 1860, y: 960, w: 400, h: 26 }),
      plat({ x: 2400, y: 1140, w: 420, h: 26 }),
      plat({ x: 2980, y: 900, w: 380, h: 26 }),
      plat({ x: 480, y: 740, w: 300, h: 24 }),
      plat({ x: 1100, y: 660, w: 360, h: 24 }),
      plat({ x: 1720, y: 560, w: 340, h: 24 }),
      plat({ x: 2320, y: 700, w: 320, h: 24 }),
      plat({ x: 2900, y: 480, w: 340, h: 24 }),
      plat({ x: 100, y: 420, w: 280, h: 24 })
    ],
    props: [
      prop("tree", 280, 1420),
      prop("tree", 520, 1420),
      prop("tree", 900, 1420),
      prop("tree", 1180, 1420),
      prop("tree", 1600, 1420),
      prop("tree", 2040, 1420),
      prop("tree", 2480, 1420),
      prop("tree", 2860, 1420),
      prop("tree", 3300, 1420),
      prop("tree", 320, 1180),
      prop("tree", 860, 1040),
      prop("tree", 1400, 1220),
      prop("tree", 1980, 960),
      prop("tree", 2520, 1140),
      prop("tree", 3080, 900),
      prop("tree", 560, 740),
      prop("tree", 1200, 660),
      prop("tree", 1820, 560)
    ],
    spawnPoints: DEFAULT_SPAWNS,
    ceiling: MAP_CEILING,
    groundStyle: "moss",
    backdrop: {
      sky: "#0a1610", mid: "#1a3a28", accent: "#2d5a3c", pattern: "canopy"
    }
  }),

  Object.freeze({
    id: "yard",
    name: "Yard",
    theme: "industrial",
    blurb: "Industrial yard — steam vents blast fighters skyward.",
    unlocked: true,
    platforms: [
      GROUND,
      plat({ x: 160, y: 1200, w: 460, h: 28 }),
      plat({ x: 720, y: 1060, w: 400, h: 28 }),
      plat({ x: 1240, y: 1220, w: 480, h: 28 }),
      plat({ x: 1840, y: 1000, w: 440, h: 28 }),
      plat({ x: 2420, y: 1180, w: 420, h: 28 }),
      plat({ x: 3000, y: 940, w: 400, h: 28 }),
      plat({ x: 400, y: 780, w: 320, h: 24 }),
      plat({ x: 1000, y: 680, w: 360, h: 24 }),
      plat({ x: 1600, y: 580, w: 340, h: 24 }),
      plat({ x: 2200, y: 720, w: 360, h: 24 }),
      plat({ x: 2800, y: 520, w: 360, h: 24 }),
      plat({ x: 80, y: 480, w: 280, h: 24 })
    ],
    props: [
      prop("crate", 220, 1200),
      prop("crateStack", 320, 1200),
      prop("pipe", 780, 1060),
      prop("barrel", 900, 1060),
      prop("redBarrel", 980, 1060),
      prop("crate", 1320, 1220),
      prop("crate", 1480, 1220),
      prop("pipe", 1900, 1000),
      prop("crateStack", 2100, 1000),
      prop("barrel", 2500, 1180),
      prop("crate", 2680, 1180),
      prop("pipe", 3080, 940),
      prop("crate", 440, 780),
      prop("barrel", 1080, 680),
      prop("redBarrel", 2860, 520),
      prop("crateStack", 1700, 580),
      prop("pipe", 2280, 720)
    ],
    spawnPoints: DEFAULT_SPAWNS,
    ceiling: MAP_CEILING,
    groundStyle: "grate",
    backdrop: {
      sky: "#14110e", mid: "#3a342c", accent: "#6a5a40", pattern: "pipes"
    }
  }),

  Object.freeze({
    id: "ruins",
    name: "Ruins",
    theme: "ruins",
    blurb: "Broken pillars — stand too long and ledges crumble away.",
    unlocked: true,
    platforms: [
      GROUND,
      plat({ x: 80, y: 1240, w: 280, h: 26 }),
      plat({ x: 480, y: 1080, w: 200, h: 26 }),
      plat({ x: 820, y: 1280, w: 360, h: 26 }),
      plat({ x: 1280, y: 980, w: 240, h: 26 }),
      plat({ x: 1640, y: 1180, w: 420, h: 26 }),
      plat({ x: 2180, y: 900, w: 280, h: 26 }),
      plat({ x: 2580, y: 1120, w: 320, h: 26 }),
      plat({ x: 3020, y: 980, w: 360, h: 26 }),
      plat({ x: 200, y: 720, w: 220, h: 24 }),
      plat({ x: 700, y: 620, w: 180, h: 24 }),
      plat({ x: 1100, y: 780, w: 260, h: 24 }),
      plat({ x: 1600, y: 540, w: 200, h: 24 }),
      plat({ x: 2000, y: 680, w: 240, h: 24 }),
      plat({ x: 2500, y: 480, w: 220, h: 24 }),
      plat({ x: 2900, y: 620, w: 280, h: 24 }),
      plat({ x: 3300, y: 400, w: 200, h: 24 })
    ],
    props: [
      prop("pillar", 140, 1240),
      prop("pillar", 900, 1280),
      prop("pillar", 1720, 1180),
      prop("pillar", 2260, 900),
      prop("pillar", 2680, 1120),
      prop("pillar", 3140, 980),
      prop("pillar", 260, 720),
      prop("pillar", 1180, 780),
      prop("pillar", 2080, 680),
      prop("crate", 520, 1080),
      prop("barrel", 1320, 980)
    ],
    spawnPoints: DEFAULT_SPAWNS,
    ceiling: MAP_CEILING,
    groundStyle: "stone",
    backdrop: {
      sky: "#1a1518", mid: "#4a3e48", accent: "#7a6a72", pattern: "ruins"
    }
  }),

  Object.freeze({
    id: "docks",
    name: "Docks",
    theme: "docks",
    blurb: "Long piers — rising tide floods the gaps (and the edges).",
    unlocked: true,
    platforms: [
      // No continuous ground — pit hazard between piers (fall = death via WORLD.h)
      plat({ x: 0, y: 1380, w: 520, h: 40 }),
      plat({ x: 640, y: 1380, w: 480, h: 40 }),
      plat({ x: 1240, y: 1380, w: 520, h: 40 }),
      plat({ x: 1880, y: 1380, w: 480, h: 40 }),
      plat({ x: 2480, y: 1380, w: 520, h: 40 }),
      plat({ x: 3120, y: 1380, w: 480, h: 40 }),
      // Upper pier levels
      plat({ x: 80, y: 1120, w: 360, h: 26 }),
      plat({ x: 560, y: 1000, w: 400, h: 26 }),
      plat({ x: 1100, y: 1120, w: 380, h: 26 }),
      plat({ x: 1620, y: 960, w: 420, h: 26 }),
      plat({ x: 2180, y: 1100, w: 400, h: 26 }),
      plat({ x: 2720, y: 940, w: 380, h: 26 }),
      plat({ x: 3200, y: 1080, w: 320, h: 26 }),
      plat({ x: 300, y: 760, w: 300, h: 24 }),
      plat({ x: 900, y: 680, w: 320, h: 24 }),
      plat({ x: 1500, y: 720, w: 340, h: 24 }),
      plat({ x: 2100, y: 640, w: 300, h: 24 }),
      plat({ x: 2700, y: 700, w: 320, h: 24 }),
      plat({ x: 100, y: 480, w: 260, h: 24 }),
      plat({ x: 1800, y: 460, w: 280, h: 24 }),
      plat({ x: 3000, y: 500, w: 280, h: 24 })
    ],
    props: [
      prop("crate", 120, 1380),
      prop("barrel", 720, 1380),
      prop("crate", 1400, 1380),
      prop("barrel", 2000, 1380),
      prop("redBarrel", 2080, 1380),
      prop("crate", 2600, 1380),
      prop("barrel", 3200, 1380),
      prop("crate", 160, 1120),
      prop("pipe", 600, 1000),
      prop("crate", 1700, 960),
      prop("barrel", 2260, 1100)
    ],
    spawnPoints: {
      training: {
        player: { x: 180, y: 1280 },
        buddy: { x: 3200, y: 1280 }
      },
      conquest: {
        player: { x: 160, y: 1280 },
        buddy: { x: 320, y: 1280 },
        enemy1: { x: 3000, y: 1280 },
        enemy2: { x: 3220, y: 1280 }
      }
    },
    ceiling: MAP_CEILING,
    groundStyle: "wood",
    backdrop: {
      sky: "#0c1824", mid: "#1a4060", accent: "#3a6a8a", pattern: "water"
    }
  })
]);

export const MAP_BY_ID = Object.freeze(
  Object.fromEntries(MAPS.map((map) => [map.id, map]))
);

/**
 * Metal power-up crate spawn anchors (x, yBottom) and abundance per map.
 * Densities: Forest/Yard high; Battlefield/Ruins/Docks medium; City sparse rooftops.
 */
export const POWER_CRATE_MAP = Object.freeze({
  battlefield: { density: 0.55, maxConcurrent: 3 },
  city: { density: 0.35, maxConcurrent: 2 },
  desert: { density: 0.5, maxConcurrent: 3 },
  forest: { density: 0.75, maxConcurrent: 4 },
  yard: { density: 0.8, maxConcurrent: 4 },
  ruins: { density: 0.55, maxConcurrent: 3 },
  docks: { density: 0.5, maxConcurrent: 3 }
});

export const POWER_CRATE_SPAWNS = Object.freeze({
  battlefield: [
    { x: 420, y: 1190 }, { x: 980, y: 1030 }, { x: 1550, y: 1240 },
    { x: 2100, y: 980 }, { x: 2700, y: 1190 }, { x: 700, y: 760 },
    { x: 1400, y: 690 }, { x: 2550, y: 720 }, { x: 1800, y: 1420 }
  ],
  city: [
    { x: 560, y: 1180 }, { x: 820, y: 1020 }, { x: 1120, y: 860 },
    { x: 1420, y: 700 }, { x: 2140, y: 1100 }, { x: 2460, y: 940 },
    { x: 1760, y: 900 }, { x: 320, y: 1420 }
  ],
  desert: [
    { x: 700, y: 1280 }, { x: 1100, y: 1200 }, { x: 1600, y: 1320 },
    { x: 2300, y: 1280 }, { x: 500, y: 980 }, { x: 1000, y: 860 },
    { x: 2200, y: 880 }, { x: 1900, y: 500 }, { x: 2800, y: 700 }
  ],
  forest: [
    { x: 380, y: 1180 }, { x: 900, y: 1040 }, { x: 1450, y: 1220 },
    { x: 2000, y: 960 }, { x: 2550, y: 1140 }, { x: 600, y: 740 },
    { x: 1250, y: 660 }, { x: 1900, y: 560 }, { x: 700, y: 1420 },
    { x: 1800, y: 1420 }, { x: 3100, y: 900 }
  ],
  yard: [
    { x: 500, y: 1200 }, { x: 900, y: 1060 }, { x: 1550, y: 1220 },
    { x: 2000, y: 1000 }, { x: 2550, y: 1180 }, { x: 600, y: 780 },
    { x: 1200, y: 680 }, { x: 2400, y: 720 }, { x: 1100, y: 1420 },
    { x: 1900, y: 1420 }, { x: 2900, y: 520 }
  ],
  ruins: [
    { x: 200, y: 1240 }, { x: 560, y: 1080 }, { x: 980, y: 1280 },
    { x: 1380, y: 980 }, { x: 1800, y: 1180 }, { x: 2320, y: 900 },
    { x: 2800, y: 1120 }, { x: 800, y: 620 }, { x: 1700, y: 540 },
    { x: 2600, y: 480 }
  ],
  docks: [
    { x: 280, y: 1380 }, { x: 800, y: 1380 }, { x: 1500, y: 1380 },
    { x: 2100, y: 1380 }, { x: 2800, y: 1380 }, { x: 200, y: 1120 },
    { x: 700, y: 1000 }, { x: 1800, y: 960 }, { x: 2300, y: 1100 },
    { x: 1000, y: 680 }, { x: 2200, y: 640 }
  ]
});

/** Classic arena platforms (Battlefield) — kept for callers that need a static list. */
export const PLATFORMS = BATTLEFIELD_PLATFORMS;

export function getMap(id) {
  return MAP_BY_ID[id] || MAP_BY_ID.battlefield;
}

export function listMaps() {
  return MAPS.slice();
}

export function unlockedMaps() {
  return MAPS.filter((map) => map.unlocked);
}

/** Pick a random unlocked map id. */
export function pickRandomMapId(random = Math.random) {
  const pool = unlockedMaps();
  return pool[Math.floor(random() * pool.length) % pool.length].id;
}

/**
 * Deep-clone map geometry into a per-match runtime (mutable props with HP).
 * @param {string} mapId
 */
export function createMapRuntime(mapId) {
  const template = getMap(mapId);
  return {
    id: template.id,
    name: template.name,
    theme: template.theme,
    blurb: template.blurb,
    platforms: template.platforms.map((p) => ({ ...p })),
    props: template.props.map((p) => ({
      ...p,
      canopy: p.canopy ? { ...p.canopy } : null,
      hp: p.maxHp ?? p.hp,
      maxHp: p.maxHp ?? p.hp,
      solid: p.baseSolid ?? p.solid,
      blocksProjectiles: p.baseBlocksProjectiles ?? p.blocksProjectiles,
      blocksSight: p.baseBlocksSight ?? p.blocksSight,
      baseSolid: p.baseSolid ?? !!p.solid,
      baseBlocksProjectiles: p.baseBlocksProjectiles ?? p.blocksProjectiles !== false,
      baseBlocksSight: p.baseBlocksSight ?? !!p.blocksSight,
      hitFlash: 0,
      destroyed: false,
      groundDebrisDropped: false
    })),
    spawnPoints: structuredClone
      ? structuredClone(template.spawnPoints)
      : JSON.parse(JSON.stringify(template.spawnPoints)),
    ceiling: template.ceiling ?? MAP_CEILING,
    groundStyle: template.groundStyle,
    backdrop: { ...template.backdrop },
    world: { w: MAP_WORLD.w, h: MAP_WORLD.h },
    powerCrateSpawns: (POWER_CRATE_SPAWNS[template.id] || POWER_CRATE_SPAWNS.battlefield)
      .map((s) => ({ ...s })),
    powerCrateConfig: { ...(POWER_CRATE_MAP[template.id] || POWER_CRATE_MAP.battlefield) }
  };
}

/** Platforms standing on for a live game (or Battlefield fallback). */
export function platformsOf(game) {
  return game?.platforms?.length ? game.platforms : PLATFORMS;
}

/** Intact props that still block projectiles. */
export function projectileBlockers(game) {
  const props = game?.props || [];
  return props.filter(
    (p) => !p.destroyed
      && p.blocksProjectiles
      && !p.thrownInFlight
      && !p.illusionGhosted
      && !p.forgeHidden
      && (p.hp == null || p.hp > 0)
  );
}

/** Intact solid props that block fighter feet / walls. */
export function solidProps(game) {
  const props = game?.props || [];
  return props.filter(
    (p) => !p.destroyed
      && p.solid
      && !p.illusionGhosted
      && !p.forgeHidden
      && (p.hp == null || p.hp > 0)
  );
}

/** Geometry that hard-blocks team vision (walls + sight-blocking props). */
export function sightBlockers(game) {
  const platforms = platformsOf(game).filter((p) => p.blocksSight);
  const props = [];
  for (const p of game?.props || []) {
    if (p.destroyed || p.illusionGhosted || p.forgeHidden) continue;
    if (!p.blocksSight || (p.hp != null && !(p.hp > 0))) continue;
    // Light Condensation: LOS uses an inflated glare box, not the tiny sprite.
    if (p.lightCondensation || p.kind === "lightCondensation") {
      const side = p.sightBlockSide
        || Math.max(p.w || 14, (p.w || 14) * 20);
      const cx = p.x + (p.w || 0) / 2;
      const cy = p.y + (p.h || 0) / 2;
      props.push({
        x: cx - side / 2,
        y: cy - side / 2,
        w: side,
        h: side,
        blocksSight: true,
        lightCondensation: true
      });
      continue;
    }
    props.push(p);
  }
  return [...platforms, ...props];
}

/**
 * Apply damage to a breakable prop. Returns true if the prop absorbed the hit
 * (projectile should stop). Emits crack/debris effects on the game.
 * Braced props spend metal casing HP before the wood core.
 */
export function damageProp(prop, amount, game, impactX, impactY) {
  if (!prop || prop.destroyed || !prop.breakable) return false;
  let left = Math.max(0, amount);
  const ix = impactX ?? prop.x + prop.w / 2;
  const iy = impactY ?? prop.y + prop.h / 2;
  if (prop.braced && (prop.braceHp || 0) > 0 && left > 0) {
    const absorbed = Math.min(prop.braceHp, left);
    prop.braceHp -= absorbed;
    left -= absorbed;
    prop.hitFlash = 0.14;
    if (game?.effects) {
      game.effects.push({
        type: "propHit",
        x: ix,
        y: iy,
        life: 0.1
      });
    }
    if (prop.braceHp <= 0) {
      prop.braced = false;
      prop.braceHp = 0;
      if (game?.effects) {
        game.effects.push({
          type: "crateBreak",
          x: ix,
          y: iy,
          life: 0.22,
          color: "#d8e0ea"
        });
      }
    }
    if (left <= 0) {
      playBreakableHitSfx();
      return true;
    }
  }
  prop.hp = Math.max(0, (prop.hp ?? prop.maxHp ?? 1) - left);
  prop.hitFlash = .14;
  if (game?.effects) {
    game.effects.push({
      type: "propHit",
      x: ix,
      y: iy,
      life: .12
    });
  }
  if (prop.hp <= 0) {
    prop.destroyed = true;
    prop.braced = false;
    prop.braceHp = 0;
    prop.solid = false;
    prop.blocksProjectiles = false;
    prop.blocksSight = false;
    if (game?.effects) {
      game.effects.push({
        type: "debris",
        x: ix,
        y: iy,
        life: .45,
        kind: prop.kind,
        w: prop.w,
        h: prop.h
      });
    }
    spawnPropDebris(game, prop, ix, iy);
    const explosive = isExplosiveBarrel(prop);
    playBreakableDestroySfx({ explosive });
    if (explosive) {
      detonateExplosiveBarrel(prop, game, ix, iy, damageProp);
    }
  } else {
    playBreakableHitSfx();
  }
  return true;
}
