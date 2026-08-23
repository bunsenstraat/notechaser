// NoteChaser — Collapsible playable keyboard dock
//
// A touch/mouse playable piano that sits at the bottom of the screen during
// exercises. Two jobs:
//   1. Always: sound the note you press (own sustained voices, released on lift).
//   2. In MIDI input mode: act as an on-screen MIDI keyboard, so the answer
//      checking in app.js works without hardware — it feeds the same
//      midiHeldNotes / onMidiNoteChange() path handleMidiMessage() uses.
//
// While keys are held in mic mode we suppress pitch detection (see
// playKeyboardMuting()), otherwise the mic hears the keyboard and scores it.

const PK_WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
// Black key = semitone offset + the white key index it sits after
const PK_BLACK_OFFSETS = [[1, 0], [3, 1], [6, 3], [8, 4], [10, 5]];
const PK_MIN_LOW = 24;   // C1
const PK_MAX_HIGH = 108; // C8
const PK_RELEASE_TAIL_MS = 300; // mic stays muted this long after the last key up
const PK_MAX_HOLD_MS = 12000;   // safety net against a stuck note

let pkOpen = false;
let pkEnabled = true;
let pkLow = 48;      // lowest note shown, always a C
let pkOctaves = 2;
let pkVoices = new Map();          // midi -> { osc1, osc2, gain, timer }
let pkHeld = new Map();            // midi -> number of pointers holding it
let pkPointerNotes = new Map();    // pointerId -> midi
let pkLastReleaseAt = 0;
let pkCurrentScreen = 'setup';

function pkStore(key, val) {
  try { localStorage.setItem('notechaser_kbd_' + key, String(val)); } catch (e) {}
}
function pkRead(key, fallback) {
  try {
    const v = localStorage.getItem('notechaser_kbd_' + key);
    return v === null ? fallback : v;
  } catch (e) { return fallback; }
}

// ── RANGE ──
function pkClampLow(low, octaves) {
  const span = (octaves || pkOctaves) * 12;
  const l = Math.round(low / 12) * 12; // snap to a C
  return Math.max(PK_MIN_LOW, Math.min(PK_MAX_HIGH - span, l));
}

// Smallest window (snapped to whole octaves starting on a C) that holds lo..hi
function pkWindowFor(lo, hi, octaves) {
  const span = octaves * 12;
  let low = pkClampLow(Math.round((lo + hi) / 2) - span / 2, octaves);
  if (lo < low) low = pkClampLow(Math.floor(lo / 12) * 12, octaves);
  if (hi > low + span) low = pkClampLow(Math.ceil((hi - span) / 12) * 12, octaves);
  return low;
}

// Centre the keyboard on whatever range the current exercise uses. When the
// exercise spans more than we can show, start at its bottom — pkFollowRange()
// pans from there as the targets move.
function pkAutoRange() {
  let lo = 48, hi = 72;
  if (typeof getRangeAbsLow === 'function') lo = getRangeAbsLow();
  if (typeof getRangeAbsHigh === 'function') hi = getRangeAbsHigh();
  const span = pkOctaves * 12;
  pkLow = hi - lo <= span
    ? pkWindowFor(lo, hi, pkOctaves)
    : pkClampLow(Math.floor(lo / 12) * 12);
  buildPlayKeyboard();
}

// Keep the current target reachable — a one-octave phone keyboard can't cover
// a two-octave exercise range on its own, so pan (and widen for chords).
function pkFollowRange(lo, hi) {
  if (lo === null || lo === undefined) return;
  if (hi === null || hi === undefined) hi = lo;
  if (pkHeld.size > 0) return; // never move keys out from under a finger
  if (lo >= pkLow && hi <= pkLow + pkOctaves * 12) return;

  // Widen until a C-aligned window actually holds the whole target span
  let octaves = pkOctaves;
  let low = pkWindowFor(lo, hi, octaves);
  while (octaves < 3 && (lo < low || hi > low + octaves * 12)) {
    octaves++;
    low = pkWindowFor(lo, hi, octaves);
  }
  if (low === pkLow && octaves === pkOctaves) return;
  pkLow = low;
  pkOctaves = octaves; // widening here is a temporary fit, not a saved preference
  buildPlayKeyboard();
}

