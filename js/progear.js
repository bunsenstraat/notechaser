// NoteChaser — Progressions by ear (lives in the Find the Bass mode)
//
// Sing the roots was already there. These are the naming exercises — the
// sound is in your head, the words aren't yet:
//
//   'name'      — hear a progression, name it ("Tritone sub")
//   'roots'     — name each chord's root as a degree (I, ♭II, ii … ♭VII)
//   'positions' — ii-V-I in A/B positions: name each chord's position
//
// Played like a band: bass on the root plus a piano voicing, in a random key,
// with the upper voices voice-led from chord to chord. Answers come from
// buttons, no mic. Reuses Identify's answer grid (#identifyGrid) and its
// identify-mode layout.

const ROOT_NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♯IV', 'V', '♭VI', 'VI', '♭VII', 'VII'];

// Rootless voicings for the naming exercises. Find the Bass's table, except
// Maj7 'A': there it's 1 3 5 7 (with the root), which sits in a different
// register from every other rootless form and made each major 7th lurch.
// Here it's the standard 3 5 7 9. (Sing the roots keeps its own table.)
const PE_ROOTLESS = Object.assign({}, VOICINGS, { Maj7: { A: [4, 7, 11, 14], B: VOICINGS.Maj7.B } });

// A/B/C position chord quality for each cadence quality
const PE_POSITION_QUALITY = { m7: 'Min7', '7': 'Dom7', Maj7: 'Maj7', m7b5: 'Half-Dim7', '7alt': 'Dom7', m6: 'Min6', IV7: 'Dom7' };

let bassExercise = 'sing';      // 'sing' | 'name' | 'roots' | 'positions'
let bassVoicing = 'rootless';   // 'rootless' | 'positions' — for name/roots

let peProg = null;              // the CADENCES entry being played
let peChords = [];              // [{ notes, degRoot, name, pos }]
let peStep = 0;                 // chord being answered (roots / positions)
let peDone = false;             // progression finished; next one coming
let peBusy = false;             // between a right answer and the next question
let peHeard = false;            // it has started sounding — answers open
let peClean = true;             // no mistakes on this progression yet
let peOrder = [];               // answer values in button order (1–9 keys)

function isProgEar() { return gameMode === 'bass' && bassExercise !== 'sing'; }

// Single-chord "cadences" have nothing to name as a progression
function pePlayable() {
  return [...selectedCadences].filter(i => CADENCES[i].chords.length > 1);
}

// ── SETUP ──
function setBassExercise(ex) {
  bassExercise = ex;
  document.querySelectorAll('.bass-ex-btn').forEach(b => b.classList.toggle('selected', b.dataset.bex === ex));
  // Voicing style applies to naming progressions/roots; positions are always positions
  document.getElementById('bassVoicingRow').style.display = (ex === 'name' || ex === 'roots') ? '' : 'none';
  if (typeof refreshInputHint === 'function') refreshInputHint();
  updateStartBtn();
}

function setBassVoicing(v) {
  bassVoicing = v;
  document.querySelectorAll('.bass-voicing-btn').forEach(b => b.classList.toggle('selected', b.dataset.bvoc === v));
}

// ── BUILDING A PROGRESSION ──
// Positions follow the A/B system: when the root moves by a 4th or 5th the
// position switches (ii A → V B → I A, or the mirror), which keeps the
// 7th-resolves-to-3rd motion the system is built on. Pure "fewest
// semitones" would rotate A→B→C there and lose that. On any other root
// motion (I → I7, IV → iv, by step or third) it takes whichever of A/B
// moves least, as a pianist would.
// Rootless voicings choose freely between A and B by least motion — which
// in a ii-V-I gives the same A-B-A anyway, and stays smooth on progressions
// that don't move by fourths (I → I7, IV → iv).
function peMotion(a, b) {
  if (a.length === b.length) return a.reduce((sum, n, i) => sum + Math.abs(n - b[i]), 0);
  const centre = arr => arr.reduce((x, y) => x + y, 0) / arr.length;
  return Math.abs(centre(a) - centre(b)) * Math.max(a.length, b.length);
}

