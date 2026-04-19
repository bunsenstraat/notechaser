// NoteChaser — Application Logic
function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
function freqToMidi(freq) { return 69 + 12 * Math.log2(freq / 440); }
function midiToName(midi) {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return note + octave;
}
function midiToNoteLetter(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}
// Jazz-friendly enharmonic for MIDI display (e.g. "Bb3" instead of "A#3",
// weighted per ENHARMONIC_FLAT_WEIGHT). Random per call — cache the result
// if you need a stable label while the note is on screen.
function midiToNameJazz(midi) {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  return jazzNoteName(pc) + octave;
}

// Default ranges
const DEFAULTS = {
  vocalLow: 48, vocalHigh: 64,       // C3 – E4
  chordSingLow: 45, chordSingHigh: 63, // A2 – Eb4
  instLow: 48, instHigh: 72,          // C3 – C5
  bassLow: 36, bassHigh: 72,          // C2 – C5
  cents: 50, holdMs: 500,
  sensitivity: 5, confidence: 20,
  announceVoice: true, autoPlayIntro: true, hidePiano: false, hideTarget: false,
};

// Toggleable behaviors (loaded from settings)
let ANNOUNCE_VOICE = true;
let AUTO_PLAY_INTRO = true;
let HIDE_PIANO = false;
let HIDE_TARGET = false;

// Mutable ranges (loaded from settings)
let RANGE_LOW = 48;
let RANGE_HIGH = 57;
let RANGE_ABS_LOW = 48;
let RANGE_ABS_HIGH = 64;

let INST_RANGE_LOW = 48;
let INST_RANGE_HIGH = 60;
let INST_RANGE_ABS_LOW = 48;
let INST_RANGE_ABS_HIGH = 72;

// Chord sing range
let CHORD_SING_LOW = 45;
let CHORD_SING_HIGH = 63;

// Bass range
let BASS_RANGE_LOW = 36;
let BASS_RANGE_HIGH = 72;

// Tuner settings
let CENTS_TOLERANCE = 50;
let RMS_THRESHOLD = 0.005;
let CONFIDENCE_THRESHOLD = 0.2;

// Range helpers based on mode
function isInstrumentMode() { return (gameMode === 'instrument' || gameMode === 'harmonic' || gameMode === 'chord' || gameMode === 'bass' || gameMode === 'progression') && !(gameMode === 'chord' && chordPlayback === 'sing'); }
function isChordSing() { return gameMode === 'chord' && chordPlayback === 'sing'; }
function isChordCall() { return gameMode === 'chord' && chordPlayback === 'call'; }
function isChordVoiceMode() { return isChordSing() || isChordCall(); }
function isScaleWide() { return gameMode === 'scale' && scaleRangeWide; }
function isLickWide() { return gameMode === 'licks' && lickRangeWide; }
function getRangeLow() { if (gameMode === 'bass') return BASS_RANGE_LOW; if (isChordSing()) return CHORD_SING_LOW; if (isScaleWide() || isLickWide()) return INST_RANGE_LOW; return isInstrumentMode() ? INST_RANGE_LOW : RANGE_LOW; }
function getRangeHigh() { if (gameMode === 'bass') return BASS_RANGE_LOW + 12; if (isChordSing()) return CHORD_SING_LOW + 8; if (isScaleWide() || isLickWide()) return INST_RANGE_HIGH; return isInstrumentMode() ? INST_RANGE_HIGH : RANGE_HIGH; }
function getRangeAbsLow() { if (gameMode === 'bass') return BASS_RANGE_LOW; if (isChordSing()) return CHORD_SING_LOW; if (isScaleWide() || isLickWide()) return INST_RANGE_ABS_LOW; return isInstrumentMode() ? INST_RANGE_ABS_LOW : RANGE_ABS_LOW; }
function getRangeAbsHigh() { if (gameMode === 'bass') return BASS_RANGE_HIGH; if (isChordSing()) return CHORD_SING_HIGH; if (isScaleWide() || isLickWide()) return INST_RANGE_ABS_HIGH; return isInstrumentMode() ? INST_RANGE_ABS_HIGH : RANGE_ABS_HIGH; }

// ── MIDI INPUT ──
let useMidi = false;
let midiAccess = null;
let midiHeldNotes = new Set(); // currently held MIDI notes
let midiInput = null;

async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    alert('Web MIDI is not supported in this browser. Please use Chrome or Edge.');
    return false;
  }
  try {
    midiAccess = await navigator.requestMIDIAccess();
    connectMidiInputs();
    midiAccess.onstatechange = () => connectMidiInputs();
    return true;
  } catch(e) {
    alert('MIDI access denied. Please allow MIDI access and try again.');
    return false;
  }
}

function connectMidiInputs() {
  if (!midiAccess) return;
  for (const input of midiAccess.inputs.values()) {
    input.onmidimessage = handleMidiMessage;
  }
}

function handleMidiMessage(msg) {
  const [status, note, velocity] = msg.data;
  const command = status & 0xf0;
  if (command === 0x90 && velocity > 0) {
    // Note on
    midiHeldNotes.add(note);
    onMidiNoteChange();
  } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
    // Note off
    midiHeldNotes.delete(note);
  }
}

function onMidiNoteChange() {
  if (!gameActive || melodyPlaying || !useMidi) return;

  if (gameMode === 'chord') {
    // Chord mode: check if held notes match all target notes
    updateChordPiano(null, midiHeldNotes);
    updateMidiChordDisplay();

    let allHit = true;
    for (const t of chordTargetNotes) {
      if (!midiHeldNotes.has(t)) { allHit = false; break; }
    }
    if (allHit && chordTargetNotes.size > 0) {
      chordHitNotes = new Set(chordTargetNotes);
      chordTargetNotes = new Set();
      updateDisplay();
      onSuccess();
    }
  } else if (gameMode === 'progression') {
    // Progression mode: check if held notes match current chord target
    updateProgressionPiano();
    updateMidiChordDisplay();

    // Octave-independent: match pitch classes only
    const heldPCs = new Set([...midiHeldNotes].map(n => n % 12));
    const targetPCs = new Set([...progTargetNotes].map(n => n % 12));
    let allHit = true;
    for (const pc of targetPCs) {
      if (!heldPCs.has(pc)) { allHit = false; break; }
    }
    if (allHit && progTargetNotes.size > 0) {
      progHitNotes = new Set(progTargetNotes);
      progTargetNotes = new Set();
      playChordConfirmBeep();
      updateDisplay();

      // Move to next chord in progression
      progChordIndex++;
      if (progChordIndex >= currentProgression.chords.length) {
        // Progression complete!
        onSuccess();
      } else {
        // Set up next chord, reset timer
        setupProgChord();
        buildPiano();
        updateDisplay();
        roundStart = performance.now();
      }
    }
  } else {
    // Single note modes: use the latest note played
    if (midiHeldNotes.size === 0) return;
    const latestNote = [...midiHeldNotes].pop();

    if (gameMode === 'bass') {
      // Match pitch class
      const targetMidi = bassNotes[bassIndex];
      if (latestNote % 12 === targetMidi % 12) {
        bassIndex++;
        playChordConfirmBeep();
        updateDisplay();
        if (bassIndex >= bassNotes.length) {
          onSuccess();
        }
      }
    } else if (gameMode === 'licks') {
      if (latestNote === lickNotes[lickNoteIndex]) {
        onSuccess();
      }
    } else if (gameMode === 'scale') {
      if (latestNote === scaleNotes[scaleNoteIndex]) {
        onSuccess();
      }
    } else if (gameMode === 'melody' || gameMode === 'harmonic') {
      if (latestNote === melodyNotes[melodyIndex]) {
        onSuccess();
      }
    } else if (gameMode === 'instrument') {
      if (latestNote === currentTargetMidi) {
        onSuccess();
      }
    } else if (gameMode === 'voice') {
      // Voice mode via MIDI: allow playing the target note on a keyboard.
      // In root style, match by pitch class so jazz extensions (b13/13) can
      // be played at any octave. In chain style, require the exact MIDI note.
      const match = intervalStyle === 'root'
        ? (latestNote % 12 === currentTargetMidi % 12)
        : (latestNote === currentTargetMidi);
      if (match) onSuccess();
    }
  }
}

function updateMidiChordDisplay() {
  const singingEl = document.getElementById('singingNote');
  if (midiHeldNotes.size > 0) {
    const names = [...midiHeldNotes].sort((a,b) => a-b).map(m => midiToName(m));
    singingEl.innerHTML = `You: <span>${names.join(' ')}</span>`;
  } else {
    singingEl.innerHTML = '&nbsp;';
  }
}

function setInputMode(midi) {
  useMidi = midi;
  document.querySelectorAll('.input-mode-btn').forEach(b => {
    b.classList.toggle('selected', (b.dataset.input === 'midi') === midi);
  });
  document.getElementById('micHint').textContent = midi
    ? 'Connect a MIDI keyboard to play'
    : 'Microphone access required for pitch detection';
}

// ── STATE ──
let selectedIntervals = new Set();
let dirUp = true, dirDown = true;
let gameMode = 'voice'; // 'voice', 'instrument', or 'melody'

// Interval style — 'chain' (target becomes next base) or 'root' (stay on a root for N rounds, always up)
let intervalStyle = 'chain';
let intervalRoundsOnRoot = 0;
let intervalRoundsPerRoot = 4;

// Melody mode state
let melodyNotes = [];
let melodyIndex = 0;
let melodyLength = 2;
let melodyRound = 0;
let melodySpeed = 3; // rounds before adding a note (4=chill, 3=normal, 2=fast, 1=insane)
let melodyPlaying = false;
let hiScoreMelody = parseInt(localStorage.getItem('notechaser_hi_melody') || '0');

// Lick mode state
let selectedLicks = new Set();
let lickRangeWide = false;
let lickCycle = 3; // new lick every N keys
let currentLick = null;
let lickNotes = []; // actual MIDI notes to play/detect
let lickNoteIndex = 0;
let lickRoot = null;
let lickKeysPlayed = 0; // how many keys done for current lick
let lickKeyOrder = []; // shuffled key order
let lickKeyIndex = 0;
let lickFeel = 'straight'; // 'straight', 'swing', 'hard'
let lickBPM = 140;
let hiScoreLick = parseInt(localStorage.getItem('notechaser_hi_lick') || '0');

// Progression mode state
let selectedProgressions = new Set();
let currentProgression = null;
let progChordIndex = 0;        // which chord in the progression we're on
let progKeyRoot = 0;           // pitch class of the key (0=C, 1=C#, etc.)
let progCurrentChordType = null; // the CHORD_TYPES entry for current chord
let progCurrentRoot = null;    // MIDI root of the current chord
let progTargetNotes = new Set();
let progHitNotes = new Set();
let hiScoreProgression = parseInt(localStorage.getItem('notechaser_hi_progression') || '0');

// Harmonic mode state
let selectedScale = null;
let harmonicRoot = null;
let hiScoreHarmonic = parseInt(localStorage.getItem('notechaser_hi_harmonic') || '0');

// Chord mode state
let selectedChords = new Set();
let chordRoot = null;
let chordRoundsOnRoot = 0;
let chordRoundsPerRoot = 1;
let currentChordType = null;
let chordTargetNotes = new Set();
let chordHitNotes = new Set();
let holdingForMidi = null;
let chordPlayback = 'arpeggio'; // 'arpeggio' or 'stack'
let hiScoreChord = parseInt(localStorage.getItem('notechaser_hi_chord') || '0');

// Bass mode state
let selectedCadences = new Set();
let bassKeyRoot = null;
let currentCadence = null;
let bassNotes = [];
let bassIndex = 0;
let bassCadenceChords = [];
let bassUseTypeB = false;
let bassAnnounceKey = true;
let hiScoreBass = parseInt(localStorage.getItem('notechaser_hi_bass') || '0');

// Scale sing mode state
let selectedScalesForSing = new Set();
let scaleNotes = [];
let scaleNoteIndex = 0;
let currentScaleForSing = null;
let scaleRoot = null;
let scaleDirUp = true, scaleDirDown = true, scaleDirBoth = false;
let scaleCurrentDir = 'up'; // tracks actual direction for voice announcement
let scaleRangeWide = false; // false = vocal range, true = instrument/keyboard range
let hiScoreScale = parseInt(localStorage.getItem('notechaser_hi_scale') || '0');

let currentKeyDisplay = ''; // jazz-friendly key name for current round