function shiftPlayOctave(delta) {
  pkReleaseAll();
  pkLow = pkClampLow(pkLow + delta * 12);
  pkStore('low', pkLow);
  buildPlayKeyboard();
}

function cyclePlayOctaves() {
  pkReleaseAll();
  pkOctaves = pkOctaves >= 3 ? 1 : pkOctaves + 1;
  pkStore('octaves', pkOctaves);
  pkLow = pkClampLow(pkLow);
  buildPlayKeyboard();
}

// ── BUILD ──
function buildPlayKeyboard() {
  const keys = document.getElementById('pkKeys');
  if (!keys) return;
  keys.innerHTML = '';

  const whiteCount = pkOctaves * 7 + 1; // include the top C
  const whiteW = 100 / whiteCount;

  const whiteRow = document.createElement('div');
  whiteRow.className = 'pk-white-row';
  const blackRow = document.createElement('div');
  blackRow.className = 'pk-black-row';

  for (let oct = 0; oct <= pkOctaves; oct++) {
    const base = pkLow + oct * 12;
    const whites = oct === pkOctaves ? [0] : PK_WHITE_OFFSETS; // last octave: just the top C
    whites.forEach(off => {
      const midi = base + off;
      const key = document.createElement('div');
      key.className = 'pk-key pk-white';
      key.dataset.midi = midi;
      const label = document.createElement('span');
      label.className = 'pk-label';
      label.textContent = off === 0 ? midiToName(midi) : NOTE_NAMES[midi % 12];
      if (off === 0) label.classList.add('pk-label-c');
      key.appendChild(label);
      whiteRow.appendChild(key);
    });

    if (oct === pkOctaves) break;
    PK_BLACK_OFFSETS.forEach(([off, afterWhite]) => {
      const midi = base + off;
      const key = document.createElement('div');
      key.className = 'pk-key pk-black';
      key.dataset.midi = midi;
      // Sit on the boundary between the two neighbouring white keys
      const boundary = (oct * 7 + afterWhite + 1) * whiteW;
      key.style.left = `calc(${boundary}% - (${whiteW}% * 0.32))`;
      key.style.width = `calc(${whiteW}% * 0.64)`;
      blackRow.appendChild(key);
    });
  }

  keys.appendChild(whiteRow);
  keys.appendChild(blackRow);

  const hi = pkLow + pkOctaves * 12;
  const rangeLabel = document.getElementById('pkRangeLabel');
  if (rangeLabel) rangeLabel.textContent = `${midiToName(pkLow)} – ${midiToName(hi)}`;
  const octBtn = document.getElementById('pkOctavesBtn');
  if (octBtn) octBtn.textContent = pkOctaves + ' oct';

  pkUpdateDockHeight();
}

// ── VOICES ──
// Sounding is the engine's job (js/audio.js) — a key press is just a held
// voice, released when the finger lifts.
function pkStartVoice(midi) {
  if (typeof startVoice !== 'function') return;
  if (pkVoices.has(midi)) pkStopVoice(midi);
  const voice = startVoice(midi);
  if (!voice) return;
  const timer = setTimeout(() => pkNoteOff(midi, true), PK_MAX_HOLD_MS);
  pkVoices.set(midi, { voice, timer });
}

function pkStopVoice(midi) {
  const v = pkVoices.get(midi);
  if (!v) return;
  pkVoices.delete(midi);
  clearTimeout(v.timer);
  stopVoice(v.voice);
}

// ── NOTE ON / OFF ──
function pkNoteOn(midi) {
  const count = pkHeld.get(midi) || 0;
  pkHeld.set(midi, count + 1);
  if (count > 0) return; // already sounding via another pointer

  pkStartVoice(midi);
  document.querySelectorAll(`.pk-key[data-midi="${midi}"]`).forEach(k => k.classList.add('pressed'));

  // In MIDI input mode the on-screen keyboard *is* the input device.
  if (typeof useMidi !== 'undefined' && useMidi) {
    midiHeldNotes.add(midi);
    onMidiNoteChange();
  }
}