// Every way to voice one chord: each form, in each octave that fits the
// range. forms: [{ key, intervals }] relative to the root. rootInBass:
// interval 0 is the bass (positions); otherwise the voicing floats over its
// own bass.
function peCandidates(pc, forms, rootInBass) {
  const out = [];
  for (const f of forms) {
    const upperIv = rootInBass ? f.intervals.slice(1) : f.intervals;
    for (let root = pc + 24; root <= 72; root += 12) {
      const upper = upperIv.map(iv => root + iv).sort((x, y) => x - y);
      const lowest = rootInBass ? root : upper[0];
      if (lowest < 40 || upper[upper.length - 1] > 81) continue;
      out.push({ form: f.key, root, upper });
    }
  }
  return out;
}

function peBuild() {
  const pool = pePlayable();
  const prevIdx = peProg ? CADENCES.indexOf(peProg) : -1;
  const choices = pool.length > 1 ? pool.filter(i => i !== prevIdx) : pool;
  peProg = CADENCES[choices[Math.floor(Math.random() * choices.length)]];
  bassKeyRoot = Math.floor(Math.random() * 12);
  currentKeyDisplay = jazzNoteName(bassKeyRoot);

  const usePositions = bassExercise === 'positions' || bassVoicing === 'positions';
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const centre = arr => arr.reduce((x, y) => x + y, 0) / arr.length;
  const first = pick(['A', 'B']); // the first chord's form is a free choice — vary it
  const chords = peProg.chords.map(ch => ({ ch, pc: (bassKeyRoot + ch.degRoot) % 12 }));

  // The whole progression is planned at once (it's at most a handful of
  // chords), so a run of fourths that drifts downward is placed high enough
  // at the start never to have to leap back up an octave halfway through.
  const stages = chords.map(({ ch, pc }, i) => {
    let keys = i === 0 ? [first] : ['A', 'B'];
    const forms = keys.map(k => ({
      key: k,
      intervals: usePositions
        ? CHORD_TYPES.find(c => c.pos === k && c.quality === PE_POSITION_QUALITY[ch.quality]).intervals
        : PE_ROOTLESS[ch.quality][k],
    }));
    return peCandidates(pc, forms, usePositions);
  });
  const fourth = i => [5, 7].includes((chords[i].pc - chords[i - 1].pc + 12) % 12);
  const allowed = (i, a, b) => !usePositions || !fourth(i) || a.form !== b.form;

  // Dynamic programme: cheapest total motion ending in each candidate
  let layer = stages[0].map(c => ({ c, cost: Math.abs(centre(c.upper) - (usePositions ? 60 : 64)) * 0.5, path: [c] }));
  for (let i = 1; i < stages.length; i++) {
    layer = stages[i].map(c => {
      let best = null;
      for (const prev of layer) {
        if (!allowed(i, prev.c, c)) continue;
        const cost = prev.cost + peMotion(prev.c.upper, c.upper);
        if (!best || cost < best.cost) best = { c, cost, path: prev.path.concat([c]) };
      }
      return best;
    }).filter(Boolean);
  }
  const plan = layer.reduce((a, b) => (b.cost < a.cost ? b : a)).path;

  peChords = plan.map((v, i) => ({
    notes: usePositions ? [v.root, ...v.upper] : [36 + chords[i].pc, ...v.upper], // rootless: bass in octave 2
    degRoot: chords[i].ch.degRoot,
    name: chords[i].ch.name,
    pos: usePositions ? v.form : null,
  }));
  peStep = 0;
  peDone = false;
  peBusy = false;
  peHeard = false;
  peClean = true;
}

// ── SOUND ──
const PE_SPACING = 1.6;

// The key, when announced, comes with its tonic in the bass — a reference to
// hear the degrees against. Hard mode gives neither.
function pePlay(withReference, done) {
  melodyPlaying = true;
  peHeard = true;
  const events = [];
  let t = 0;
  if (withReference) {
    const tonic = 36 + bassKeyRoot;
    events.push({ notes: [tonic, tonic + 12], at: 0, dur: 1.0 });
    t = 1.4;
  }
  peChords.forEach((c, i) => events.push({ notes: c.notes, at: t + i * PE_SPACING, dur: PE_SPACING - 0.1 }));
  playSequence(events, {
    totalDur: t + peChords.length * PE_SPACING,
    onEnd: () => { melodyPlaying = false; if (done) done(); },
  });
}

