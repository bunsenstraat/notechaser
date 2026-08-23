// NoteChaser — Audio engine
//
// Everything that makes a sound lives here. Three things it does that the
// old inline Web Audio code did not:
//
//  1. Render once, replay many. A piano-ish tone is synthesised into an
//     AudioBuffer per octave anchor (additive partials with real piano
//     inharmonicity + a hammer transient), then played back with
//     playbackRate for the semitones in between. Costs a few nodes per note
//     instead of a small oscillator rig, and lets us afford a far richer
//     timbre than triangle+sine because it's computed once.
//
//  2. Absolute-time scheduling. Every play function takes `when` — an
//     AudioContext timestamp. Sequences are handed to the audio clock up
//     front, so a busy main thread can no longer smear a melody's rhythm.
//
//  3. Sane gain staging. Voices are quiet enough that a 7-note voicing still
//     fits under 0 dBFS, with a limiter as a safety net rather than a
//     compressor squashing every note. Speech ducking is ref-counted on its
//     own node, so overlapping announcements can't strand the mix at 25%.

let audioCtx = null;
let masterGain = null;   // voices connect here (kept as the name other modules use)
let duckGain = null;     // pulled down while speech is talking
let audioLimiter = null;

const BUS_LEVEL = 0.85;
const DUCK_LEVEL = 0.22;
const NOTE_LEVEL = 0.26;   // per one-shot note; a 7-note voicing still lands under 0 dBFS
const VOICE_LEVEL = 0.26;  // per held keyboard note
const MAX_VOICES = 24;     // hard cap; oldest is stolen past this

// One rendered sample per octave; anything else is pitch-shifted at most ±6
// semitones off the nearest anchor.
const SAMPLE_ANCHORS = [24, 36, 48, 60, 72, 84, 96];
const sampleBank = new Map(); // anchor midi -> AudioBuffer
let bankBuilding = false;

const activeVoices = new Set(); // { src, gain, startedAt, release() }

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

    // Safety limiter, not a tone-shaper: it should sit idle until something
    // genuinely stacks up. (The old chain compressed 4:1 from -20 dB, which
    // is why chords pumped and notes after them sounded swallowed.)
    audioLimiter = audioCtx.createDynamicsCompressor();
    audioLimiter.threshold.value = -4;
    audioLimiter.knee.value = 2;
    audioLimiter.ratio.value = 12;
    audioLimiter.attack.value = 0.003;
    audioLimiter.release.value = 0.18;
    audioLimiter.connect(audioCtx.destination);

    duckGain = audioCtx.createGain();
    duckGain.gain.value = 1;
    duckGain.connect(audioLimiter);

    masterGain = audioCtx.createGain();
    masterGain.gain.value = BUS_LEVEL;
    masterGain.connect(duckGain);

    buildSampleBank();
    attachResumeGuards();
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
}

