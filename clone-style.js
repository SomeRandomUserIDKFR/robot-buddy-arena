export const CLONE_STYLE_SAMPLE_SECONDS = .1;
export const CLONE_STYLE_MAX_CONTEXTS = 64;
export const CLONE_STYLE_MAX_COMBOS = 64;
export const CLONE_STYLE_ACTIONS = [
  "attack", "dodge", "jump", "jet", "shield", "armor", "nano", "recall",
  "chuck", "eject", "secondary", "form"
];
const MODES = ["sword", "shield", "rifle", "sniper"];
const validatedStyles = new WeakSet();

export function normalizeCloneBehavior(value) {
  return value === "generic" ? "generic" : "imitation";
}

export function freshCloneStyle() {
  return { version: 1, seconds: 0, contexts: {}, combos: [] };
}

function finite(value, max = 3600) {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : 0;
}

export function ensureCloneStyle(profile) {
  const old = profile.cloneStyle;
  if (old?.version === 1 && validatedStyles.has(old)) return old;
  const style = freshCloneStyle();
  style.seconds = finite(old?.seconds, 1e9);
  for (const [key, entry] of Object.entries(old?.contexts || {}).slice(-CLONE_STYLE_MAX_CONTEXTS)) {
    if (!entry || !/^(gun|saber)\|(near|mid|far|none)\|(hurt|healthy)\|(threat|calm)\|(air|ground)$/.test(key)) continue;
    const row = {
      seconds: finite(entry.seconds), actions: {}, opportunities: {}, events: {},
      move: { toward: finite(entry.move?.toward), away: finite(entry.move?.away), still: finite(entry.move?.still) },
      modular: {}, adaptive: {}
    };
    for (const action of CLONE_STYLE_ACTIONS) {
      row.actions[action] = finite(entry.actions?.[action]);
      row.opportunities[action] = finite(entry.opportunities?.[action]);
      row.events[action] = finite(entry.events?.[action]);
    }
    for (const mode of MODES) {
      row.modular[mode] = finite(entry.modular?.[mode]);
      row.adaptive[mode] = finite(entry.adaptive?.[mode]);
    }
    style.contexts[key] = row;
  }
  style.combos = (Array.isArray(old?.combos) ? old.combos : [])
    .filter((combo) => combo && Object.hasOwn(style.contexts, combo.context)
      && CLONE_STYLE_ACTIONS.includes(combo.from) && CLONE_STYLE_ACTIONS.includes(combo.to)
      && ["quick", "short", "long"].includes(combo.delay))
    .slice(-CLONE_STYLE_MAX_COMBOS)
    .map((combo) => ({ context: combo.context, from: combo.from, to: combo.to,
      delay: combo.delay, count: finite(combo.count), starts: finite(combo.starts) }));
  validatedStyles.add(style);
  profile.cloneStyle = style;
  return style;
}

export function ownerCloneStyle(owner, profile = null) {
  if (owner.human && profile) owner.cloneStyle = ensureCloneStyle(profile);
  if (!owner.cloneStyle) owner.cloneStyle = freshCloneStyle();
  return owner.cloneStyle;
}

export function bindCloneStyle(owner, clone) {
  clone.cloneBehavior = normalizeCloneBehavior(owner.loadout?.cloneBehavior);
  clone.cloneStyle = ownerCloneStyle(owner);
}

export function noteCloneStyleInput(fighter, action) {
  if (fighter && CLONE_STYLE_ACTIONS.includes(action)) {
    fighter._cloneStyleInputs ||= new Set();
    fighter._cloneStyleInputs.add(action);
  }
}

export function cloneStyleSituation(fighter, visible, { target: selected, hp = fighter.hp } = {}) {
  const foes = visible.filter((foe) => foe && !foe.dead && foe.team !== fighter.team && !foe.disguiseProp);
  const target = selected !== undefined ? selected : foes.reduce((best, foe) => !best
    || Math.hypot(foe.x - fighter.x, foe.y - fighter.y) < Math.hypot(best.x - fighter.x, best.y - fighter.y)
    ? foe : best, null);
  const distance = target ? Math.hypot(target.x - fighter.x, target.y - fighter.y) : Infinity;
  const range = !target ? "none" : distance < 180 ? "near" : distance < 600 ? "mid" : "far";
  const hurt = hp < fighter.maxHp * .4 ? "hurt" : "healthy";
  const threat = foes.some((foe) => foe.weapon === "saber"
    && Math.hypot(foe.x - fighter.x, foe.y - fighter.y) < 240)
    || (fighter.hitFlash || 0) > 0;
  return { target, key: `${fighter.weapon === "saber" ? "saber" : "gun"}|${range}|${hurt}|${threat ? "threat" : "calm"}|${fighter.grounded ? "ground" : "air"}` };
}

