// NoteChaser — SoundFont (.sf2) player
//
// Load your own .sf2 piano and every note the app plays uses it instead of the
// built-in rendered piano. Parsed here in the page: the file never leaves the
// machine. It's kept in this browser's IndexedDB so it survives reloads.
//
// What's implemented is what pianos lean on: preset → instrument → zone
// layering with key and velocity ranges, stereo L/R sample pairs (via pan),
// loops (sampleModes 1 and 3), the volume envelope (delay/attack/hold/decay/
// sustain/release, with keynum-scaled hold and decay so treble notes die
// faster), coarse/fine tuning, scaleTuning, root-key override, attenuation
// and the lowpass filter. Not implemented: modulation envelope, LFOs, and
// modulators — rarely load-bearing in piano fonts.
//
// Samples are converted to AudioBuffers lazily, the first time a note needs
// them: a big piano font can be hundreds of MB, and expanding all of it to
// float up front would double that.

const SF2_VELOCITY = 100;        // the app's notes have no dynamics; pick a mid-loud layer
const SF2_ATTEN_SCALE = 0.4;     // EMU/FluidSynth convention for initialAttenuation
const SF2_DB_NAME = 'notechaser-soundfont';
const SF2_PRESET_KEY = 'notechaser_sf2_preset';

// Generator operator numbers (SoundFont 2.04 spec, section 8.1.2)
const G = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4, initialFilterFc: 8, initialFilterQ: 9, endAddrsCoarseOffset: 12,
  pan: 17, delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36,
  sustainVolEnv: 37, releaseVolEnv: 38, keynumToVolEnvHold: 39, keynumToVolEnvDecay: 40,
  instrument: 41, keyRange: 43, velRange: 44, startloopAddrsCoarseOffset: 45,
  initialAttenuation: 48, endloopAddrsCoarseOffset: 50, coarseTune: 51, fineTune: 52,
  sampleID: 53, sampleModes: 54, scaleTuning: 56, overridingRootKey: 58,
};

const SF2_DEFAULTS = {
  [G.initialFilterFc]: 13500, [G.delayVolEnv]: -12000, [G.attackVolEnv]: -12000,
  [G.holdVolEnv]: -12000, [G.decayVolEnv]: -12000, [G.releaseVolEnv]: -12000,
  [G.scaleTuning]: 100, [G.overridingRootKey]: -1,
};

// Valid only at instrument level — a preset zone may not add to these
const SF2_INSTRUMENT_ONLY = new Set([0, 1, 2, 3, 4, 12, 45, 46, 47, 50, 53, 54, 57, 58]);

let sf2 = null;          // parsed font: { name, presets, smpl, … }
let sf2Regions = [];     // playable layers of the selected preset
let sf2PresetIdx = -1;
let sf2Norm = 1;         // brings the font's level in line with the built-in piano
const sf2BufferCache = new Map();

function sf2Active() { return !!sf2 && sf2Regions.length > 0; }