// iOS suspends (or "interrupts") the context on a phone call, Siri, screen
// lock or a tab switch, and never resumes it by itself — from the player's
// side the app just goes silent until reload. Nudge it back on any sign of
// life.
function attachResumeGuards() {
  const resume = () => {
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  window.addEventListener('focus', resume);
  document.addEventListener('pointerdown', resume, { passive: true });
  document.addEventListener('keydown', resume);
  audioCtx.onstatechange = () => { if (audioCtx.state === 'interrupted') resume(); };
}

function audioNow() {
  return audioCtx ? audioCtx.currentTime : 0;
}

// ── SPEECH DUCKING ──
// Ref-counted: two announcements overlapping (or one whose onend never fires
// while the next is already talking) can't leave the mix stuck quiet.
let duckCount = 0;

function duckAudio() {
  duckCount++;
  applyDuck();
}

function unduckAudio() {
  duckCount = Math.max(0, duckCount - 1);
  applyDuck();
}

function applyDuck() {
  if (!duckGain) return;
  const target = duckCount > 0 ? DUCK_LEVEL : 1;
  duckGain.gain.setTargetAtTime(target, audioCtx.currentTime, duckCount > 0 ? 0.04 : 0.08);
}

// ── SAMPLE RENDERING ──
// One anchor at a time, rendered by an OfflineAudioContext — the DSP runs on
// the rendering thread, so building the bank costs the UI nothing. Until an
// anchor is ready its notes fall back to the oscillator synth, so the first
// note after startup never goes missing.
async function buildSampleBank() {
  if (bankBuilding) return;
  bankBuilding = true;
  // Middle octaves first — that's where the exercises live
  const queue = [...SAMPLE_ANCHORS].sort((a, b) => Math.abs(a - 60) - Math.abs(b - 60));
  for (const anchor of queue) {
    try {
      sampleBank.set(anchor, await renderPianoSample(anchor));
    } catch (e) { /* fall back to the live synth for this anchor */ }
  }
  bankBuilding = false;
}

// Additive piano-ish tone: partials stretched by string inharmonicity (what
// makes an ear hear "string" rather than "organ"), each decaying faster than
// the one below it, plus a filtered noise burst for the hammer.
async function renderPianoSample(midi) {
  const sr = audioCtx.sampleRate;
  const f0 = midiToFreq(midi);
  // Bass strings ring far longer than treble ones
  const dur = Math.max(1.4, Math.min(4.0, 340 / f0 + 1.1));
  const oac = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);

  const out = oac.createGain();
  out.gain.value = 1;
  out.connect(oac.destination);

  const B = 0.0004; // inharmonicity coefficient
  for (let k = 1; k <= 16; k++) {
    const f = f0 * k * Math.sqrt(1 + B * k * k);
    if (f > sr * 0.45) break;
    const amp = Math.pow(k, -1.4) * (k % 2 === 0 ? 0.72 : 1);
    const decay = Math.min(dur, dur / (1 + 0.7 * (k - 1)));

    const osc = oac.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    const g = oac.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(amp, 0.004);
    g.gain.exponentialRampToValueAtTime(amp * 0.0004, decay);
    osc.connect(g);
    g.connect(out);
    osc.start(0);
    osc.stop(dur);
  }

  // Hammer thump under the attack
  const noiseLen = Math.ceil(sr * 0.05);
  const noiseBuf = oac.createBuffer(1, noiseLen, sr);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
  const nsrc = oac.createBufferSource();
  nsrc.buffer = noiseBuf;
  const nfilter = oac.createBiquadFilter();
  nfilter.type = 'bandpass';
  nfilter.frequency.value = Math.min(f0 * 3.5, sr * 0.35);
  nfilter.Q.value = 0.8;
  const ngain = oac.createGain();
  ngain.gain.setValueAtTime(0.6, 0);
  ngain.gain.exponentialRampToValueAtTime(0.0005, 0.045);
  nsrc.connect(nfilter);
  nfilter.connect(ngain);
  ngain.connect(out);
  nsrc.start(0);

  const buf = await oac.startRendering();

  // Normalise, and fade the tail so the buffer never ends on a step
  const data = buf.getChannelData(0);
  const n = data.length;
  const fade = Math.min(n, Math.round(0.05 * sr));
  for (let i = 0; i < fade; i++) data[n - 1 - i] *= i / fade;
  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
  if (peak > 0) { const g = 0.95 / peak; for (let i = 0; i < n; i++) data[i] *= g; }
  return buf;
}

function nearestAnchor(midi) {
  let best = SAMPLE_ANCHORS[0];
  for (const a of SAMPLE_ANCHORS) {
    if (Math.abs(midi - a) < Math.abs(midi - best)) best = a;
  }
  return best;
}

// ── VOICES ──
function registerVoice(voice) {
  activeVoices.add(voice);
  // Steal until we're back under the cap. release() drops the voice from the
  // set straight away — waiting for its onended would let a fast burst run
  // the count away before any of them cleared.
  while (activeVoices.size > MAX_VOICES) {
    let oldest = null;
    for (const v of activeVoices) if (!oldest || v.startedAt < oldest.startedAt) oldest = v;
    if (!oldest) break;
    oldest.release(0.03);
  }
}

// One-shot note. `when` is an absolute AudioContext time; anything already in
// the past is clamped to now so a late timer can't schedule into a hole.
// `levelScale` lets a stacked voicing share the headroom (see playSequence).
function playNote(midi, duration = 2, when, levelScale = 1) {
  initAudio();
  const start = Math.max(when === undefined ? audioCtx.currentTime : when, audioCtx.currentTime);
  const buf = sampleBank.get(nearestAnchor(midi));
  if (buf) playSampledNote(midi, duration, start, NOTE_LEVEL * levelScale, buf);
  else playSynthNote(midi, duration, start, NOTE_LEVEL * 1.6 * levelScale);
}

function playSampledNote(midi, duration, start, level, buf) {
  const anchor = nearestAnchor(midi);
  const rate = Math.pow(2, (midi - anchor) / 12);
  const natural = buf.duration / rate;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(level, start);
  src.connect(gain);
  gain.connect(masterGain);

  // Let short notes ring their natural decay; only fade when we're cutting
  // the sample off early.
  const end = Math.min(duration, natural);
  if (duration < natural) {
    const fade = Math.min(0.14, duration * 0.4);
    gain.gain.setValueAtTime(level, start + end - fade);
    gain.gain.exponentialRampToValueAtTime(0.0006, start + end);
  }

  const voice = {
    startedAt: start,
    released: false,
    release(t) {
      if (voice.released) return;
      voice.released = true;
      activeVoices.delete(voice);
      const now = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + t);
      try { src.stop(now + t + 0.02); } catch (e) {}
    },
  };
  src.onended = () => activeVoices.delete(voice);
  src.start(start);
  src.stop(start + end + 0.03);
  registerVoice(voice);
  return voice;
}