function emptyRow() {
  const actions = () => Object.fromEntries(CLONE_STYLE_ACTIONS.map((action) => [action, 0]));
  const modes = () => Object.fromEntries(MODES.map((mode) => [mode, 0]));
  return { seconds: 0, actions: actions(), opportunities: actions(), events: actions(),
    move: { toward: 0, away: 0, still: 0 }, modular: modes(), adaptive: modes() };
}

export function recordCloneStyle(fighter, intent, dt, game, profile, visible, hp = fighter?.hp) {
  if (!fighter || fighter.combatClone || fighter.illusion || fighter.dead || game.paused || game.over) return;
  const style = ownerCloneStyle(fighter, profile);
  const inputs = fighter._cloneStyleInputs || new Set();
  fighter._cloneStyleInputs = null;
  if (game.learningLocked || profile?.learningLocked || !(dt > 0)) return;
  const situation = cloneStyleSituation(fighter, visible, { hp });
  const runtime = fighter._cloneStyleRecorder ||= { acc: 0, previous: {}, last: null, frames: [] };
  const active = {
    attack: !!intent.attack, dodge: !!intent.dodge || inputs.has("dodge"),
    jump: !!intent.jump && fighter.grounded, jet: !!(intent.jetHeld ?? intent.jet),
    shield: !!fighter.shieldRaised, armor: !!fighter.retractableDeployed || fighter.retractableMorphTo === "on",
    nano: inputs.has("nano") || (fighter.nanobotArmor || 0) > (runtime.nanoArmor || 0),
    recall: !!fighter.nanotechChanneling,
    chuck: !!intent.chuck, eject: !!intent.ejectVacuum,
    secondary: fighter.activeWeaponSlot === "secondaryWeapon", form: (fighter.nanobotWeapon || 0) > 0
  };
  const available = {
    attack: true, dodge: (fighter.dodgeCd || 0) <= 0 || active.dodge,
    jump: !!fighter.grounded, jet: true,
    shield: (fighter.shieldMaxDurability || 0) > 0, armor: (fighter.retractableMax || 0) > 0,
    nano: !!fighter.hasNanotechChestplate, recall: !!fighter.hasNanotechChestplate,
    chuck: !!fighter.materialConsumer, eject: !!fighter.materialConsumer,
    secondary: fighter.loadout?.secondaryWeapon !== "no-secondary" && !!fighter.loadout?.secondaryWeapon,
    form: (fighter.nanotechWeaponCost || 0) > 0
  };
  const row = style.contexts[situation.key] ||= emptyRow();
  const now = game.elapsed || 0;
  for (const action of CLONE_STYLE_ACTIONS) {
    if (inputs.has(action) || (active[action] && (!runtime.previous[action] || action === "nano"))) {
      row.events[action] = (row.events[action] || 0) + 1;
      const last = runtime.last;
      if (last && last.action !== action && now - last.at > 0 && now - last.at <= 2.5) {
        const gap = now - last.at;
        const delay = gap < .35 ? "quick" : gap < 1 ? "short" : "long";
        let combo = style.combos.find((c) => c.context === last.context
          && c.from === last.action && c.to === action && c.delay === delay);
        if (!combo) {
          combo = { context: last.context, from: last.action, to: action, delay, count: 0, starts: 0 };
          style.combos.push(combo);
        }
        combo.count = Math.min(3600, combo.count + 1);
        combo.starts = Math.max(combo.count, style.contexts[last.context]?.events[last.action] || 1);
      }
      runtime.last = { action, at: now, context: situation.key };
    }
  }
  runtime.acc += dt;
  const direction = Math.sign((situation.target?.x ?? fighter.x + (fighter.facing || 1)) - fighter.x);
  const movement = !intent.mx ? "still" : Math.sign(intent.mx) === direction ? "toward" : "away";
  runtime.frames.push({ row, active, available, dt, movement,
    modular: fighter.modularWeapon ? fighter.modularMode : null,
    adaptive: fighter.adaptiveNanotechWeapon ? fighter.adaptiveMode : null });
  if (runtime.acc >= CLONE_STYLE_SAMPLE_SECONDS) {
    runtime.acc = 0;
    for (const frame of runtime.frames) {
      const sample = frame.row;
      if (sample.seconds > 120) {
        sample.seconds *= .99;
        for (const map of [sample.actions, sample.opportunities, sample.events, sample.move, sample.modular, sample.adaptive]) {
          for (const key of Object.keys(map)) map[key] *= .99;
        }
      }
      sample.seconds += frame.dt;
      style.seconds += frame.dt;
      for (const action of CLONE_STYLE_ACTIONS) {
        if (frame.available[action]) sample.opportunities[action] = (sample.opportunities[action] || 0) + frame.dt;
        if (frame.active[action]) sample.actions[action] = (sample.actions[action] || 0) + frame.dt;
      }
      sample.move[frame.movement] += frame.dt;
      if (MODES.includes(frame.modular)) {
        sample.modular[frame.modular] = (sample.modular[frame.modular] || 0) + frame.dt;
      }
      if (MODES.includes(frame.adaptive)) {
        sample.adaptive[frame.adaptive] = (sample.adaptive[frame.adaptive] || 0) + frame.dt;
      }
    }
    runtime.frames = [];
  }
  runtime.previous = active;
  runtime.nanoArmor = fighter.nanobotArmor || 0;
  while (Object.keys(style.contexts).length > CLONE_STYLE_MAX_CONTEXTS) {
    delete style.contexts[Object.keys(style.contexts)[0]];
  }
  style.combos = style.combos.filter((combo) => Object.hasOwn(style.contexts, combo.context)).slice(-CLONE_STYLE_MAX_COMBOS);
}

