// Runs on the audio thread. Does nothing but copy the mic signal into
// 1024-sample chunks and hand each one straight to the pitch worker (over a
// MessagePort the page gives it) — no maths here, so it can never make the
// piano stutter. The detection itself happens in js/pitch-worker.js.
class PitchTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Float32Array(1024);
    this.n = 0;
    this.out = null;
    this.port.onmessage = e => { if (e.data && e.data.port) this.out = e.data.port; };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || !this.out) return true;
    let i = 0;
    while (i < ch.length) {
      const k = Math.min(ch.length - i, this.chunk.length - this.n);
      this.chunk.set(ch.subarray(i, i + k), this.n);
      this.n += k;
      i += k;
      if (this.n === this.chunk.length) {
        this.out.postMessage(this.chunk, [this.chunk.buffer]);
        this.chunk = new Float32Array(1024);
        this.n = 0;
      }
    }
    return true; // output stays silent
  }
}

registerProcessor('pitch-tap', PitchTap);
