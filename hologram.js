export const HOLOGRAM_ID = "hologram";
export const HOLOGRAM_COOLDOWN = 2.5;
export const HOLOGRAM_MAX_ACTIVE = 2;
export const HOLOGRAM_LIFE = 15;
export const HOLOGRAM_FADE_SECONDS = .35;

export function isHologram(fighter) {
  return !!fighter?.hologram;
}

export function isHologramGear(fighter) {
  return !isHologram(fighter) && (fighter?.hologramGear === true
    || fighter?.loadout?.extensionSecondary === HOLOGRAM_ID);
}

export function fadeHologram(fighter) {
  if (!isHologram(fighter) || fighter.dead) return false;
  fighter.dead = true;
  fighter.hologramFadeLeft = HOLOGRAM_FADE_SECONDS;
  fighter.vx = 0;
  fighter.vy = 0;
  return true;
}

export function hologramOpacity(fighter) {
  if (!isHologram(fighter) || !fighter.dead) return 1;
  const t = Math.max(0, Math.min(1, 1 - (fighter.hologramFadeLeft || 0) / HOLOGRAM_FADE_SECONDS));
  return 1 - t * t * (3 - 2 * t);
}
