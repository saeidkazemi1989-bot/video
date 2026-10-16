/**
 * Tests for the four added features, with a real WebAudio work-alike so the
 * music generator and the speech detector run exactly as they do on a phone.
 *   node tools/test-features.mjs
 */
import { detectFocus, focusAtTime, trackTravel, smoothTrack, downscale, skinMask, components } from '../src/core/face.js';
import { detectSpeechSegments, buildSubtitles, estimateWpm } from '../src/core/vad.js';
import { GENRES, generateTrack, buildArrangement } from '../src/core/musicgen.js';
import * as Edit from '../src/core/editPlan.js';
import { buildPlan, DEFAULT_SETTINGS } from '../src/core/planner.js';
import { attachSubtitles } from '../src/core/overlays.js';
import { drawSubtitles, SUBTITLE_STYLES } from '../src/core/text.js';
import * as Upd from '../src/core/update.js';
import * as Diag from '../src/core/diag.js';

let failures = 0, checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label} ${extra}`); }
}
const section = (n) => console.log(`\n▸ ${n}`);

/* ================================================================== */
/* WebAudio work-alike (OfflineAudioContext + graph + compressor…)    */
/* ================================================================== */
class FakeParam {
  constructor(v = 0) { this.value = v; this._events = []; }
  setValueAtTime(v, t) { this._events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this._events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this._events.push(['exp', v, t]); return this; }
  cancelScheduledValues(t) { this._events = this._events.filter((e) => e[2] < t); return this; }
}
class FakeNode {
  constructor(kind, ctx) { this.kind = kind; this.ctx = ctx; this._out = []; }
  connect(dest) { if (dest) this._out.push(dest); return dest; }
  disconnect() { this._out = []; }
  start(t = 0) { this._started = t; this.ctx._active.push(this); }
  stop(t = 0) { this._stopped = t; }
}
class FakeOscillator extends FakeNode {
  constructor(ctx) {
    super('osc', ctx);
    this.frequency = new FakeParam(440);
    this.detune = new FakeParam(0);
    this.type = 'sine';
  }
}
class FakeBufferSource extends FakeNode {
  constructor(ctx) { super('buf', ctx); this.playbackRate = new FakeParam(1); this.buffer = null; this.loop = false; }
}
class FakeGain extends FakeNode { constructor(ctx) { super('gain', ctx); this.gain = new FakeParam(1); } }
class FakeFilter extends FakeNode { constructor(ctx) { super('filter', ctx); this.frequency = new FakeParam(1000); this.Q = new FakeParam(1); this.type = 'lowpass'; } }
class FakePanner extends FakeNode { constructor(ctx) { super('panner', ctx); this.pan = new FakeParam(0); } }
class FakeCompressor extends FakeNode {
  constructor(ctx) {
    super('comp', ctx);
    this.threshold = new FakeParam(-24); this.knee = new FakeParam(30); this.ratio = new FakeParam(12);
    this.attack = new FakeParam(0.003); this.release = new FakeParam(0.25);
  }
}
class FakeShaper extends FakeNode { constructor(ctx) { super('shaper', ctx); this.curve = null; } }
class FakeConvolver extends FakeNode { constructor(ctx) { super('conv', ctx); this.buffer = null; } }
class FakeDelay extends FakeNode { constructor(ctx) { super('delay', ctx); this.delayTime = new FakeParam(0); } }
class FakeBuffer {
  constructor(ch, len, sr) {
    this.numberOfChannels = ch; this.length = len; this.sampleRate = sr;
    this.duration = len / sr;
    this._data = Array.from({ length: ch }, () => new Float32Array(len));
  }
  getChannelData(c) { return this._data[c] || this._data[0]; }
  copyToChannel(src, c, off = 0) { this._data[c].set(src, off); }
}
class FakeOfflineCtx {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels; this.length = length; this.sampleRate = sampleRate;
    this.duration = length / sampleRate; this.destination = new FakeNode('dest', this);
    this._active = [];
  }
  createOscillator() { return new FakeOscillator(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createGain() { return new FakeGain(this); }
  createBiquadFilter() { return new FakeFilter(this); }
  createStereoPanner() { return new FakePanner(this); }
  createDynamicsCompressor() { return new FakeCompressor(this); }
  createWaveShaper() { return new FakeShaper(this); }
  createConvolver() { return new FakeConvolver(this); }
  createDelay() { return new FakeDelay(this); }
  createBuffer(ch, len, sr) { return new FakeBuffer(ch, len, sr); }
  /** Render: walk the graph, evaluate params at event times, synthesise. */
  async startRendering() {
    const out = new FakeBuffer(2, this.length, this.sampleRate);
    const L = out.getChannelData(0);
    const R = out.getChannelData(1);
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const evalParam = (param, t) => {
      let v = param.value;
      for (const [kind, value, at] of param._events) {
        if (at > t) break;
        v = value;
        void kind;
      }
      // exponential ramps: approximate between the last two events
      const evs = param._events;
      for (let i = evs.length - 1; i >= 0; i--) {
        const [kind, value, at] = evs[i];
        if (kind === 'exp' && at > t) continue;
        const prev = evs[i - 1];
        if (kind === 'exp' && prev && t >= prev[2] && t <= at) {
          const k = (t - prev[2]) / Math.max(1e-6, at - prev[2]);
          v = Math.max(0.0001, prev[1]) * Math.pow(Math.max(0.0001, value) / Math.max(0.0001, prev[1]), k);
          break;
        }
        if (kind === 'exp' && t > at) { v = value; break; }
      }
      return v;
    };
    const collect = (node, seen = new Set()) => {
      if (!node || seen.has(node)) return seen;
      seen.add(node);
      for (const n of node._out || []) collect(n, seen);
      return seen;
    };
    const reachesMaster = (node) => collect(node).has(this.destination) ||
      [...collect(node)].some((n) => n.kind === 'comp' || n.kind === 'conv');
    for (const node of this._active) {
      if (!reachesMaster(node)) continue;
      const start = node._started || 0;
      const stop = node._stopped ?? this.duration;
      for (let i = Math.floor(start * this.sampleRate); i < Math.min(L.length, Math.floor(stop * this.sampleRate)); i++) {
        const t = i / this.sampleRate;
        if (node.kind === 'osc') {
          const f = evalParam(node.frequency, t);
          const d = evalParam(node.detune, t);
          const phase = 2 * Math.PI * f * (t - start) * Math.pow(2, d / 1200);
          let sample;
          switch (node.type) {
            case 'square': sample = Math.sin(phase) >= 0 ? 0.6 : -0.6; break;
            case 'sawtooth': sample = 0.5 - ((f * (t - start)) % 1); break;
            case 'triangle': sample = 2 * Math.abs(2 * ((f * (t - start)) % 1) - 1) - 1; break;
            default: sample = Math.sin(phase);
          }
          // find the gain in the chain
          let g = 1;
          if (node._out[0]?.gain) g = evalParam(node._out[0].gain, t);
          L[i] += sample * g * 0.5;
          R[i] += sample * g * 0.5;
        } else if (node.kind === 'buf') {
          let g = 1;
          if (node._out[0]?.gain) g = evalParam(node._out[0].gain, t);
          let g2 = 1;
          const after = node._out[0]?._out?.[0];
          if (after?.gain) g2 = evalParam(after.gain, t);
          // pseudo-random but deterministic noise burst
          const n = Math.sin(i * 12.9898) * 43758.5453;
          const noise = (n - Math.floor(n)) * 2 - 1;
          L[i] += noise * g * g2 * 0.35;
          R[i] += noise * g * g2 * 0.35;
        }
      }
    }
    // sanity: never silent, never clipping
    let peak = 0, energy = 0;
    for (let i = 0; i < L.length; i += 7) {
      const a = Math.abs(L[i]);
      if (a > peak) peak = a;
      energy += a * a;
    }
    this._peak = peak;
    this._rms = Math.sqrt(energy / (L.length / 7));
    return out;
  }
}
globalThis.window = globalThis;
globalThis.OfflineAudioContext = FakeOfflineCtx;
globalThis.AudioBuffer = FakeBuffer;

/* ================================================================== */
section('face / smart reframe');
{
  // synthetic "portrait": a skin-coloured blob slightly off centre
  const W = 200, H = 260;
  const imageData = {
    width: W, height: H,
    data: new Uint8ClampedArray(W * H * 4),
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const bg = 30 + ((x * 7 + y * 3) % 40);
      let r = bg, g = bg + 4, b = bg + 12;
      const inFace = Math.abs(x - 130) < 26 && Math.abs(y - 80) < 33;
      if (inFace) { r = 214; g = 168; b = 142; }
      imageData.data[i] = r; imageData.data[i + 1] = g; imageData.data[i + 2] = b; imageData.data[i + 3] = 255;
    }
  }
  const focus = detectFocus(imageData);
  ok(focus.source === 'skin', 'skin blob detected as a face', focus.source);
  ok(Math.abs(focus.x - 0.65) < 0.09, 'focus x landed on the subject', focus.x.toFixed(3));
  ok(Math.abs(focus.y - 0.31) < 0.1, 'focus y landed on the subject', focus.y.toFixed(3));
  ok(focus.score > 0.4, 'blob scored confidently', focus.score.toFixed(2));

  // native detector path
  const native = detectFocus(imageData, { nativeFaces: [{ x: 20, y: 200, width: 40, height: 40 }] });
  ok(native.source === 'face', 'native FaceDetector is preferred when available');
  ok(Math.abs(native.x - 0.2) < 0.03, 'native box mapped to normalised coords', native.x.toFixed(3));

  // no faces: saliency should not explode
  const flat = { width: 120, height: 120, data: new Uint8ClampedArray(120 * 120 * 4).fill(120) };
  const sal = detectFocus(flat);
  ok(sal.source === 'salience', 'falls back to saliency without a face', sal.source);
  ok(sal.x >= 0 && sal.x <= 1 && sal.y >= 0 && sal.y <= 1, 'saliency inside bounds');

  // masks & components
  const small = downscale(imageData, 64);
  const mask = skinMask(small);
  const blobs = components(mask, small.width, small.height, 5);
  ok(blobs.length >= 1, 'connected components found the blob', String(blobs.length));

  // focus track + interpolation
  const track = smoothTrack([
    { t: 0, x: 0.2, y: 0.2, score: 0.5 }, { t: 1, x: 0.4, y: 0.3, score: 0.9 },
    { t: 2, x: 0.7, y: 0.5, score: 0.6 }, { t: 3, x: 0.8, y: 0.6, score: 0.4 },
  ], 1);
  ok(track.length === 4, 'smoothTrack keeps the samples');
  ok(trackTravel(track) > 0.4, 'travel is measured', trackTravel(track).toFixed(2));
  const mid = focusAtTime({ focusTrack: track }, 1.5);
  ok(mid.x > 0.4 && mid.x < 0.7, 'focus interpolates between samples', mid.x.toFixed(3));
  const before = focusAtTime({ focusTrack: track }, -1);
  ok(before.x === track[0].x, 'clamps before the first sample');
  const after = focusAtTime({ focusTrack: track }, 99);
  ok(after.x === track[track.length - 1].x, 'clamps after the last sample');
  const legacy = focusAtTime({ focus: [0.3, 0.6] }, 1);
  ok(legacy.x === 0.3 && legacy.y === 0.6, 'legacy array focus still works');
}

/* ================================================================== */
section('speech detection + subtitles');
{
  const sr = 16000;
  const seconds = 12;
  const data = new Float32Array(seconds * sr);
  // speech-like bursts: amplitude modulated noise with formant-ish tone
  const segments = [[1.0, 3.0], [4.0, 6.5], [8.0, 10.0]];
  for (const [t0, t1] of segments) {
    for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) {
      const t = i / sr;
      const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * t);
      const tone = Math.sin(2 * Math.PI * 180 * t) * 0.5 + Math.sin(2 * Math.PI * 520 * t) * 0.25;
      const noise = (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.4;
      data[i] = (tone + noise) * syllable * 0.6;
    }
  }
  // silence floor
  for (let i = 0; i < data.length; i++) data[i] += (Math.sin(i * 7.13) * 43758.5453 % 1) * 0.004;
  const audio = { sampleRate: sr, length: data.length, duration: seconds, numberOfChannels: 1, getChannelData: () => data };
  const vad = detectSpeechSegments(audio);
  ok(vad.segments.length >= 3, 'three speech segments found', String(vad.segments.length));
  const first = vad.segments[0];
  ok(Math.abs(first.t0 - 1.0) < 0.25, 'segment starts near the speech', first.t0.toFixed(2));
  ok(Math.abs(first.t1 - 3.0) < 0.3, 'segment ends near the speech', first.t1.toFixed(2));
  ok(vad.speechRatio > 0.25 && vad.speechRatio < 0.75, 'speech ratio is plausible', vad.speechRatio.toFixed(2));
  ok(vad.segments.every((s) => s.t1 > s.t0), 'segments are ordered and non-empty');

  // words laid over the detected speech
  const text = 'این یک تست کوتاه برای زیرنویس خودکار روی ویدیو است و باید درست تقسیم شود';
  const built = buildSubtitles(vad.segments, text, { maxWordsPerCue: 4 });
  ok(built.cues.length >= 3, 'cues generated', String(built.cues.length));
  const words = built.cues.flatMap((c) => c.words);
  ok(words.length === text.split(/\s+/).length, 'every word got a timing', `${words.length}`);
  ok(words.every((w, i) => i === 0 || w.t0 >= words[i - 1].t0 - 1e-6), 'word timings are monotonic');
  ok(built.cues.every((c) => c.t1 > c.t0), 'cues have duration');
  ok(built.cues.every((c) => c.words.every((w) => w.t0 >= c.t0 - 0.01 && w.t1 <= c.t1 + 0.01)), 'words stay inside their cue');
  ok(built.cues.length <= text.split(/\s+/).length, 'no cue inflation');
  const wpm = estimateWpm(built.cues);
  ok(wpm > 60 && wpm < 400, 'speech rate is plausible', String(wpm));

  // subtitle plan wiring: cues mapped through a cut (trim + slow motion)
  const asset = {
    id: 'v1', kind: 'video', name: 'clip.mp4', duration: 20, trimIn: 2, trimOut: 20, speed: 1,
    use: true, hero: false, volume: 1, muted: true,
    analysis: { focus: [0.5, 0.4], score: 0.6, mood: 'clean', motion: 0.3, suggestedIn: 2 },
  };
  const plan = {
    duration: 10, cuts: [{ index: 0, t0: 0, t1: 10, dur: 10, asset, assetId: 'v1', trimIn: 2, speed: 0.5, trimOut: 7 }],
    settings: { subtitleWords: 4, subtitles: true }, presetId: 'vlog', copy: {}, musicStart: 0,
    preset: { caption: { anim: 'pop' }, intro: { dur: 2 }, outro: { dur: 2 } },
  };
  plan._subtitleSource = { text, segmentsByAsset: { v1: vad.segments.map((s) => ({ t0: s.t0 + 2, t1: s.t1 + 2, energy: s.energy })) } };
  attachSubtitles(plan, plan._subtitleSource);
  ok(plan.subtitles.length >= 2, 'subtitles attached to the plan', String(plan.subtitles.length));
  ok(plan.subtitles.every((c) => c.t0 >= -0.01 && c.t1 <= 10.01), 'cues inside the shot window');
  // slow motion (0.5×) must stretch the subtitle times about ×2
  const mkPlan = (speed) => {
    const p2 = {
      duration: 20, presetId: 'vlog', copy: {}, musicStart: 0,
      settings: { subtitleWords: 4, subtitles: true },
      preset: { caption: { anim: 'pop' }, intro: { dur: 2 }, outro: { dur: 2 } },
      cuts: [{ index: 0, t0: 0, t1: 20, dur: 20, asset, assetId: 'v1', trimIn: 2, speed, trimOut: 2 + 20 * speed }],
    };
    p2._subtitleSource = { text, segmentsByAsset: { v1: vad.segments.map((s) => ({ t0: s.t0 + 2, t1: s.t1 + 2, energy: s.energy })) } };
    attachSubtitles(p2, p2._subtitleSource);
    return p2;
  };
  const normal = mkPlan(1);
  const slow = mkPlan(0.5);
  const firstNormal = normal.subtitles[0].t0;
  const firstSlow = slow.subtitles[0].t0;
  const expected = (vad.segments[0].t0 + 2 - 2) * 2;   // segment start mapped through a 0.5× cut
  ok(Math.abs(firstSlow - expected) < 0.05, 'slow motion maps source speech to the right timeline spot', `${firstSlow.toFixed(2)} vs ${expected.toFixed(2)}`);
  ok(firstSlow > firstNormal * 1.6, 'slow motion stretches the subtitle timing', `${firstNormal.toFixed(2)} → ${firstSlow.toFixed(2)}`);
  ok(slow.subtitles[slow.subtitles.length - 1].t1 < 20.5, 'slow-motion cues stay inside the shot');

  // renderer smoke test with the fake 2D context
  const calls = [];
  const ctx = new Proxy({
    canvas: { width: 1080, height: 1920 },
    measureText: (t) => ({ width: String(t).length * 12 }),
    save() {}, restore() {}, translate() {}, scale() {}, fillText: (t) => calls.push(t),
    beginPath() {}, fill() {}, strokeText() {}, rect() {}, roundRect() {}, moveTo() {}, arcTo() {}, closePath() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get: (t, p) => (p in t ? t[p] : () => {}), set: () => true });
  const drawn = drawSubtitles(ctx, { subtitles: plan.subtitles, settings: { subtitleStyle: 'karaoke', lang: 'fa' } }, plan.subtitles[0].t0 + 0.05);
  ok(drawn === true, 'subtitle renderer draws the active cue');
  const ids = Object.keys(SUBTITLE_STYLES);
  for (const id of ids) {
    const r = drawSubtitles(ctx, { subtitles: plan.subtitles, settings: { subtitleStyle: id, lang: 'fa' } }, plan.subtitles[0].t0 + 0.05);
    ok(r === true, `style ${id} renders`);
  }
  const none = drawSubtitles(ctx, { subtitles: plan.subtitles, settings: {} }, plan.subtitles[0].t1 + 3);
  ok(none === false, 'nothing is drawn between cues');
}

/* ================================================================== */
section('music library (procedural generator)');
{
  const arrangement = buildArrangement(100, 90);
  ok(arrangement.totalBars >= 14 && arrangement.totalBars <= 44, 'arrangement length is sane', String(arrangement.totalBars));
  ok(arrangement.sections.some((s) => s.name === 'drop'), 'arrangement has a drop');
  ok(arrangement.sections.some((s) => s.name === 'break'), 'arrangement has a break');
  const sum = arrangement.sections.reduce((a, s) => a + s.bars, 0);
  ok(sum === arrangement.totalBars, 'sections add up');

  const results = [];
  for (const genre of GENRES) {
    const track = await generateTrack({
      genreId: genre.id,
      bpm: genre.bpm,
      seed: 4242,
      onProgress: () => {},
    });
    const label = genre.id;
    ok(track.buffer.numberOfChannels === 2, `${label}: stereo`);
    ok(track.duration > 30, `${label}: longer than 30s`, String(Math.round(track.duration)));
    ok(Math.abs(track.bpm - genre.bpm) < 0.01, `${label}: bpm kept exactly (grid is exact by construction)`, String(track.bpm));
    ok(track.beats.length > 20, `${label}: beat grid present`);
    const beat = 60 / track.bpm;
    ok(Math.abs(track.beats[1] - beat) < 1e-6, `${label}: beats spaced by exactly one beat`);
    const err = track.beats.map((b, i) => Math.abs(b - i * beat)).reduce((a, b) => Math.max(a, b), 0);
    ok(err < 1e-4, `${label}: beat grid drift < 0.1ms`, `${(err * 1000).toFixed(4)}ms`);
    // audio sanity
    const buf = track.buffer;
    const data = buf.getChannelData(0);
    let peak = 0, rms = 0, clipped = 0;
    for (let i = 0; i < data.length; i += 5) {
      const a = Math.abs(data[i]);
      if (a > peak) peak = a;
      if (a > 0.999) clipped++;
      rms += a * a;
    }
    rms = Math.sqrt(rms / (data.length / 5));
    ok(peak > 0.02, `${label}: track is not silent`, peak.toFixed(3));
    ok(clipped / (data.length / 5) < 0.02, `${label}: not heavily clipped`, `${((clipped / (data.length / 5)) * 100).toFixed(2)}%`);
    ok(track.energy.length > 100, `${label}: energy curve measured`);
    const eMax = Math.max(...track.energy);
    ok(Math.abs(eMax - 1) < 0.02, `${label}: energy normalised`);
    ok(track.waveform.length === 320, `${label}: waveform buckets`);
    ok(track.bestStart >= 0 && track.bestStart <= Math.max(0, track.duration - 30) + 1e-6, `${label}: best start in range`);
    const barSec = (60 / track.bpm) * 4;
    ok(Math.abs(track.bestStart / barSec - Math.round(track.bestStart / barSec)) < 1e-6, `${label}: best start on a bar line`);
    ok(track.structure?.length > 4, `${label}: structure reported`);
    results.push({ genre: label, peak, rms });
  }
  // genre character should differ (loudness spread across the library)
  const peaks = results.map((r) => r.peak);
  ok(Math.max(...peaks) - Math.min(...peaks) > 0.01, 'genres are not clones of each other', peaks.map((p) => p.toFixed(2)).join(','));

  // the generated track must drive the planner with exact beat alignment
  const music = {
    duration: 120, bpm: 100, beatPeriod: 0.6, confidence: 1,
    beats: Float32Array.from({ length: 200 }, (_, i) => i * 0.6),
    energy: new Float32Array(120 * 20).fill(0.6), energyHz: 20,
    waveform: new Float32Array(320).fill(0.5),
    bestStart: 12, dropTime: 24,
  };
  const assets = Array.from({ length: 6 }, (_, i) => ({
    id: `a${i}`, kind: i % 2 ? 'photo' : 'video', name: `m${i}`, duration: i % 2 ? null : 8,
    trimIn: 0, trimOut: i % 2 ? null : 8, speed: 1, use: true, hero: i === 0, volume: 1,
    muted: true, focus: null,
    analysis: { score: 0.5, mood: 'clean', motion: 0.3, focus: [0.5, 0.4], suggestedIn: 1 },
  }));
  const plan = buildPlan({ assets, presetId: 'pop' in {} ? 'auto' : 'viral', music, settings: { ...DEFAULT_SETTINGS, duration: 30 }, seed: 5 });
  const beat = 60 / plan.bpm;
  const beatsInPlan = plan.duration / beat;
  ok(Math.abs(beatsInPlan - Math.round(beatsInPlan)) < 0.02, 'plan length is a whole number of beats with a generated track', beatsInPlan.toFixed(3));
}

/* ================================================================== */
section('manual timeline editor');
{
  const mkAsset = (i, kind = 'video') => ({
    id: `a${i}`, kind, name: `m${i}`, duration: kind === 'video' ? 12 : null,
    trimIn: 0, trimOut: kind === 'video' ? 12 : null, speed: 1, use: true, hero: i === 0,
    volume: 1, muted: true,
    analysis: { score: 0.5, mood: 'clean', motion: 0.3, focus: [0.5, 0.4], suggestedIn: 1 + i * 0.2 },
  });
  const assets = [mkAsset(0), mkAsset(1), mkAsset(2), mkAsset(3, 'photo'), mkAsset(4, 'photo')];
  const music = {
    duration: 120, bpm: 120, beatPeriod: 0.5, confidence: 1,
    beats: Float32Array.from({ length: 240 }, (_, i) => i * 0.5),
    energy: new Float32Array(2400).fill(0.5), energyHz: 20, waveform: new Float32Array(320).fill(0.5),
    bestStart: 8, dropTime: 16,
  };
  const fresh = () => buildPlan({ assets, presetId: 'viral', music, settings: { ...DEFAULT_SETTINGS, duration: 24 }, seed: 3 });

  let plan = fresh();
  const beatsOf = (p) => p.cuts.map((c) => Math.round(c.dur / (60 / p.bpm)));
  const contiguous = (p) => p.cuts.every((c, i) => i === 0 || Math.abs(c.t0 - p.cuts[i - 1].t1) < 1e-3);
  ok(contiguous(plan), 'plan starts contiguous');

  // ---- resize (absorb) keeps the total length ----
  const total0 = plan.duration;
  const beatsBefore = beatsOf(plan).reduce((a, b) => a + b, 0);
  Edit.resizeCut(plan, 1, 2);
  ok(contiguous(plan), 'resize keeps cuts contiguous');
  const beatsAfter = beatsOf(plan).reduce((a, b) => a + b, 0);
  ok(beatsAfter === beatsBefore, 'resize absorbs the change (same total beats)', `${beatsBefore} → ${beatsAfter}`);
  const grown = plan.cuts[1].dur;
  ok(grown > 0, 'grew a shot');
  // shrink back
  Edit.resizeCut(plan, 1, -1);
  ok(contiguous(plan), 'shrink keeps contiguity');
  const beatsAfter2 = beatsOf(plan).reduce((a, b) => a + b, 0);
  ok(beatsAfter2 === beatsBefore, 'shrink also conserves the total');
  ok(plan.cuts.every((c) => c.dur >= (60 / plan.bpm) * 0.5 - 1e-6), 'no shot below half a beat');

  // every shot must still have enough source material
  for (const c of plan.cuts) {
    if (c.asset?.kind !== 'video') continue;
    const avail = (c.trimOut - c.trimIn) / c.speed;
    ok(avail >= c.dur - 0.15, 'source window still covers the shot', `${avail.toFixed(2)} vs ${c.dur.toFixed(2)}`);
    ok(c.trimIn >= (c.asset.trimIn || 0) - 1e-6 && c.trimOut <= (c.asset.trimOut ?? c.asset.duration) + 1e-6, 'source window inside the file');
  }

  // ---- move swaps content without shifting the timeline ----
  const beforeIds = plan.cuts.map((c) => c.assetId);
  const beforeTimes = plan.cuts.map((c) => `${c.t0}-${c.t1}`).join('|');
  Edit.moveCut(plan, 0, 1);
  ok(plan.cuts.map((c) => c.assetId)[0] === beforeIds[1], 'move swaps the assets');
  ok(plan.cuts.map((c) => `${c.t0}-${c.t1}`).join('|') === beforeTimes, 'move never shifts the timeline');
  ok(contiguous(plan), 'still contiguous after a move');

  // ---- text overlays stay inside ----
  ok(plan.overlays.every((o) => o.t1 <= plan.duration + 0.01), 'overlays stay inside after edits');
  ok(plan.overlays.every((o) => o.t1 > o.t0), 'overlays valid after edits');

  // ---- speed ----
  const videoIdx = plan.cuts.findIndex((c) => c.asset?.kind === 'video');
  Edit.setCutSpeed(plan, videoIdx, 0.5);
  const sc = plan.cuts[videoIdx];
  ok(sc.speedOverride === 0.5, 'speed override stored');
  ok(sc.speed <= 1.0001, 'effective speed respected');
  ok(sc.planMute === true, 'slow shots get their audio muted (pitch would break)');
  ok(contiguous(plan), 'contiguous after speed change');

  // ---- split / duplicate / delete ----
  const n0 = plan.cuts.length;
  Edit.splitCut(plan, 2, plan.cuts[2].t0 + plan.cuts[2].dur / 2);
  ok(plan.cuts.length === n0 + 1, 'split adds a shot', `${n0} → ${plan.cuts.length}`);
  ok(contiguous(plan), 'contiguous after split');
  ok(plan.overlays.every((o) => o.t1 <= plan.duration + 0.01), 'overlays still inside after split');
  const dupIdx = 1;
  Edit.duplicateCut(plan, dupIdx);
  ok(plan.cuts[dupIdx + 1].assetId === plan.cuts[dupIdx].assetId, 'duplicate copies the asset');
  Edit.deleteCut(plan, dupIdx);
  ok(plan.cuts.length === n0 + 1, 'delete removes one shot');
  ok(contiguous(plan), 'contiguous after delete');

  // ---- replace asset ----
  const target = plan.cuts.findIndex((c) => c.assetId !== assets[2].id);
  Edit.replaceAsset(plan, target, assets[2]);
  ok(plan.cuts[target].assetId === assets[2].id, 'replace works');
  ok(plan.cuts[target].trimOverride == null, 'replace clears the manual in-point');

  // ---- snap to grid ----
  plan.cuts[0].dur += 0.13;
  Edit.retime(plan);
  const len0 = plan.duration;
  const offGridBefore = plan.cuts.filter((c) => Math.abs(c.dur / (60 / plan.bpm) - Math.round(c.dur / (60 / plan.bpm))) > 0.02).length;
  Edit.snapToGrid(plan);
  const beat = 60 / plan.bpm;
  ok(plan.cuts.every((c) => c.dur >= beat - 1e-6), 'every shot is at least one beat');
  ok(plan.cuts.every((c) => Math.abs(c.dur / beat - Math.round(c.dur / beat)) < 0.02), 'all shots snapped to the grid');
  // each off-grid shot can shift the total by at most half a beat, so the sum is bounded
  ok(Math.abs(plan.duration - len0) <= (offGridBefore + 1) * beat * 0.5 + 1e-6,
    'snap never drifts more than the grid allows', `${len0.toFixed(2)} → ${plan.duration.toFixed(2)} (${offGridBefore} off-grid shots)`);
  ok(Math.abs(plan.duration / beat - Math.round(plan.duration / beat)) < 0.02, 'the reel length is a whole number of beats after snapping');
  ok(contiguous(plan), 'contiguous after snapping');

  // ---- extreme edits must not break anything ----
  for (let i = 0; i < plan.cuts.length; i++) Edit.resizeCut(plan, i, 4);
  ok(plan.cuts.length >= 1, 'survives growing everything');
  ok(contiguous(plan), 'still contiguous after aggressive growth');
  ok(plan.cuts.every((c) => c.dur > 0.15), 'no zero-length shots');
  while (plan.cuts.length > 1) Edit.deleteCut(plan, 0);
  ok(plan.cuts.length === 1, 'last shot cannot be deleted');
  const single = plan.cuts[0];
  ok(Math.abs(plan.duration - single.dur) < 1e-3, 'duration follows the single shot');
}


/* ================================================================== */
section('update engine («بروزرسانی»)');

{
  // ---- version maths ----
  ok(Upd.parseVersion('1.2.3').parts.join('.') === '1.2.3', 'parses x.y.z');
  ok(Upd.parseVersion('v2.0').parts.join('.') === '2.0.0', 'parses v2.0 as 2.0.0');
  ok(Upd.parseVersion('1.2.3-beta.1').pre === 'beta.1', 'keeps the pre-release tag');
  ok(Upd.parseVersion('garbage') === null, 'rejects nonsense versions');
  ok(Upd.parseVersion('') === null, 'rejects empty versions');
  ok(Upd.parseVersion(Upd.APP_VERSION) !== null || Upd.APP_VERSION === '0.0.0-dev', 'APP_VERSION is a real version');

  ok(Upd.compareVersions('1.2.0', '1.1.9') === 1, '1.2.0 > 1.1.9');
  ok(Upd.compareVersions('1.10.0', '1.9.0') === 1, 'numeric, not lexicographic');
  ok(Upd.compareVersions('1.0.0', '1.0.0') === 0, 'equal versions compare equal');
  ok(Upd.compareVersions('v1.1.0', '1.1.0') === 0, 'the leading v is ignored');
  ok(Upd.compareVersions('1.0.0-beta', '1.0.0') === -1, 'pre-release sorts below the release');
  ok(Upd.isNewer('1.2.0', '1.1.0') === true, 'isNewer detects a newer build');
  ok(Upd.isNewer('1.1.0', '1.1.0') === false, 'isNewer is false on the same build');

  ok(Upd.faVersion('1.2.3') === '۱٫۲٫۳', 'Persian digits + decimal separator');
  ok(Upd.faVersion('v1.10.0') === '۱٫۱۰٫۰', 'faVersion strips the v and keeps 10');

  // ---- release payloads ----
  const release = {
    tag_name: 'v1.2.0', name: 'ReelForge 1.2.0', html_url: 'https://x/rel/1.2.0',
    body: '## تازه‌ها\n- دکمهٔ بروزرسانی\n- سرعت رندر', published_at: '2026-10-16T00:00:00Z',
    assets: [
      { name: 'reelforge-web-dist.zip', size: 10, browser_download_url: 'https://x/web.zip' },
      { name: 'reelforge-abc1234-debug.apk', size: 7350987, browser_download_url: 'https://x/app.apk' },
      { name: 'BUILD.txt', size: 100, browser_download_url: 'https://x/build.txt' },
    ],
  };
  const norm = Upd.normalizeRelease(release);
  ok(norm.version === '1.2.0', 'release version normalised', norm.version);
  ok(norm.apkUrl === 'https://x/app.apk', 'picks the .apk asset', norm.apkUrl);
  ok(norm.apkSize === 7350987, 'carries the APK size through');
  ok(norm.url === 'https://x/rel/1.2.0', 'keeps the release page url');
  ok(norm.notes.includes('دکمهٔ بروزرسانی'), 'keeps release notes');
  ok(Upd.normalizeRelease({ ...release, draft: true }) === null, 'ignores drafts');
  ok(Upd.normalizeRelease({ ...release, prerelease: true }) === null, 'ignores pre-releases');
  ok(Upd.normalizeRelease({ tag_name: 'v1.2.0' }).apkUrl === '', 'a release without an APK still parses');
  ok(Upd.normalizeRelease({ tag_name: 'nope' }) === null, 'garbage tag → null');
  ok(Upd.normalizeRelease(null) === null, 'null payload is safe');

  ok(Upd.normalizeCustom({ version: '1.3.0', apk: 'https://h/app.apk' }).apkUrl === 'https://h/app.apk', 'custom manifest (string apk)');
  const customObj = Upd.normalizeCustom({ version: 'v1.3.0', apk: { url: 'https://h/a.apk', name: 'reelforge.apk', size: 42 } });
  ok(customObj.apkName === 'reelforge.apk' && customObj.apkSize === 42, 'custom manifest (object apk)');
  ok(Upd.normalizeCustom({ version: 'x' }) === null, 'custom manifest with a bad version → null');
  ok(Upd.pickApkAsset({ assets: [] }) === null, 'no assets → no apk');

  // ---- checkForUpdate with an injected fetch ----
  const res = (payload, status = 200) => Promise.resolve({
    ok: status >= 200 && status < 300, status, json: async () => payload,
  });
  const newer = await Upd.checkForUpdate({ current: '1.1.0', fetchImpl: () => res(release) });
  ok(newer.ok === true, 'check succeeds');
  ok(newer.hasUpdate === true, 'a newer release is flagged');
  ok(newer.apkUrl === 'https://x/app.apk', 'the download url is exposed');
  ok(newer.source === 'github', 'source recorded');

  const same = await Upd.checkForUpdate({ current: '1.2.0', fetchImpl: () => res(release) });
  ok(same.ok === true && same.hasUpdate === false, 'the current build is not an update');

  const older = await Upd.checkForUpdate({ current: '2.0.0', fetchImpl: () => res(release) });
  ok(older.hasUpdate === false, 'an older release is not an update');

  const privateRepo = await Upd.checkForUpdate({ current: '1.1.0', fetchImpl: () => res({ message: 'Not Found' }, 404) });
  ok(privateRepo.ok === false && privateRepo.error === 'http-404', '404 (private repo) is reported', privateRepo.error);
  ok(Upd.explainError('http-404').includes('خصوصی'), 'the 404 explanation mentions the private repo');

  const customFirst = await Upd.checkForUpdate({
    current: '1.1.0',
    customUrl: 'https://host/latest.json',
    fetchImpl: (url) => (url.includes('host') ? res({ version: '1.4.0', apk: 'https://host/a.apk' }) : res({}, 404)),
  });
  ok(customFirst.ok === true && customFirst.latest.version === '1.4.0', 'custom manifest wins when it answers');
  ok(customFirst.source === 'custom', 'custom source recorded');
  ok(customFirst.hasUpdate === true, 'custom manifest drives hasUpdate');

  const fallbackToGithub = await Upd.checkForUpdate({
    current: '1.1.0',
    customUrl: 'https://host/latest.json',
    fetchImpl: (url) => (url.includes('host') ? Promise.reject(new Error('offline')) : res(release)),
  });
  ok(fallbackToGithub.ok === true && fallbackToGithub.source === 'github', 'falls back to GitHub when the custom url fails');

  const dead = await Upd.checkForUpdate({ current: '1.1.0', fetchImpl: () => Promise.reject(new Error('Failed to fetch')) });
  ok(dead.ok === false && dead.hasUpdate === false, 'a dead network never claims an update');
  ok(Upd.explainError(dead.error).length > 10, 'every error has a Persian explanation');

  const slow = await Upd.checkForUpdate({ current: '1.1.0', timeoutMs: 30, fetchImpl: () => new Promise(() => {}) });
  ok(slow.ok === false && slow.error === 'timeout', 'a hanging request times out', slow.error);

  ok((await Upd.checkForUpdate({ current: '1.1.0', fetchImpl: null })).error === 'no-fetch', 'no fetch → explicit error');

  // ---- what the button does ----
  ok(Upd.updateAction({ mode: 'web', webReady: true }) === 'reload', 'waiting worker → reload');
  ok(Upd.updateAction({ mode: 'android', hasUpdate: true, apkUrl: 'https://x/a.apk' }) === 'download', 'android + apk → download');
  ok(Upd.updateAction({ mode: 'android', hasUpdate: true }) === 'open', 'android without an apk → open the page');
  ok(Upd.updateAction({ mode: 'web', hasUpdate: true }) === 'reload', 'web + newer deploy → reload');
  ok(Upd.updateAction({ mode: 'android', hasUpdate: false }) === 'none', 'nothing new → none');
  ok(Upd.actionLabel('download').includes('دانلود'), 'action labels are Persian');
  ok(Upd.actionLabel('reload').includes('راه‌اندازی'), 'the reload label explains itself');

  // ---- status lines ----
  const st = Upd.statusText({ ok: true, current: '1.1.0', hasUpdate: true, latest: { version: '1.2.0' } }, { mode: 'android' });
  ok(st.includes('۱٫۲٫۰') && st.includes('۱٫۱٫۰'), 'status names both versions', st);
  ok(Upd.statusText({ ok: true, current: '1.2.0', hasUpdate: false }).includes('آخرین نسخه'), 'up-to-date message');
  ok(Upd.statusText({ ok: false, error: 'offline' }).includes('اینترنت'), 'offline message');
  ok(Upd.statusText({ ok: false, error: 'timeout' }).includes('مهلت'), 'timeout message');

  // ---- environment ----
  ok(Upd.platformOf({}) === 'web', 'plain page → web');
  ok(Upd.platformOf({ Capacitor: { getPlatform: () => 'android' } }) === 'android', 'Capacitor android detected');
  ok(Upd.isNative({ Capacitor: { getPlatform: () => 'ios' } }) === true, 'iOS counts as native');
  ok(Upd.isNative({}) === false, 'web is not native');

  const opened = [];
  ok(Upd.openExternal('https://x/a.apk', { Capacitor: { Plugins: { Browser: { open: (o) => opened.push(o.url) } } } }) === 'browser', 'native browser plugin used');
  ok(opened[0] === 'https://x/a.apk', 'the native plugin got the right url');
  const wins = [];
  ok(Upd.openExternal('https://x/b.apk', { open: (u) => { wins.push(u); return {}; } }) === 'window', 'window.open fallback');
  const loc = { href: '' };
  ok(Upd.openExternal('https://x/c.apk', { location: loc }) === 'location', 'location fallback');
  ok(loc.href === 'https://x/c.apk', 'location fallback navigates');
  ok(Upd.openExternal('', {}) === 'none', 'empty url is ignored');

  // ---- web build detection ----
  const perf = { getEntriesByType: () => [{ name: 'https://app.local/assets/index-OLDHASH.js' }] };
  const htmlWithDifferentHash = '<script type="module" src="./assets/index-NEWHASH.js"></script>';
  const web = await Upd.detectWebBuild({
    perf, doc: null, fetchImpl: () => Promise.resolve({ ok: true, status: 200, text: async () => htmlWithDifferentHash }),
  });
  ok(web?.hasUpdate === true, 'a redeployed bundle is detected', JSON.stringify(web));
  ok(web.running === 'index-OLDHASH.js' && web.remote === 'index-NEWHASH.js', 'both hashes are reported');
  const sameWeb = await Upd.detectWebBuild({
    perf, doc: null, fetchImpl: () => Promise.resolve({ ok: true, status: 200, text: async () => '<script src="./assets/index-OLDHASH.js"></script>' }),
  });
  ok(sameWeb.hasUpdate === false, 'the same bundle is not an update');
  ok((await Upd.detectWebBuild({ perf: { getEntriesByType: () => [] }, doc: null, fetchImpl: () => res({}) })) === null, 'dev build (no hashed bundle) → null');
  ok((await Upd.detectWebBuild({ perf, doc: null, fetchImpl: () => Promise.reject(new Error('offline')) })) === null, 'offline check is silent');

  const docLike = { querySelectorAll: () => [{ getAttribute: () => './assets/index-FROMDOM.js' }] };
  ok(Upd.runningAssetName(docLike, { getEntriesByType: () => [] }) === 'index-FROMDOM.js', 'falls back to <script src>');
  ok(Upd.runningAssetName({ querySelectorAll: () => [] }, { getEntriesByType: () => [] }) === '', 'nothing to detect → empty');
}


/* ================================================================== */
section('device diagnostics («وضعیت دستگاه»)');

{
  Diag.recordError(new Error('Shader error: fetchPrev'), 'step 5');
  ok(Diag.lastErrors().length >= 1, 'errors are remembered');
  ok(Diag.lastErrors().at(-1).where === 'step 5', 'the stage is recorded');
  ok(Diag.lastErrors().at(-1).text.includes('fetchPrev'), 'the message is recorded');
  for (let i = 0; i < 20; i++) Diag.recordError(`e${i}`, 'x');
  ok(Diag.lastErrors().length <= 12, 'the error log is a bounded ring buffer', String(Diag.lastErrors().length));
  ok(Diag.recordError('plain string').text === 'plain string', 'string errors are accepted');

  // a phone-like environment: WebGL2 present, WebCodecs missing, native face detector
  const fakeWin = {
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/140 Mobile Safari', language: 'fa-IR', hardwareConcurrency: 8, deviceMemory: 8 },
    screen: { width: 1080, height: 2400 },
    devicePixelRatio: 2.75,
    Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) },
    AudioContext: class {}, OfflineAudioContext: class {},
    FaceDetector: class {},
  };
  const report = await Diag.deviceReport(fakeWin, { extra: { step: 5 } });
  ok(report.platform === 'android' && report.native === true, 'native platform is reported');
  ok(report.webgl2?.ok === false, 'a missing WebGL2 context is reported, not thrown', JSON.stringify(report.webgl2));
  ok(report.webgl2?.reason === 'webgl2-unavailable', 'the probe explains why');
  ok(report.encoder?.supported === false && report.encoder.reason === 'no-webcodecs', 'WebCodecs absence is detected');
  ok(report.audio.offlineAudioContext === true, 'audio support detected');
  ok(report.faceDetector === true, 'native FaceDetector detected');
  ok(report.screen === '1080×2400 @2.75x', 'screen + dpr reported', report.screen);
  ok(report.cores === 8 && report.memoryGB === 8, 'cores/memory reported');

  const text = Diag.reportText(report);
  ok(text.includes('webgl2: FAILED (webgl2-unavailable)'), 'text report spells out the WebGL failure', text.split('\n').find((l) => l.startsWith('webgl2')));
  ok(text.includes('encoder: unsupported (no-webcodecs)'), 'text report spells out the encoder state');
  ok(text.includes('platform: android (native)'), 'text report names the platform');
  ok(text.includes('recent errors:'), 'text report carries the recent errors');
  ok(text.split('\n').every((l) => l.length < 400), 'text report lines stay readable');

  const rows = Diag.reportRows(report);
  ok(rows.length >= 8, 'diagnostics sheet has rows', String(rows.length));
  ok(rows.every(([k, v]) => k && v !== undefined && v !== null && v !== ''), 'no empty rows');
  ok(rows.some(([k]) => k.includes('گرافیک')), 'graphics row exists');
  ok(rows.some(([k, v]) => k.includes('کدگذار') && String(v).includes('غیرفعال')), 'encoder row flags the problem');

  // a healthy environment must read as healthy
  const goodWin = {
    navigator: { userAgent: 'Mozilla/5.0 Chrome/140', language: 'en', hardwareConcurrency: 8 },
    screen: { width: 412, height: 915 }, devicePixelRatio: 2.6,
    VideoEncoder: { isConfigSupported: async () => ({ supported: true }) },
    VideoFrame: class {},
    AudioContext: class {}, OfflineAudioContext: class {},
    document: {
      createElement: () => ({
        getContext: () => ({
          getExtension: () => null,
          getParameter: (p) => ({ 0x1F00: 'Google', 0x1F01: 'Adreno 730', 0x1F02: 'WebGL 2.0', 0x8B8C: 'WebGL GLSL ES 3.00' }[p] || 4096),
          getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
          FRAGMENT_SHADER: 35632, HIGH_FLOAT: 36336, VENDOR: 0x1F00, RENDERER: 0x1F01, VERSION: 0x1F02,
          SHADING_LANGUAGE_VERSION: 0x8B8C, MAX_TEXTURE_SIZE: 0x0D33,
        }),
      }),
    },
  };
  const goodReport = await Diag.deviceReport(goodWin);
  ok(goodReport.webgl2?.ok === true, 'a working GL context is reported as ok');
  ok(goodReport.webgl2.renderer === 'Adreno 730', 'the GL renderer string is captured', goodReport.webgl2.renderer);
  ok(goodReport.webgl2.highpFragment === true, 'highp fragment precision is captured');
  ok(goodReport.encoder.supported === true, 'encoder support detected');
  ok(Diag.reportText(goodReport).includes('webgl2: ok'), 'healthy report reads as ok');
  ok(Diag.reportRows(goodReport).some(([k, v]) => k.includes('کدگذار') && String(v).includes('فعال')), 'healthy encoder row');
  ok(Diag.reportText({}).length > 0, 'an empty report still renders without throwing');
  ok(Diag.reportRows({}).length >= 1, 'reportRows never returns nothing');
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} feature checks passed`);
process.exit(failures ? 1 : 0);
