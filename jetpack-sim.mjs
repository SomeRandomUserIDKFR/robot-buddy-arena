// Headless verification of jetpack fuel rules and the world ceiling.
// Exercises the REAL game code (stepJetFuel / stepFighter / stepBullets),
// not a copy of the math.
import assert from "node:assert/strict";
import {
  CEILING, JET_BURN_TIME, JET_RECHARGE_TIME, JET_RESTART_FUEL, JUMP, SIZE, WORLD
} from "./config.js";
import { Fighter, stepBullets, stepFighter, stepJetFuel } from "./combat.js";

const DT = 1 / 60;

function fuelState() {
  return { fuel: 1, jetLocked: false, jetReleased: true };
}

function makeGame() {
  return {
    mode: "conquest", elapsed: 0, lastShotAtPlayer: -99,
    fighters: [], bullets: [], effects: [], pings: [], stats: {},
    platforms: [], props: [], ceiling: CEILING
  };
}

function makeFighter(options) {
  return new Fighter({ human: true, team: 0, name: "SIM", weapon: "gun", ...options });
}

const intentOf = ({ jet = false, jump = false }) => () => ({
  mx: 0, jump, jet, jetHeld: jet || jump, attack: false, dodge: false
});

// --- 1. Full tank sustains continuous thrust for ~JET_BURN_TIME seconds. ---
{
  const f = fuelState();
  let t = 0;
  while (f.fuel > 0 && t < 10) {
    assert.equal(stepJetFuel(f, true, true, DT), true, "thrust should hold until empty");
    t += DT;
  }
  assert.ok(Math.abs(t - JET_BURN_TIME) < .1, `burn time ${t.toFixed(2)}s should be ~${JET_BURN_TIME}s`);
  assert.equal(f.jetLocked, true, "running dry must engage the lockout");
  console.log(`ok: full tank burns out after ${t.toFixed(2)}s and locks`);
}

// --- 2. Holding thrust at zero: zero thrust pulses, ever. Fuel may recharge
//        but must NOT reactivate while the input stays held. ---
{
  const f = fuelState();
  while (f.fuel > 0) stepJetFuel(f, true, true, DT);
  let pulses = 0;
  for (let t = 0; t < 6; t += DT) {
    if (stepJetFuel(f, true, true, DT)) pulses++;
  }
  assert.equal(pulses, 0, "held thrust after exhaustion must never pulse");
  assert.equal(f.jetLocked, true, "lock persists while the key stays held");
  assert.ok(f.fuel > .9, "fuel recharges during the lockout");
  console.log("ok: holding thrust at zero yields 0 thrust ticks over 6s (fuel recharges, stays locked)");
}

// --- 3. Rapid tapping cannot bypass the lockout: no thrust until fuel has
//        rebuilt to the restart reserve. ---
{
  const f = fuelState();
  while (f.fuel > 0) stepJetFuel(f, true, true, DT);
  let downtime = 0;
  let fuelAtRestart = null;
  for (let frame = 0; frame < 60 * 10; frame++) {
    const held = frame % 6 < 3; // tap: 50ms on, 50ms off
    if (stepJetFuel(f, held, held, DT)) {
      fuelAtRestart = f.fuel + DT / JET_BURN_TIME; // fuel before this tick's burn
      break;
    }
    downtime += DT;
  }
  assert.ok(fuelAtRestart !== null, "jet should eventually re-arm");
  assert.ok(
    fuelAtRestart >= JET_RESTART_FUEL - 1e-9,
    `first thrust at ${(fuelAtRestart * 100).toFixed(1)}% fuel, needs >= ${JET_RESTART_FUEL * 100}%`
  );
  const minDowntime = JET_RESTART_FUEL * JET_RECHARGE_TIME;
  assert.ok(downtime >= minDowntime - .05, `downtime ${downtime.toFixed(2)}s >= ~${minDowntime}s`);
  console.log(`ok: tapping still forces ${downtime.toFixed(2)}s downtime; restarts at ${(fuelAtRestart * 100).toFixed(0)}% fuel`);
}

// --- 4. Release-then-hold re-arms only after the reserve threshold. ---
{
  const f = fuelState();
  while (f.fuel > 0) stepJetFuel(f, true, true, DT);
  stepJetFuel(f, false, false, DT); // single-frame release
  let downtime = DT;
  while (!stepJetFuel(f, true, true, DT)) downtime += DT;
  assert.ok(Math.abs(downtime - JET_RESTART_FUEL * JET_RECHARGE_TIME) < .1,
    `release+hold downtime ${downtime.toFixed(2)}s should be ~${JET_RESTART_FUEL * JET_RECHARGE_TIME}s`);
  console.log(`ok: after release, thrust re-arms after ${downtime.toFixed(2)}s (reserve rebuilt)`);
}

