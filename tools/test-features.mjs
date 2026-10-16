/**
 * Tests for the four added features, with a real WebAudio work-alike so the
 * music generator and the speech detector run exactly as they do on a phone.
 *   node tools/test-features.mjs
 */
import { readFileSync } from 'node:fs';
import { detectFocus, focusAtTime, trackTravel, smoothTrack, downscale, skinMask, components } from '../src/core/face.js';
import { detectSpeechSegments, buildSubtitles, estimateWpm } from '../src/core/vad.js';
import { GENRES, generateTrack, buildArrangement } from '../src/core/musicgen.js';
import * as Mod from '../src/core/musicgen.js';
import * as Edit from '../src/core/editPlan.js';
import { buildPlan, DEFAULT_SETTINGS } from '../src/core/planner.js';
import { attachSubtitles } from '../src/core/overlays.js';
import { drawSubtitles, SUBTITLE_STYLES } from '../src/core/text.js';
import { buildCopy } from '../src/core/captions.js';
import * as Upd from '../src/core/update.js';
import * as Diag from '../src/core/diag.js';
import { coverRect, containRect, pillowBars, FRAMINGS } from '../src/core/framing.js';
import * as Save from '../src/core/save.js';
import { state, migratePrefs, PREFS_VERSION } from '../src/state.js';
import { buildSoundtrack, musicLoop } from '../src/core/audio.js';
import * as Brief from '../src/core/brief.js';
import { PRESETS as STYLE_PRESETS, DURATIONS as STYLE_DURATIONS } from '../src/data/styles.js';
import { TONES as COPY_TONES } from '../src/data/hooks.js';

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

/* ---- diagnostics: state, context, render/save history ---- */
{
  const mkNav = (regs, controller) => ({ serviceWorker: { getRegistrations: async () => regs, controller } });
  ok(await Diag.probeServiceWorker({}) === 'unsupported', 'no serviceWorker → unsupported');
  ok(await Diag.probeServiceWorker({ navigator: mkNav([], null) }) === 'not-registered', 'no registrations → not-registered');
  ok(await Diag.probeServiceWorker({ navigator: mkNav([{}], null) }) === 'registered', 'registered without a controller');
  ok(await Diag.probeServiceWorker({ navigator: mkNav([{}], {}) }) === 'active', 'a controlling worker is active');
  ok(await Diag.probeServiceWorker({ navigator: { serviceWorker: { getRegistrations: async () => { throw new Error('x'); } } } }) === 'unknown', 'a broken SW API is reported as unknown');
  ok(await Diag.probeServiceWorker({ navigator: { serviceWorker: {} } }) === 'not-registered', 'no getRegistrations → treated as none');

  // encoder mode: hardware first, software fallback
  const hw = await Diag.probeEncoder({ VideoEncoder: { isConfigSupported: async (c) => ({ supported: c.hardwareAcceleration === 'prefer-hardware' }) }, VideoFrame: class {} });
  ok(hw.supported === true && hw.mode === 'hardware', 'hardware encoding is detected', JSON.stringify(hw));
  const swOnly = await Diag.probeEncoder({ VideoEncoder: { isConfigSupported: async (c) => ({ supported: !c.hardwareAcceleration }) }, VideoFrame: class {} });
  ok(swOnly.supported === true && swOnly.mode === 'default', 'software-only encoders are detected', JSON.stringify(swOnly));

  Diag.recordRender({ frames: 900, ms: 95_000, quality: '1080p', renderer: 'WebGL2' });
  Diag.recordRender({ frames: 600, ms: 40_000, quality: '720p', renderer: '2D' });
  ok(Diag.lastRenders().length === 2, 'renders are remembered');
  const r0 = Diag.lastRenders().at(-1);
  ok(r0.seconds === 40 && r0.fps > 14 && r0.fps < 16, 'render fps is derived from wall time', JSON.stringify(r0));
  for (let i = 0; i < 5; i++) Diag.recordRender({ frames: 1, ms: 1000 });
  ok(Diag.lastRenders().length === 3, 'render history is bounded');

  Diag.recordSave({ ok: true, method: 'files', display: 'Documents/ReelForge', path: 'ReelForge/a.mp4', bytes: 1024 });
  Diag.recordSave({ ok: false, error: 'quota' });
  ok(Diag.lastSaves().length === 2 && Diag.lastSaves().at(-1).ok === false, 'saves are remembered, including failures');

  const ctx = { stage: 'مرحله ۶', assets: '۳ عکس · ۱ ویدیو', duration: 30, framing: 'fill', order: 'smart', quality: '1080p', fps: 30, preset: 'viral', music: 'ساخت اپ' };
  const reportWin = {
    navigator: { userAgent: 'UA', serviceWorker: { getRegistrations: async () => [], controller: null } },
    document: { createElement: () => ({ getContext: () => null }) },
  };
  const withCtx = await Diag.deviceReport(reportWin, { context: ctx });
  const text2 = Diag.reportText(withCtx);
  ok(text2.includes('stage: مرحله ۶'), 'the report names the stage', text2);
  ok(text2.includes('framing=fill') && text2.includes('order=smart'), 'the report carries the framing + order the user chose');
  ok(text2.includes('render: 1 frames in 1s'), 'render history is in the report');
  ok(text2.includes('save: FAILED (quota)'), 'save failures are in the report');
  ok(text2.includes('serviceWorker: not-registered'), 'the worker state is explicit');
  ok(Diag.reportRows(withCtx).some(([k]) => k === 'آخرین رندر'), 'the sheet shows the last render');
  ok(Diag.reportRows(withCtx).some(([k, v]) => k === 'آخرین ذخیره' && String(v).includes('ناموفق')), 'the sheet shows the last save');
  ok(Diag.reportRows(withCtx).some(([k, v]) => k === 'تنظیمات تدوین' && String(v).includes('پرکردن قاب')), 'the sheet shows the framing mode');
}

  ok(Diag.reportText({}).length > 0, 'an empty report still renders without throwing');
  ok(Diag.reportRows({}).length >= 1, 'reportRows never returns nothing');
}