function peIntro(done) {
  const isMinor = peProg.cat === 'minor';
  if (bassAnnounceKey) {
    speak(`${speechify(currentKeyDisplay)} ${isMinor ? 'minor' : 'major'}`, () => pePlay(true, done));
  } else {
    pePlay(false, done);
  }
}

// ── ANSWERS ──
function peAnswers() {
  if (bassExercise === 'name') {
    return pePlayable().sort((a, b) => a - b)
      .map(i => ({ value: String(i), label: CADENCES[i].name, sub: CADENCES[i].short }));
  }
  if (bassExercise === 'positions') {
    return [{ value: 'A', label: 'A position', sub: '1 3 5 7' }, { value: 'B', label: 'B position', sub: '1 7 3 5' }];
  }
  // roots: only the degrees the selected progressions use, in chromatic order
  const degs = new Set();
  for (const i of pePlayable()) CADENCES[i].chords.forEach(c => degs.add(c.degRoot));
  return [...degs].sort((a, b) => a - b).map(d => ({ value: String(d), label: ROOT_NUMERALS[d], sub: '' }));
}

function peBuildGrid() {
  const grid = document.getElementById('identifyGrid');
  grid.innerHTML = '';
  const answers = peAnswers();
  peOrder = answers.map(a => a.value);
  answers.forEach((a, n) => {
    const btn = document.createElement('button');
    btn.className = 'identify-btn' + (bassExercise === 'roots' ? ' roman' : '');
    btn.dataset.answer = a.value;
    const key = n < 9 ? `<span class="identify-key">${n + 1}</span>` : '';
    btn.innerHTML = `${key}${a.label}${a.sub ? `<span class="chord-label">${a.sub}</span>` : ''}`;
    btn.addEventListener('click', () => peAnswer(a.value));
    grid.appendChild(btn);
  });
}

function peResetButtons() {
  document.querySelectorAll('#identifyGrid .identify-btn').forEach(b => {
    b.classList.remove('wrong', 'correct', 'also', 'reveal');
    b.disabled = false;
  });
}

function peTruth() {
  if (bassExercise === 'name') return String(CADENCES.indexOf(peProg));
  const c = peChords[peStep];
  if (!c) return null; // every chord answered; the next progression is on its way
  return bassExercise === 'positions' ? c.pos : String(c.degRoot);
}

function peMark(value, cls) {
  const btn = [...document.querySelectorAll('#identifyGrid .identify-btn')].find(b => b.dataset.answer === value);
  if (btn) btn.classList.add(cls);
  return btn;
}

function peAnswer(value) {
  value = String(value);
  const onGameScreen = document.getElementById('game').classList.contains('active');
  if (!onGameScreen || !isProgEar() || !peHeard || peBusy || peDone) return;
  if (!listenGateOpen()) armListening();
  if (value !== peTruth()) {
    const btn = peMark(value, 'wrong');
    if (btn) btn.disabled = true;
    peClean = false;
    markAssignmentMistake(); // keep guessing — the progression no longer counts
    return;
  }
  peMark(value, 'correct');
  peRight();
}

// A right answer: reveal it, record it, move on
function peRight(skipped) {
  peBusy = true;
  if (bassExercise === 'name') {
    peStep = peChords.length; // the whole progression is revealed
    commitAssignmentResult(false);
    peRender();
    later(() => peFinish(skipped), 1100);
    return;
  }
  commitAssignmentResult(false);   // this chord's record
  peStep++;
  if (!skipped) playChordConfirmBeep();
  peRender();
  if (peStep >= peChords.length) { later(() => peFinish(skipped), 1100); return; }
  later(() => {
    beginAssignmentAttempt();      // next chord, fresh attempt
    peBusy = false;
    peResetButtons();
    roundStart = performance.now();
    peRender();
  }, 600);
}

function peFinish(skipped) {
  peDone = true;
  if (peClean && !skipped) {
    score++;
    document.getElementById('scoreDisplay').textContent = score;
    playSuccessChime();
    const flash = document.getElementById('successFlash');
    flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show');
    const dot = document.createElement('div');
    dot.className = 'streak-dot';
    document.getElementById('streakDots').appendChild(dot);
  }
  renderMasteryDisplay(); // the name is safe to show now
  nextQuestion(peNext, 1400);
}