let audioCtx = null;
let masterGain = null;
let analyser = null;
let micStream = null;
let gameActive = false;
let score = 0;
let hiScore = parseInt(localStorage.getItem('notechaser_hi') || '0');
let currentBaseMidi = Math.floor(Math.random() * (RANGE_HIGH - RANGE_LOW + 1)) + RANGE_LOW;
let currentTargetMidi = 49;
let currentBaseName = '';   // cached jazz-friendly display (e.g. "Bb3")
let currentTargetName = ''; // cached jazz-friendly display
let currentInterval = null;
let currentDir = 1;
let holdStart = 0;
let HOLD_REQUIRED = 500; // ms to hold correct pitch
let TIMEOUT = 7000; // ms before game over
let roundStart = 0;
let animFrame = null;
let pitchBuffer = new Float32Array(2048);

// ── SETUP UI ──
const grid = document.getElementById('intervalGrid');
INTERVALS.forEach((iv, i) => {
  const btn = document.createElement('button');
  btn.className = 'interval-btn';
  btn.textContent = iv.name;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedIntervals.has(i)) {
      selectedIntervals.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedIntervals.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  grid.appendChild(btn);
});

// Build scale grid
const scaleGrid = document.getElementById('scaleGrid');
SCALES.forEach((scale, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn';
  btn.innerHTML = `${scale.name}<span class="chord-label">I${scale.chordName}</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    // Single-select (radio behavior)
    document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('selected'));
    if (selectedScale === i) {
      selectedScale = null;
    } else {
      selectedScale = i;
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  scaleGrid.appendChild(btn);
});

// Build chord grid
const chordGrid = document.getElementById('chordGrid');
CHORD_TYPES.forEach((ct, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn chord-type-btn';
  btn.innerHTML = `${ct.name}<span class="chord-label">${ct.short}</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedChords.has(i)) {
      selectedChords.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedChords.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  chordGrid.appendChild(btn);
});

function chordPreset(p) {
  const btns = chordGrid.querySelectorAll('.chord-type-btn');
  selectedChords.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'all') {
    CHORD_TYPES.forEach((ct, i) => { selectedChords.add(i); btns[i].classList.add('selected'); });
  } else if (p !== 'none') {
    CHORD_TYPES.forEach((ct, i) => { if (ct.cat === p) { selectedChords.add(i); btns[i].classList.add('selected'); } });
  }
  updateStartBtn();
}

// Build cadence grid
const cadenceGrid = document.getElementById('cadenceGrid');
CADENCES.forEach((cad, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn cadence-btn';
  btn.innerHTML = `${cad.name}<span class="chord-label">${cad.short}</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedCadences.has(i)) {
      selectedCadences.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedCadences.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  cadenceGrid.appendChild(btn);
});

function cadencePreset(p) {
  const btns = cadenceGrid.querySelectorAll('.cadence-btn');
  selectedCadences.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'major') {
    CADENCES.forEach((c, i) => { if (c.cat === 'major') { selectedCadences.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'minor') {
    CADENCES.forEach((c, i) => { if (c.cat === 'minor') { selectedCadences.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'single') {
    CADENCES.forEach((c, i) => { if (c.cat === 'single') { selectedCadences.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'all') {
    CADENCES.forEach((_, i) => { selectedCadences.add(i); btns[i].classList.add('selected'); });
  }
  updateStartBtn();
}

// Build scale sing grid (multi-select)
const scaleSingGrid = document.getElementById('scaleSingGrid');
SCALES.forEach((scale, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn scale-sing-btn';
  btn.innerHTML = `${scale.name}<span class="chord-label">${scale.intervals.length} notes</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedScalesForSing.has(i)) {
      selectedScalesForSing.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedScalesForSing.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  scaleSingGrid.appendChild(btn);
});

