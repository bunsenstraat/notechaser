// NoteChaser — Data Constants
// ── NOTE / INTERVAL DATA ──
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

const INTERVALS = [
  { name: 'Minor 2nd',  semitones: 1,  short: 'm2' },
  { name: 'Major 2nd',  semitones: 2,  short: 'M2' },
  { name: 'Minor 3rd',  semitones: 3,  short: 'm3' },
  { name: 'Major 3rd',  semitones: 4,  short: 'M3' },
  { name: 'Perfect 4th', semitones: 5, short: 'P4' },
  { name: 'Tritone',    semitones: 6,  short: 'TT' },
  { name: 'Perfect 5th', semitones: 7, short: 'P5' },
  { name: 'Minor 6th',  semitones: 8,  short: 'm6' },
  { name: 'Major 6th',  semitones: 9,  short: 'M6' },
  { name: 'Minor 7th',  semitones: 10, short: 'm7' },
  { name: 'Major 7th',  semitones: 11, short: 'M7' },
  { name: 'Octave',     semitones: 12, short: 'P8' },
];

const SCALES = [
  // Church Modes
  { name: 'Ionian',       intervals: [0,2,4,5,7,9,11], chord: [0,4,7,11], chordName: 'Maj7', cat: 'church' },
  { name: 'Dorian',       intervals: [0,2,3,5,7,9,10], chord: [0,3,7,10], chordName: 'm7', cat: 'church' },
  { name: 'Phrygian',     intervals: [0,1,3,5,7,8,10], chord: [0,3,7,10], chordName: 'm7', cat: 'church' },
  { name: 'Lydian',       intervals: [0,2,4,6,7,9,11], chord: [0,4,7,11], chordName: 'Maj7', cat: 'church' },
  { name: 'Mixolydian',   intervals: [0,2,4,5,7,9,10], chord: [0,4,7,10], chordName: '7', cat: 'church' },
  { name: 'Aeolian',      intervals: [0,2,3,5,7,8,10], chord: [0,3,7,10], chordName: 'm7', cat: 'church' },
  { name: 'Locrian',      intervals: [0,1,3,5,6,8,10], chord: [0,3,6,10], chordName: 'm7♭5', cat: 'church' },
  // Minor variants
  { name: 'Melodic Min',  intervals: [0,2,3,5,7,9,11], chord: [0,3,7,11], chordName: 'mMaj7', cat: 'minor' },
  { name: 'Harmonic Min', intervals: [0,2,3,5,7,8,11], chord: [0,3,7,11], chordName: 'mMaj7', cat: 'minor' },
  // Bebop
  { name: 'Maj Bebop',    intervals: [0,2,4,5,7,8,9,11], chord: [0,4,7,11], chordName: 'Maj7', cat: 'bebop' },
  { name: 'Dom Bebop',    intervals: [0,2,4,5,7,9,10,11], chord: [0,4,7,10], chordName: '7', cat: 'bebop' },
  // Blues
  { name: 'Maj Blues',     intervals: [0,2,3,4,7,9],  chord: [0,4,7,10], chordName: '7', cat: 'blues' },
  { name: 'Min Blues',     intervals: [0,3,5,6,7,10], chord: [0,3,7,10], chordName: 'm7', cat: 'blues' },
  // Jazz
  { name: 'Altered',       intervals: [0,1,3,4,6,8,10], chord: [0,4,8,10], chordName: '7alt', cat: 'jazz' },
  { name: 'Mixo ♭9♭13',   intervals: [0,1,4,5,7,8,10], chord: [0,4,7,10], chordName: '7', cat: 'jazz' },
  { name: 'Whole Tone',    intervals: [0,2,4,6,8,10],   chord: [0,4,8,10], chordName: 'aug7', cat: 'jazz' },
  { name: 'Dim WH',        intervals: [0,1,3,4,6,7,9,10], chord: [0,3,6,9], chordName: 'dim7', cat: 'jazz' },
  { name: 'Dim HW',        intervals: [0,2,3,5,6,8,9,11], chord: [0,4,7,10], chordName: '7', cat: 'jazz' },
  { name: 'Maj #11',        intervals: [0,2,4,6,7,9,11], chord: [0,4,7,11], chordName: 'Maj7', cat: 'jazz' },
  { name: 'Mixo #11',      intervals: [0,2,4,6,7,9,10], chord: [0,4,7,10], chordName: '7', cat: 'jazz' },
  { name: 'Lydian Aug',    intervals: [0,2,4,6,8,9,11], chord: [0,4,8,11], chordName: 'Maj7#5', cat: 'jazz' },
  { name: 'Loc ♮2',        intervals: [0,2,3,5,6,8,10], chord: [0,3,6,10], chordName: 'm7♭5', cat: 'jazz' },
];