/* ================================================================== */
section('framing («کامل» vs «پرکردن قاب»)');

{
  // a 4:3 photo in a 9:16 reel frame — the case that made the app look "zoomed"
  const srcW = 4000, srcH = 3000, outW = 1080, outH = 1920;
  const fit = containRect(srcW, srcH, outW, outH);
  ok(Math.abs(fit.w / fit.h - srcW / srcH) < 1e-6, 'contain keeps the source aspect');
  ok(fit.w <= outW + 1e-6 && fit.h <= outH + 1e-6, 'contain shows the whole picture inside the frame');
  ok(fit.x >= -1e-6 && fit.y >= -1e-6 && fit.x + fit.w <= outW + 1e-6 && fit.y + fit.h <= outH + 1e-6, 'contain is centred, nothing outside');
  ok(Math.abs(fit.w - outW) < 1e-6, 'a 4:3 photo uses the full width');
  ok(fit.h < outH * 0.6, 'and therefore leaves backdrop above/below', String(fit.h));

  const cover = coverRect(srcW, srcH, outW, outH);
  ok(cover.w >= outW - 1e-6 && cover.h >= outH - 1e-6, 'cover always fills the frame');
  ok(Math.abs(cover.w / cover.h - srcW / srcH) < 1e-6, 'cover keeps the source aspect');
  ok(cover.w > fit.w, 'cover is zoomed in compared with contain (the reported "zoom")');

  // portrait photo: cover crops the sides, contain letterboxes the same amount
  const pFit = containRect(3000, 4000, 1080, 1920);
  ok(Math.abs(pFit.w - 1080) < 1e-6, 'a 3:4 portrait photo fits the width in contain');
  ok(pFit.h < 1920 && pFit.h > 1000, 'and leaves backdrop above/below instead of cropping', String(pFit.h));
  const tallFit = containRect(1080, 2400, 1080, 1920);
  ok(Math.abs(tallFit.h - 1920) < 1e-6 && tallFit.w < 1080, 'a taller-than-9:16 source fits the height instead');
  const pCover = coverRect(3000, 4000, 1080, 1920);
  ok(pCover.w >= 1080 && pCover.h >= 1920, 'portrait cover still fills the frame');

  // the bars function describes the backdrop area for the UI
  const bars = pillowBars(srcW, srcH, outW, outH);
  ok(bars.sides === 0 && bars.top > 0.3, 'pillow bars report top/bottom backdrop', JSON.stringify(bars));
  ok(pillowBars(1080, 1920, 1080, 1920).top === 0, 'a 9:16 source needs no backdrop at all');

  // smart reframe must still work in cover mode
  const left = coverRect(4000, 3000, 1080, 1920, { focus: [0.1, 0.5] });
  const right = coverRect(4000, 3000, 1080, 1920, { focus: [0.9, 0.5] });
  // smaller x = the window shows the right-hand part of the photo
  ok(right.x < left.x, 'focus moves the crop window', `${left.x} vs ${right.x}`);
  ok(left.x > -1480 / 2, 'a subject on the left keeps the window in the left half', String(left.x));
  ok(Math.abs(left.x - right.x) > 100, 'the two crop windows really differ', `${left.x} vs ${right.x}`);
  for (const r of [left, right, coverRect(4000, 3000, 1080, 1920, { focus: [0, 0] }), coverRect(4000, 3000, 1080, 1920, { focus: [1, 1] })]) {
    ok(r.x <= 1e-6 && r.y <= 1e-6 && r.x + r.w >= outW - 1e-6 && r.y + r.h >= outH - 1e-6,
      'cover never leaves a gap at any focus', JSON.stringify(r));
  }
  ok(coverRect(4000, 3000, 1080, 1920, { zoom: 1.4 }).w > coverRect(4000, 3000, 1080, 1920).w, 'zoom scales the cover window');
  ok(FRAMINGS.length === 2 && FRAMINGS[0].id === 'fit', 'two framing modes are offered, fit first');

  // both compositors must agree: the shader mirrors containRect, the 2D fallback calls it
  const glSource = readFileSync(new URL('../src/core/gl.js', import.meta.url), 'utf8');
  ok(/vec2 vis = \(srcA > outA\)/.test(glSource), 'the shader computes the same contain mapping');
  ok(glSource.includes("containRect(srcWidth, srcHeight, w, h)"), 'the 2D fallback uses containRect');
  ok(glSource.includes("coverRect(srcWidth, srcHeight, w, h"), 'the 2D fallback uses coverRect');
}

/* ================================================================== */
section('saving files where they can be found');