function scaleSingPreset(p) {
  const btns = scaleSingGrid.querySelectorAll('.scale-sing-btn');
  selectedScalesForSing.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'modes') {
    SCALES.forEach((s, i) => { if (s.cat === 'church') { selectedScalesForSing.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'minor') {
    SCALES.forEach((s, i) => { if (s.cat === 'minor') { selectedScalesForSing.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'jazz') {
    SCALES.forEach((s, i) => { if (s.cat === 'jazz') { selectedScalesForSing.add(i); btns[i].classList.add('selected'); } });
  } else if (p === 'all') {
    SCALES.forEach((_, i) => { selectedScalesForSing.add(i); btns[i].classList.add('selected'); });
  }
  updateStartBtn();
}

// Build lick grid
const licksGrid = document.getElementById('licksGrid');
LICKS.forEach((lick, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn lick-btn';
  btn.innerHTML = `${lick.name}<span class="chord-label">${lick.notes.length} notes</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedLicks.has(i)) {
      selectedLicks.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedLicks.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  licksGrid.appendChild(btn);
});

function licksPreset(p) {
  const btns = licksGrid.querySelectorAll('.lick-btn');
  selectedLicks.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'all') {
    LICKS.forEach((_, i) => { selectedLicks.add(i); btns[i].classList.add('selected'); });
  } else if (p !== 'none') {
    LICKS.forEach((l, i) => { if (l.cat === p) { selectedLicks.add(i); btns[i].classList.add('selected'); } });
  }
  updateStartBtn();
}

function setLickRange(wide) {
  lickRangeWide = wide;
  document.querySelectorAll('.lick-range-btn').forEach(b => {
    b.classList.toggle('selected', (b.dataset.lrange === 'wide') === wide);
  });
}

function setLickCycle(n) {
  lickCycle = n;
  document.querySelectorAll('.lick-cycle-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.lcycle) === n);
  });
}

function setLickFeel(feel) {
  lickFeel = feel;
  document.querySelectorAll('.lick-feel-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.feel === feel);
  });
}

function updateLickTempoLabel() {
  lickBPM = parseInt(document.getElementById('lickTempoSlider').value);
  document.getElementById('lickTempoLabel').textContent = lickBPM + ' BPM';
}

function shuffleKeys() {
  // Shuffle array of 0-11 (pitch classes)
  const keys = Array.from({length: 12}, (_, i) => i);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}

function buildLickNotes(lick, rootMidi) {
  return lick.notes.map(s => rootMidi + s);
}

function pickLickRoot(pitchClass) {
  // Place the lick so all notes fit in range
  const lo = lickRangeWide ? INST_RANGE_ABS_LOW : RANGE_ABS_LOW;
  const hi = lickRangeWide ? INST_RANGE_ABS_HIGH : RANGE_ABS_HIGH;
  const minNote = Math.min(...currentLick.notes);
  const maxNote = Math.max(...currentLick.notes);
  // Find a root with this pitch class that fits
  for (let oct = 2; oct <= 6; oct++) {
    const root = pitchClass + oct * 12;
    if (root + minNote >= lo && root + maxNote <= hi) return root;
  }
  // Fallback: just use the lowest octave that fits
  const root = lo + pitchClass - (lo % 12);
  return root >= lo ? root : root + 12;
}

// Build progression grid
const progressionGrid = document.getElementById('progressionGrid');
PROGRESSIONS.forEach((prog, i) => {
  const btn = document.createElement('button');
  btn.className = 'scale-btn progression-btn';
  btn.innerHTML = `${prog.name}<span class="chord-label">${prog.short}</span>`;
  btn.dataset.idx = i;
  btn.addEventListener('click', () => {
    if (selectedProgressions.has(i)) {
      selectedProgressions.delete(i);
      btn.classList.remove('selected');
    } else {
      selectedProgressions.add(i);
      btn.classList.add('selected');
    }
    updateStartBtn();
  });
  progressionGrid.appendChild(btn);
});

function progressionPreset(p) {
  const btns = progressionGrid.querySelectorAll('.progression-btn');
  selectedProgressions.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'all') {
    PROGRESSIONS.forEach((_, i) => { selectedProgressions.add(i); btns[i].classList.add('selected'); });
  } else if (p !== 'none') {
    PROGRESSIONS.forEach((pr, i) => { if (pr.cat === p) { selectedProgressions.add(i); btns[i].classList.add('selected'); } });
  }
  updateStartBtn();
}

// Resolve a progression chord name to a CHORD_TYPES entry
function resolveChordType(chordName) {
  return CHORD_TYPES.find(ct => ct.name === chordName);
}

function toggleScaleDir(d) {
  if (d === 'both') {
    scaleDirBoth = !scaleDirBoth;
    if (scaleDirBoth) { scaleDirUp = false; scaleDirDown = false; }
    else { scaleDirUp = true; scaleDirDown = true; }
  } else if (d === 'up') {
    scaleDirUp = !scaleDirUp;
    scaleDirBoth = false;
    if (!scaleDirUp && !scaleDirDown) scaleDirDown = true;
  } else {
    scaleDirDown = !scaleDirDown;
    scaleDirBoth = false;
    if (!scaleDirUp && !scaleDirDown) scaleDirUp = true;
  }
  document.querySelectorAll('.scale-dir-btn').forEach(b => {
    if (b.dataset.sdir === 'up') b.classList.toggle('selected', scaleDirUp);
    if (b.dataset.sdir === 'down') b.classList.toggle('selected', scaleDirDown);
    if (b.dataset.sdir === 'both') b.classList.toggle('selected', scaleDirBoth);
  });
}

function setScaleRange(wide) {
  scaleRangeWide = wide;
  document.querySelectorAll('.scale-range-btn').forEach(b => {
    b.classList.toggle('selected', (b.dataset.srange === 'wide') === wide);
  });
}

function buildScaleNotes(rootMidi, scale) {
  // Build the scale notes
  let notes = [];
  // ascending: root + each interval
  const ascending = scale.intervals.map(s => rootMidi + s);
  // add octave
  ascending.push(rootMidi + 12);

  if (scaleDirBoth) {
    // Up then down (skip duplicate top note)
    notes = [...ascending, ...ascending.slice(0, -1).reverse()];
    scaleCurrentDir = 'up and down';
  } else if (scaleDirUp && scaleDirDown) {
    // Random pick each round
    if (Math.random() < 0.5) {
      notes = [...ascending];
      scaleCurrentDir = 'up';
    } else {
      notes = [...ascending].reverse();
      scaleCurrentDir = 'down';
    }
  } else if (scaleDirDown) {
    notes = [...ascending].reverse();
    scaleCurrentDir = 'down';
  } else {
    notes = [...ascending];
    scaleCurrentDir = 'up';
  }
  return notes;
}

function toggleBassAnnounce(on) {
  bassAnnounceKey = on;
  document.querySelectorAll('.bass-announce-btn').forEach(b => {
    b.classList.toggle('selected', (b.dataset.ann === 'on') === on);
  });
}

let speechWarmedUp = false;
function warmUpSpeech() {
  if (speechWarmedUp) return;
  speechWarmedUp = true;
  // Unlock speechSynthesis on first user interaction (crucial for mobile)
  speechSynthesis.cancel();
  const w = new SpeechSynthesisUtterance(' ');
  w.volume = 0;
  w.rate = 2;
  speechSynthesis.speak(w);
  speechSynthesis.getVoices();
}

function setMode(m) {
  warmUpSpeech(); // unlock speech early on first tap
  gameMode = m;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.mode === m);
  });
  const isHarmonic = (m === 'harmonic');
  const isChord = (m === 'chord');
  const isBass = (m === 'bass');
  const isScale = (m === 'scale');
  const isLicks = (m === 'licks');
  const isProgression = (m === 'progression');
  const isMelody = (m === 'melody' || m === 'harmonic');
  document.getElementById('intervalSetup').style.display = (isHarmonic || isChord || isBass || isScale || isLicks || isProgression) ? 'none' : '';
  document.getElementById('scaleSetup').style.display = isHarmonic ? '' : 'none';
  document.getElementById('chordSetup').style.display = isChord ? '' : 'none';
  document.getElementById('bassSetup').style.display = isBass ? '' : 'none';
  document.getElementById('scaleSingSetup').style.display = isScale ? '' : 'none';
  document.getElementById('licksSetup').style.display = isLicks ? '' : 'none';
  document.getElementById('progressionSetup').style.display = isProgression ? '' : 'none';
  document.querySelectorAll('.melody-only-setting').forEach(el => {
    el.style.display = isMelody ? '' : 'none';
  });
  // Hide the Chain/Root style picker in melody mode (doesn't apply there)
  document.querySelectorAll('.interval-style-only').forEach(el => {
    el.style.display = isMelody ? 'none' : '';
  });
  // In melody mode, also hide root-cycle row since style=chain is forced
  if (isMelody) {
    document.getElementById('rootCycleLabel').style.display = 'none';
    document.getElementById('rootCycleRow').style.display = 'none';
    document.getElementById('dirSectionLabel').style.display = '';
    document.getElementById('dirRow').style.display = '';
  } else {
    // Restore whatever the current intervalStyle wants
    setIntervalStyle(intervalStyle);
  }
  updateStartBtn();
}

function toggleDir(d) {
  if (d === 'up') dirUp = !dirUp;
  else dirDown = !dirDown;
  if (!dirUp && !dirDown) {
    if (d === 'up') dirDown = true;
    else dirUp = true;
  }
  document.querySelector('[data-dir="up"]').classList.toggle('selected', dirUp);
  document.querySelector('[data-dir="down"]').classList.toggle('selected', dirDown);
}

function preset(p) {
  const btns = grid.querySelectorAll('.interval-btn');
  selectedIntervals.clear();
  btns.forEach(b => b.classList.remove('selected'));
  if (p === 'easy') {
    [1,2,4,6].forEach(i => { selectedIntervals.add(i); btns[i].classList.add('selected'); });
  } else if (p === 'triads') {
    [2,3,4,6].forEach(i => { selectedIntervals.add(i); btns[i].classList.add('selected'); });
  } else if (p === 'diatonic') {
    // m2, M2, m3, M3, P4, P5, m6, M6, m7, M7, octave (skip tritone)
    [0,1,2,3,4,6,7,8,9,10,11].forEach(i => { selectedIntervals.add(i); btns[i].classList.add('selected'); });
  } else if (p === 'jazz') {
    // Octave + tensions: P8, b9, 9, #9, 11, #11, b13, 13
    [11,12,13,14,15,16,17,18].forEach(i => {
      if (INTERVALS[i]) { selectedIntervals.add(i); btns[i].classList.add('selected'); }
    });
  } else if (p === 'all') {
    INTERVALS.forEach((_, i) => { selectedIntervals.add(i); btns[i].classList.add('selected'); });
  }
  updateStartBtn();
}

function setIntervalStyle(style) {
  intervalStyle = style;
  document.querySelectorAll('[data-istyle]').forEach(b => {
    b.classList.toggle('selected', b.dataset.istyle === style);
  });
  // Root mode is always "up" — hide the direction row, show rounds-per-root
  const isRoot = (style === 'root');
  document.getElementById('dirSectionLabel').style.display = isRoot ? 'none' : '';
  document.getElementById('dirRow').style.display = isRoot ? 'none' : '';
  document.getElementById('rootCycleLabel').style.display = isRoot ? '' : 'none';
  document.getElementById('rootCycleRow').style.display = isRoot ? '' : 'none';
}

function setIntervalRoundsPerRoot(n) {
  intervalRoundsPerRoot = n;
  document.querySelectorAll('[data-rcyc]').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.rcyc) === n);
  });
}

function updateStartBtn() {
  if (gameMode === 'harmonic') {
    document.getElementById('startBtn').disabled = selectedScale === null;
  } else if (gameMode === 'chord') {
    document.getElementById('startBtn').disabled = selectedChords.size === 0;
  } else if (gameMode === 'bass') {
    document.getElementById('startBtn').disabled = selectedCadences.size === 0;
  } else if (gameMode === 'scale') {
    document.getElementById('startBtn').disabled = selectedScalesForSing.size === 0;
  } else if (gameMode === 'licks') {
    document.getElementById('startBtn').disabled = selectedLicks.size === 0;
  } else if (gameMode === 'progression') {
    document.getElementById('startBtn').disabled = selectedProgressions.size === 0;
  } else {
    document.getElementById('startBtn').disabled = selectedIntervals.size === 0;
  }
}

// Default: easy
preset('easy');

// ── PIANO BUILD ──
function buildPiano() {
  const piano = document.getElementById('piano');
  piano.innerHTML = '';
  let lo = getRangeAbsLow();
  let hi = getRangeAbsHigh();
  // In chord mode, ensure piano covers the actual voicing notes
  if (gameMode === 'chord' && chordRoot !== null && currentChordType) {
    const voiceLo = chordRoot + Math.min(...currentChordType.intervals);
    const voiceHi = chordRoot + Math.max(...currentChordType.intervals);
    lo = Math.min(lo, voiceLo);
    hi = Math.max(hi, voiceHi);
  }
  // In progression mode, ensure piano covers voicing notes
  if (gameMode === 'progression' && progCurrentRoot !== null && progCurrentChordType) {
    const voiceLo = progCurrentRoot + Math.min(...progCurrentChordType.intervals);
    const voiceHi = progCurrentRoot + Math.max(...progCurrentChordType.intervals);
    lo = Math.min(lo, voiceLo);
    hi = Math.max(hi, voiceHi);
  }
  // In root-style interval mode, the target may be up to a 13th (21 semitones) above the base.
  // Extend the piano upward so the target note is visible on the keyboard.
  if ((gameMode === 'voice' || gameMode === 'instrument') && intervalStyle === 'root' && selectedIntervals.size > 0) {
    let maxInterval = 0;
    for (const idx of selectedIntervals) {
      const iv = INTERVALS[idx];
      if (iv && iv.semitones > maxInterval) maxInterval = iv.semitones;
    }
    if (maxInterval > 0) hi = Math.max(hi, lo + maxInterval);
  }
  for (let midi = lo; midi <= hi; midi++) {
    const noteIdx = midi % 12;
    const isBlack = [1,3,6,8,10].includes(noteIdx);
    const key = document.createElement('div');
    key.className = 'piano-key' + (isBlack ? ' black' : '');
    key.dataset.midi = midi;
    piano.appendChild(key);
  }
}
buildPiano();

// ── REPLAY BASE NOTE ──
function playAnswer() {
  if (!gameActive || melodyPlaying) return;
  let notes;
  if (gameMode === 'progression') {
    if (!progCurrentChordType || progCurrentRoot === null) return;
    notes = progCurrentChordType.intervals.map(s => progCurrentRoot + s);
  } else if (isChordVoiceMode()) {
    notes = currentChordType.intervals.map(s => chordRoot + s);
  } else {
    return;
  }
  melodyPlaying = true;
  // Play all chord tones as arpeggio so the user can hear each note
  let i = 0;
  function playNext() {
    if (i < notes.length) {
      playNote(notes[i], 0.6);
      i++;
      setTimeout(playNext, 400);
    } else {
      // Then stack them together
      setTimeout(() => {
        notes.forEach(n => playNote(n, 1.2));
        setTimeout(() => { melodyPlaying = false; }, 1400);
      }, 300);
    }
  }
  playNext();
}

function replayBaseNote() {
  if (!gameActive || melodyPlaying) return;
  if (gameMode === 'bass') {
    playCadence(bassCadenceChords, () => {
      roundStart = performance.now();
    });
  } else if (gameMode === 'chord') {
    playChordForMode(chordRoot, currentChordType.intervals, () => {
      roundStart = performance.now();
    });
  } else if (gameMode === 'harmonic') {
    playChord(harmonicRoot, SCALES[selectedScale].chord, () => {
      playMelody(melodyNotes, () => {
        updateDisplay();
        roundStart = performance.now();
      });
    });
  } else if (gameMode === 'scale') {
    // Replay: announce scale name + play root
    const scale = SCALES[currentScaleForSing];
    announceScale(scaleRoot, scale.name, () => {
      playNote(scaleRoot, 0.8);
      setTimeout(() => { roundStart = performance.now(); }, 1000);
    });
  } else if (gameMode === 'licks') {
    playLick(lickNotes, () => {
      updateDisplay();
      roundStart = performance.now();
    });
  } else if (gameMode === 'progression') {
    // Replay: play root note of current chord
    playNote(progCurrentRoot, 1.0);
    setTimeout(() => { roundStart = performance.now(); }, 1200);
  } else if (gameMode === 'melody') {
    playMelody(melodyNotes, () => {
      updateDisplay();
      roundStart = performance.now();
    });
  } else {
    playNote(currentBaseMidi, 0.6);
    if (gameMode === 'instrument') {
      setTimeout(() => playNote(currentTargetMidi, 0.6), 500);
    }
  }
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && gameActive) {
    e.preventDefault();
    replayBaseNote();
  }
});
document.getElementById('replayHint')?.addEventListener('click', replayBaseNote);

function updatePianoHighlights(fromMidi, targetMidi, singingMidi) {
  document.querySelectorAll('.piano-key').forEach(k => {
    k.classList.remove('active-from', 'active-target', 'active-singing');
    const m = parseInt(k.dataset.midi);
    if (m === fromMidi) k.classList.add('active-from');
    if (m === targetMidi) k.classList.add('active-target');
    if (singingMidi !== null && m === singingMidi) k.classList.add('active-singing');
  });
}

// ── AUDIO ──
function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Master gain + compressor for balanced output (especially vs speech on mobile)
    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -20;
    compressor.knee.value = 10;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;
    compressor.connect(audioCtx.destination);
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.6; // leave headroom for speech
    masterGain.connect(compressor);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playNote(midi, duration = 2) {
  initAudio();
  const freq = midiToFreq(midi);
  const now = audioCtx.currentTime;

  // Rich tone: triangle + sine
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

  // Envelope
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.35, now + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.15, now + duration * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + duration);
  osc2.stop(now + duration);
}

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

// ── PITCH DETECTION (Autocorrelation) ──
async function startMic() {
  // On mobile, try without constraints first if strict constraints fail
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch(e) {
    // Fallback for mobile browsers that reject those constraints
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }
  micStream = stream;
  initAudio();
  // Resume AudioContext (required on mobile after user gesture)
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  // Use larger FFT for better low-frequency resolution on high sample rate devices
  const sr = audioCtx.sampleRate;
  analyser.fftSize = sr > 44100 ? 8192 : 4096;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  pitchBuffer = new Float32Array(analyser.fftSize);
  console.log('Mic started: sampleRate=' + sr + ', fftSize=' + analyser.fftSize);
}

function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }
}

function detectPitch() {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(pitchBuffer);

  // Check RMS to filter silence (lower threshold for mobile mics)
  let rms = 0;
  for (let i = 0; i < pitchBuffer.length; i++) rms += pitchBuffer[i] * pitchBuffer[i];
  rms = Math.sqrt(rms / pitchBuffer.length);
  if (rms < RMS_THRESHOLD) return null;

  // Autocorrelation
  const SIZE = pitchBuffer.length;
  const corr = new Float32Array(SIZE);
  for (let lag = 0; lag < SIZE; lag++) {
    let sum = 0;
    for (let i = 0; i < SIZE - lag; i++) {
      sum += pitchBuffer[i] * pitchBuffer[i + lag];
    }
    corr[lag] = sum;
  }

  // Find first dip then peak
  let d = 0;
  while (d < SIZE - 1 && corr[d] > corr[d + 1]) d++;

  let maxVal = -1, maxIdx = -1;
  const sampleRate = audioCtx.sampleRate;
  const minLag = Math.floor(sampleRate / 600); // max ~600Hz
  const maxLag = Math.floor(sampleRate / 55);  // min ~55Hz

  for (let i = Math.max(d, minLag); i < Math.min(SIZE - 1, maxLag); i++) {
    if (corr[i] > maxVal) {
      maxVal = corr[i];
      maxIdx = i;
    }
  }

  if (maxIdx === -1 || maxVal < 0.01) return null;

  // Parabolic interpolation for better accuracy
  const y1 = maxIdx > 0 ? corr[maxIdx - 1] : corr[maxIdx];
  const y2 = corr[maxIdx];
  const y3 = maxIdx < SIZE - 1 ? corr[maxIdx + 1] : corr[maxIdx];
  const shift = (y3 - y1) / (2 * (2 * y2 - y1 - y3));
  const refinedLag = maxIdx + (isFinite(shift) ? shift : 0);

  const freq = sampleRate / refinedLag;
  if (freq < 55 || freq > 600) return null;

  // Confidence check (relaxed for mobile mics)
  if (corr[maxIdx] / corr[0] < CONFIDENCE_THRESHOLD) return null;

  return freq;
}

// ── CHORD PLAYBACK ──
function speak(text, callback) {
  // If voice announcements are disabled, skip speech entirely
  if (!ANNOUNCE_VOICE) {
    if (callback) setTimeout(callback, 50);
    return;
  }
  // Cancel any queued speech to avoid pile-ups
  speechSynthesis.cancel();

  // Duck music volume during speech so voice is clearly heard
  if (masterGain) {
    masterGain.gain.setTargetAtTime(0.15, audioCtx.currentTime, 0.05);
  }

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1.0;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    // Restore music volume
    if (masterGain) {
      masterGain.gain.setTargetAtTime(0.6, audioCtx.currentTime, 0.1);
    }
    if (callback) callback();
  };

  utter.onend = finish;
  utter.onerror = finish;
  speechSynthesis.speak(utter);

  // Fallback: if onend/onerror never fire (common on mobile)
  const estimatedMs = Math.max(1500, text.length * 100);
  setTimeout(finish, estimatedMs);
}

function announceScale(rootMidi, scaleName, callback) {
  const noteName = midiToName(rootMidi).replace('#', ' sharp').replace('b', ' flat');
  speak(`${noteName} ${scaleName}, ${scaleCurrentDir}`, callback);
}

function playChord(rootMidi, chordIntervals, callback) {
  initAudio();
  melodyPlaying = true;
  const arpeggioSpacing = 250;
  const holdDuration = 1.2;

  // Arpeggio up
  chordIntervals.forEach((semitones, i) => {
    setTimeout(() => {
      playNote(rootMidi + semitones, holdDuration);
    }, i * arpeggioSpacing);
  });

  // Stack all notes after arpeggio
  const stackTime = chordIntervals.length * arpeggioSpacing;
  setTimeout(() => {
    chordIntervals.forEach(semitones => {
      playNote(rootMidi + semitones, 1.0);
    });
  }, stackTime);

  const totalTime = stackTime + 1200;
  setTimeout(() => {
    melodyPlaying = false;
    if (callback) callback();
  }, totalTime);
}

// ── HARMONIC MELODY GENERATION ──
function generateHarmonicMelody(length, rootMidi, scale) {
  // Build all valid MIDI notes in this scale within singable range
  const scaleTones = [];
  for (let octaveOffset = -24; octaveOffset <= 24; octaveOffset += 12) {
    for (const interval of scale.intervals) {
      const midi = rootMidi + octaveOffset + interval;
      if (midi >= getRangeAbsLow() && midi <= getRangeAbsHigh()) {
        scaleTones.push(midi);
      }
    }
  }
  const uniqueTones = [...new Set(scaleTones)].sort((a, b) => a - b);
  if (uniqueTones.length === 0) return [rootMidi];

  const notes = [];
  // Start on a random guide tone (1, 3, 5, 7, 9 of the scale)
  const guideDegrees = [0, 2, 4, 6]; // scale degree indices: 1st, 3rd, 5th, 7th
  // Add 9th (2nd degree up an octave concept, but just degree index 1)
  if (scale.intervals.length > 1) guideDegrees.push(1);
  // Pick a random guide tone and find it in our available tones
  const degIdx = guideDegrees[Math.floor(Math.random() * guideDegrees.length)];
  const guideInterval = scale.intervals[degIdx % scale.intervals.length];
  // Find the closest matching tone to rootMidi + guideInterval
  const guideTarget = rootMidi + guideInterval;
  let currentIdx = uniqueTones.findIndex(t => t === guideTarget);
  if (currentIdx === -1) {
    // Find nearest available tone
    let minDist = Infinity;
    uniqueTones.forEach((t, i) => {
      const d = Math.abs(t - guideTarget);
      if (d < minDist) { minDist = d; currentIdx = i; }
    });
  }
  if (currentIdx === -1) currentIdx = Math.floor(uniqueTones.length / 2);
  notes.push(uniqueTones[currentIdx]);

  for (let n = 1; n < length; n++) {
    // Move 1-3 scale steps, random direction (stepwise bias)
    const maxStep = Math.min(3, Math.floor(uniqueTones.length / 2));
    const step = Math.floor(Math.random() * maxStep) + 1;
    const dir = Math.random() < 0.5 ? 1 : -1;
    let newIdx = currentIdx + dir * step;
    newIdx = Math.max(0, Math.min(uniqueTones.length - 1, newIdx));
    // Avoid repeating same note
    if (newIdx === currentIdx && uniqueTones.length > 1) {
      newIdx = currentIdx + (currentIdx > 0 ? -1 : 1);
    }
    currentIdx = newIdx;
    notes.push(uniqueTones[currentIdx]);
  }
  return notes;
}

// ── MELODY HELPERS ──
function generateMelody(length) {
  const intervals = [...selectedIntervals].map(i => INTERVALS[i]);
  const dirs = [];
  if (dirUp) dirs.push(1);
  if (dirDown) dirs.push(-1);

  const notes = [];
  let note = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
  notes.push(note);

  for (let n = 1; n < length; n++) {
    let found = false;
    for (let attempts = 0; attempts < 50; attempts++) {
      const iv = intervals[Math.floor(Math.random() * intervals.length)];
      let d = dirs[Math.floor(Math.random() * dirs.length)];
      const target = note + d * iv.semitones;
      // Bias direction to stay in range
      if (target < getRangeLow() && d === -1 && dirs.includes(1)) d = 1;
      if (target > getRangeHigh() && d === 1 && dirs.includes(-1)) d = -1;
      const finalTarget = note + d * iv.semitones;
      if (finalTarget >= getRangeAbsLow() && finalTarget <= getRangeAbsHigh()) {
        note = finalTarget;
        notes.push(note);
        found = true;
        break;
      }
    }
    if (!found) {
      // Fallback
      const iv = intervals[0];
      const d = note > 52 ? -1 : 1;
      note = note + d * iv.semitones;
      notes.push(note);
    }
  }
  return notes;
}

function playMelody(notes, callback) {
  melodyPlaying = true;
  const spacing = 1200; // ms between notes
  notes.forEach((midi, i) => {
    setTimeout(() => {
      playNote(midi, 1);
      // Highlight current note on piano during playback
      updatePianoHighlights(null, midi, null);
      document.getElementById('intervalDisplay').textContent = `Listen... ${i + 1}/${notes.length}`;
    }, i * spacing);
  });
  setTimeout(() => {
    melodyPlaying = false;
    if (callback) callback();
  }, notes.length * spacing);
}

function playLick(notes, callback) {
  melodyPlaying = true;
  // Eighth note duration from BPM: one beat = 60/BPM seconds, eighth = half a beat
  const eighthMs = (60 / lickBPM) * 1000 / 2;
  // Swing ratios: straight = 1:1, swing = ~2:1 (triplet), hard = 3:1
  const swingRatio = lickFeel === 'hard' ? 0.75 : lickFeel === 'swing' ? 0.667 : 0.5;
  // Duration of each note (slightly shorter than spacing for articulation)
  const noteDur = eighthMs * 1.8 / 1000; // in seconds for playNote

  // Calculate timing for each note with swing
  const times = [];
  let t = 0;
  for (let i = 0; i < notes.length; i++) {
    times.push(t);
    // Swing: long-short pattern on pairs of eighth notes
    if (i % 2 === 0) {
      t += eighthMs * 2 * swingRatio; // long
    } else {
      t += eighthMs * 2 * (1 - swingRatio); // short
    }
  }

  notes.forEach((midi, i) => {
    setTimeout(() => {
      playNote(midi, noteDur);
      updatePianoHighlights(null, midi, null);
      document.getElementById('intervalDisplay').textContent = `Listen... ${i + 1}/${notes.length}`;
    }, times[i]);
  });

  const totalTime = times[times.length - 1] + eighthMs * 2;
  setTimeout(() => {
    melodyPlaying = false;
    if (callback) callback();
  }, totalTime);
}

// ── CHORD MODE HELPERS ──
function pickChordRootFor(chordType) {
  // Pick any pitch class, then place the root in the right octave
  const pc = Math.floor(Math.random() * 12);
  if (isChordSing()) {
    return placeChordRootForSinging(pc, chordType);
  }
  return placeChordRoot(pc, chordType);
}

function placeChordRoot(pitchClass, chordType) {
  // Find the octave for this root where the voicing sits around middle C
  // Jazz rule: voicing should include or be near C4 (MIDI 60)
  const middleC = 60;
  let bestRoot = null;
  let bestDist = Infinity;
  for (let oct = 2; oct <= 6; oct++) {
    const root = pitchClass + oct * 12;
    const lowest = root + Math.min(...chordType.intervals);
    const highest = root + Math.max(...chordType.intervals);
    const center = (lowest + highest) / 2;
    const dist = Math.abs(center - middleC);
    if (dist < bestDist) {
      bestDist = dist;
      bestRoot = root;
    }
  }
  return bestRoot;
}

function placeChordRootForSinging(pitchClass, chordType) {
  // For singing: place voicing in the lower part of the vocal range
  // so all notes are comfortably singable
  const lo = CHORD_SING_LOW;
  const hi = CHORD_SING_HIGH;
  let bestRoot = null;
  let bestScore = Infinity;
  for (let oct = 1; oct <= 6; oct++) {
    const root = pitchClass + oct * 12;
    const lowest = root + Math.min(...chordType.intervals);
    const highest = root + Math.max(...chordType.intervals);
    // All notes must fit inside the singing range
    if (lowest < lo || highest > hi) continue;
    // Prefer placing at the lower end of the range
    const score = lowest - lo;
    if (score < bestScore) {
      bestScore = score;
      bestRoot = root;
    }
  }
  return bestRoot !== null ? bestRoot : placeChordRoot(pitchClass, chordType);
}

function chordFitsRoot(chordType, root) {
  // Always fits — we place voicings around middle C
  return true;
}

function chooseNextChord() {
  const indices = [...selectedChords];
  let candidates = indices;
  if (indices.length > 1 && currentChordType) {
    const lastIdx = CHORD_TYPES.indexOf(currentChordType);
    candidates = indices.filter(i => i !== lastIdx);
  }
  const idx = candidates[Math.floor(Math.random() * candidates.length)];
  currentChordType = CHORD_TYPES[idx];
  // Place voicing: around middle C for instruments, lower vocal range for singing
  chordRoot = isChordSing()
    ? placeChordRootForSinging(chordRoot % 12, currentChordType)
    : placeChordRoot(chordRoot % 12, currentChordType);
  chordTargetNotes = new Set(currentChordType.intervals.map(s => chordRoot + s));
  chordHitNotes = new Set();
  holdingForMidi = null;
  buildPiano(); // rebuild piano to fit this voicing
}

function updateChordPiano(singingMidi, heldMidiNotes) {
  const showTargets = isChordVoiceMode(); // only show target notes in voice modes (sing/call)
  document.querySelectorAll('.piano-key').forEach(k => {
    k.classList.remove('active-from', 'active-target', 'active-singing');
    const m = parseInt(k.dataset.midi);
    if (chordHitNotes.has(m)) k.classList.add('active-singing'); // green
    if (showTargets && chordTargetNotes.has(m)) k.classList.add('active-target'); // cyan — only in voice modes
    if (singingMidi !== null && m === singingMidi) k.classList.add('active-from'); // magenta = currently playing
    if (heldMidiNotes && heldMidiNotes.has(m)) k.classList.add('active-from'); // magenta = MIDI held
  });
}

// ── PROGRESSION MODE HELPERS ──
let progChordRootDisplay = ''; // jazz-friendly name for current chord root

function setupProgChord() {
  const chordDef = currentProgression.chords[progChordIndex];
  progCurrentChordType = resolveChordType(chordDef.chordName);
  const chordRootPC = (progKeyRoot + chordDef.degRoot) % 12;
  progCurrentRoot = placeChordRoot(chordRootPC, progCurrentChordType);
  progTargetNotes = new Set(progCurrentChordType.intervals.map(s => progCurrentRoot + s));
  progHitNotes = new Set();
  progChordRootDisplay = jazzNoteName(chordRootPC);
}

function updateProgressionPiano() {
  document.querySelectorAll('.piano-key').forEach(k => {
    k.classList.remove('active-from', 'active-target', 'active-singing');
    const m = parseInt(k.dataset.midi);
    if (progHitNotes.has(m)) k.classList.add('active-singing');
    if (progTargetNotes.has(m)) k.classList.add('active-target');
    if (useMidi && midiHeldNotes.has(m)) k.classList.add('active-from');
  });
}

function playChordConfirmBeep() {
  initAudio();
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = 'sine';
  osc.frequency.value = 880;
  osc.connect(g);
  g.connect(masterGain);
  g.gain.setValueAtTime(0.1, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.start(now);
  osc.stop(now + 0.15);
}

// ── BASS MODE HELPERS ──
function pickBassKey() {
  return Math.floor(Math.random() * 12);
}

function buildBassRound() {
  bassUseTypeB = Math.random() < 0.5;
  bassCadenceChords = [];
  bassNotes = [];
  bassIndex = 0;

  currentCadence.chords.forEach(chord => {
    const chordRootPC = (bassKeyRoot + chord.degRoot) % 12;

    // Bass note in octave 2 (MIDI 36-47)
    const bassNote = 36 + chordRootPC;
    bassNotes.push(bassNote);

    // Voicing: place around C4 area (MIDI 48+)
    const voicing = VOICINGS[chord.quality];
    const intervals = bassUseTypeB ? voicing.B : voicing.A;
    const voicingBase = 48 + chordRootPC;
    const voicingMidi = intervals.map(iv => voicingBase + iv);
    console.log(`Bass chord: ${chord.name}, root MIDI ${bassNote}, voicing MIDI ${voicingMidi}`);
    bassCadenceChords.push(voicingMidi);
  });
}

function playCadence(chordArrays, callback) {
  melodyPlaying = true;
  const chordDuration = 1.2;
  const chordSpacing = 1500;

  chordArrays.forEach((notes, i) => {
    setTimeout(() => {
      notes.forEach(midi => playNote(midi, chordDuration));
    }, i * chordSpacing);
  });

  setTimeout(() => {
    melodyPlaying = false;
    if (callback) callback();
  }, chordArrays.length * chordSpacing);
}

function announceBassKey(pitchClass, isMinor, callback) {
  const name = speechify(currentKeyDisplay);
  const quality = isMinor ? 'minor' : 'major';
  speak(`${name} ${quality}`, callback);
}

function updateBassPiano(singingMidi) {
  document.querySelectorAll('.piano-key').forEach(k => {
    k.classList.remove('active-from', 'active-target', 'active-singing');
    const m = parseInt(k.dataset.midi);
    // Green for already-hit bass notes
    if (bassNotes.slice(0, bassIndex).includes(m)) k.classList.add('active-singing');
    // Cyan for current target
    if (bassIndex < bassNotes.length && m === bassNotes[bassIndex]) k.classList.add('active-target');
    // Magenta for what user is currently playing
    if (singingMidi !== null && m === singingMidi) k.classList.add('active-from');
  });
}

// ── GAME LOGIC ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('settings').classList.remove('active');
  document.getElementById('settingsGear').style.display = id === 'setup' ? '' : 'none';
  document.getElementById(id).classList.add('active');
}

function chooseNextChallenge() {
  const intervals = [...selectedIntervals].map(i => INTERVALS[i]);
  const dirs = [];
  if (intervalStyle === 'root') {
    dirs.push(1); // root mode: always up
  } else {
    if (dirUp) dirs.push(1);
    if (dirDown) dirs.push(-1);
  }

  // Root mode: don't skip oversized intervals — we match pitch class, so target can be
  // displayed high but the singer can sing the note at any octave.
  if (intervalStyle === 'root') {
    // Avoid repeating the exact same interval twice in a row when possible
    let iv = intervals[Math.floor(Math.random() * intervals.length)];
    if (intervals.length > 1 && currentInterval && iv === currentInterval) {
      for (let k = 0; k < 5 && iv === currentInterval; k++) {
        iv = intervals[Math.floor(Math.random() * intervals.length)];
      }
    }
    currentInterval = iv;
    currentDir = 1;
    currentTargetMidi = currentBaseMidi + iv.semitones;
    // If target shares pitch class with the root (octave interval), keep the same
    // enharmonic spelling as the base so "Bb3" → "Bb4", not "A#4".
    const samePC = (currentTargetMidi % 12) === (currentBaseMidi % 12);
    if (samePC && currentBaseName) {
      const letters = currentBaseName.replace(/-?\d+$/, '');
      const octave = Math.floor(currentTargetMidi / 12) - 1;
      currentTargetName = letters + octave;
    } else {
      currentTargetName = midiToNameJazz(currentTargetMidi);
    }
    return;
  }

  // Chain mode: try to pick a valid combo
  for (let attempts = 0; attempts < 50; attempts++) {
    const iv = intervals[Math.floor(Math.random() * intervals.length)];
    let d = dirs[Math.floor(Math.random() * dirs.length)];

    // Bias direction to stay in range
    const target = currentBaseMidi + d * iv.semitones;
    if (target < getRangeLow() && d === -1 && dirs.includes(1)) d = 1;
    if (target > getRangeHigh() && d === 1 && dirs.includes(-1)) d = -1;

    const finalTarget = currentBaseMidi + d * iv.semitones;
    if (finalTarget >= getRangeAbsLow() && finalTarget <= getRangeAbsHigh()) {
      currentInterval = iv;
      currentDir = d;
      currentTargetMidi = finalTarget;
      currentTargetName = midiToNameJazz(currentTargetMidi);
      return;
    }
  }

  // Fallback: just pick something in range
  const iv = intervals[0];
  currentDir = currentBaseMidi > 48 ? -1 : 1;
  currentInterval = iv;
  currentTargetMidi = currentBaseMidi + currentDir * iv.semitones;
  currentTargetName = midiToNameJazz(currentTargetMidi);
}

// Pick a low root that gives headroom for jazz intervals (up to 21 semitones / 13th)
function pickRootBaseMidi() {
  // Stay in the lower third of the available range so large intervals fit comfortably
  const lo = getRangeAbsLow();
  const hi = getRangeAbsHigh();
  // Prefer the bottom octave (or less, if the range is small)
  const span = Math.min(12, Math.max(1, hi - lo));
  return lo + Math.floor(Math.random() * (span + 1));
}

function updateDisplay() {
  const dirLabel = currentDir > 0 ? 'Up' : 'Down';
  document.getElementById('scoreDisplay').textContent = score;
  document.getElementById('hiScoreGame').textContent = `BEST: ${hiScore}`;
  // Hide answer button by default; chord mode will show it for sing
  document.getElementById('answerBtn').style.display = 'none';

  if (gameMode === 'bass') {
    document.getElementById('hiScoreGame').textContent = `BEST: ${hiScoreBass}`;
    const isSingle = currentCadence.chords.length === 1;
    const chordName = currentCadence.chords[bassIndex] ? currentCadence.chords[bassIndex].name : '✓';
    document.getElementById('intervalDisplay').textContent = isSingle
      ? `${chordName}`
      : `${currentCadence.name} — ${chordName} (${bassIndex + 1}/${bassNotes.length})`;
    document.getElementById('noteFrom').textContent = `Key: ${currentKeyDisplay}`;
    document.getElementById('noteTarget').textContent = bassIndex < bassNotes.length ? midiToName(bassNotes[bassIndex]) : '✓';
    document.getElementById('arrowDir').innerHTML = '&#127928;';
    document.getElementById('replayHint').innerHTML = isSingle
      ? 'Press <kbd>SPACE</kbd> or tap here to replay chord'
      : 'Press <kbd>SPACE</kbd> or tap here to replay cadence';
    updateBassPiano(null);
  } else if (gameMode === 'chord') {
    document.getElementById('hiScoreGame').textContent = `BEST: ${hiScoreChord}`;
    const remaining = chordTargetNotes.size;
    const total = currentChordType.intervals.length;
    if (isChordVoiceMode()) {
      document.getElementById('intervalDisplay').textContent = `${currentChordType.name} — ${remaining} note${remaining !== 1 ? 's' : ''} left`;
      document.getElementById('noteFrom').textContent = `Root: ${currentKeyDisplay}`;
    } else {
      document.getElementById('intervalDisplay').textContent = `${remaining} note${remaining !== 1 ? 's' : ''} left`;
      document.getElementById('noteFrom').textContent = `Root: ${currentKeyDisplay}`;
    }
    document.getElementById('noteTarget').textContent = `${chordHitNotes.size}/${total}`;
    document.getElementById('arrowDir').innerHTML = '&#127927;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to replay chord';
    document.getElementById('answerBtn').style.display = isChordVoiceMode() ? '' : 'none';
    updateChordPiano(null);
  } else if (gameMode === 'melody' || gameMode === 'harmonic') {
    const hi = gameMode === 'harmonic' ? hiScoreHarmonic : hiScoreMelody;
    document.getElementById('hiScoreGame').textContent = `BEST: ${hi}`;
    if (gameMode === 'harmonic') {
      const scale = SCALES[selectedScale];
      document.getElementById('intervalDisplay').textContent = `${scale.name} | Note ${melodyIndex + 1} / ${melodyNotes.length}`;
      document.getElementById('noteFrom').textContent = `${midiToNoteLetter(harmonicRoot)} ${scale.chordName}`;
    } else {
      document.getElementById('intervalDisplay').textContent = `Note ${melodyIndex + 1} / ${melodyNotes.length}`;
      document.getElementById('noteFrom').textContent = `Rd: ${melodyRound + 1}`;
    }
    document.getElementById('noteTarget').textContent = midiToName(melodyNotes[melodyIndex]);
    document.getElementById('arrowDir').innerHTML = '&#127926;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to hear ' + (gameMode === 'harmonic' ? 'chord + melody' : 'melody') + ' again';
    updatePianoHighlights(null, melodyNotes[melodyIndex], null);
  } else if (gameMode === 'scale') {
    document.getElementById('hiScoreGame').textContent = `BEST: ${hiScoreScale}`;
    const scale = SCALES[currentScaleForSing];
    const dirArrow = scaleCurrentDir === 'down' ? '↓' : scaleCurrentDir === 'up and down' ? '↕' : '↑';
    document.getElementById('intervalDisplay').textContent = `${scale.name} ${dirArrow} — Note ${scaleNoteIndex + 1} / ${scaleNotes.length}`;
    document.getElementById('noteFrom').textContent = `Root: ${midiToName(scaleRoot)}`;
    document.getElementById('noteTarget').textContent = midiToName(scaleNotes[scaleNoteIndex]);
    document.getElementById('arrowDir').innerHTML = '&#127925;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to hear scale again';
    updatePianoHighlights(null, scaleNotes[scaleNoteIndex], null);
  } else if (gameMode === 'licks') {
    document.getElementById('hiScoreGame').textContent = `BEST: ${hiScoreLick}`;
    document.getElementById('intervalDisplay').textContent = `${currentLick.name} in ${currentKeyDisplay} — Note ${lickNoteIndex + 1} / ${lickNotes.length}`;
    document.getElementById('noteFrom').textContent = `Key: ${currentKeyDisplay}`;
    document.getElementById('noteTarget').textContent = midiToName(lickNotes[lickNoteIndex]);
    document.getElementById('arrowDir').innerHTML = '&#127927;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to replay lick';
    updatePianoHighlights(null, lickNotes[lickNoteIndex], null);
  } else if (gameMode === 'progression') {
    document.getElementById('hiScoreGame').textContent = `BEST: ${hiScoreProgression}`;
    const chordDef = currentProgression.chords[progChordIndex];
    document.getElementById('intervalDisplay').textContent = `${currentProgression.name} in ${currentKeyDisplay}`;
    document.getElementById('noteFrom').textContent = `Chord ${progChordIndex + 1}/${currentProgression.chords.length}: ${chordDef.chordName}`;
    document.getElementById('noteTarget').textContent = `${progChordRootDisplay} root`;
    document.getElementById('arrowDir').innerHTML = '&#127929;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to hear root';
    document.getElementById('answerBtn').style.display = '';
    updateProgressionPiano();
  } else if (gameMode === 'instrument') {
    document.getElementById('intervalDisplay').textContent = 'Listen & Play';
    document.getElementById('noteFrom').textContent = '?';
    document.getElementById('noteTarget').textContent = '?';
    document.getElementById('arrowDir').innerHTML = '&#127911;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to replay both notes';
    updatePianoHighlights(null, null, null);
  } else {
    const styleTag = intervalStyle === 'root' ? ' · Root' : '';
    document.getElementById('intervalDisplay').textContent = `${currentInterval.name} ${dirLabel}${styleTag}`;
    document.getElementById('noteFrom').textContent = currentBaseName || midiToNameJazz(currentBaseMidi);
    document.getElementById('noteTarget').textContent = HIDE_TARGET ? '?' : (currentTargetName || midiToNameJazz(currentTargetMidi));
    document.getElementById('arrowDir').innerHTML = currentDir > 0 ? '&#9650;' : '&#9660;';
    document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to replay base note';
    // Hide the target on the piano too when HIDE_TARGET is on, unless we're in instrument mode
    // (instrument mode already doesn't highlight a target; see onSuccess reveal).
    const pianoTarget = HIDE_TARGET ? null : currentTargetMidi;
    updatePianoHighlights(currentBaseMidi, pianoTarget, null);
  }
}

function updateTimeLabel() {
  const v = document.getElementById('timeSlider').value;
  document.getElementById('timeLabel').textContent = v + 's';
}

function setMelodySpeed(speed) {
  melodySpeed = speed;
  document.querySelectorAll('.speed-btn').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.speed) === speed);
  });
}

function setChordPlayback(mode) {
  chordPlayback = mode;
  document.querySelectorAll('.chord-play-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.cplay === mode);
  });
  if (gameMode === 'chord') buildPiano();
}

function playChordForMode(rootMidi, intervals, callback) {
  if (chordPlayback === 'sing' || chordPlayback === 'call') {
    // Sing mode — voice-announce chord name, play only the root
    melodyPlaying = true;
    const rootLabel = speechify(currentKeyDisplay);
    const spokenName = speechify(currentChordType.name);
    const chordLabel = rootLabel + ' ' + spokenName;
    speak(chordLabel, () => {
      if (AUTO_PLAY_INTRO) {
        playNote(rootMidi, 1.0);
        setTimeout(() => {
          melodyPlaying = false;
          if (callback) callback();
        }, 1200);
      } else {
        melodyPlaying = false;
        if (callback) callback();
      }
    });
  } else if (chordPlayback === 'stack') {
    // Stack only — play all notes simultaneously
    melodyPlaying = true;
    intervals.forEach(semitones => {
      playNote(rootMidi + semitones, 1.5);
    });
    setTimeout(() => {
      melodyPlaying = false;
      if (callback) callback();
    }, 1700);
  } else {
    // Arpeggio + stack (existing behavior)
    playChord(rootMidi, intervals, callback);
  }
}

async function startGame() {
  TIMEOUT = parseInt(document.getElementById('timeSlider').value) * 1000;

  if (useMidi) {
    const ok = await initMidi();
    if (!ok) return;
    midiHeldNotes.clear();
    initAudio();
  } else {
    try {
      await startMic();
    } catch (e) {
      alert('Microphone access is required for NoteChaser. Please allow mic access and try again.');
      return;
    }
    initAudio();
  }

  // Ensure speech is warmed up (in case setMode wasn't tapped)
  warmUpSpeech();

  score = 0;
  holdStart = 0;

  document.getElementById('streakDots').innerHTML = '';
  document.getElementById('holdProgress').style.width = '0%';
  document.getElementById('singingNote').innerHTML = '&nbsp;';

  showScreen('game');

  if (gameMode === 'bass') {
    bassKeyRoot = pickBassKey();
    currentKeyDisplay = jazzNoteName(bassKeyRoot);
    const indices = [...selectedCadences];
    currentCadence = CADENCES[indices[Math.floor(Math.random() * indices.length)]];
    score = 0;
    buildPiano();
    buildBassRound();
    updateDisplay();

    const beginGame = () => {
      updateDisplay();
      gameActive = true;
      roundStart = performance.now();
      gameLoop();
    };
    const startListening = () => {
      if (AUTO_PLAY_INTRO) {
        playCadence(bassCadenceChords, beginGame);
      } else {
        beginGame();
      }
    };

    setTimeout(() => {
      if (bassAnnounceKey) {
        const isMinor = currentCadence.cat === 'minor' || currentCadence.name === 'Im7';
        announceBassKey(bassKeyRoot, isMinor, startListening);
      } else {
        startListening();
      }
    }, 400);
  } else if (gameMode === 'chord') {
    chordRoot = Math.floor(Math.random() * 12); // random pitch class
    currentKeyDisplay = jazzNoteName(chordRoot);
    currentChordType = null;
    chordRoundsOnRoot = 0;
    score = 0;
    chooseNextChord(); // picks chord + places root around middle C + builds piano
    updateDisplay();

    setTimeout(() => {
      const beginGame = () => {
        gameActive = true;
        roundStart = performance.now();
        gameLoop();
      };
      if (chordPlayback === 'sing' || chordPlayback === 'call') {
        // sing/call always calls playChordForMode — it handles the
        // auto-play toggle for the root note internally, but still speaks
        playChordForMode(chordRoot, currentChordType.intervals, beginGame);
      } else if (AUTO_PLAY_INTRO) {
        speak(speechify(currentKeyDisplay), () => {
          playChordForMode(chordRoot, currentChordType.intervals, beginGame);
        });
      } else {
        speak(speechify(currentKeyDisplay), beginGame);
      }
    }, 400);
  } else if (gameMode === 'progression') {
    score = 0;
    progChordIndex = 0;
    progKeyRoot = Math.floor(Math.random() * 12);
    currentKeyDisplay = jazzNoteName(progKeyRoot);
    // Pick random progression
    const progIndices = [...selectedProgressions];
    currentProgression = PROGRESSIONS[progIndices[Math.floor(Math.random() * progIndices.length)]];
    setupProgChord();
    buildPiano();
    updateDisplay();

    setTimeout(() => {
      // Announce progression name and key
      speak(`${speechify(currentProgression.name)}, in ${speechify(currentKeyDisplay)}`, () => {
        const beginGame = () => {
          gameActive = true;
          roundStart = performance.now();
          gameLoop();
        };
        if (AUTO_PLAY_INTRO) {
          playNote(progCurrentRoot, 1.0);
          setTimeout(beginGame, 1200);
        } else {
          beginGame();
        }
      });
    }, 400);
  } else if (gameMode === 'scale') {
    score = 0;
    scaleNoteIndex = 0;
    // Pick random scale from selection
    const scaleIndices = [...selectedScalesForSing];
    currentScaleForSing = scaleIndices[Math.floor(Math.random() * scaleIndices.length)];
    const scale = SCALES[currentScaleForSing];
    // Pick root within vocal range
    scaleRoot = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
    scaleNotes = buildScaleNotes(scaleRoot, scale);
    buildPiano();
    updateDisplay();

    setTimeout(() => {
      announceScale(scaleRoot, scale.name, () => {
        const beginGame = () => {
          gameActive = true;
          roundStart = performance.now();
          gameLoop();
        };
        if (AUTO_PLAY_INTRO) {
          playNote(scaleRoot, 0.8);
          setTimeout(beginGame, 1000);
        } else {
          beginGame();
        }
      });
    }, 400);
  } else if (gameMode === 'licks') {
    score = 0;
    lickNoteIndex = 0;
    lickKeysPlayed = 0;
    lickKeyOrder = shuffleKeys();
    lickKeyIndex = 0;
    currentKeyDisplay = jazzNoteName(lickKeyOrder[0]);
    // Pick first lick
    const lickIndices = [...selectedLicks];
    currentLick = LICKS[lickIndices[Math.floor(Math.random() * lickIndices.length)]];
    lickRoot = pickLickRoot(lickKeyOrder[0]);
    lickNotes = buildLickNotes(currentLick, lickRoot);
    buildPiano();
    updateDisplay();

    setTimeout(() => {
      speak(`${currentLick.name}, in ${speechify(currentKeyDisplay)}`, () => {
        const beginGame = () => {
          updateDisplay();
          gameActive = true;
          roundStart = performance.now();
          gameLoop();
        };
        if (AUTO_PLAY_INTRO) {
          playLick(lickNotes, beginGame);
        } else {
          beginGame();
        }
      });
    }, 400);
  } else if (gameMode === 'melody' || gameMode === 'harmonic') {
    melodyLength = 2;
    melodyRound = 0;
    melodyIndex = 0;

    if (gameMode === 'harmonic') {
      harmonicRoot = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
      melodyNotes = generateHarmonicMelody(melodyLength, harmonicRoot, SCALES[selectedScale]);
    } else {
      melodyNotes = generateMelody(melodyLength);
    }

    score = 0;
    buildPiano(); // rebuild piano for mode's range
    updateDisplay();

    const beginMelodyGame = () => {
      updateDisplay();
      gameActive = true;
      roundStart = performance.now();
      gameLoop();
    };
    const startListening = () => {
      if (AUTO_PLAY_INTRO) {
        playMelody(melodyNotes, beginMelodyGame);
      } else {
        beginMelodyGame();
      }
    };

    setTimeout(() => {
      if (gameMode === 'harmonic') {
        // Announce scale name, then play chord, then start
        announceScale(harmonicRoot, SCALES[selectedScale].name, () => {
          if (AUTO_PLAY_INTRO) {
            playChord(harmonicRoot, SCALES[selectedScale].chord, startListening);
          } else {
            startListening();
          }
        });
      } else {
        startListening();
      }
    }, 400);
  } else {
    if (intervalStyle === 'root') {
      currentBaseMidi = pickRootBaseMidi();
      intervalRoundsOnRoot = 0;
    } else {
      currentBaseMidi = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
    }
    currentBaseName = midiToNameJazz(currentBaseMidi);
    buildPiano(); // rebuild piano for mode's range
    chooseNextChallenge();
    updateDisplay();

    // Play notes
    if (AUTO_PLAY_INTRO) {
      setTimeout(() => {
        playNote(currentBaseMidi);
        if (gameMode === 'instrument') {
          setTimeout(() => playNote(currentTargetMidi), 500);
        }
      }, 300);
    }

    gameActive = true;
    roundStart = performance.now();
    gameLoop();
  }
}

function gameLoop() {
  if (!gameActive) return;

  const now = performance.now();
  const elapsed = now - roundStart;

  // Timer bar
  const pct = Math.max(0, 1 - elapsed / TIMEOUT);
  document.getElementById('timerBar').style.width = (pct * 100) + '%';

  // Timeout
  if (elapsed > TIMEOUT) {
    endGame();
    return;
  }

  // Don't detect pitch while melody is playing back
  if (melodyPlaying) {
    animFrame = requestAnimationFrame(gameLoop);
    return;
  }

  // MIDI mode: detection happens via MIDI callbacks, just keep timer running
  if (useMidi) {
    animFrame = requestAnimationFrame(gameLoop);
    return;
  }

  // Pitch detection
  const freq = detectPitch();
  const needle = document.getElementById('pitchNeedle');
  const singingEl = document.getElementById('singingNote');
  const holdBar = document.getElementById('holdProgress');

  if (freq) {
    const midi = freqToMidi(freq);
    const roundedMidi = Math.round(midi);
    const noteName = midiToName(roundedMidi);

    if (gameMode === 'bass') {
      // Bass mode: match pitch class — accept any octave for singing
      const targetMidi = bassNotes[bassIndex];
      const targetPC = targetMidi % 12;
      const sungPC = midi % 12;
      let pcDiff = sungPC - targetPC;
      if (pcDiff > 6) pcDiff -= 12;
      if (pcDiff < -6) pcDiff += 12;
      const centsOff = pcDiff * 100;
      const needlePos = 50 + (centsOff / 400) * 100;
      needle.style.left = Math.max(2, Math.min(98, needlePos)) + '%';
      const absCents = Math.abs(centsOff);
      needle.className = absCents < CENTS_TOLERANCE ? 'pitch-needle' : absCents < CENTS_TOLERANCE * 2 ? 'pitch-needle close' : 'pitch-needle off-pitch';
      singingEl.innerHTML = `You: <span>${noteName}</span>`;
      updateBassPiano(roundedMidi);

      if (absCents < CENTS_TOLERANCE) {
        if (holdStart === 0) holdStart = now;
        const held = now - holdStart;
        holdBar.style.width = Math.min(100, (held / HOLD_REQUIRED) * 100) + '%';
        if (held >= HOLD_REQUIRED) {
          // Bass note confirmed
          bassIndex++;
          holdStart = 0;
          holdBar.style.width = '0%';
          playChordConfirmBeep();
          updateDisplay();
          if (bassIndex >= bassNotes.length) {
            onSuccess();
            return;
          }
        }
      } else {
        holdStart = 0;
        holdBar.style.width = '0%';
      }
    } else if (gameMode === 'chord') {
      // Chord mode: match against any remaining target note
      let bestTarget = null;
      let bestCents = Infinity;
      for (const t of chordTargetNotes) {
        const c = Math.abs((midi - t) * 100);
        if (c < bestCents) { bestCents = c; bestTarget = t; }
      }

      const centsOff = bestTarget !== null ? (midi - bestTarget) * 100 : 999;
      const needlePos = 50 + (centsOff / 400) * 100;
      needle.style.left = Math.max(2, Math.min(98, needlePos)) + '%';
      const absCents = Math.abs(centsOff);
      needle.className = absCents < CENTS_TOLERANCE ? 'pitch-needle' : absCents < CENTS_TOLERANCE * 2 ? 'pitch-needle close' : 'pitch-needle off-pitch';
      singingEl.innerHTML = `You: <span>${noteName}</span>`;
      updateChordPiano(roundedMidi);

      if (absCents < CENTS_TOLERANCE && bestTarget !== null) {
        if (holdingForMidi !== bestTarget) { holdStart = now; holdingForMidi = bestTarget; }
        const held = now - holdStart;
        holdBar.style.width = Math.min(100, (held / HOLD_REQUIRED) * 100) + '%';
        if (held >= HOLD_REQUIRED) {
          // Note confirmed!
          chordTargetNotes.delete(bestTarget);
          chordHitNotes.add(bestTarget);
          holdStart = 0;
          holdingForMidi = null;
          holdBar.style.width = '0%';
          playChordConfirmBeep();
          updateDisplay();
          if (chordTargetNotes.size === 0) {
            onSuccess();
            return;
          }
        }
      } else {
        holdStart = 0;
        holdingForMidi = null;
        holdBar.style.width = '0%';
      }
    } else {
      // All other modes: single target
      const targetMidi = gameMode === 'licks' ? lickNotes[lickNoteIndex] : gameMode === 'scale' ? scaleNotes[scaleNoteIndex] : (gameMode === 'melody' || gameMode === 'harmonic') ? melodyNotes[melodyIndex] : currentTargetMidi;
      // In voice mode with root-style intervals, match pitch class (any octave).
      // This lets singers nail a b13 or 13 by singing the correct pitch class at a reachable octave.
      let centsOff;
      if (gameMode === 'voice' && intervalStyle === 'root') {
        let pcDiff = ((midi - targetMidi) % 12 + 12) % 12;
        if (pcDiff > 6) pcDiff -= 12;
        centsOff = pcDiff * 100;
      } else {
        centsOff = (midi - targetMidi) * 100;
      }
      const needlePos = 50 + (centsOff / 400) * 100;
      const clampedPos = Math.max(2, Math.min(98, needlePos));
      needle.style.left = clampedPos + '%';

      const absCents = Math.abs(centsOff);
      if (absCents < CENTS_TOLERANCE) {
        needle.className = 'pitch-needle';
      } else if (absCents < CENTS_TOLERANCE * 2) {
        needle.className = 'pitch-needle close';
      } else {
        needle.className = 'pitch-needle off-pitch';
      }

      singingEl.innerHTML = `You: <span>${noteName}</span>`;
      if (gameMode === 'instrument') {
        updatePianoHighlights(null, null, roundedMidi);
      } else if (gameMode === 'licks' || gameMode === 'scale' || gameMode === 'melody' || gameMode === 'harmonic') {
        updatePianoHighlights(null, targetMidi, roundedMidi);
      } else {
        updatePianoHighlights(currentBaseMidi, currentTargetMidi, roundedMidi);
      }

      if (absCents < CENTS_TOLERANCE) {
        if (holdStart === 0) holdStart = now;
        const held = now - holdStart;
        holdBar.style.width = Math.min(100, (held / HOLD_REQUIRED) * 100) + '%';
        if (held >= HOLD_REQUIRED) {
          onSuccess();
          return;
        }
      } else {
        holdStart = 0;
        holdBar.style.width = '0%';
      }
    }
  } else {
    needle.style.left = '50%';
    needle.className = 'pitch-needle';
    singingEl.innerHTML = '&nbsp;';
    holdStart = 0;
    holdingForMidi = null;
    holdBar.style.width = '0%';
    if (gameMode === 'bass') {
      updateBassPiano(null);
    } else if (gameMode === 'chord') {
      updateChordPiano(null);
    } else if (gameMode === 'licks') {
      updatePianoHighlights(null, lickNotes[lickNoteIndex], null);
    } else if (gameMode === 'scale') {
      updatePianoHighlights(null, scaleNotes[scaleNoteIndex], null);
    } else if (gameMode === 'melody' || gameMode === 'harmonic') {
      const targetMidi = melodyNotes[melodyIndex];
      updatePianoHighlights(null, targetMidi, null);
    } else if (gameMode === 'instrument') {
      updatePianoHighlights(null, null, null);
    } else {
      updatePianoHighlights(currentBaseMidi, currentTargetMidi, null);
    }
  }

  animFrame = requestAnimationFrame(gameLoop);
}

function onSuccess() {
  playSuccessChime();

  // Flash
  const flash = document.getElementById('successFlash');
  flash.classList.remove('show');
  void flash.offsetWidth;
  flash.classList.add('show');

  holdStart = 0;
  holdingForMidi = null;
  document.getElementById('holdProgress').style.width = '0%';

  if (gameMode === 'bass') {
    // Cadence complete!
    cancelAnimationFrame(animFrame);
    score++;
    document.getElementById('scoreDisplay').textContent = score;

    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    // New key + cadence
    bassKeyRoot = pickBassKey();
    currentKeyDisplay = jazzNoteName(bassKeyRoot);
    const indices = [...selectedCadences];
    currentCadence = CADENCES[indices[Math.floor(Math.random() * indices.length)]];
    buildBassRound();
    updateDisplay();

    const beginRound = () => {
      updateDisplay();
      roundStart = performance.now();
      animFrame = requestAnimationFrame(gameLoop);
    };
    const playNext = () => {
      if (AUTO_PLAY_INTRO) {
        playCadence(bassCadenceChords, beginRound);
      } else {
        beginRound();
      }
    };

    setTimeout(() => {
      if (bassAnnounceKey) {
        const isMinor = currentCadence.cat === 'minor' || currentCadence.name === 'Im7';
        announceBassKey(bassKeyRoot, isMinor, playNext);
      } else {
        playNext();
      }
    }, 800);
    return;
  }

  if (gameMode === 'chord') {
    // Chord complete!
    cancelAnimationFrame(animFrame);
    score++;
    document.getElementById('scoreDisplay').textContent = score;

    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    chordRoundsOnRoot++;
    let rootChanged = false;
    if (chordRoundsOnRoot >= chordRoundsPerRoot) {
      // New random root pitch class
      chordRoot = Math.floor(Math.random() * 12); // just pitch class for now
      currentKeyDisplay = jazzNoteName(chordRoot);
      chordRoundsOnRoot = 0;
      rootChanged = true;
    }
    chooseNextChord(); // picks chord + places root in right octave around middle C
    updateDisplay();

    const beginRound = () => {
      roundStart = performance.now();
      animFrame = requestAnimationFrame(gameLoop);
    };
    const playNext = () => {
      // sing/call always call playChordForMode (it handles auto-play internally for the root)
      // arpeggio/stack only play when auto-play is on
      if (chordPlayback === 'sing' || chordPlayback === 'call') {
        playChordForMode(chordRoot, currentChordType.intervals, beginRound);
      } else if (AUTO_PLAY_INTRO) {
        playChordForMode(chordRoot, currentChordType.intervals, beginRound);
      } else {
        beginRound();
      }
    };

    setTimeout(() => {
      if (rootChanged && chordPlayback !== 'sing' && chordPlayback !== 'call') {
        speak(speechify(currentKeyDisplay), playNext);
      } else {
        playNext();
      }
    }, 800);
    return;
  }

  if (gameMode === 'progression') {
    // Full progression completed!
    cancelAnimationFrame(animFrame);
    score++;
    document.getElementById('scoreDisplay').textContent = score;
    document.getElementById('streakDots').innerHTML = '';

    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    // New key + maybe new progression
    progKeyRoot = Math.floor(Math.random() * 12);
    currentKeyDisplay = jazzNoteName(progKeyRoot);
    progChordIndex = 0;
    const progIndices = [...selectedProgressions];
    currentProgression = PROGRESSIONS[progIndices[Math.floor(Math.random() * progIndices.length)]];
    setupProgChord();
    buildPiano();

    document.getElementById('intervalDisplay').textContent = `✓ Progression ${score}!`;

    setTimeout(() => {
      speak(`${speechify(currentProgression.name)}, in ${speechify(currentKeyDisplay)}`, () => {
        const beginRound = () => {
          updateDisplay();
          roundStart = performance.now();
          animFrame = requestAnimationFrame(gameLoop);
        };
        if (AUTO_PLAY_INTRO) {
          playNote(progCurrentRoot, 1.0);
          setTimeout(beginRound, 1200);
        } else {
          beginRound();
        }
      });
    }, 800);
    return;
  }

  if (gameMode === 'licks') {
    // Lick mode: advance to next note in lick
    lickNoteIndex++;

    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    if (lickNoteIndex >= lickNotes.length) {
      // Lick complete in this key!
      cancelAnimationFrame(animFrame);
      score++;
      lickKeysPlayed++;
      document.getElementById('scoreDisplay').textContent = score;
      document.getElementById('streakDots').innerHTML = '';

      // Move to next key
      lickKeyIndex++;

      // Check if we need a new lick
      if (lickKeysPlayed >= lickCycle || lickKeyIndex >= 12) {
        // New lick + reshuffle keys
        const lickIndices = [...selectedLicks];
        currentLick = LICKS[lickIndices[Math.floor(Math.random() * lickIndices.length)]];
        lickKeyOrder = shuffleKeys();
        lickKeyIndex = 0;
        lickKeysPlayed = 0;
      }

      // Build lick in new key
      currentKeyDisplay = jazzNoteName(lickKeyOrder[lickKeyIndex]);
      lickRoot = pickLickRoot(lickKeyOrder[lickKeyIndex]);
      lickNotes = buildLickNotes(currentLick, lickRoot);
      lickNoteIndex = 0;

      document.getElementById('intervalDisplay').textContent = `✓ Lick ${score}!`;

      setTimeout(() => {
        speak(`${currentLick.name}, in ${speechify(currentKeyDisplay)}`, () => {
          const beginRound = () => {
            updateDisplay();
            roundStart = performance.now();
            animFrame = requestAnimationFrame(gameLoop);
          };
          if (AUTO_PLAY_INTRO) {
            playLick(lickNotes, beginRound);
          } else {
            beginRound();
          }
        });
      }, 800);
    } else {
      // Next note in lick
      updateDisplay();
      roundStart = performance.now();
      animFrame = requestAnimationFrame(gameLoop);
    }
    return;
  }

  if (gameMode === 'scale') {
    // Scale mode: advance to next note in scale
    scaleNoteIndex++;

    // Streak dot
    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    if (scaleNoteIndex >= scaleNotes.length) {
      // Scale complete!
      cancelAnimationFrame(animFrame);
      score++;
      document.getElementById('scoreDisplay').textContent = score;
      document.getElementById('streakDots').innerHTML = '';

      // Pick next scale + root
      const scaleIndices = [...selectedScalesForSing];
      currentScaleForSing = scaleIndices[Math.floor(Math.random() * scaleIndices.length)];
      const scale = SCALES[currentScaleForSing];
      scaleRoot = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
      scaleNotes = buildScaleNotes(scaleRoot, scale);
      scaleNoteIndex = 0;

      document.getElementById('intervalDisplay').textContent = `✓ Scale ${score}!`;

      setTimeout(() => {
        announceScale(scaleRoot, scale.name, () => {
          const beginRound = () => {
            updateDisplay();
            roundStart = performance.now();
            animFrame = requestAnimationFrame(gameLoop);
          };
          if (AUTO_PLAY_INTRO) {
            playNote(scaleRoot, 0.8);
            setTimeout(beginRound, 1000);
          } else {
            beginRound();
          }
        });
      }, 800);
    } else {
      // Next note in scale
      updateDisplay();
      roundStart = performance.now();
      animFrame = requestAnimationFrame(gameLoop);
    }
    return;
  }

  if (gameMode === 'melody' || gameMode === 'harmonic') {
    // Melody/Harmonic mode: advance to next note in sequence
    melodyIndex++;

    // Streak dot for each note
    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);

    if (melodyIndex >= melodyNotes.length) {
      // Round complete!
      melodyRound++;
      melodyIndex = 0;

      // Add a note based on speed setting (chill=4, normal=3, fast=2, insane=1)
      if (melodyRound > 0 && melodyRound % melodySpeed === 0) {
        melodyLength++;
      }

      score = melodyRound;
      document.getElementById('scoreDisplay').textContent = score;

      // Generate new melody
      if (gameMode === 'harmonic') {
        // New root every 3 rounds
        if (melodyRound % 3 === 0) {
          harmonicRoot = Math.floor(Math.random() * (getRangeHigh() - getRangeLow() + 1)) + getRangeLow();
        }
        melodyNotes = generateHarmonicMelody(melodyLength, harmonicRoot, SCALES[selectedScale]);
      } else {
        melodyNotes = generateMelody(melodyLength);
      }

      const scaleLabel = gameMode === 'harmonic' ? ` | ${SCALES[selectedScale].name}` : '';
      document.getElementById('intervalDisplay').textContent = `✓ Round ${melodyRound}! Length: ${melodyLength}${scaleLabel}`;
      document.getElementById('streakDots').innerHTML = '';

      // Play chord (harmonic) + melody after a brief pause
      setTimeout(() => {
        const beginRound = () => {
          updateDisplay();
          roundStart = performance.now();
          animFrame = requestAnimationFrame(gameLoop);
        };
        const startPlayback = () => {
          if (AUTO_PLAY_INTRO) {
            playMelody(melodyNotes, beginRound);
          } else {
            beginRound();
          }
        };
        if (gameMode === 'harmonic') {
          // Announce new key if it changed
          const playChordThen = (cb) => {
            if (AUTO_PLAY_INTRO) {
              playChord(harmonicRoot, SCALES[selectedScale].chord, cb);
            } else {
              cb();
            }
          };
          if (melodyRound > 0 && melodyRound % 3 === 0) {
            announceScale(harmonicRoot, SCALES[selectedScale].name, () => {
              playChordThen(startPlayback);
            });
          } else {
            playChordThen(startPlayback);
          }
        } else {
          startPlayback();
        }
      }, 1000);
    } else {
      // Next note in the melody
      updateDisplay();
      roundStart = performance.now();
      animFrame = requestAnimationFrame(gameLoop);
    }
    return;
  }

  score++;

  // Streak dot
  const dot = document.createElement('div');
  dot.className = 'streak-dot';
  document.getElementById('streakDots').appendChild(dot);

  // In instrument mode, briefly flash the correct interval before moving on
  if (gameMode === 'instrument') {
    const dirLabel = currentDir > 0 ? 'Up' : 'Down';
    document.getElementById('intervalDisplay').textContent = `${currentInterval.name} ${dirLabel}`;
    document.getElementById('noteFrom').textContent = currentBaseName || midiToNameJazz(currentBaseMidi);
    document.getElementById('noteTarget').textContent = currentTargetName || midiToNameJazz(currentTargetMidi);
  }

  // Root mode: keep the same base for N rounds, then pick a new random root.
  // Chain mode: new base = old target (carry over the display name so the
  // enharmonic spelling stays consistent with what was just shown).
  if (intervalStyle === 'root') {
    intervalRoundsOnRoot++;
    if (intervalRoundsOnRoot >= intervalRoundsPerRoot) {
      currentBaseMidi = pickRootBaseMidi();
      currentBaseName = midiToNameJazz(currentBaseMidi);
      intervalRoundsOnRoot = 0;
    }
    // else: keep currentBaseMidi and currentBaseName
  } else {
    currentBaseMidi = currentTargetMidi;
    currentBaseName = currentTargetName;
  }

  chooseNextChallenge();

  // Short delay so player can see the revealed interval in instrument mode
  setTimeout(() => {
    updateDisplay();
    if (AUTO_PLAY_INTRO) {
      playNote(currentBaseMidi);
      if (gameMode === 'instrument') {
        setTimeout(() => playNote(currentTargetMidi), 500);
      }
    }
  }, gameMode === 'instrument' ? 800 : 200);

  roundStart = performance.now();
  animFrame = requestAnimationFrame(gameLoop);
}

function endGame() {
  gameActive = false;
  melodyPlaying = false;
  if (animFrame) cancelAnimationFrame(animFrame);
  stopMic();

  playFailSound();

  if (gameMode === 'bass') {
    const isNewBest = score > hiScoreBass;
    if (isNewBest) {
      hiScoreBass = score;
      localStorage.setItem('notechaser_hi_bass', hiScoreBass);
    }
    document.getElementById('goScore').textContent = score;
    document.getElementById('goScoreLabel').textContent = 'Bass Notes Found';
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScoreBass}`;
      bestEl.className = 'go-best';
    }
  } else if (gameMode === 'chord') {
    const isNewBest = score > hiScoreChord;
    if (isNewBest) {
      hiScoreChord = score;
      localStorage.setItem('notechaser_hi_chord', hiScoreChord);
    }
    document.getElementById('goScore').textContent = score;
    document.getElementById('goScoreLabel').textContent = 'Chords Identified';
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScoreChord}`;
      bestEl.className = 'go-best';
    }
  } else if (gameMode === 'scale') {
    const isNewBest = score > hiScoreScale;
    if (isNewBest) {
      hiScoreScale = score;
      localStorage.setItem('notechaser_hi_scale', hiScoreScale);
    }
    document.getElementById('goScore').textContent = score;
    const scaleName = SCALES[currentScaleForSing] ? SCALES[currentScaleForSing].name : 'Scale';
    document.getElementById('goScoreLabel').textContent = `Scales Completed`;
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScoreScale}`;
      bestEl.className = 'go-best';
    }
  } else if (gameMode === 'licks') {
    const isNewBest = score > hiScoreLick;
    if (isNewBest) {
      hiScoreLick = score;
      localStorage.setItem('notechaser_hi_lick', hiScoreLick);
    }
    document.getElementById('goScore').textContent = score;
    document.getElementById('goScoreLabel').textContent = 'Licks Nailed';
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScoreLick}`;
      bestEl.className = 'go-best';
    }
  } else if (gameMode === 'progression') {
    const isNewBest = score > hiScoreProgression;
    if (isNewBest) {
      hiScoreProgression = score;
      localStorage.setItem('notechaser_hi_progression', hiScoreProgression);
    }
    document.getElementById('goScore').textContent = score;
    document.getElementById('goScoreLabel').textContent = 'Progressions Completed';
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScoreProgression}`;
      bestEl.className = 'go-best';
    }
  } else if (gameMode === 'melody' || gameMode === 'harmonic') {
    const melodyScore = melodyRound;
    const isHarmonic = gameMode === 'harmonic';
    const currentHi = isHarmonic ? hiScoreHarmonic : hiScoreMelody;
    const isNewBest = melodyScore > currentHi;
    if (isNewBest) {
      if (isHarmonic) {
        hiScoreHarmonic = melodyScore;
        localStorage.setItem('notechaser_hi_harmonic', hiScoreHarmonic);
      } else {
        hiScoreMelody = melodyScore;
        localStorage.setItem('notechaser_hi_melody', hiScoreMelody);
      }
    }

    document.getElementById('goScore').textContent = melodyScore;
    const modeLabel = isHarmonic ? `${SCALES[selectedScale].name} | ` : '';
    document.getElementById('goScoreLabel').textContent = `${modeLabel}Rounds Survived (Max Length: ${melodyLength})`;
    const bestEl = document.getElementById('goBest');
    if (isNewBest && melodyScore > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${isHarmonic ? hiScoreHarmonic : hiScoreMelody}`;
      bestEl.className = 'go-best';
    }
  } else {
    const isNewBest = score > hiScore;
    if (isNewBest) {
      hiScore = score;
      localStorage.setItem('notechaser_hi', hiScore);
    }

    document.getElementById('goScore').textContent = score;
    document.getElementById('goScoreLabel').textContent = 'Intervals Nailed';
    const bestEl = document.getElementById('goBest');
    if (isNewBest && score > 0) {
      bestEl.textContent = 'NEW BEST!';
      bestEl.className = 'go-best go-new-best';
    } else {
      bestEl.textContent = `BEST: ${hiScore}`;
      bestEl.className = 'go-best';
    }
  }

  showScreen('gameover');
}

function retryGame() {
  startGame();
}

function backToSetup() {
  showScreen('setup');
}

// ── SETTINGS ──
function openSettings() {
  document.getElementById('setup').classList.remove('active');
  document.getElementById('settings').classList.add('active');
  document.getElementById('settingsGear').style.display = 'none';
  loadSettingsUI();
}

function closeSettings() {
  document.getElementById('settings').classList.remove('active');
  document.getElementById('setup').classList.add('active');
  document.getElementById('settingsGear').style.display = '';
}

function loadSettingsUI() {
  const s = JSON.parse(localStorage.getItem('notechaser_settings') || 'null') || DEFAULTS;
  document.getElementById('sVocalLow').value = s.vocalLow;
  document.getElementById('sVocalHigh').value = s.vocalHigh;
  document.getElementById('sChordSingLow').value = s.chordSingLow;
  document.getElementById('sChordSingHigh').value = s.chordSingHigh;
  document.getElementById('sInstLow').value = s.instLow;
  document.getElementById('sInstHigh').value = s.instHigh;
  document.getElementById('sBassLow').value = s.bassLow;
  document.getElementById('sBassHigh').value = s.bassHigh;
  document.getElementById('sCents').value = s.cents;
  document.getElementById('sHold').value = s.holdMs;
  document.getElementById('sSensitivity').value = s.sensitivity;
  document.getElementById('sConfidence').value = s.confidence;
  document.getElementById('sAnnounceVoice').checked = s.announceVoice !== false;
  document.getElementById('sAutoPlayIntro').checked = s.autoPlayIntro !== false;
  document.getElementById('sHidePiano').checked = s.hidePiano === true;
  document.getElementById('sHideTarget').checked = s.hideTarget === true;
  updateSettingDisplay();
}

function updateSettingDisplay() {
  document.getElementById('sVocalLowVal').textContent = midiToName(+document.getElementById('sVocalLow').value);
  document.getElementById('sVocalHighVal').textContent = midiToName(+document.getElementById('sVocalHigh').value);
  document.getElementById('sChordSingLowVal').textContent = midiToName(+document.getElementById('sChordSingLow').value);
  document.getElementById('sChordSingHighVal').textContent = midiToName(+document.getElementById('sChordSingHigh').value);
  document.getElementById('sInstLowVal').textContent = midiToName(+document.getElementById('sInstLow').value);
  document.getElementById('sInstHighVal').textContent = midiToName(+document.getElementById('sInstHigh').value);
  document.getElementById('sBassLowVal').textContent = midiToName(+document.getElementById('sBassLow').value);
  document.getElementById('sBassHighVal').textContent = midiToName(+document.getElementById('sBassHigh').value);
  document.getElementById('sCentsVal').textContent = document.getElementById('sCents').value;
  document.getElementById('sHoldVal').textContent = document.getElementById('sHold').value;
  const sens = +document.getElementById('sSensitivity').value;
  document.getElementById('sSensitivityVal').textContent = sens;
  const conf = +document.getElementById('sConfidence').value;
  document.getElementById('sConfidenceVal').textContent = (conf / 100).toFixed(2);
}

function applySettings(s) {
  RANGE_LOW = s.vocalLow;
  RANGE_HIGH = Math.min(s.vocalLow + 9, s.vocalHigh); // starting range within vocal
  RANGE_ABS_LOW = s.vocalLow;
  RANGE_ABS_HIGH = s.vocalHigh;

  INST_RANGE_LOW = s.instLow;
  INST_RANGE_HIGH = Math.min(s.instLow + 12, s.instHigh);
  INST_RANGE_ABS_LOW = s.instLow;
  INST_RANGE_ABS_HIGH = s.instHigh;

  CHORD_SING_LOW = s.chordSingLow;
  CHORD_SING_HIGH = s.chordSingHigh;

  BASS_RANGE_LOW = s.bassLow;
  BASS_RANGE_HIGH = s.bassHigh;

  CENTS_TOLERANCE = s.cents;
  HOLD_REQUIRED = s.holdMs;
  RMS_THRESHOLD = s.sensitivity / 1000; // 1-20 → 0.001-0.020
  CONFIDENCE_THRESHOLD = s.confidence / 100; // 5-50 → 0.05-0.50
  ANNOUNCE_VOICE = s.announceVoice !== false;
  AUTO_PLAY_INTRO = s.autoPlayIntro !== false;
  HIDE_PIANO = s.hidePiano === true;
  HIDE_TARGET = s.hideTarget === true;
  applyHidePiano();
  // Re-render current round if game is active so HIDE_TARGET takes effect immediately
  if (gameActive) updateDisplay();
}

function applyHidePiano() {
  const piano = document.getElementById('piano');
  if (piano) piano.style.display = HIDE_PIANO ? 'none' : '';
}

function saveSettings() {
  const s = {
    vocalLow: +document.getElementById('sVocalLow').value,
    vocalHigh: +document.getElementById('sVocalHigh').value,
    chordSingLow: +document.getElementById('sChordSingLow').value,
    chordSingHigh: +document.getElementById('sChordSingHigh').value,
    instLow: +document.getElementById('sInstLow').value,
    instHigh: +document.getElementById('sInstHigh').value,
    bassLow: +document.getElementById('sBassLow').value,
    bassHigh: +document.getElementById('sBassHigh').value,
    cents: +document.getElementById('sCents').value,
    holdMs: +document.getElementById('sHold').value,
    sensitivity: +document.getElementById('sSensitivity').value,
    confidence: +document.getElementById('sConfidence').value,
    announceVoice: document.getElementById('sAnnounceVoice').checked,
    autoPlayIntro: document.getElementById('sAutoPlayIntro').checked,
    hidePiano: document.getElementById('sHidePiano').checked,
    hideTarget: document.getElementById('sHideTarget').checked,
  };
  localStorage.setItem('notechaser_settings', JSON.stringify(s));
  applySettings(s);
  closeSettings();
}

function resetSettings() {
  localStorage.removeItem('notechaser_settings');
  applySettings(DEFAULTS);
  loadSettingsUI();
}

// Load saved settings on startup
(function() {
  const saved = JSON.parse(localStorage.getItem('notechaser_settings') || 'null');
  if (saved) applySettings(saved);
})();

// Prevent start with nothing selected
updateStartBtn();