// Interval name → semitone translator
// Supports: 1, b2, 2, b3, 3, 4, #4, b5, 5, #5, b6, 6, b7, 7
// Upper octave: b9, 9, #9, b10, 10, 11, #11, b13, 13
// Prefixed intervals keep stacking upward
const IV = {
  '1':0, 'b2':1, '2':2, '#2':3, 'b3':3, '3':4, '4':5, '#4':6,
  'b5':6, '5':7, '#5':8, 'b6':8, '6':9, 'bb7':9, 'b7':10, '7':11,
  '8':12, 'b9':13, '9':14, '#9':15, 'b10':15, '10':16,
  '11':17, '#11':18, 'b12':18, '12':19, 'b13':20, '13':21, '#13':22,
  '14':23, 'b15':23, '15':24,
};
function iv(str) {
  // Parse interval string like "1 3 5 b7 9" → [0, 4, 7, 10, 14]
  // Automatically ensures ascending voicing order (bumps notes up octave if needed)
  const raw = str.trim().split(/\s+/).map(s => {
    if (IV[s] !== undefined) return IV[s];
    const n = parseInt(s);
    if (!isNaN(n)) return n; // fallback to raw semitones
    console.warn('Unknown interval:', s);
    return 0;
  });
  // Ensure ascending: if a note is lower than the previous, bump it up 12
  for (let i = 1; i < raw.length; i++) {
    while (raw[i] <= raw[i - 1]) raw[i] += 12;
  }
  return raw;
}

const CHORD_TYPES = [
  // Triads
  { name: 'Major',      short: 'Maj',   intervals: iv('1 3 5'),        cat: 'triad' },
  { name: 'Minor',      short: 'min',   intervals: iv('1 b3 5'),       cat: 'triad' },
  { name: 'Diminished', short: 'dim',   intervals: iv('1 b3 b5'),      cat: 'triad' },
  { name: 'Augmented',  short: 'aug',   intervals: iv('1 3 #5'),       cat: 'triad' },
  { name: 'Sus2',       short: 'sus2',  intervals: iv('1 2 5'),        cat: 'triad' },
  { name: 'Sus4',       short: 'sus4',  intervals: iv('1 4 5'),        cat: 'triad' },
  // Seventh chords
  { name: 'Maj7',       short: 'Maj7',  intervals: iv('1 3 5 7'),      cat: '7th' },
  { name: 'Dom7',       short: '7',     intervals: iv('1 3 5 b7'),     cat: '7th' },
  { name: 'Min7',       short: 'm7',    intervals: iv('1 b3 5 b7'),    cat: '7th' },
  { name: 'Min(Maj7)',  short: 'mM7',   intervals: iv('1 b3 5 7'),     cat: '7th' },
  { name: 'Dim7',       short: 'dim7',  intervals: iv('1 b3 b5 6'),    cat: '7th' },
  { name: 'Half-Dim7',  short: 'm7b5',  intervals: iv('1 b3 b5 b7'),   cat: '7th' },
  { name: 'Aug7',       short: 'aug7',  intervals: iv('1 3 #5 b7'),    cat: '7th' },
  // Extensions
  { name: '9',          short: '9',     intervals: iv('1 3 5 b7 9'),   cat: 'ext' },
  { name: 'min9',       short: 'm9',    intervals: iv('1 b3 5 b7 9'),  cat: 'ext' },
  { name: 'Maj9',       short: 'Maj9',  intervals: iv('1 3 5 7 9'),    cat: 'ext' },
  // Rootless Type A (3rd on bottom — Bill Evans)
  { name: 'Maj7 RL-A',    short: 'Maj7 A', intervals: iv('3 5 7'),        cat: 'rootless-A' },
  { name: 'Dom7 RL-A',    short: '7 A',    intervals: iv('3 b7 9'),       cat: 'rootless-A' },
  //{ name: 'Dom7 RL-A 13',    short: '13 A',    intervals: iv('3 b7 9 13'),       cat: 'rootless-A' },
  { name: 'Min7 RL-A',    short: 'm7 A',   intervals: iv('b3 b7 9'),      cat: 'rootless-A' },
  //{ name: 'Min7 RL-A 11',    short: 'm7 A 11',   intervals: iv('b3 b7 9 11'),      cat: 'rootless-A' }, 
  //{ name: 'Min7♭5 RL-A',  short: 'ø A',    intervals: iv('b3 b5 b7 9'),     cat: 'rootless-A' },
  //{ name: 'Dom9 RL-A',    short: '9 A',    intervals: iv('3 b7 9 11'),      cat: 'rootless-A' },
  // Rootless Type B (7th on bottom — Bill Evans)
  { name: 'Maj7 RL-B',    short: 'Maj7 B', intervals: iv('7 3 5'),        cat: 'rootless-B' },
  { name: 'Dom7 RL-B',    short: '7 B',    intervals: iv('b7 9 3'),      cat: 'rootless-B' },
  //{ name: 'Dom7 RL-B 13',    short: '13 B',    intervals: iv('b7 9 3 13'),      cat: 'rootless-B' },
  //{ name: 'Dom7 RL-B 13 wide',    short: '13 B wide',    intervals: iv('b7 3 13 9'),      cat: 'rootless-B' },
  { name: 'Min7 RL-B',    short: 'm7 B',   intervals: iv('b7 9 b3'),      cat: 'rootless-B' },
  //{ name: 'Min7 RL-B 11',    short: 'm7 B 11',   intervals: iv('b7 9 b3 11'),      cat: 'rootless-B' },
  //{ name: 'Min7♭5 RL-B',  short: 'ø B',    intervals: iv('b7 b9 b3 b5'),    cat: 'rootless-B' },
  //{ name: 'Dom9 RL-B',    short: '9 B',    intervals: iv('b7 9 3 13'),      cat: 'rootless-B' },
  // Shell voicings (root + guide tones)
  { name: 'Maj7 Shell',   short: 'Maj7 sh', intervals: iv('1 3 7'),         cat: 'shell' },
  { name: 'Dom7 Shell',   short: '7 sh',    intervals: iv('1 3 b7'),        cat: 'shell' },
  { name: 'Min7 Shell',   short: 'm7 sh',   intervals: iv('1 b3 b7'),       cat: 'shell' },
  { name: 'Min7♭5 Shell', short: 'ø sh',    intervals: iv('1 b3 b7'),       cat: 'shell' },
  // Quartal voicings (stacked 4ths)
  // { name: 'Quartal 3',    short: 'Q3',     intervals: iv('1 4 b7'),         cat: 'quartal' },
  // { name: 'Quartal 4',    short: 'Q4',     intervals: iv('1 4 b7 b10'),     cat: 'quartal' },
  // { name: 'Quartal 5',    short: 'Q5',     intervals: iv('1 4 b7 b10 b13'), cat: 'quartal' },
  // { name: 'So What',      short: 'SW',     intervals: iv('1 4 b7 b10 12'),  cat: 'quartal' },
  // { name: 'Kenny B.',     short: 'KB',     intervals: iv('1 4 b7 9 12'),    cat: 'quartal' },
  // { name: 'RL Maj Q13',   short: 'Q6',     intervals: [-1,4,9,14],          cat: 'quartal' },
  // { name: 'RL Dom Q13',   short: 'Q6dom',  intervals: [-2,4,9,14],          cat: 'quartal' },
  // { name: 'RL Dom Qb13',  short: 'Q6b13',  intervals: [-2,4,8,14],          cat: 'quartal' },
  // { name: 'RL Dom Qb13b9',  short: 'Q6b13b9',  intervals: [-2,4,8,13],          cat: 'quartal' },
  // { name: 'RL min 6',     short: 'Qm6',    intervals: [-2,3,9,14],          cat: 'quartal' },
];