{
  const blob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
  const chunks = Save.sliceBlob(new Blob([new Uint8Array(7 * 1024 * 1024)]), 3 * 1024 * 1024);
  ok(chunks.length === 3, 'big files are split into transfer chunks', String(chunks.length));
  ok(chunks[0].size === 3 * 1024 * 1024 && chunks[2].size === 1024 * 1024, 'chunks keep the byte count exact',
    chunks.map((c) => c.size).join('/'));
  ok(Save.sliceBlob(new Blob([])).length === 0, 'an empty blob produces no chunks');
  ok(Save.sliceBlob(null).length === 0, 'a missing blob is tolerated');

  ok(Save.isNativeApp({ Capacitor: { isNativePlatform: () => true } }) === true, 'native platform detected');
  ok(Save.isNativeApp({ Capacitor: { platform: 'android' } }) === true, 'a static platform string works too');
  ok(Save.isNativeApp({}) === false, 'a plain browser is not native');
  ok(Save.isNativeApp({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } }) === false, 'a throwing bridge is safe');

  // native save: the Filesystem plugin gets the whole file, in order, with progress
  const calls = [];
  const fakeFS = {
    Directory: { Documents: 'DOCUMENTS' },
    async writeFile(o) { calls.push({ op: 'write', ...o }); return { uri: 'file:///storage/emulated/0/Documents/ReelForge/x.mp4' }; },
    async appendFile(o) { calls.push({ op: 'append', ...o }); },
    async getUri(o) { return { uri: `file:///doc/${o.path}` }; },
  };
  const progress = [];
  const res = await Save.saveBlob(new Blob([new Uint8Array(6 * 1024 * 1024)]), 'reel.mp4', {
    win: { Capacitor: { isNativePlatform: () => true } },
    filesystem: fakeFS,
    directory: 'DOCUMENTS',
    chunkBytes: 2 * 1024 * 1024,
    onProgress: (p, label) => progress.push([p, label]),
  });
  ok(res.ok === true && res.method === 'files', 'native save reports success', JSON.stringify(res));
  ok(calls[0].op === 'write' && calls[0].path === 'ReelForge/reel.mp4', 'the file lands in the ReelForge folder', calls[0].path);
  ok(calls[0].recursive === true, 'the folder is created on demand');
  ok(calls.filter((c) => c.op === 'append').length === 2, 'the remaining chunks are appended', String(calls.length));
  ok(res.uri.startsWith('file://'), 'a shareable uri comes back', res.uri);
  ok(res.display === 'Documents/ReelForge', 'the display path is human readable', res.display);
  ok(progress.length >= 3 && progress.at(-1)[0] <= 1, 'progress is reported per chunk', String(progress.length));
  ok(progress.at(-1)[1].includes('ذخیره'), 'progress labels are Persian');

  // a missing plugin must not pretend to have saved
  const noPlugin = await Save.saveBlob(blob, 'x.mp4', { win: { Capacitor: { isNativePlatform: () => true } }, filesystem: {} });
  ok(noPlugin.ok === false && noPlugin.error === 'filesystem-plugin-missing', 'no plugin → honest failure');

  // a failing write is reported, not swallowed
  const brokenFS = { Directory: { Documents: 'DOCUMENTS' }, writeFile: async () => { throw new Error('quota'); }, appendFile: async () => {} };
  const failed = await Save.saveBlob(blob, 'x.mp4', { win: { Capacitor: { isNativePlatform: () => true } }, filesystem: brokenFS, directory: 'DOCUMENTS' });
  ok(failed.ok === false && failed.error === 'quota', 'write errors surface to the UI', JSON.stringify(failed));

  // browser path still downloads
  const downloaded = [];
  const webSaved = await Save.saveBlob(blob, 'x.mp4', {
    win: {},
    filesystem: { Directory: {}, writeFile: async () => { throw new Error('should not be called'); } },
    download: (b, name) => downloaded.push([name, b.size]),
  });
  ok(webSaved.ok === true && webSaved.method === 'download', 'a browser falls back to a download', JSON.stringify(webSaved));
  ok(downloaded.length === 1 && downloaded[0][0] === 'x.mp4' && downloaded[0][1] === 1024, 'the browser download gets the whole file', JSON.stringify(downloaded));
  const failedDownload = await Save.saveBlob(blob, 'x.mp4', { win: {}, download: () => { throw new Error('blocked'); } });
  ok(failedDownload.ok === false && failedDownload.error === 'blocked', 'a blocked download is reported', JSON.stringify(failedDownload));

  const report = await Save.saveWithReport(blob, 'reel.mp4', {
    win: { Capacitor: { isNativePlatform: () => true } }, filesystem: fakeFS, directory: 'DOCUMENTS', chunkBytes: 4 * 1024 * 1024,
  });
  ok(report.message.includes('Documents/ReelForge/reel.mp4'), 'the success message names the exact folder', report.message);
  const failedReport = await Save.saveWithReport(blob, 'reel.mp4', { win: { Capacitor: { isNativePlatform: () => true } }, filesystem: {} });
  ok(failedReport.message.includes('اشتراک'), 'a failure points at the sharing fallback', failedReport.message);

  ok(Save.base64ToBytes('AAECAw==').length === 4, 'base64 decodes to bytes');
  ok(Save.base64ToBytes('data:video/mp4;base64,AAECAw==').length === 4, 'data-url prefixes are stripped');
  ok(Save.SAVE_DISPLAY.includes('Documents'), 'the advertised folder is Documents/ReelForge');
}

/* ================================================================== */
section('music render progress (no more parking at 90%)');

