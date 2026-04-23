// NoteChaser — Per-assignment overlearning tracker
//
// Each unique "assignment" (e.g. a chord type, an interval+direction, a lick)
// has its own record: streak toward mastery, successes, mistakes, mastered flag.
//
// Overlearning rule: a fresh assignment is mastered after PROGRESS_BASE_STREAK
// correct reps in a row. Every mistake resets the current streak and grows the
// required streak by 100% (mistakes=0 → 5, =1 → 10, =2 → 15, ...). This
// enforces at-least-100% overlearning.
//
// Storage is a single JSON blob in localStorage (simple, synchronous, plenty
// of headroom for a few hundred records). The API is self-contained so we can
// swap the backend to IndexedDB later without touching callers.

const PROGRESS_STORAGE_KEY = 'notechaser_progress_v1';
const PROGRESS_BASE_STREAK = 5;

let _progressCache = null;

function _progressLoad() {
  if (_progressCache) return _progressCache;
  try {
    _progressCache = JSON.parse(localStorage.getItem(PROGRESS_STORAGE_KEY) || '{}');
  } catch (e) {
    _progressCache = {};
  }
  return _progressCache;
}

function _progressSave() {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(_progressCache || {}));
  } catch (e) {
    console.warn('NoteChaser: failed to persist progress', e);
  }
}

function _progressDefaults(key, label, mode) {
  return {
    key,
    label: label || key,
    mode: mode || '',
    successes: 0,
    mistakes: 0,
    currentStreak: 0,
    bestStreak: 0,
    mastered: false,
    masteredAt: null,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
  };
}

// Required streak for mastery — grows 100% per recorded mistake.
// mistakes=0 → 5, =1 → 10, =2 → 15, =3 → 20, ...
function progressRequiredStreak(stats) {
  const m = stats ? stats.mistakes || 0 : 0;
  return PROGRESS_BASE_STREAK * (1 + m);
}

function progressGet(key, label, mode) {
  const data = _progressLoad();
  if (!data[key]) {
    data[key] = _progressDefaults(key, label, mode);
  } else {
    // Backfill label/mode if missing (older records)
    if (label && !data[key].label) data[key].label = label;
    if (mode && !data[key].mode) data[key].mode = mode;
  }
  return data[key];
}

// Read-only lookup — does NOT create a record if one doesn't exist.
// Use this for rendering/displaying so we don't pollute storage with
// zero-value entries.
function progressPeek(key) {
  const data = _progressLoad();
  return data[key] || null;
}

function progressRecordSuccess(key, label, mode) {
  if (!key) return null;
  const stats = progressGet(key, label, mode);
  stats.successes++;
  stats.currentStreak++;
  if (stats.currentStreak > stats.bestStreak) stats.bestStreak = stats.currentStreak;
  stats.lastSeen = Date.now();
  const required = progressRequiredStreak(stats);
  let justMastered = false;
  if (!stats.mastered && stats.currentStreak >= required) {
    stats.mastered = true;
    stats.masteredAt = Date.now();
    justMastered = true;
  }
  _progressSave();
  return { stats, required, justMastered };
}

function progressRecordMistake(key, label, mode) {
  if (!key) return null;
  const stats = progressGet(key, label, mode);
  stats.mistakes++;
  stats.currentStreak = 0;
  // Breaking a streak during overlearning un-masters the item so the
  // user has to climb the (now-larger) required streak again.
  stats.mastered = false;
  stats.masteredAt = null;
  stats.lastSeen = Date.now();
  _progressSave();
  return { stats, required: progressRequiredStreak(stats) };
}

function progressAll() {
  // Clone so callers can't mutate the cache
  return JSON.parse(JSON.stringify(_progressLoad()));
}

function progressResetKey(key) {
  const data = _progressLoad();
  delete data[key];
  _progressSave();
}

function progressResetAll() {
  _progressCache = {};
  _progressSave();
}

function progressSummary() {
  const data = _progressLoad();
  const rows = Object.values(data);
  const total = rows.length;
  const mastered = rows.filter(r => r.mastered).length;
  const totalSuccesses = rows.reduce((s, r) => s + (r.successes || 0), 0);
  const totalMistakes = rows.reduce((s, r) => s + (r.mistakes || 0), 0);
  return { total, mastered, totalSuccesses, totalMistakes };
}