function pkNoteOff(midi, force) {
  const count = pkHeld.get(midi) || 0;
  if (count === 0) return;
  if (!force && count > 1) { pkHeld.set(midi, count - 1); return; }

  pkHeld.delete(midi);
  pkStopVoice(midi);
  pkLastReleaseAt = performance.now();
  document.querySelectorAll(`.pk-key[data-midi="${midi}"]`).forEach(k => k.classList.remove('pressed'));

  if (typeof useMidi !== 'undefined' && useMidi) midiHeldNotes.delete(midi);
}

function pkReleaseAll() {
  [...pkHeld.keys()].forEach(midi => pkNoteOff(midi, true));
  pkPointerNotes.clear();
}

// True while the on-screen keyboard is sounding (plus a short tail), so the
// pitch detector can ignore what the mic picks up from it.
function playKeyboardMuting() {
  if (pkHeld.size > 0) return true;
  return pkLastReleaseAt > 0 && (performance.now() - pkLastReleaseAt) < PK_RELEASE_TAIL_MS;
}

// ── TARGET MIRRORING ──
// Copy the from/target/hit highlights off the small display piano onto the
// playable keys, so the guidance sits under your fingers. Driven from
// gameLoop(). Respects "Hide piano keyboard" — if the display piano is
// hidden, we don't leak its highlights here either.
const PK_MIRROR = [
  ['active-from', 'mirror-from'],
  ['active-target', 'mirror-target'],
  ['active-singing', 'mirror-hit'],
];

// What the player is being asked to hit right now, so the keys stay in reach.
// Reads app state defensively — this module loads after app.js but the game
// may not have started yet.
function pkCurrentTargets() {
  if (typeof gameActive === 'undefined' || !gameActive) return [];
  const pick = (arr, i) => (Array.isArray(arr) && arr[i] !== undefined ? [arr[i]] : []);
  switch (gameMode) {
    case 'chord': return [...chordTargetNotes];
    case 'progression': return [...progTargetNotes];
    case 'bass': return pick(bassNotes, bassIndex);
    case 'licks': return pick(lickNotes, lickNoteIndex);
    case 'scale': return pick(scaleNotes, scaleNoteIndex);
    case 'melody':
    case 'harmonic': return pick(melodyNotes, melodyIndex);
    case 'target': {
      const t = targetSequence[targetSeqIndex];
      return t ? [t.midi] : [];
    }
    default:
      // Target only — following the base note too would force a wider (and on
      // a phone, thinner-keyed) keyboard than the answer needs.
      return typeof currentTargetMidi === 'number' ? [currentTargetMidi] : [];
  }
}

function pkMirrorHighlights() {
  const keys = document.getElementById('pkKeys');
  if (!keys || !pkOpen) return;
  const hidden = typeof HIDE_PIANO !== 'undefined' && HIDE_PIANO;
  const marks = new Map();
  if (!hidden) {
    document.querySelectorAll('.piano-key').forEach(k => {
      const flags = PK_MIRROR.filter(([src]) => k.classList.contains(src)).map(([, dst]) => dst);
      if (flags.length) marks.set(parseInt(k.dataset.midi), flags);
    });
  }

  const targets = pkCurrentTargets();
  if (targets.length) pkFollowRange(Math.min(...targets), Math.max(...targets));

  document.getElementById('pkKeys').querySelectorAll('.pk-key').forEach(k => {
    const flags = marks.get(parseInt(k.dataset.midi));
    PK_MIRROR.forEach(([, dst]) => k.classList.toggle(dst, !!flags && flags.includes(dst)));
  });
}

// ── POINTER INPUT ──
function pkMidiFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const key = el && el.closest ? el.closest('.pk-key') : null;
  return key ? parseInt(key.dataset.midi) : null;
}

