/**
 * Tiny procedural combat SFX (Web Audio). No asset files.
 * Safe no-op in Node / when muted / before user gesture unlocks audio.
 */

let ctx = null;
let unlocked = false;
let enabled = true;
let masterGain = null;
let masterVolume = 0.55;

/** Shared jetpack loop nodes (filtered noise whoosh — no buzzing oscillator). */
let jetNoiseLow = null;
let jetNoiseHigh = null;
let jetGain = null;
let jetActive = false;

const lastPlayed = Object.create(null);

function canPlay() {
  return enabled && typeof globalThis.AudioContext === "function";
}

function getCtx() {
  if (!canPlay()) return null;
  if (!ctx) {
    try {
      ctx = new globalThis.AudioContext();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  return ctx;
}

function gated(kind, minGap) {
  const now = performance?.now?.() ?? Date.now();
  const prev = lastPlayed[kind] || 0;
  if (now - prev < minGap) return false;
  lastPlayed[kind] = now;
  return true;
}

/** Call from a user gesture so browsers allow audio. */
export function unlockSfx() {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === "suspended") {
    audio.resume().catch(() => {});
  }
  unlocked = true;
}

export function setSfxEnabled(value) {
  enabled = value !== false;
  if (!enabled) setJetpackThrusting(false);
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(enabled ? masterVolume : 0, ctx.currentTime, 0.02);
  }
}

export function isSfxEnabled() {
  return enabled;
}

export function setSfxVolume(value) {
  const n = Number(value);
  masterVolume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.55;
  if (masterGain && ctx && enabled) {
    masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
  }
}