// ── PARSING ──
function sf2Parse(arrayBuffer, fileName) {
  const dv = new DataView(arrayBuffer);
  const str = (off, len) => {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = dv.getUint8(off + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };
  if (arrayBuffer.byteLength < 12 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'sfbk') {
    throw new Error('This isn’t a SoundFont 2 (.sf2) file.');
  }

  // Walk the three top-level LISTs (INFO, sdta, pdta) and index their chunks
  const chunks = {};
  const riffEnd = Math.min(arrayBuffer.byteLength, 8 + dv.getUint32(4, true));
  let off = 12;
  while (off + 8 <= riffEnd) {
    const id = str(off, 4);
    const size = dv.getUint32(off + 4, true);
    if (id === 'LIST') {
      const listEnd = Math.min(off + 8 + size, riffEnd);
      let sub = off + 12;
      while (sub + 8 <= listEnd) {
        const sid = str(sub, 4);
        const ssize = dv.getUint32(sub + 4, true);
        chunks[sid] = { off: sub + 8, size: Math.min(ssize, listEnd - sub - 8) };
        sub += 8 + ssize + (ssize & 1);
      }
    }
    off += 8 + size + (size & 1);
  }
  for (const need of ['smpl', 'phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr']) {
    if (!chunks[need]) throw new Error(`Damaged SoundFont: the ${need} chunk is missing.`);
  }
  if (chunks.ifil && dv.getUint16(chunks.ifil.off, true) >= 3) {
    throw new Error('This is an SF3 (compressed) SoundFont — please use the .sf2 version.');
  }

  const records = (name, size, read) => {
    const c = chunks[name];
    const out = [];
    for (let i = 0; i + size <= c.size; i += size) out.push(read(c.off + i));
    return out;
  };
  const gen = o => ({ op: dv.getUint16(o, true), lo: dv.getUint8(o + 2), hi: dv.getUint8(o + 3), amt: dv.getInt16(o + 2, true), u: dv.getUint16(o + 2, true) });
  const phdr = records('phdr', 38, o => ({ name: str(o, 20), program: dv.getUint16(o + 20, true), bank: dv.getUint16(o + 22, true), bag: dv.getUint16(o + 24, true) }));
  const pbag = records('pbag', 4, o => dv.getUint16(o, true));
  const pgen = records('pgen', 4, gen);
  const inst = records('inst', 22, o => ({ name: str(o, 20), bag: dv.getUint16(o + 20, true) }));
  const ibag = records('ibag', 4, o => dv.getUint16(o, true));
  const igen = records('igen', 4, gen);
  const shdr = records('shdr', 46, o => ({
    name: str(o, 20), start: dv.getUint32(o + 20, true), end: dv.getUint32(o + 24, true),
    loopStart: dv.getUint32(o + 28, true), loopEnd: dv.getUint32(o + 32, true),
    rate: dv.getUint32(o + 36, true), pitch: dv.getUint8(o + 40), correction: dv.getInt8(o + 41),
    type: dv.getUint16(o + 44, true),
  }));
  if (shdr.some(s => s.type & 0x10)) {
    throw new Error('This SoundFont has compressed (SF3) samples — please use the .sf2 version.');
  }

  // The sample pool: 16-bit signed little-endian, all samples back to back
  const sc = chunks.smpl;
  const smpl = sc.off % 2 === 0
    ? new Int16Array(arrayBuffer, sc.off, Math.floor(sc.size / 2))
    : new Int16Array(arrayBuffer.slice(sc.off, sc.off + sc.size - (sc.size & 1)));

  // The last phdr/inst/shdr record is a terminator (EOP/EOI/EOS)
  const presets = phdr.slice(0, -1).map((p, i) => ({ ...p, index: i }))
    .sort((a, b) => a.bank - b.bank || a.program - b.program);

  return { name: fileName || 'SoundFont', phdr, pbag, pgen, inst, ibag, igen, shdr, smpl, presets };
}

// A bag's generators as { op: record }. The first zone of a preset/instrument
// is global if it lacks the terminal generator (instrument / sampleID).
function sf2Zones(bagStart, bagEnd, bags, gens, terminalOp) {
  const zones = [];
  let global = null;
  for (let b = bagStart; b < bagEnd && b + 1 < bags.length; b++) {
    const z = {};
    for (let i = bags[b]; i < bags[b + 1] && i < gens.length; i++) z[gens[i].op] = gens[i];
    if (z[terminalOp]) zones.push(z);
    else if (b === bagStart) global = z;
  }
  return { global, zones };
}

const sf2Range = r => (r ? { lo: r.lo, hi: r.hi } : { lo: 0, hi: 127 });

// Flatten one preset into playable layers: instrument values are absolute
// (local zone overrides the instrument's global zone, which overrides the
// spec defaults); preset values are added on top; key/velocity ranges are
// intersected.
function sf2BuildRegions(font, presetIdx) {
  const { phdr, pbag, pgen, inst, ibag, igen, shdr } = font;
  const p = phdr[presetIdx];
  const { global: pGlobal, zones: pZones } = sf2Zones(p.bag, phdr[presetIdx + 1].bag, pbag, pgen, G.instrument);
  const regions = [];
  for (const pz of pZones) {
    const instIdx = pz[G.instrument].u;
    if (instIdx + 1 >= inst.length) continue;
    const pKey = sf2Range(pz[G.keyRange] || (pGlobal && pGlobal[G.keyRange]));
    const pVel = sf2Range(pz[G.velRange] || (pGlobal && pGlobal[G.velRange]));
    const add = {};
    for (const src of [pGlobal, pz]) {
      if (!src) continue;
      for (const op in src) {
        const n = +op;
        if (n === G.keyRange || n === G.velRange || n === G.instrument || SF2_INSTRUMENT_ONLY.has(n)) continue;
        add[n] = src[op].amt; // local replaces global
      }
    }

    const ins = inst[instIdx];
    const { global: iGlobal, zones: iZones } = sf2Zones(ins.bag, inst[instIdx + 1].bag, ibag, igen, G.sampleID);
    for (const iz of iZones) {
      const sample = shdr[iz[G.sampleID].u];
      if (!sample || sample.type & 0x8000 || sample.end <= sample.start) continue; // ROM / empty
      const gens = { ...SF2_DEFAULTS };
      let iKey = { lo: 0, hi: 127 }, iVel = { lo: 0, hi: 127 };
      for (const src of [iGlobal, iz]) {
        if (!src) continue;
        for (const op in src) {
          const n = +op;
          if (n === G.keyRange) iKey = sf2Range(src[op]);
          else if (n === G.velRange) iVel = sf2Range(src[op]);
          else gens[n] = src[op].amt;
        }
      }
      for (const op in add) gens[op] = (gens[op] || 0) + add[op];
      const keyLo = Math.max(pKey.lo, iKey.lo), keyHi = Math.min(pKey.hi, iKey.hi);
      const velLo = Math.max(pVel.lo, iVel.lo), velHi = Math.min(pVel.hi, iVel.hi);
      if (keyLo > keyHi || velLo > velHi) continue;
      regions.push({ keyLo, keyHi, velLo, velHi, sample, gens });
    }
  }
  return regions;
}

const g0 = (gens, op) => gens[op] || 0;

function sf2RegionsFor(midi, vel) {
  return sf2Regions.filter(r => midi >= r.keyLo && midi <= r.keyHi && vel >= r.velLo && vel <= r.velHi);
}

// The sample slice a region plays, as an AudioBuffer (cached per slice)
function sf2Buffer(r) {
  const s = r.sample, g = r.gens;
  const start = s.start + g0(g, G.startAddrsOffset) + 32768 * g0(g, G.startAddrsCoarseOffset);
  const end = Math.min(s.end + g0(g, G.endAddrsOffset) + 32768 * g0(g, G.endAddrsCoarseOffset), sf2.smpl.length);
  const key = `${start}:${end}:${s.rate}`;
  let entry = sf2BufferCache.get(key);
  if (!entry) {
    const len = Math.max(1, end - start);
    const rate = Math.max(3000, Math.min(192000, s.rate || 44100));
    const buffer = audioCtx.createBuffer(1, len, rate);
    const ch = buffer.getChannelData(0);
    const src = sf2.smpl;
    for (let i = 0; i < len; i++) ch[i] = src[start + i] / 32768;
    entry = { buffer, start, rate };
    sf2BufferCache.set(key, entry);
  }
  const loopStart = s.loopStart + g0(g, G.startloopAddrsOffset) + 32768 * g0(g, G.startloopAddrsCoarseOffset);
  const loopEnd = s.loopEnd + g0(g, G.endloopAddrsOffset) + 32768 * g0(g, G.endloopAddrsCoarseOffset);
  return {
    buffer: entry.buffer,
    loopStart: (loopStart - entry.start) / entry.rate,
    loopEnd: (loopEnd - entry.start) / entry.rate,
  };
}

// ── ENVELOPE ──
// SF2 times are timecents (2^(tc/1200) s); levels are centibels of attenuation.
function sf2Envelope(g, midi) {
  const tc = v => Math.pow(2, v / 1200);
  const sustainCb = Math.max(0, Math.min(1440, g0(g, G.sustainVolEnv)));
  const decay = tc(g[G.decayVolEnv] + g0(g, G.keynumToVolEnvDecay) * (60 - midi));
  return {
    delay: tc(g[G.delayVolEnv]),
    attack: tc(g[G.attackVolEnv]),
    hold: tc(g[G.holdVolEnv] + g0(g, G.keynumToVolEnvHold) * (60 - midi)),
    // decayVolEnv is the time to fall 100 dB; reaching sustain takes its share
    decayToSustain: decay * Math.min(1, sustainCb / 1000),
    sustain: Math.pow(10, -sustainCb / 200),
    release: Math.max(0.03, Math.min(6, tc(g[G.releaseVolEnv]))),
  };
}

// Envelope level (0–1 of peak) t seconds after the note starts. Computed, not
// read back from the AudioParam, so a release can start from the exact
// current level without a click.
function sf2EnvAt(e, t) {
  if (t < e.delay) return 0;
  t -= e.delay;
  if (t < e.attack) return t / e.attack;
  t -= e.attack;
  if (t < e.hold) return 1;
  t -= e.hold;
  if (e.decayToSustain > 0 && t < e.decayToSustain) return Math.pow(e.sustain, t / e.decayToSustain); // linear in dB
  return e.sustain;
}

// Schedule attack → hold → decay, cut off at `until` if the note ends first
function sf2ScheduleEnv(param, e, peak, t0, until) {
  const end = until === undefined ? Infinity : until;
  const level = t => Math.max(peak * sf2EnvAt(e, t - t0), 1e-7);
  param.setValueAtTime(0, t0);
  let t = t0 + e.delay;
  if (t >= end) return;
  param.setValueAtTime(0, t);
  let next = t + e.attack;
  if (next >= end) { param.linearRampToValueAtTime(level(end), end); return; }
  param.linearRampToValueAtTime(peak, next);
  t = next;
  next = t + e.hold;
  if (next >= end) return;
  param.setValueAtTime(peak, next);
  t = next;
  if (e.decayToSustain > 0) {
    next = t + e.decayToSustain;
    if (next >= end) { param.exponentialRampToValueAtTime(level(end), end); return; }
    param.exponentialRampToValueAtTime(Math.max(peak * e.sustain, 1e-7), next);
  }
}

// A part's level at time t, including a release already under way — so a
// note cut short mid-release fades from where it actually is, not from the
// (louder) envelope level, which would click.
function sf2LevelAt(part, t) {
  const env = part.env;
  if (part.relAt === undefined || t < part.relAt) {
    return Math.max(part.peak * sf2EnvAt(env, t - part.start), 1e-7);
  }
  const from = Math.max(part.peak * sf2EnvAt(env, part.relAt - part.start), 1e-7);
  return Math.max(from * Math.pow(1e-5, Math.min(1, (t - part.relAt) / part.relTime)), 1e-8);
}

function sf2Release(part, at, releaseTime) {
  const v = sf2LevelAt(part, at);
  const param = part.gain.gain;
  param.cancelScheduledValues(at);
  param.setValueAtTime(v, at);
  param.exponentialRampToValueAtTime(Math.max(v * 1e-5, 1e-8), at + releaseTime); // −100 dB
  part.relAt = at;
  part.relTime = releaseTime;
}

// ── VOICES ──
// One app note = every region that covers this key at our velocity (two of
// them for a stereo L/R pair). `duration` undefined = held until release().
function sf2Voice(midi, start, duration, level) {
  const regions = sf2RegionsFor(midi, SF2_VELOCITY);
  if (!regions.length) return null;
  const parts = regions.map(r => {
    const g = r.gens;
    const { buffer, loopStart, loopEnd } = sf2Buffer(r);
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const root = g[G.overridingRootKey] >= 0 ? g[G.overridingRootKey] : (r.sample.pitch <= 127 ? r.sample.pitch : 60);
    const cents = (midi - root) * g[G.scaleTuning] + g0(g, G.coarseTune) * 100 + g0(g, G.fineTune) + r.sample.correction;
    src.playbackRate.value = Math.pow(2, cents / 1200);
    const mode = g0(g, G.sampleModes) & 3;
    if ((mode === 1 || mode === 3) && loopEnd > loopStart && loopEnd <= buffer.duration + 1e-6) {
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
    }

    let node = src;
    const fc = g[G.initialFilterFc];
    if (fc < 13500) {
      const f = audioCtx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(8.176 * Math.pow(2, fc / 1200), audioCtx.sampleRate / 2);
      f.Q.value = Math.max(0, g0(g, G.initialFilterQ) / 10);
      node.connect(f);
      node = f;
    }
    const gain = audioCtx.createGain();
    node.connect(gain);
    node = gain;
    const pan = g0(g, G.pan);
    if (pan && audioCtx.createStereoPanner) {
      const p = audioCtx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan / 500));
      node.connect(p);
      node = p;
    }
    node.connect(masterGain);

    const env = sf2Envelope(g, midi);
    const peak = level * sf2Norm * Math.pow(10, -(g0(g, G.initialAttenuation) * SF2_ATTEN_SCALE) / 200);
    const until = duration === undefined ? undefined : start + duration;
    const part = { src, gain, env, peak, mode, start };
    sf2ScheduleEnv(gain.gain, env, peak, start, until);
    src.start(start);
    if (until !== undefined) {
      sf2Release(part, until, env.release);
      src.stop(until + env.release + 0.05);
    } else if (!src.loop) {
      // Held: let an unlooped sample ring to its natural end
      src.stop(start + buffer.duration / src.playbackRate.value + 0.05);
    }
    return part;
  });

  const voice = {
    startedAt: start,
    released: false,
    // Short times (voice stealing) cut fast; a key being let go uses the
    // font's own release, which is what makes a piano sound like a piano.
    release(t) {
      if (voice.released) return;
      voice.released = true;
      activeVoices.delete(voice);
      const at = Math.max(audioCtx.currentTime, start);
      for (const part of parts) {
        const rt = t <= 0.06 ? t : part.env.release;
        // Already releasing on its own and that ends sooner? Leave it be.
        if (part.relAt !== undefined && part.relAt <= at && part.relAt + part.relTime <= at + rt) continue;
        if (part.mode === 3) part.src.loop = false; // mode 3: play the tail after the loop
        sf2Release(part, at, rt);
        try { part.src.stop(at + rt + 0.05); } catch (e) {}
      }
    },
  };
  parts[0].src.onended = () => activeVoices.delete(voice);
  registerVoice(voice);
  return voice;
}