// --- 5. Full recharge from empty takes ~JET_RECHARGE_TIME seconds. ---
{
  const f = fuelState();
  f.fuel = 0;
  let t = 0;
  while (f.fuel < 1 && t < 10) {
    stepJetFuel(f, false, false, DT);
    t += DT;
  }
  assert.ok(Math.abs(t - JET_RECHARGE_TIME) < .1, `recharge ${t.toFixed(2)}s should be ~${JET_RECHARGE_TIME}s`);
  console.log(`ok: empty-to-full recharge takes ${t.toFixed(2)}s`);
}

// --- 6. Full physics: holding jet forever cannot maintain altitude after
//        exhaustion — the fighter falls and never thrusts again. ---
{
  const game = makeGame();
  const f = makeFighter({ x: 100, y: 800, fuel: 1 });
  game.fighters.push(f);
  const intent = intentOf({ jet: true });
  let exhaustedAt = null;
  let yAtExhaustion = null;
  for (let t = 0; t < 10; t += DT) {
    stepFighter(f, DT, game, {}, {}, intent);
    if (exhaustedAt === null && f.jetLocked) {
      exhaustedAt = t;
      yAtExhaustion = f.y;
    } else if (exhaustedAt !== null) {
      assert.equal(f.thrusting, false, "no thrust pulses after exhaustion while held");
      if (t > exhaustedAt + 2) break;
    }
  }
  assert.ok(exhaustedAt !== null, "fighter should exhaust its tank");
  assert.ok(
    f.grounded || f.y > yAtExhaustion + 600,
    "fighter must lose altitude once exhausted (landed or fell >600px)"
  );
  console.log(`ok: after exhaustion at y=${yAtExhaustion.toFixed(0)}, fighter fell to y=${f.y.toFixed(0)} (grounded=${f.grounded})`);
}

// --- 7. Ceiling: a full-tank jump+jet climb from a high platform hits the
//        ceiling, is clamped there without jitter, and never crosses it. ---
{
  const game = makeGame();
  const f = makeFighter({ x: 200, y: 430 - SIZE, fuel: 1 }); // atop platform y=430
  game.fighters.push(f);
  const intent = intentOf({ jet: true, jump: true });
  let minY = Infinity;
  let framesAtCeiling = 0;
  for (let t = 0; t < 4; t += DT) {
    stepFighter(f, DT, game, {}, {}, intent);
    assert.ok(f.y >= CEILING - 1e-9, `fighter crossed the ceiling: y=${f.y}`);
    minY = Math.min(minY, f.y);
    if (f.y === CEILING) framesAtCeiling++;
  }
  assert.equal(minY, CEILING, "climb should reach and ride the ceiling exactly");
  assert.ok(framesAtCeiling > 30, "fighter should rest at the ceiling steadily (no jitter)");
  console.log(`ok: ceiling holds at y=${CEILING}; rode it for ${framesAtCeiling} frames without crossing`);
}

// --- 8. Jetpack height capability preserved: jump+jet from the ground floor
//        still reaches the highest platform (y=430) on one tank. ---
{
  const game = makeGame();
  const f = makeFighter({ x: 1000, y: 1420 - SIZE, fuel: 1, grounded: true });
  game.fighters.push(f);
  const intent = intentOf({ jet: true, jump: true });
  let minY = Infinity;
  for (let t = 0; t < 5 && !f.jetLocked; t += DT) {
    stepFighter(f, DT, game, {}, {}, intent);
    minY = Math.min(minY, f.y);
  }
  assert.ok(minY <= 430 - SIZE, `full tank should reach the top platform; peaked at y=${minY.toFixed(0)}`);
  console.log(`ok: one tank still climbs from the floor to y=${minY.toFixed(0)} (top platform at ${430 - SIZE})`);
}

// --- 9. Bullets leaving world bounds are removed. ---
{
  const game = makeGame();
  const owner = makeFighter({ team: 0 });
  game.bullets.push(
    { x: 500, y: 60, px: 500, py: 60, vx: 0, vy: -1550, owner, life: .85, traveled: 0 },
    { x: WORLD.w - 20, y: 800, px: WORLD.w - 20, py: 800, vx: 1550, vy: 0, owner, life: .85, traveled: 0 }
  );
  for (let i = 0; i < 6; i++) stepBullets(game, DT);
  assert.equal(game.bullets.length, 0, "out-of-bounds bullets must be culled");
  console.log("ok: bullets exiting the top/side of the world are removed");
}

console.log("\nJetpack + ceiling simulation suite passed.");