// Jazz chord voicing qualities (Type A = 3rd on bottom, Type B = 7th on bottom)
// ── BEBOP LICKS ──
// Each lick is an array of semitones relative to the root (0 = root)
// Negative values = below root, positive = above
const LICKS = [
  { name: '1-2-3-5', cat: 'basic', notes: [0, 2, 4, 7] },
  { name: '1-3-5-7', cat: 'basic', notes: [0, 4, 7, 11] },
  { name: '5-4-3-1', cat: 'basic', notes: [7, 5, 4, 0] },
  { name: 'Enclosure 3rd', cat: 'bebop', notes: [5, 3, 4, 0, 2] },
  { name: 'Enclosure Root', cat: 'bebop', notes: [2, -1, 0, 4, 7] },
  { name: 'Honeysuckle Rose', cat: 'bebop', notes: [4, 0, 2, -1, 0] },
  { name: 'Parker #1', cat: 'bebop', notes: [0, 2, 4, 5, 7, 4, 2, 0] },
  { name: 'Parker #2', cat: 'bebop', notes: [0, 11, 7, 4, 5, 7, 9, 11, 12] },
  { name: 'Approach 3rd', cat: 'bebop', notes: [2, 3, 5, 4] },
  { name: 'Approach 7th', cat: 'bebop', notes: [9, 10, 12, 11] },
  { name: 'Bebop Run', cat: 'bebop', notes: [0, 2, 4, 5, 7, 9, 10, 11, 12] },
  { name: 'Minor Cry', cat: 'minor', notes: [0, 3, 5, 7, 10, 12, 10, 7] },
  { name: 'Minor Turn', cat: 'minor', notes: [0, 2, 3, 5, 3, 2, 0, -2] },
  { name: 'Minor Encl.', cat: 'minor', notes: [5, 2, 4, 3, 0, 3, 7] },
  { name: 'ii-V Lick #1', cat: 'ii-V', notes: [0, 2, 4, 5, 4, 2, 1, 0] },
  { name: 'ii-V Lick #2', cat: 'ii-V', notes: [7, 5, 4, 2, 0, 1, -1, 0] },
  { name: 'ii-V Lick #3', cat: 'ii-V', notes: [0, 2, 3, 5, 7, 9, 7, 5, 4, 2, 0] },
  { name: 'Coltrane', cat: 'advanced', notes: [0, 4, 7, 11, 14, 11, 7, 4, 0] },
  { name: 'Digital Pattern', cat: 'advanced', notes: [0, 2, 4, 7, 2, 4, 7, 9] },
  { name: 'Pentatonic Run', cat: 'advanced', notes: [0, 2, 4, 7, 9, 12, 9, 7, 4, 2, 0] }
];