// Level the font against the built-in piano: a single middle C should peak
// where the built-in one does, so chimes and mixes keep their balance.
function sf2Normalise() {
  sf2Norm = 1;
  const regs = sf2RegionsFor(60, SF2_VELOCITY);
  let loudest = 0;
  for (const r of regs) {
    const s = r.sample;
    const atten = Math.pow(10, -(g0(r.gens, G.initialAttenuation) * SF2_ATTEN_SCALE) / 200);
    let peak = 0;
    const end = Math.min(s.end, sf2.smpl.length);
    for (let i = s.start; i < end; i += 2) { const a = Math.abs(sf2.smpl[i]); if (a > peak) peak = a; }
    loudest = Math.max(loudest, (peak / 32768) * atten);
  }
  if (loudest > 0) sf2Norm = Math.max(0.05, Math.min(20, 0.95 / loudest));
}

function sf2SelectPreset(presetIdx) {
  if (!sf2) return false;
  sf2PresetIdx = presetIdx;
  sf2Regions = sf2BuildRegions(sf2, presetIdx);
  sf2BufferCache.clear();
  sf2Normalise();
  const p = sf2.phdr[presetIdx];
  try { localStorage.setItem(SF2_PRESET_KEY, `${p.bank}:${p.program}`); } catch (e) {}
  return sf2Regions.length > 0;
}