// Fallback for the window before the sample bank finishes rendering.
function playSynthNote(midi, duration, start, level) {
  const freq = midiToFreq(midi);
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  osc2.type = 'sine';
  osc2.frequency.value = freq;
  const mix1 = audioCtx.createGain();
  const mix2 = audioCtx.createGain();
  mix1.gain.value = 0.5;
  mix2.gain.value = 0.3;
  osc1.connect(mix1);
  osc2.connect(mix2);
  mix1.connect(gain);
  mix2.connect(gain);
  gain.connect(masterGain);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(level * 0.45, start + duration * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  osc1.start(start);
  osc2.start(start);
  osc1.stop(start + duration);
  osc2.stop(start + duration);

  const voice = {
    startedAt: start,
    released: false,
    release(t) {
      if (voice.released) return;
      voice.released = true;
      activeVoices.delete(voice);
      const now = audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
      gain.gain.exponentialRampToValueAtTime(0.0005, now + t);
      try { osc1.stop(now + t + 0.02); osc2.stop(now + t + 0.02); } catch (e) {}
    },
  };
  osc1.onended = () => activeVoices.delete(voice);
  registerVoice(voice);
  return voice;
}

// Held note for the on-screen keyboard: rings out like a piano key until
// stopVoice() lifts the damper.
function startVoice(midi) {
  initAudio();
  const start = audioCtx.currentTime;
  const buf = sampleBank.get(nearestAnchor(midi));
  return buf
    ? playSampledNote(midi, 60, start, VOICE_LEVEL, buf)
    : playSynthNote(midi, 8, start, VOICE_LEVEL * 1.6);
}

function stopVoice(voice, releaseTime = 0.22) {
  if (voice) voice.release(releaseTime);
}

function stopAllVoices() {
  for (const v of [...activeVoices]) v.release(0.05);
  activeVoices.clear();
}

// ── SEQUENCES ──
// events: [{ notes: midi | [midi], at: secondsFromStart, dur: seconds }]
// Audio is handed to the clock immediately; the visual callbacks ride along
// on the same clock instead of on setTimeout, so highlights track what you
// actually hear.
function playSequence(events, opts = {}) {
  initAudio();
  const lead = opts.lead === undefined ? 0.08 : opts.lead;
  const t0 = audioCtx.currentTime + lead;
  let last = 0;

  events.forEach(ev => {
    const notes = Array.isArray(ev.notes) ? ev.notes : [ev.notes];
    // Equal-power share for stacked notes: a 7-note voicing shouldn't hit the
    // bus seven times as hard as a single note and drive the limiter.
    const scale = notes.length > 1 ? 1 / Math.sqrt(notes.length) : 1;
    notes.forEach(midi => playNote(midi, ev.dur, t0 + ev.at, scale));
    last = Math.max(last, ev.at + ev.dur);
  });

  const endAt = t0 + (opts.totalDur === undefined ? last : opts.totalDur);
  let i = 0;
  let cancelled = false;

  const tick = () => {
    if (cancelled) return;
    const now = audioCtx.currentTime;
    while (i < events.length && now >= t0 + events[i].at - 0.015) {
      if (opts.onNote) opts.onNote(events[i], i);
      i++;
    }
    if (now >= endAt) {
      if (opts.onEnd) opts.onEnd();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  return { cancel() { cancelled = true; } };
}

// ── UI SOUNDS ──
function playSuccessChime() {
  initAudio();
  const now = audioCtx.currentTime;
  [0, 0.08, 0.16].forEach((t, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = [880, 1108.73, 1318.51][i]; // A5, C#6, E6
    osc.connect(g);
    g.connect(masterGain);
    g.gain.setValueAtTime(0, now + t);
    g.gain.linearRampToValueAtTime(0.12, now + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.25);
    osc.start(now + t);
    osc.stop(now + t + 0.25);
  });
}

function playFailSound() {
  initAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.linearRampToValueAtTime(80, now + 0.4);
  osc.connect(g);
  g.connect(masterGain);
  g.gain.setValueAtTime(0.15, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.start(now);
  osc.stop(now + 0.5);
}

// Short "nope" chime — fires when a mistake is detected mid-round. Much
// softer than playFailSound (which is reserved for game-over). Two quick
// descending triangle tones: F#4 → D4 (minor third down), total ~240ms.
function playMistakeChime() {
  initAudio();
  const now = audioCtx.currentTime;
  [0, 0.06].forEach((t, i) => {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = [369.99, 293.66][i]; // F#4, D4
    osc.connect(g);
    g.connect(masterGain);
    g.gain.setValueAtTime(0, now + t);
    g.gain.linearRampToValueAtTime(0.08, now + t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.18);
    osc.start(now + t);
    osc.stop(now + t + 0.18);
  });
}

// Per-note confirmation in chord / bass / progression modes.
function playChordConfirmBeep() {
  initAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  osc.connect(g);
  g.connect(masterGain);
  g.gain.setValueAtTime(0.1, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.start(now);
  osc.stop(now + 0.15);
}