function peNext() {
  // An answer during the very first progression lands before the game goes
  // active — wait for that playback to finish rather than stopping here
  if (melodyPlaying) { later(peNext, 100); return; }
  if (!gameActive) return;
  peBuild();
  beginAssignmentAttempt();
  peResetButtons();
  peRender();
  if (typeof cancelAnimationFrame === 'function' && animFrame) cancelAnimationFrame(animFrame);
  peIntro(() => {
    roundStart = performance.now();
    animFrame = requestAnimationFrame(gameLoop);
  });
}

// X: show the answer, charge the mistake, move on
function peSkip() {
  if (!isProgEar() || peBusy || peDone || !peHeard) return;
  markAssignmentMistake();
  peClean = false;
  peMark(peTruth(), 'reveal');
  peRight(true);
}

// ── GAME HOOKS (called from app.js) ──
function peStartGame() {
  score = 0;
  peProg = null;
  peBuild();
  beginAssignmentAttempt();
  peBuildGrid();
  buildPiano();
  updateDisplay();
  later(() => {
    peIntro(() => {
      gameActive = true;
      roundStart = performance.now();
      gameLoop();
    });
  }, 400);
}

function peReplay() {
  if (!peProg || melodyPlaying) return;
  pePlay(false, () => { roundStart = performance.now(); });
}

function peBest() {
  return parseInt(localStorage.getItem(`notechaser_hi_prog_${bassExercise}`) || '0');
}

function peAssignmentInfo() {
  if (!peProg) return null;
  const cIdx = CADENCES.indexOf(peProg);
  if (bassExercise === 'name') return { key: `prog-name:${cIdx}`, label: `${peProg.name} (name it)`, mode: 'bass' };
  const k = Math.min(peStep, peChords.length - 1);
  const c = peProg.chords[k];
  if (bassExercise === 'positions') return { key: `prog-pos:${cIdx}:${k}`, label: `${peProg.name} — ${c.name} (position)`, mode: 'bass' };
  return { key: `prog-root:${cIdx}:${k}`, label: `${peProg.name} — ${c.name} (root)`, mode: 'bass' };
}

// ── DISPLAY ──
function peRender() {
  if (!peProg) return;
  const n = peChords.length;
  const cur = Math.min(peStep, n - 1);
  const heading = document.getElementById('intervalDisplay');
  if (bassExercise === 'name') {
    heading.textContent = peStep >= n ? peProg.name : 'Which progression?';
  } else if (peStep >= n) {
    heading.textContent = peProg.name;
  } else if (bassExercise === 'positions') {
    heading.textContent = `Chord ${cur + 1} of ${n} · ${peChords[cur].name} — which position?`;
  } else {
    heading.textContent = `Chord ${cur + 1} of ${n} — which root?`;
  }
  setNoteBoxLabels('Key', 'Answer');
  document.getElementById('noteFrom').textContent = bassAnnounceKey ? currentKeyDisplay : '?';
  const last = peStep > 0 ? peChords[Math.min(peStep, n) - 1] : null;
  document.getElementById('noteTarget').textContent =
    bassExercise === 'name' ? (peStep >= n ? '✓' : '?')
    : last ? (bassExercise === 'positions' ? last.pos : ROOT_NUMERALS[last.degRoot]) : '?';
  document.getElementById('arrowDir').innerHTML = '&#127911;';
  document.getElementById('replayHint').innerHTML = 'Press <kbd>SPACE</kbd> or tap here to replay';
  updatePianoHighlights(null, null, null);
  peRenderSlots();
}

// The progression as slots: answered chords show their full Roman numeral
// (that's the vocabulary), the current one is highlighted, the rest wait.
function peRenderSlots() {
  const el = document.getElementById('progSlots');
  if (!el) return;
  if (!isProgEar() || !peProg) { el.style.display = 'none'; return; }
  el.innerHTML = peChords.map((c, i) => {
    const known = i < peStep;
    const current = i === peStep && !peDone && bassExercise !== 'name';
    const text = known ? `${c.name}${c.pos ? `<span class="slot-pos">${c.pos}</span>` : ''}` : '?';
    return `<span class="prog-slot${known ? ' known' : ''}${current ? ' current' : ''}">${text}</span>`;
  }).join('<span class="prog-arrow">→</span>');
  el.style.display = '';
}