const VOICINGS = {
  'm7':    { A: [3, 7, 10, 14],  B: [10, 14, 15, 19] },
  '7':     { A: [4, 9, 10, 14],  B: [10, 14, 16, 21] },
  'Maj7':  { A: [4, 7, 11, 14],  B: [11, 14, 16, 19] },
  'm7b5':  { A: [3, 6, 10, 14],  B: [10, 14, 15, 18] },
  '7alt':  { A: [4, 8, 10, 13],  B: [10, 13, 16, 20] },
  'm6':    { A: [3, 7, 9, 14],   B: [9, 14, 15, 19] },
  'IV7':   { A: [4, 7, 10, 14],  B: [10, 14, 16, 19] },
};

const CADENCES = [
  {
    name: 'ii-V-I', short: 'ii⁷→V⁷→I△', cat: 'major',
    chords: [
      { degRoot: 2,  name: 'ii-7',    quality: 'm7' },
      { degRoot: 7,  name: 'V7',      quality: '7' },
      { degRoot: 0,  name: 'IMaj7',   quality: 'Maj7' },
    ]
  },
  {
    name: 'Turnaround', short: 'I→vi⁷→ii⁷→V⁷', cat: 'major',
    chords: [
      { degRoot: 0,  name: 'IMaj7',   quality: 'Maj7' },
      { degRoot: 9,  name: 'vi-7',    quality: 'm7' },
      { degRoot: 2,  name: 'ii-7',    quality: 'm7' },
      { degRoot: 7,  name: 'V7',      quality: '7' },
    ]
  },
  {
    name: 'Minor ii-V-i', short: 'iiø→V⁷alt→i⁶', cat: 'minor',
    chords: [
      { degRoot: 2,  name: 'iiø7',    quality: 'm7b5' },
      { degRoot: 7,  name: 'V7alt',   quality: '7alt' },
      { degRoot: 0,  name: 'i-6',     quality: 'm6' },
    ]
  },
  {
    name: 'Rhythm Bridge', short: 'I△→IV⁷→iii⁷→vi⁷', cat: 'major',
    chords: [
      { degRoot: 0,  name: 'IMaj7',   quality: 'Maj7' },
      { degRoot: 5,  name: 'IV7',     quality: 'IV7' },
      { degRoot: 4,  name: 'iii-7',   quality: 'm7' },
      { degRoot: 9,  name: 'vi-7',    quality: 'm7' },
    ]
  },
  {
    name: 'ii-V', short: 'ii⁷→V⁷', cat: 'major',
    chords: [
      { degRoot: 2,  name: 'ii-7',    quality: 'm7' },
      { degRoot: 7,  name: 'V7',      quality: '7' },
    ]
  },
  {
    name: 'Plagal', short: 'I△→IV△→I△', cat: 'major',
    chords: [
      { degRoot: 0,  name: 'IMaj7',   quality: 'Maj7' },
      { degRoot: 5,  name: 'IVMaj7',  quality: 'Maj7' },
      { degRoot: 0,  name: 'IMaj7',   quality: 'Maj7' },
    ]
  },
  // Single chords
  {
    name: 'IMaj7', short: 'I△', cat: 'single',
    chords: [ { degRoot: 0, name: 'IMaj7', quality: 'Maj7' } ]
  },
  {
    name: 'Im7', short: 'i⁷', cat: 'single',
    chords: [ { degRoot: 0, name: 'Im7', quality: 'm7' } ]
  },
  {
    name: 'V7', short: 'V⁷', cat: 'single',
    chords: [ { degRoot: 7, name: 'V7', quality: '7' } ]
  },
  {
    name: 'iim7', short: 'ii⁷', cat: 'single',
    chords: [ { degRoot: 2, name: 'ii-7', quality: 'm7' } ]
  },
];

// MIDI note helpers: A4 = 69 = 440Hz