// First choice: the saved preset; then bank 0 program 0 (acoustic grand in
// GM fonts); then whatever comes first.
function sf2DefaultPreset(font) {
  let saved = null;
  try { saved = localStorage.getItem(SF2_PRESET_KEY); } catch (e) {}
  const byKey = k => font.presets.find(p => `${p.bank}:${p.program}` === k);
  return (saved && byKey(saved)) || byKey('0:0') || font.presets[0];
}

function sf2Install(arrayBuffer, fileName) {
  const font = sf2Parse(arrayBuffer, fileName);
  if (!font.presets.length) throw new Error('This SoundFont has no presets.');
  sf2 = font;
  if (!sf2SelectPreset(sf2DefaultPreset(font).index)) {
    // Default preset plays nothing (drum kit, empty) — take the first that does
    const playable = font.presets.find(p => sf2SelectPreset(p.index));
    if (!playable) { sf2 = null; sf2Regions = []; throw new Error('No playable presets in this SoundFont.'); }
  }
  return font;
}

function sf2Uninstall() {
  sf2 = null;
  sf2Regions = [];
  sf2PresetIdx = -1;
  sf2BufferCache.clear();
}

// ── STORAGE (IndexedDB — this browser only) ──
function sf2Db() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error('no IndexedDB')); return; }
    const req = indexedDB.open(SF2_DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('fonts');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sf2Store(file) {
  const db = await sf2Db();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('fonts', 'readwrite');
    tx.objectStore('fonts').put({ name: file.name, size: file.size, blob: file }, 'current');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('storage aborted'));
  });
  db.close();
}