{
  // a fake OfflineAudioContext that supports suspend/resume like a phone does
  class FakeOffline {
    constructor(len) { this.length = len; this.sampleRate = 44100; this._suspends = []; this._resume = null; }
    suspend(t) {
      return new Promise((resolve) => {
        this._suspends.push({ t, resolve });
        if (this._resume) { const r = this._resume; this._resume = null; r(); }
      });
    }
    resume() {
      const next = this._suspends.shift();
      this._lastResume = true;
      return next ? Promise.resolve(next.resolve()).then(() => {}) : Promise.resolve();
    }
    startRendering() {
      const drive = async () => {
        await new Promise((r) => setTimeout(r, 0));
        while (this._suspends.length) {
          const next = this._suspends[0];
          if (this._resume) { const r = this._resume; this._resume = null; r(); }
          await new Promise((r) => setTimeout(r, 0));
          await next.resolve();
          await new Promise((r) => setTimeout(r, 0));
        }
        return { sampleRate: 44100, length: this.length, getChannelData: () => new Float32Array(this.length) };
      };
      return drive();
    }
  }
  const seen = [];
  const ctx = new FakeOffline(44100 * 20);
  const rendered = await Mod.renderWithProgress(ctx, {
    duration: 20,
    steps: 4,
    onProgress: (p, label) => seen.push([p, label]),
  });
  ok(!!rendered && rendered.sampleRate === 44100, 'the render still resolves');
  ok(seen.length >= 3, 'progress is reported from the render loop, not a timer', String(seen.length));
  const values = seen.map(([p]) => p);
  ok(values.every((v, i) => i === 0 || v >= values[i - 1]), 'progress never goes backwards', values.join(','));
  ok(Math.max(...values) <= 0.95, 'progress stays honest before analysis', String(Math.max(...values)));
  ok(values.at(-1) > 0.5, 'progress travels well past the old 12% ceiling', String(values.at(-1)));
  ok(seen.every(([, label]) => label.includes('%') || label.includes('رندر')), 'labels describe the render');

  // an engine without suspend() must still render (fallback timer keeps the bar alive)
  const noSuspend = {
    length: 44100, sampleRate: 44100,
    suspend: () => { throw new Error('not supported'); },
    resume: async () => {},
    startRendering: async () => ({ sampleRate: 44100, length: 44100, getChannelData: () => new Float32Array(44100) }),
  };
  const still = await Mod.renderWithProgress(noSuspend, { duration: 1, onProgress: () => {} });
  ok(!!still, 'a context without suspend() still renders');

  // a render that never finishes must report instead of hanging the UI forever
  const stuck = { length: 44100, sampleRate: 44100, suspend: async () => {}, resume: async () => {}, startRendering: () => new Promise(() => {}) };
  let timeoutError = '';
  try {
    await Mod.renderWithProgress(stuck, { duration: 1, timeoutMs: 40, onProgress: () => {} });
  } catch (e) { timeoutError = e.message; }
  ok(timeoutError.includes('طول کشید'), 'a stuck render times out with a Persian message', timeoutError);

  // cancellation propagates
  const controller = new AbortController();
  controller.abort();
  let aborted = '';
  try {
    await Mod.renderWithProgress(new FakeOffline(44100 * 4), { duration: 2, steps: 3, signal: controller.signal, onProgress: () => {} });
  } catch (e) { aborted = e.name; }
  ok(aborted === 'AbortError', 'an aborted build stops early', aborted);
}


/* ---- one-time preference migration (the "reversed media" complaint) ---- */
{
  state.settings.orderMode = 'smart';
  const migrated = migratePrefs({ settingsVersion: 1, settings: { orderMode: 'smart' } });
  ok(migrated === true, 'an old prefs blob is migrated');
  ok(state.settings.orderMode === 'intake', 'the untouched "smart" default becomes "همان ترتیب من"', state.settings.orderMode);
  ok(migratePrefs({ settingsVersion: PREFS_VERSION }) === false, 'current prefs are left alone');
  ok(migratePrefs(null) === false, 'a missing prefs blob is safe');
  ok(migratePrefs({}) === false || state.settings.orderMode === 'intake', 'an empty blob does not throw');

  // a user who *deliberately* chose smart keeps it (their prefs are already v2)
  state.settings.orderMode = 'smart';
  migratePrefs({ settingsVersion: PREFS_VERSION, settings: { orderMode: 'smart' } });
  ok(state.settings.orderMode === 'smart', 'a deliberate choice on the current version survives');
  state.settings.orderMode = 'intake';
}


/* ================================================================== */
section('compositor orientation (the «۱۸۰ درجه» bug)');