function pkBindPointerEvents() {
  const keys = document.getElementById('pkKeys');
  if (!keys) return;

  keys.addEventListener('pointerdown', e => {
    const midi = pkMidiFromPoint(e.clientX, e.clientY);
    if (midi === null) return;
    e.preventDefault();
    try { keys.setPointerCapture(e.pointerId); } catch (err) {}
    pkPointerNotes.set(e.pointerId, midi);
    pkNoteOn(midi);
  });

  // Sliding across keys retriggers — glissando, and forgiving of finger drift
  keys.addEventListener('pointermove', e => {
    if (!pkPointerNotes.has(e.pointerId)) return;
    const midi = pkMidiFromPoint(e.clientX, e.clientY);
    const current = pkPointerNotes.get(e.pointerId);
    if (midi === current) return;
    if (current !== null) pkNoteOff(current);
    if (midi !== null) pkNoteOn(midi);
    pkPointerNotes.set(e.pointerId, midi);
  });

  const release = e => {
    if (!pkPointerNotes.has(e.pointerId)) return;
    const midi = pkPointerNotes.get(e.pointerId);
    pkPointerNotes.delete(e.pointerId);
    if (midi !== null) pkNoteOff(midi);
  };
  keys.addEventListener('pointerup', release);
  keys.addEventListener('pointercancel', release);
  keys.addEventListener('lostpointercapture', release);
  keys.addEventListener('contextmenu', e => e.preventDefault());
}

// ── DOCK VISIBILITY ──
function togglePlayKeyboard(open) {
  pkOpen = open === undefined ? !pkOpen : !!open;
  if (!pkOpen) pkReleaseAll();
  pkStore('open', pkOpen ? '1' : '0');
  pkApplyOpenState();
}

function pkApplyOpenState() {
  const dock = document.getElementById('pkDock');
  if (!dock) return;
  dock.classList.toggle('open', pkOpen);
  const chevron = document.getElementById('pkChevron');
  if (chevron) chevron.innerHTML = pkOpen ? '&#9660;' : '&#9650;';
  const toggle = document.getElementById('pkToggle');
  if (toggle) toggle.setAttribute('aria-expanded', pkOpen ? 'true' : 'false');
  // Lets the game screen give up vertical space to the keyboard
  document.body.classList.toggle('pk-expanded', pkOpen && dock.classList.contains('visible'));
  pkMirrorHighlights();
  pkUpdateDockHeight();
}

// Reserve space at the bottom of the page so the dock never covers content.
function pkUpdateDockHeight() {
  const dock = document.getElementById('pkDock');
  const panel = document.getElementById('pkPanel');
  const bar = document.getElementById('pkBar');
  if (!dock || !panel || !bar) return;
  const visible = dock.classList.contains('visible');
  const h = visible ? bar.offsetHeight + (pkOpen ? panel.scrollHeight : 0) : 0;
  document.documentElement.style.setProperty('--pk-dock-h', h + 'px');
}

// Only on the game screen — this is a practice aid, not a setup control.
function pkSyncVisibility() {
  const dock = document.getElementById('pkDock');
  if (!dock) return;
  const visible = pkEnabled && pkCurrentScreen === 'game';
  dock.classList.toggle('visible', visible);
  document.body.classList.toggle('pk-expanded', pkOpen && visible);
  if (!visible) pkReleaseAll();
  pkUpdateDockHeight();
}

function pkOnScreenChange(id) {
  pkCurrentScreen = id;
  if (id === 'game') pkAutoRange();
  pkSyncVisibility();
}

function pkApplyEnabled(enabled) {
  pkEnabled = enabled !== false;
  pkSyncVisibility();
}

// ── INIT ──
(function pkInit() {
  pkEnabled = typeof PLAY_KEYBOARD === 'undefined' ? true : PLAY_KEYBOARD;
  // Narrow phones get one octave by default so the keys stay finger-sized
  const defaultOctaves = window.innerWidth < 420 ? '1' : '2';
  pkOctaves = Math.max(1, Math.min(3, parseInt(pkRead('octaves', defaultOctaves)) || 2));
  pkLow = pkClampLow(parseInt(pkRead('low', '48')) || 48);
  pkOpen = pkRead('open', '0') === '1';

  buildPlayKeyboard();
  pkBindPointerEvents();
  pkApplyOpenState();
  pkSyncVisibility();

  window.addEventListener('resize', pkUpdateDockHeight);
  window.addEventListener('blur', pkReleaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pkReleaseAll(); });

  document.addEventListener('keydown', e => {
    if (e.key === 'k' || e.key === 'K') {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (!pkEnabled || pkCurrentScreen !== 'game') return;
      e.preventDefault();
      togglePlayKeyboard();
    }
  });
})();