function tone({
  freq = 440,
  freqEnd = null,
  dur = 0.08,
  type = "square",
  vol = 0.2,
  when = 0,
  /** Fraction of `dur` spent swelling in (0 = start at full vol). */
  attack = 0
} = {}) {
  const audio = getCtx();
  if (!audio || !unlocked || !enabled) return;
  const t0 = audio.currentTime + when;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (freqEnd != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  }
  const peak = Math.max(0.0001, vol);
  const attackT = Math.max(0, Math.min(dur * 0.85, dur * attack));
  if (attackT > 0.001) {
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attackT);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  } else {
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Soft band-limited pulse body for gunfire (swell in, ease out). */
function pulseBody({
  freq = 220,
  freqEnd = 110,
  dur = 0.14,
  vol = 0.12,
  when = 0,
  filterFreq = 900
} = {}) {
  const audio = getCtx();
  if (!audio || !unlocked || !enabled) return;
  const t0 = audio.currentTime + when;
  const osc = audio.createOscillator();
  const filter = audio.createBiquadFilter();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
  filter.type = "lowpass";
  filter.Q.value = 0.7;
  filter.frequency.setValueAtTime(filterFreq * 0.55, t0);
  filter.frequency.exponentialRampToValueAtTime(filterFreq, t0 + dur * 0.35);
  filter.frequency.exponentialRampToValueAtTime(filterFreq * 0.35, t0 + dur);
  const peak = Math.max(0.0001, vol);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + dur * 0.28);
  gain.gain.exponentialRampToValueAtTime(peak * 0.55, t0 + dur * 0.55);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noiseBurst({ dur = 0.1, vol = 0.2, filterFreq = 1800, when = 0 } = {}) {
  const audio = getCtx();
  if (!audio || !unlocked || !enabled) return;
  const t0 = audio.currentTime + when;
  const samples = Math.max(1, Math.floor(audio.sampleRate * dur));
  const buffer = audio.createBuffer(1, samples, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / samples);
  }
  const src = audio.createBufferSource();
  src.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(Math.max(0.0001, vol), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

/** Gun / laser fire — soft swell / pulse, not a sharp click. */
export function playShotSfx(opts = {}) {
  if (!gated("shot", opts.hitscan ? 45 : 55)) return;
  if (opts.hitscan) {
    // Soft laser tick: muted hum pulse.
    pulseBody({
      freq: 720, freqEnd: 380, dur: 0.09, vol: 0.055, filterFreq: 1400
    });
    tone({
      freq: 980, freqEnd: 520, dur: 0.07, type: "sine", vol: 0.035, attack: 0.4
    });
    return;
  }
  if (opts.tracer) {
    // Sniper: longer swell + low bloom, light hush of air.
    pulseBody({
      freq: 140, freqEnd: 55, dur: 0.28, vol: 0.16, filterFreq: 520
    });
    tone({
      freq: 220, freqEnd: 90, dur: 0.22, type: "triangle", vol: 0.08, attack: 0.35
    });
    noiseBurst({ dur: 0.14, vol: 0.06, filterFreq: 600 });
    return;
  }
  // Standard projectile rifle — rounded pulse body.
  pulseBody({
    freq: 260, freqEnd: 110, dur: 0.15, vol: 0.11, filterFreq: 780
  });
  tone({
    freq: 340, freqEnd: 150, dur: 0.12, type: "triangle", vol: 0.05, attack: 0.32
  });
  noiseBurst({ dur: 0.07, vol: 0.04, filterFreq: 900 });
}

/** Melee swing whoosh. */
export function playMeleeSfx() {
  if (!gated("melee", 80)) return;
  noiseBurst({ dur: 0.08, vol: 0.1, filterFreq: 2400 });
  tone({ freq: 320, freqEnd: 120, dur: 0.07, type: "triangle", vol: 0.08 });
}

/** Fighter impact / bullet hit. */
export function playImpactSfx(opts = {}) {
  if (!gated("impact", 40)) return;
  if (opts.shield) {
    tone({ freq: 880, freqEnd: 420, dur: 0.06, type: "sine", vol: 0.1 });
    noiseBurst({ dur: 0.04, vol: 0.06, filterFreq: 3200 });
    return;
  }
  tone({ freq: 160, freqEnd: 70, dur: 0.08, type: "triangle", vol: 0.14 });
  noiseBurst({ dur: 0.07, vol: 0.12, filterFreq: 1200 });
}

/** Breakable prop chip. */
export function playBreakableHitSfx() {
  if (!gated("propHit", 50)) return;
  tone({ freq: 520, freqEnd: 240, dur: 0.05, type: "square", vol: 0.07 });
  noiseBurst({ dur: 0.05, vol: 0.08, filterFreq: 2200 });
}

/** Breakable prop destroy / shatter. */
export function playBreakableDestroySfx(opts = {}) {
  if (!gated("propBreak", 70)) return;
  if (opts.explosive) {
    noiseBurst({ dur: 0.28, vol: 0.28, filterFreq: 700 });
    tone({ freq: 90, freqEnd: 40, dur: 0.25, type: "triangle", vol: 0.2 });
    return;
  }
  noiseBurst({ dur: 0.16, vol: 0.18, filterFreq: 1400 });
  tone({ freq: 240, freqEnd: 80, dur: 0.12, type: "square", vol: 0.1 });
  tone({ freq: 180, freqEnd: 60, dur: 0.1, type: "triangle", vol: 0.08, when: 0.03 });
}

function ensureJetNodes(audio) {
  if (jetGain) return;
  jetGain = audio.createGain();
  jetGain.gain.value = 0;
  jetGain.connect(masterGain);

  jetOsc = audio.createOscillator();
  jetOsc.type = "sawtooth";
  jetOsc.frequency.value = 68;
  const oscFilter = audio.createBiquadFilter();
  oscFilter.type = "lowpass";
  oscFilter.frequency.value = 420;
  jetOsc.connect(oscFilter);
  oscFilter.connect(jetGain);

  const samples = audio.sampleRate;
  const buffer = audio.createBuffer(1, samples, samples);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
  jetNoise = audio.createBufferSource();
  jetNoise.buffer = buffer;
  jetNoise.loop = true;
  const noiseFilter = audio.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 900;
  noiseFilter.Q.value = 0.7;
  jetNoise.connect(noiseFilter);
  noiseFilter.connect(jetGain);

  jetOsc.start();
  jetNoise.start();
}

/** Soft loop while the local player is thrusting. */
export function setJetpackThrusting(active) {
  const audio = getCtx();
  if (!audio || !unlocked || !enabled) {
    jetActive = false;
    return;
  }
  ensureJetNodes(audio);
  const on = !!active;
  if (on === jetActive) return;
  jetActive = on;
  const target = on ? 0.045 : 0.0001;
  jetGain.gain.cancelScheduledValues(audio.currentTime);
  jetGain.gain.setTargetAtTime(target, audio.currentTime, on ? 0.04 : 0.08);
}

/** Sync mute/volume from profile settings. */
export function applySfxSettings(settingsOrGameplay) {
  const gameplay = settingsOrGameplay?.gameplay || settingsOrGameplay || {};
  setSfxEnabled(gameplay.sfxEnabled !== false);
  if (gameplay.sfxVolume != null) setSfxVolume(gameplay.sfxVolume);
}