{
  const glSource = readFileSync(new URL('../src/core/gl.js', import.meta.url), 'utf8');
  const { VERT_SRC, FRAG_SRC } = await import('../src/core/gl.js');

  // ---- the three changes that keep the GL path upright ----
  ok(/-aPos\.y/.test(VERT_SRC), 'the vertex shader flips y so uv is top-down (0,0 = top-left)');
  ok(!/vUv = aPos \* 0\.5 \+ 0\.5/.test(VERT_SRC), 'the old y-up uv mapping is gone');
  ok(/gl\.pixelStorei\(gl\.UNPACK_FLIP_Y_WEBGL,\s*true\)/.test(glSource),
    'DOM sources are uploaded flipped (t=0 = top row) — without this every frame is mirrored');
  ok(/uCoverCenter/.test(FRAG_SRC) && /p \/ uCoverScale \+ uCoverCenter/.test(FRAG_SRC),
    'the crop window is anchored by its centre, not its top-left');
  ok(/uniform2f\(U\.uCoverCenter,\s*ox \+ visW \/ 2,\s*oy \+ visH \/ 2\)/.test(glSource),
    'and the JS passes exactly that centre');

  // ---- the shader mapping, ported to JS, must agree with the 2D compositor ----
  // mapUv: p = (cv-0.5)*uRes; srcPx = p/uCoverScale + uCoverCenter; uv = srcPx/uSrcSize
  // (zoom = 1, pan = 0, rot = 0 — the shader folds those in separately from coverRect)
  const glMap = (cv, { outW, outH, srcW, srcH, centerSrc }) => {
    const scale = Math.max(outW / srcW, outH / srcH);
    const px = (cv[0] - 0.5) * outW / scale + centerSrc[0];
    const py = (cv[1] - 0.5) * outH / scale + centerSrc[1];
    return [px / srcW, py / srcH];
  };
  const rnd = (() => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();

  let worst = 0, worstCase = '';
  for (let i = 0; i < 40; i++) {
    const outW = [1080, 720, 540][i % 3];
    const outH = Math.round(outW * 16 / 9);
    const srcW = 800 + Math.round(rnd() * 3200);
    const srcH = 600 + Math.round(rnd() * 3000);
    const focus = [rnd(), rnd()];
    const rect = coverRect(srcW, srcH, outW, outH, { focus });
    // draw() passes the *source-pixel* centre of the visible window: ox + visW/2, with
    // ox = -rect.x/scale (coverRect's x is the negative destination offset)
    const centerSrc = [
      (-rect.x + outW / 2) * srcW / rect.w,
      (-rect.y + outH / 2) * srcH / rect.h,
    ];
    // sanity: that centre is inside the source, and the window covers the whole frame
    const visW = outW / Math.max(outW / srcW, outH / srcH);
    const visH = outH / Math.max(outW / srcW, outH / srcH);
    if (centerSrc[0] < visW / 2 - 1e-6 || centerSrc[0] > srcW - visW / 2 + 1e-6) worst = 9, worstCase = `centre off-image ${i}`;
    for (const cv of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5], [0.2, 0.8]]) {
      const [uvx, uvy] = glMap(cv, { outW, outH, srcW, srcH, centerSrc });
      // the 2D compositor draws the whole source into `rect` (destination size outW×outH)
      const expectX = (cv[0] * outW - rect.x) / rect.w;
      const expectY = (cv[1] * outH - rect.y) / rect.h;
      const d = Math.max(Math.abs(uvx - expectX), Math.abs(uvy - expectY));
      if (d > worst) { worst = d; worstCase = `${srcW}x${srcH}->${outW}x${outH} cv=${cv} got ${uvx.toFixed(4)},${uvy.toFixed(4)} want ${expectX.toFixed(4)},${expectY.toFixed(4)}`; }
    }
  }
  ok(worst < 1e-9, 'GL mapping == 2D compositor mapping for every corner and size (same crop, no shift)',
    worst < 1e-9 ? '' : `worst ${worst.toExponential(2)} — ${worstCase}`);

  // ---- the orientation contract, stated directly ----
  const c = coverRect(4000, 3000, 1080, 1920, { focus: [0.5, 0.5] });
  const centerSrc = [(-c.x + 1080 / 2) * 4000 / c.w, (-c.y + 1920 / 2) * 3000 / c.h];
  const P = (cv) => glMap(cv, { outW: 1080, outH: 1920, srcW: 4000, srcH: 3000, centerSrc });
  const tl = P([0, 0]), tr = P([1, 0]), bl = P([0, 1]), br = P([1, 1]);
  ok(tl[1] < bl[1], 'screen top samples the top of the image, screen bottom the bottom', `${tl[1].toFixed(3)} < ${bl[1].toFixed(3)}`);
  ok(tl[0] < tr[0], 'screen left samples the left of the image — the x axis is not mirrored', `${tl[0].toFixed(3)} < ${tr[0].toFixed(3)}`);
  ok(tl[1] < 0.01 && br[1] > 0.99, 'the frame spans the whole photo top-to-bottom (a 4:3 photo covers 9:16)', `${tl[1].toFixed(3)} … ${br[1].toFixed(3)}`);
  ok(Math.abs(c.y) < 1e-6 && br[0] - tl[0] < 0.6 && br[0] - tl[0] > 0.2,
    'the sides are cropped, never letterboxed, in cover mode', `x span ${(br[0] - tl[0]).toFixed(3)}`);

  // ---- what the phone-side probe will report ----
  const red = [255, 0, 0], green = [0, 255, 0], blue = [0, 0, 255], white = [255, 255, 255];
  const upright = { topLeft: red, topRight: green, bottomLeft: blue, bottomRight: white };
  const upsideDown = { topLeft: white, topRight: blue, bottomLeft: green, bottomRight: red };
  const mirrored = { topLeft: green, topRight: red, bottomLeft: white, bottomRight: blue };
  const cls = (await import('../src/core/diag.js')).classifyQuadrants;
  ok(cls(upright).ok === true && cls(upright).verdict === 'درست', 'an upright render is classified as correct');
  const flipped = cls(upsideDown);
  ok(flipped.ok === false && flipped.rotated180 === true, 'a 180° render is detected', JSON.stringify(flipped.verdict));
  ok(cls(mirrored).mirroredX === true, 'a horizontally mirrored render is detected');
  ok(cls({ topLeft: [0, 0, 0], topRight: [0, 0, 0], bottomLeft: [0, 0, 0], bottomRight: [0, 0, 0] }).blank === true, 'a blank read-back is reported');
  ok(cls({}).ok === false, 'missing corners do not pass');
  ok(cls(upright, '2d').mode === '2d', 'the mode is reported');
}

/* ================================================================== */
section('music: device speed → adaptive plan');

{
  ok(typeof Mod.measureOfflineSpeed === 'function', 'the speed probe exists');
  const noAudio = await Mod.measureOfflineSpeed({ win: {} });
  ok(noAudio.ok === false && noAudio.reason === 'no-offline-audio', 'no OfflineAudioContext is reported');

  const t = { ms: 0 };
  class FakeOAC {
    constructor(ch, len, rate) { this.length = len; this.sampleRate = rate; }
    createOscillator() { return { connect: () => ({ connect: () => ({}) }), start() {} }; }
    createGain() { return { gain: { value: 0 }, connect: (x) => x }; }
    async startRendering() { t.ms += 300; return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(this.length) }; }
  }
  const fast = await Mod.measureOfflineSpeed({ win: { OfflineAudioContext: FakeOAC }, now: () => t.ms });
  ok(fast.ok === true && fast.ratio > 0, 'render speed is measured', JSON.stringify(fast));
  ok(Mod.chooseMusicPlan({ ratio: 100 }).quality === 'full', 'a fast device gets the full plan');
  ok(Mod.chooseMusicPlan({ ratio: 100 }).sampleRate === 44100, 'a fast device renders at 44.1 kHz');
  const mid = Mod.chooseMusicPlan({ ratio: 8, wantedSeconds: 60 });
  ok(mid.sampleRate === 32000 && mid.seconds <= 36, 'a mid device gets 32 kHz and a shorter arrangement', JSON.stringify(mid));
  const slow = Mod.chooseMusicPlan({ ratio: 2, wantedSeconds: 60 });
  ok(slow.sampleRate === 32000 && slow.seconds <= 24, 'a slow device gets the light plan', JSON.stringify(slow));
  ok(JSON.stringify(Mod.chooseMusicPlan({ ratio: 0 })) === JSON.stringify(Mod.chooseMusicPlan({ ratio: 20 })),
    'an unmeasurable ratio falls back to the default plan instead of dividing by zero');
  ok(Mod.chooseMusicPlan({ ratio: NaN, wantedSeconds: 10 }).seconds >= 12, 'the arrangement never gets shorter than 12 s');
  ok(Mod.chooseMusicPlan({ ratio: 100, wantedSeconds: 999 }).seconds <= 60, 'the arrangement is capped at 60 s');

  // the generator honours the chosen sample rate (uses the file's real WebAudio fake)
  const seen = [];
  class RecordingOAC extends globalThis.OfflineAudioContext {
    constructor(ch, len, rate) { super(ch, len, rate); seen.push([ch, len, rate]); }
  }
  const prevOAC = globalThis.OfflineAudioContext;
  let generated = null;
  try {
    globalThis.OfflineAudioContext = RecordingOAC;
    generated = await Mod.generateTrack({ genreId: 'lofi', seed: 3, seconds: 20, sampleRate: 32000, timeoutMs: 8000 });
  } catch (e) {
    ok(false, 'generateTrack with a custom sample rate must not throw', e.message);
  } finally {
    globalThis.OfflineAudioContext = prevOAC;
  }
  if (generated) {
    ok(seen[0][2] === 32000, 'the OfflineAudioContext was created at the requested rate', JSON.stringify(seen[0]));
    ok(Math.abs(seen[0][1] / 32000 - generated.duration) < 0.2, 'the context length matches the arrangement duration');
    ok(generated.buffer.sampleRate === 32000, 'the returned buffer keeps that rate');
    ok(generated.beats.length > 4 && generated.energy.length > 0, 'the analysis of a 32 kHz track is intact');
  }
}


