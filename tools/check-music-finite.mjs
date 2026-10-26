#!/usr/bin/env node
/**
 * Strict WebAudio AudioParam finiteness test across every genre, seed and length.
 * Catches any array / NaN / Infinity assigned to an AudioParam (such as the
 * riser filter bug on Chrome Android WebView).
 */
globalThis.window = globalThis;

class StrictParam {
  constructor(name, init = 0) {
    this.name = name;
    this._v = init;
  }
  get value() { return this._v; }
  set value(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError(`Non-finite AudioParam.value on ${this.name}: ${String(v)}`);
    }
    this._v = v;
  }
  setValueAtTime(v, t) {
    if (typeof v !== 'number' || !Number.isFinite(v) || typeof t !== 'number' || !Number.isFinite(t)) {
      throw new TypeError(`Non-finite setValueAtTime(${v}, ${t}) on ${this.name}`);
    }
    return this;
  }
  linearRampToValueAtTime(v, t) {
    if (typeof v !== 'number' || !Number.isFinite(v) || typeof t !== 'number' || !Number.isFinite(t)) {
      throw new TypeError(`Non-finite linearRampToValueAtTime(${v}, ${t}) on ${this.name}`);
    }
    return this;
  }
  exponentialRampToValueAtTime(v, t) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || typeof t !== 'number' || !Number.isFinite(t)) {
      throw new TypeError(`Invalid exponentialRampToValueAtTime(${v}, ${t}) on ${this.name}`);
    }
    return this;
  }
  cancelScheduledValues(t) {
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      throw new TypeError(`Non-finite cancelScheduledValues(${t}) on ${this.name}`);
    }
    return this;
  }
}

class StrictNode {
  constructor(kind) { this.kind = kind; }
  connect(dest) { return dest; }
  disconnect() {}
  start(t = 0, off = 0) {
    if (!Number.isFinite(t) || !Number.isFinite(off)) throw new TypeError(`Non-finite start(${t}, ${off})`);
  }
  stop(t = 0) {
    if (!Number.isFinite(t)) throw new TypeError(`Non-finite stop(${t})`);
  }
}

const mkNode = (kind, params) => {
  const n = new StrictNode(kind);
  for (const [k, v] of Object.entries(params)) n[k] = new StrictParam(`${kind}.${k}`, v);
  return n;
};

class StrictOfflineAudioContext {
  constructor(ch, length, sampleRate) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.destination = new StrictNode('destination');
  }
  createOscillator() { const n = mkNode('osc', { frequency: 440, detune: 0 }); n.type = 'sine'; return n; }
  createBufferSource() { const n = mkNode('bufsrc', { playbackRate: 1 }); n.buffer = null; return n; }
  createGain() { return mkNode('gain', { gain: 1 }); }
  createBiquadFilter() { const n = mkNode('biquad', { frequency: 1000, Q: 1 }); n.type = 'lowpass'; return n; }
  createStereoPanner() { return mkNode('panner', { pan: 0 }); }
  createDynamicsCompressor() { return mkNode('comp', { threshold: 0, knee: 0, ratio: 1, attack: 0, release: 0 }); }
  createWaveShaper() { const n = new StrictNode('shaper'); n.curve = null; return n; }
  createConvolver() { const n = new StrictNode('convolver'); n.buffer = null; return n; }
  createDelay() { return mkNode('delay', { delayTime: 0 }); }
  createBuffer(ch, len, sr) {
    if (!(len > 0) || !Number.isFinite(len)) throw new TypeError(`Invalid buffer length: ${len}`);
    const chans = Array.from({ length: ch }, () => new Float32Array(len));
    return {
      numberOfChannels: ch,
      length: len,
      sampleRate: sr,
      duration: len / sr,
      getChannelData: (i) => chans[i],
      copyToChannel() {},
    };
  }
  async startRendering() {
    const chans = [new Float32Array(this.length), new Float32Array(this.length)];
    return {
      numberOfChannels: 2,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: (i) => chans[i],
    };
  }
}

globalThis.OfflineAudioContext = StrictOfflineAudioContext;

const { GENRES, generateTrack } = await import('../src/core/musicgen.js');

let total = 0;
let failed = 0;
for (const g of GENRES) {
  for (const seed of [1, 7, 42]) {
    for (const seconds of [0, 12, 20, 60, 96]) {
      total++;
      try {
        await generateTrack({ genreId: g.id, seed, seconds });
      } catch (e) {
        failed++;
        console.error(`  ✗ ${g.id} seed=${seed} seconds=${seconds}: ${e.message}`);
      }
    }
  }
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${total - failed}/${total} music cases produced only finite AudioParam values`);
process.exit(failed ? 1 : 0);
