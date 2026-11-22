// Pitch detection, off the main thread (so it can't make the UI or the piano
// stutter). Chunks of mic signal arrive from js/pitch-worklet.js; after each
// one, the latest window is analysed and the raw result posted to the page,
// which applies the sensitivity/confidence settings.
//
// Same autocorrelation method as before, but computed with an FFT: the
// direct sum was ~67 million multiply-adds per frame at 48 kHz, this is a
// couple of hundred thousand — identical result.

let sr = 48000, size = 4096, ring = null, write = 0, filled = 0;
let M = 0, re = null, im = null, cosT = null, sinT = null, rev = null;

onmessage = e => {
  const d = e.data;
  if (d.type !== 'init') return;
  sr = d.sampleRate;
  size = d.size;
  ring = new Float32Array(size);
  write = 0;
  filled = 0;
  setupFFT(size * 2); // zero-padded to 2N: linear, not circular, correlation
  d.port.onmessage = ev => feed(ev.data);
};

function feed(chunk) {
  for (let i = 0; i < chunk.length; i++) {
    ring[write] = chunk[i];
    write = (write + 1) % size;
  }
  filled += chunk.length;
  if (filled >= size) postMessage(analyse());
}

function setupFFT(n) {
  M = n;
  re = new Float64Array(n);
  im = new Float64Array(n);
  cosT = new Float64Array(n / 2);
  sinT = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos(-2 * Math.PI * i / n);
    sinT[i] = Math.sin(-2 * Math.PI * i / n);
  }
  rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
}

// In-place iterative radix-2 FFT on re/im
function fft() {
  for (let i = 0; i < M; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= M; len <<= 1) {
    const half = len >> 1, step = M / len;
    for (let i = 0; i < M; i += len) {
      for (let k = 0; k < half; k++) {
        const c = cosT[k * step], s = sinT[k * step];
        const a = i + k, b = a + half;
        const tr = re[b] * c - im[b] * s;
        const ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

function analyse() {
  // Oldest → newest
  let rms = 0;
  for (let i = 0; i < size; i++) {
    const x = ring[(write + i) % size];
    re[i] = x;
    im[i] = 0;
    rms += x * x;
  }
  re.fill(0, size);
  im.fill(0, size);
  rms = Math.sqrt(rms / size);
  if (rms === 0) return { rms, freq: null, ratio: 0 };

  // Autocorrelation = IFFT(|FFT(x)|²). The power spectrum is real, so the
  // inverse is a forward FFT of it, divided by M.
  fft();
  for (let i = 0; i < M; i++) {
    re[i] = re[i] * re[i] + im[i] * im[i];
    im[i] = 0;
  }
  fft();
  const corr = lag => re[lag] / M;

  const minLag = Math.floor(sr / 600); // max ~600Hz
  const maxLag = Math.floor(sr / 55);  // min ~55Hz

  // First dip, then the highest peak in the singing range
  let d = 0;
  while (d < maxLag && corr(d) > corr(d + 1)) d++;
  let maxVal = -1, maxIdx = -1;
  for (let i = Math.max(d, minLag); i < Math.min(size - 1, maxLag); i++) {
    const v = corr(i);
    if (v > maxVal) { maxVal = v; maxIdx = i; }
  }
  if (maxIdx === -1 || maxVal < 0.01) return { rms, freq: null, ratio: 0 };

  // Parabolic interpolation for better accuracy
  const y1 = maxIdx > 0 ? corr(maxIdx - 1) : corr(maxIdx);
  const y2 = corr(maxIdx);
  const y3 = maxIdx < size - 1 ? corr(maxIdx + 1) : corr(maxIdx);
  const shift = (y3 - y1) / (2 * (2 * y2 - y1 - y3));
  const freq = sr / (maxIdx + (isFinite(shift) ? shift : 0));
  if (freq < 55 || freq > 600) return { rms, freq: null, ratio: 0 };

  return { rms, freq, ratio: y2 / corr(0) };
}