/* ================================================================== */
section('music bed loops instead of falling silent');

{
  const sr = 44100, secs = 8;
  const ramp = new FakeBuffer(2, sr * secs, sr);
  const RL = ramp.getChannelData(0);
  for (let i = 0; i < RL.length; i++) RL[i] = i / RL.length;      // 0 → 1, so a hard
  ramp.getChannelData(1).set(RL);                                  // wrap is an obvious jump

  const plan20 = [{ t0: 0, t1: 20, dur: 20, asset: { kind: 'image' } }];
  const rms = (a, from, to) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += a[i] * a[i];
    return Math.sqrt(sum / Math.max(1, to - from));
  };

  const bed = musicLoop({ buffer: ramp, bpm: 120 });
  ok(bed.barSamples === 2 * sr, '120 bpm → a 2 s bar', String(bed.barSamples));
  ok(bed.loopLen === 4 * bed.barSamples, 'an 8 s track is exactly four bars — nothing is dropped');
  ok(bed.xfade > 1000 && bed.xfade < sr / 4, 'the seam crossfade is a few tens of ms', String(bed.xfade));
  const odd = musicLoop({ buffer: new FakeBuffer(2, Math.round(sr * 7.3), sr), bpm: 120 });
  ok(odd.loopLen === 3 * 2 * sr && odd.loopLen < sr * 7.3, 'a trailing partial bar is left out of the loop', `${odd.loopLen / sr}s of ${7.3}s`);
  ok(musicLoop({ buffer: ramp, bpm: 0 }).loopLen === ramp.length, 'without a bpm the whole track is the loop');
  ok(musicLoop({}).loops === false, 'no buffer → no loop');

  const mix = await buildSoundtrack({ musicBuffer: ramp, cuts: plan20, bpm: 120, fadeIn: 0, fadeOut: 0 });
  const M = mix.channels[0];
  ok(mix.length >= 20 * sr - 1, 'the soundtrack covers the whole 20 s reel', String(mix.length));
  ok(mix.loop.wrapped === true, 'the mix reports that it wrapped the bed');
  ok(Math.abs(M[Math.round(9.5 * sr)] - M[Math.round(1.5 * sr)]) < 0.02,
    'second time round the 8 s track repeats the first (t=1.5s == t=9.5s on a ramp)',
    `${M[Math.round(1.5 * sr)].toFixed(4)} vs ${M[Math.round(9.5 * sr)].toFixed(4)}`);
  ok(Math.abs(M[Math.round(0.4 * sr)] - 0.05) < 0.01, 'the bed starts at the top of the track', M[Math.round(0.4 * sr)].toFixed(4));
  ok(rms(M, 18 * sr, 20 * sr) > 0.1, 'there is still music in the last second (the bug: silence)', rms(M, 18 * sr, 20 * sr).toFixed(3));
  const seam = Math.abs(M[mix.loop.loopLen] - M[mix.loop.loopLen - 1]);
  ok(seam < 0.02, 'the loop seam is crossfaded, not a step', seam.toFixed(5));

  const noLoop = await buildSoundtrack({ musicBuffer: ramp, cuts: plan20, bpm: 120, loop: false, fadeIn: 0, fadeOut: 0 });
  ok(rms(noLoop.channels[0], 18 * sr, 20 * sr) === 0, 'loop:false keeps the old behaviour (silent tail)');
  ok(noLoop.loop.wrapped === false, 'and says so');

  // a start offset inside the track is clamped into the loop window, never past it
  const offset = await buildSoundtrack({ musicBuffer: ramp, musicStart: 99, cuts: [{ t0: 0, t1: 3, dur: 3, asset: { kind: 'image' } }], bpm: 120, fadeIn: 0, fadeOut: 0 });
  ok(rms(offset.channels[0], 0, 3 * sr) > 0, 'a musicStart past the end still produces music instead of silence');
}


/* ================================================================== */
section('«هدف کلیپ» — one sentence decides the edit');