export function learnedCloneRow(style, key) {
  if (!style) return null;
  if (style.contexts[key]?.seconds > 0) return style.contexts[key];
  const parts = key.split("|");
  const entries = Object.entries(style.contexts).filter(([context, row]) =>
    row.seconds > 0 && context.startsWith(`${parts[0]}|`));
  entries.sort(([a], [b]) => {
    const score = (value) => value.split("|").reduce((n, part, i) => n + (part === parts[i] ? 1 : 0), 0);
    return score(b) - score(a);
  });
  return entries[0]?.[1] || null;
}

export function cloneActionChance(row, action) {
  if (action === "dodge" && row?.events.dodge > 0) return 1;
  return row?.opportunities[action] > 0
    ? Math.min(1, (row.actions[action] || 0) / row.opportunities[action]) : 0;
}

export function cloneStyleNotes(style) {
  const notes = [];
  const entries = Object.entries(style?.contexts || {}).sort(([, a], [, b]) => b.seconds - a.seconds);
  for (const [key, row] of entries.slice(0, 2)) {
    const [, range, health, pressure, height] = key.split("|");
    const context = `${range === "none" ? "without a visible foe" : `at ${range} range`}, ${health}, ${pressure}, ${height}`;
    notes.push(`${context}: dodge ${Math.floor(row.events.dodge || 0)} times across ${Math.floor(row.opportunities.dodge || 0)}s ready; jet held ${Math.round(cloneActionChance(row, "jet") * 100)}% of observed time.`);
  }
  const combo = [...(style?.combos || [])].sort((a, b) => b.count - a.count)[0];
  if (combo) notes.push(`Observed sequence: ${combo.from} then ${combo.to} (${combo.delay} gap, ${Math.floor(combo.count)} observations). Context suggests intent; it is not proof of why.`);
  return notes;
}

export function chooseCloneWeight(weights, random = Math.random) {
  const entries = Object.entries(weights || {}).filter(([, value]) => value > 0);
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  let roll = random() * total;
  for (const [key, value] of entries) {
    roll -= value;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]?.[0] || null;
}