async function sf2Load() {
  const db = await sf2Db();
  const rec = await new Promise((resolve, reject) => {
    const req = db.transaction('fonts').objectStore('fonts').get('current');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rec;
}

async function sf2Forget() {
  const db = await sf2Db();
  await new Promise(resolve => {
    const tx = db.transaction('fonts', 'readwrite');
    tx.objectStore('fonts').delete('current');
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  db.close();
}

// ── SETTINGS UI ──
function sf2FormatSize(bytes) {
  return bytes > 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} KB`;
}

function sf2RefreshUI(note, warn) {
  const status = document.getElementById('sf2Status');
  if (!status) return;
  const presetRow = document.getElementById('sf2PresetRow');
  const sel = document.getElementById('sSf2Preset');
  const remove = document.getElementById('sf2RemoveBtn');
  if (sf2Active()) {
    status.textContent = sf2.name;
    status.title = sf2.name;
    remove.style.display = '';
    if (sf2.presets.length > 1) {
      sel.innerHTML = '';
      for (const p of sf2.presets) {
        const label = `${String(p.bank).padStart(3, '0')}:${String(p.program).padStart(3, '0')}  ${p.name}`;
        sel.add(new Option(label, String(p.index)));
      }
      sel.value = String(sf2PresetIdx);
      presetRow.style.display = '';
    } else {
      presetRow.style.display = 'none';
    }
  } else {
    status.textContent = 'Built-in piano';
    status.title = '';
    remove.style.display = 'none';
    presetRow.style.display = 'none';
  }
  if (note !== undefined) {
    const el = document.getElementById('sf2Note');
    el.textContent = note;
    el.classList.toggle('warn', !!warn);
  }
}

// A quick C major arpeggio so you hear what you just loaded
function sf2Audition() {
  if (typeof playSequence !== 'function') return;
  playSequence([60, 64, 67, 72].map((m, i) => ({ notes: m, at: i * 0.22, dur: 1.6 }))
    .concat([{ notes: [48, 60, 64, 67], at: 1.0, dur: 2.2 }]));
}

async function onSf2FileChosen(input) {
  const file = input.files && input.files[0];
  input.value = ''; // let the same file be picked again
  if (!file) return;
  sf2RefreshUI(`Loading ${file.name} (${sf2FormatSize(file.size)})…`);
  try {
    const buf = await file.arrayBuffer();
    sf2Install(buf, file.name);
  } catch (e) {
    sf2RefreshUI(e.message || 'Couldn’t read that file.', true);
    return;
  }
  let stored = true;
  try { await sf2Store(file); } catch (e) { stored = false; }
  sf2RefreshUI(stored
    ? `Loaded — ${sf2.presets.length} preset${sf2.presets.length > 1 ? 's' : ''}, ${sf2FormatSize(file.size)}. Kept in this browser only, never uploaded.`
    : 'Loaded for this session — the browser wouldn’t store a file this size, so you’ll need to load it again next visit.', !stored);
  initAudio();
  sf2Audition();
}

function onSf2PresetChosen(sel) {
  const ok = sf2SelectPreset(+sel.value);
  sf2RefreshUI(ok ? '' : 'That preset has no playable notes — pick another.', !ok);
  if (ok) { initAudio(); sf2Audition(); }
}

async function removeSoundFont() {
  sf2Uninstall();
  try { localStorage.removeItem(SF2_PRESET_KEY); } catch (e) {}
  try { await sf2Forget(); } catch (e) {}
  sf2RefreshUI('Back to the built-in piano. The SoundFont was removed from this browser.');
}

// Restore the stored font on startup, after the page is up
(function sf2Restore() {
  const go = async () => {
    try {
      const rec = await sf2Load();
      if (!rec || !rec.blob) return;
      sf2Install(await rec.blob.arrayBuffer(), rec.name);
      sf2RefreshUI();
    } catch (e) {
      sf2RefreshUI('The saved SoundFont couldn’t be loaded — using the built-in piano.', true);
    }
  };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
})();