{
  const P = STYLE_PRESETS.map((x) => x.id);
  const D = STYLE_DURATIONS.map((x) => x.id);
  const G = Mod.GENRES.map((x) => x.id);
  const T = COPY_TONES.map((x) => x.id);

  ok(typeof Brief.analyzeBrief === 'function' && typeof Brief.briefPatch === 'function', 'the brief engine is exported');
  ok(Brief.BRIEF_EXAMPLES.length >= 6, 'one-tap examples exist', String(Brief.BRIEF_EXAMPLES.length));
  ok(Brief.BRIEF_EXAMPLES.every((e) => e.icon && e.label && e.text.length > 15), 'every example is usable as a brief');

  // ---- nothing / nonsense ----
  const empty = Brief.analyzeBrief('   ');
  ok(empty.ok === false && empty.reason === 'empty', 'an empty brief is refused, not guessed');
  ok(Brief.briefPatch(empty) === null, 'and produces no patch');
  ok(Brief.briefSummary(empty).length === 0, 'and no summary rows');
  ok(Brief.analyzeBrief('ا').ok === false, 'a single letter is not a brief');
  const vague = Brief.analyzeBrief('یه چیزی از اینا بساز');
  ok(vague.ok === true, 'a vague sentence still gets a default edit', JSON.stringify(vague.intentLabel));
  ok(vague.presetId === 'auto' || P.includes(vague.presetId), 'the fallback style is a real preset', vague.presetId);
  ok(Brief.briefSummary(vague).length >= 6, 'the summary always explains the decision');

  // ---- keyword detection ----
  ok(Brief.detectIntent('می‌خوام محصولم رو بفروشم، تخفیف گذاشتم').id === 'sell', 'selling is detected');
  ok(Brief.detectIntent('آموزش سه قدمی آرایش').id === 'teach', 'a tutorial is detected');
  ok(Brief.detectIntent('جشن تولد پسرم').id === 'celebrate', 'a celebration is detected');
  ok(Brief.detectIntent('').id === null, 'no text → no intent');
  ok(Brief.detectEnergy('ریتم تند و پرانرژی') > Brief.detectEnergy('آرام و ملایم و لطیف'), 'energy goes up with hype words');
  ok(Brief.detectEnergy('') === 0.5, 'neutral text → neutral energy');
  ok(Brief.detectEnergy('🔥🔥 خیلی پرانرژی!!') > 0.7, 'emojis and bangs add energy');

  const line = Brief.briefTopicLine('می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون ترغیب بشه بخره');
  ok(!line.startsWith('می‌خوام') && line.includes('کفش'), 'the on-screen line drops the filler start', line);
  ok(line.length <= 48, 'the on-screen line stays short enough for a caption', String(line.length));
  ok(Brief.briefTopicLine('کلیپم رو بساز') === 'کلیپم', 'a trailing «بساز» is dropped too', Brief.briefTopicLine('کلیپم رو بساز'));
  const kw = Brief.briefKeywords('معرفی کفش ورزشی جدید از مغازه‌ی خودم');
  ok(kw.includes('کفش') && !kw.includes('از'), 'keywords skip stopwords', kw.join(','));
  ok(kw.length <= 5, 'keywords are capped');

  // ---- the five briefs we care about ----
  const cases = [
    ['می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون ترغیب بشه بخره', { presetId: 'brand', tone: 'bold', intent: 'sell' }],
    ['جشن تولد دخترم، لحظه‌های قشنگ و احساسی با آهنگ شاد', { presetId: 'vlog', tone: 'warm', intent: 'celebrate' }],
    ['آموزش سه قدمی آرایش ساده برای مبتدی‌ها، حتماً زیرنویس داشته باشه', { intent: 'teach', subtitles: true, tone: 'curious', presetId: 'beauty' }],
    ['کلیپ انگیزشی از تمرین‌های باشگاه، انرژی بالا و ریتم تند', { presetId: 'sport', tone: 'bold', intent: 'motivate' }],
    ['ادیت هنری از غروب شهر با حس آرام و کمی غمگین', { presetId: 'cinematic', musicGenre: 'ambient', tone: 'aesthetic' }],
    ['معرفی منو و فضای دنج کافه‌ی جدیدمون', { presetId: 'food', musicGenre: 'lofi' }],
    ['product launch video for my new sneaker shop, energetic', { presetId: 'brand', intent: 'sell' }],
  ];
  for (const [text, want] of cases) {
    const a = Brief.analyzeBrief(text);
    const label = text.slice(0, 26);
    for (const [key, value] of Object.entries(want)) {
      ok(a[key] === value, `${label}: ${key} = ${value}`, `got ${a[key]}`);
    }
  }

  // ---- a patch must be safe to apply ----
  const a = Brief.analyzeBrief('می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون ترغیب بشه بخره');
  const patch = Brief.briefPatch(a);
  ok(P.includes(patch.presetId), 'the patch sets a real preset id', patch.presetId);
  ok(D.includes(patch.settings.duration), 'the patch sets a real duration', String(patch.settings.duration));
  ok(T.includes(patch.settings.tone), 'the patch sets a real tone', patch.settings.tone);
  ok(patch.settings.topic && patch.settings.topic.length <= 48, 'the patch fills the topic from the sentence');
  ok(patch.settings.brief === a.text && patch.settings.briefPlan?.intent === 'sell', 'the sentence and its plan are stored');
  ok(patch.music && G.includes(patch.music.genre), 'the patch picks a real music genre', JSON.stringify(patch.music));
  ok(patch.music.tempo >= 0.8 && patch.music.tempo <= 1.25, 'the tempo stays inside the library range');
  ok(patch.settings.orderMode === undefined, 'the brief never touches the media order (the user picks that)');
  const own = Brief.briefPatch(a, { keepMusic: true });
  ok(own.music === null, "the user's own song is never replaced by the brief");
  const defaultKeys = Object.keys(DEFAULT_SETTINGS);
  const unknown = Object.keys(patch.settings).filter((k) => !defaultKeys.includes(k));
  ok(unknown.length === 0, 'every setting the brief writes is a real setting', unknown.join(','));

  // ---- and the settings really shape the plan ----
  {
    const analysis = Brief.analyzeBrief('کلیپ انگیزشی از تمرین‌های باشگاه، انرژی بالا و ریتم تند');
    const settings = { ...DEFAULT_SETTINGS, ...Brief.briefPatch(analysis).settings };
    const assets = [
      { id: 'a', kind: 'video', use: true, duration: 8, width: 1080, height: 1920, score: 0.9, focus: [0.5, 0.4], frames: [], tone: [0.5, 0.5], motionLevel: 0.6 },
      { id: 'b', kind: 'photo', use: true, width: 1200, height: 1600, score: 0.8, focus: [0.5, 0.4], tone: [0.5, 0.5], motionLevel: 0 },
    ];
    const plan = buildPlan({ assets, presetId: 'sport', music: null, settings, seed: 7 });
    ok(plan.presetId === analysis.presetId && plan.presetId === 'sport', 'the plan uses the preset the brief chose', plan.presetId);
    ok(analysis.tone === 'bold' && plan.copy.tone === 'bold', 'the copy engine receives the brief tone', plan.copy.tone);
    ok(Math.abs(plan.duration - analysis.duration) < 1.2, 'the plan is as long as the brief asked', `${plan.duration} vs ${analysis.duration}`);
    const avgShot = plan.duration / plan.cuts.length;
    const calm = Brief.analyzeBrief('ادیت هنری آرام از غروب شهر');
    const calmSettings = { ...DEFAULT_SETTINGS, ...Brief.briefPatch(calm).settings };
    const calmPlan = buildPlan({ assets, presetId: 'cinematic', music: null, settings: calmSettings, seed: 7 });
    const calmAvg = calmPlan.duration / calmPlan.cuts.length;
    ok(avgShot < 1.8, 'an energetic brief produces fast cuts (≤1.8s a shot)', avgShot.toFixed(2));
    ok(calmAvg > avgShot * 1.6, 'a calm brief gets visibly slower cuts than an energetic one',
      `${calmAvg.toFixed(2)} > ${avgShot.toFixed(2)}`);
  }

  // ---- the brief drives the copy category even when the topic field is empty ----
  {
    const brief = 'بهترین پیتزا و کافه‌ی شهرمون رو معرفی می‌کنم';
    const withBrief = buildCopy({ presetId: 'food', topic: '', brief, seed: 3, shots: 6, duration: 30 });
    const without = buildCopy({ presetId: 'food', topic: '', seed: 3, shots: 6, duration: 30 });
    ok(withBrief.category === 'food', 'the copy engine reads the subject from the brief', withBrief.category);
    ok(without.category === 'general', 'and without it the category is just general', without.category);
    const brief2 = 'می‌خوام تمرین‌های باشگاهم رو نشون بدم و انگیزه بدم';
    ok(buildCopy({ presetId: 'sport', topic: '', brief: brief2, seed: 5, shots: 6, duration: 30 }).category === 'fitness',
      'a gym sentence lands in the fitness category');
  }

  // ---- the report explains what the brief did ----
  const lineOut = Brief.briefLine(Brief.analyzeBrief('آموزش آرایش ساده'));
  ok(lineOut.includes('آموزش') || lineOut.includes('بیوتی'), 'the report line names the goal', lineOut);
  ok(Brief.briefLine(null) === 'بدون هدف', 'no brief → a clear report value');
  const rows = Brief.briefSummary(Brief.analyzeBrief('آموزش آرایش ساده'), { faNum: (n) => String(n) });
  ok(rows.every(([k, v]) => k && v), 'every summary row is filled', JSON.stringify(rows));
  ok(rows.some(([k]) => k === 'موسیقی') && rows.some(([k]) => k === 'سبک تدوین'), 'the summary covers music and style');
}


