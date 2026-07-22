import { SIZE } from "./config.js";

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function dist(a, b) {
  return Math.hypot(
    (a.x + SIZE / 2) - (b.x + SIZE / 2),
    (a.y + SIZE / 2) - (b.y + SIZE / 2)
  );
}

export function angleDiff(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

export function segmentHitsBox(x1, y1, x2, y2, bx, by, bw, bh) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 22);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = lerp(x1, x2, t);
    const y = lerp(y1, y2, t);
    if (x >= bx && x <= bx + bw && y >= by && y <= by + bh) return true;
  }
  return false;
}

export function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

export function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : "Waited";
}

export function thoughtReason(plan) {
  return ({
    "closing safely": "target was visible but outside effective range",
    "covering retreat": "health was low",
    "vertical escape": "a practiced fuel-safe route created separation",
    "pressing target": "weapon range looked favorable",
    "answering ping": "you marked a priority",
    "searching last sighting": "shared vision was lost",
    "debris beam": "scrap ammo was ready for a beam",
    "vacuuming scrap": "the nanobot pool was full near debris",
    "grabbing breakable": "a throwable was in reach",
    "approaching breakable": "cover could be thrown",
    "throwing breakable": "a held prop made a good missile",
    "reconjuring debris": "nearby scrap could be rebuilt",
    "conjuring cover": "a breakable would buy space",
    "condensing light": "a glare spot would reveal or blind the lane",
    "breaking glare": "an enemy light node was cutting vision",
    "setting bear trap": "a mobility lock would pin the lane",
    "laying fake platform": "a false ledge would punish a landing",
    "casting fighter illusion": "a kit-matched decoy would steal focus",
    "casting prop illusion": "a false cover prop would bait shots",
    "casting platform illusion": "a false ledge would waste a landing"
  })[plan] || "no clean engagement was visible";
}

export function escapeHtml(value) {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}