/* ================================================================== */
section('pacing follows the style (fast styles really cut faster)');

{
  // «pace» is a shot-length multiplier. It used to be divided, which made every
  // energetic style («ورزشی»، «ویروسی») cut slower than «سینمایی».
  const assets = [
    { id: 'a', kind: 'video', use: true, duration: 8, width: 1080, height: 1920, score: 0.9, focus: [0.5, 0.4], frames: [], tone: [0.5, 0.5], motionLevel: 0.6 },
    { id: 'b', kind: 'photo', use: true, width: 1200, height: 1600, score: 0.8, focus: [0.5, 0.4], tone: [0.5, 0.5], motionLevel: 0 },
    { id: 'c', kind: 'photo', use: true, width: 1080, height: 1080, score: 0.7, focus: [0.5, 0.5], tone: [0.5, 0.5], motionLevel: 0 },
  ];
  const measured = STYLE_PRESETS.map((p) => {
    const plan = buildPlan({ assets, presetId: p.id, music: null, settings: { ...DEFAULT_SETTINGS, duration: 30 }, seed: 7 });
    return { id: p.id, pace: p.pace, minShot: p.minShot, maxShot: p.maxShot, avg: plan.duration / plan.cuts.length, plan };
  });
  for (const m of measured) {
    ok(m.avg >= m.minShot * 0.9 && m.avg <= m.maxShot * 1.05, `${m.id}: shots stay inside its own min/max (${m.minShot}–${m.maxShot}s)`, `${m.avg.toFixed(2)}s`);
  }
  const fast = measured.filter((m) => m.pace <= 0.7);
  const slow = measured.filter((m) => m.pace >= 1.2);
  const worstFast = Math.max(...fast.map((m) => m.avg));
  const bestSlow = Math.min(...slow.map((m) => m.avg));
  ok(fast.length >= 2 && slow.length >= 3, 'there are fast and slow styles to compare', `${fast.length}/${slow.length}`);
  ok(worstFast < bestSlow, 'every energetic style cuts faster than every calm style',
    `fastest calm ${bestSlow.toFixed(2)}s vs slowest fast ${worstFast.toFixed(2)}s`);
  const sport = measured.find((m) => m.id === 'sport');
  const cine = measured.find((m) => m.id === 'cinematic');
  ok(sport.plan.cuts.length > cine.plan.cuts.length, 'a sport edit has more cuts than a cinematic one in the same reel',
    `${sport.plan.cuts.length} vs ${cine.plan.cuts.length}`);
  const auto = measured.find((m) => m.id === 'auto');
  ok(Math.abs(auto.avg - 3.12) < 0.4, 'the default («هوشمند») pacing is unchanged for existing projects', auto.avg.toFixed(2));
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} feature checks passed`);
process.exit(failures ? 1 : 0);
