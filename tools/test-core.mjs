/**
 * Core logic tests (run with: npm test).
 * Covers the beat detector, the edit planner and the caption engine — the three
 * pieces that decide whether the automatic edit looks "professional".
 */
import { analyzeDecoded, beatsInRange, nearestBeat } from '../src/core/beats.js';
import { buildPlan } from '../src/core/planner.js';
import { buildCopy } from '../src/core/captions.js';
import { sizeForAspect, PRESETS } from '../src/data/styles.js';
import { CATEGORY_LABELS } from '../src/data/hooks.js';

let failures = 0;
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${label} ${extra}`);
  }
}
function section(name) { console.log(`\n▸ ${name}`); }

/* ------------------------------------------------------------------ */
/* synthetic audio                                                     */
/* ------------------------------------------------------------------ */
function clickTrack({ bpm = 120, seconds = 20, sampleRate = 44100, swing = 0, noise = 0.02 }) {
  const length = Math.floor(seconds * sampleRate);
  const data = new Float32Array(length);
  const beat = 60 / bpm;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    // kick on every beat
    const phase = t % beat;
    const kickEnv = Math.exp(-phase * 26);
    data[i] += Math.sin(2 * Math.PI * 58 * t) * kickEnv * 0.9;
    // strong downbeat accent every 4 beats
    const barPhase = (t % (beat * 4));
    if (barPhase < 0.02) data[i] += Math.sin(2 * Math.PI * 90 * t) * Math.exp(-barPhase * 90) * 0.6;
    // hat on off-beats
    const off = (t + beat / 2) % beat;
    data[i] += (Math.random() * 2 - 1) * Math.exp(-off * 90) * 0.25;
    // pad so spectral flux has body
    data[i] += Math.sin(2 * Math.PI * 220 * t) * 0.08 + Math.sin(2 * Math.PI * 330 * t) * 0.05;
    data[i] += (Math.random() * 2 - 1) * noise * 0.1;
    data[i] *= 0.8;
  }
  return {
    sampleRate,
    length,
    duration: seconds,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

section('beat detector');
for (const bpm of [90, 120, 128]) {
  const audio = clickTrack({ bpm, seconds: 18 });
  const res = analyzeDecoded(audio, { maxAnalyze: 18 });
  const err = Math.abs(res.bpm - bpm);
  ok(err < 4, `BPM ≈ ${bpm}`, `got ${res.bpm.toFixed(1)}`);
  ok(res.confidence > 0.1, `confidence > 0.1 (bpm=${bpm})`, `got ${res.confidence.toFixed(3)}`);
  ok(res.beats.length > 5, `beat grid has beats (bpm=${bpm})`, `got ${res.beats.length}`);
  // phase accuracy: every detected beat should sit on a true beat position
  let worst = 0;
  for (const b of res.beats) {
    const beat = 60 / bpm;
    const d = Math.abs(((b % beat) + beat) % beat);
    worst = Math.max(worst, Math.min(d, beat - d));
  }
  ok(worst < 0.06, `beat phase accurate (bpm=${bpm})`, `worst offset ${(worst * 1000).toFixed(1)}ms`);
  ok(res.beats[1] > res.beats[0], 'beats are increasing');
  ok(Number.isFinite(res.bestStart) && res.bestStart >= 0, 'bestStart is finite');
}

section('beat helpers');
{
  const audio = clickTrack({ bpm: 100, seconds: 12 });
  const res = analyzeDecoded(audio, { maxAnalyze: 12 });
  const inRange = beatsInRange(res, 2, 4);
  ok(inRange.every((t) => t >= 2 - 1e-3 && t <= 4 + 1e-3), 'beatsInRange respects bounds');
  ok(inRange.length >= 2, 'beatsInRange returns beats', `got ${inRange.length}`);
  const nb = nearestBeat(res, 2.01, 0.2);
  ok(Math.abs(nb - 2.0) < 0.1, 'nearestBeat snaps', `got ${nb.toFixed(3)}`);
}

/* ------------------------------------------------------------------ */
/* fake media library                                                  */
/* ------------------------------------------------------------------ */
function fakeAsset(i, kind, { score = 0.5, motion = 0.3, duration = 8, w = 1080, h = 1920, mood = 'clean' } = {}) {
  return {
    id: `a${i}`,
    kind,
    name: kind === 'photo' ? `photo-${i}.jpg` : `clip-${i}.mp4`,
    size: 1_000_000 + i,
    file: null,
    objectUrl: null,
    width: w,
    height: h,
    duration: kind === 'video' ? duration : null,
    trimIn: 0,
    trimOut: kind === 'video' ? duration : null,
    speed: 1,
    volume: kind === 'video' ? 1 : 0,
    muted: kind === 'video',
    use: true,
    hero: i === 0,
    thumb: null,
    analysis: {
      luma: 0.5, contrast: 0.22, saturation: 0.3, warmth: 0.03, clipHi: 0.01, clipLo: 0.01,
      sharpness: 0.05, edgeDensity: 0.25, edgeMean: 0.08,
      focus: { x: 0.5, y: 0.4 }, colors: [[120, 90, 80]], avgColor: [120, 90, 80],
      toneCurve: new Array(16).fill(0.06), motion, score, mood, samples: 4, suggestedIn: 1.2,
    },
  };
}

function musicFixture(bpm = 120, duration = 60) {
  const audio = clickTrack({ bpm, seconds: duration });
  return analyzeDecoded(audio, { maxAnalyze: duration });
}

function validatePlan(plan, assets, label) {
  const EPS = 0.002;
  ok(Math.abs(plan.cuts[0].t0) < 1e-6, `${label}: starts at 0`);
  ok(Math.abs(plan.cuts[plan.cuts.length - 1].t1 - plan.duration) < 0.01, `${label}: ends at duration`,
    `${plan.cuts[plan.cuts.length - 1].t1} vs ${plan.duration}`);
  let contiguous = true;
  for (let i = 1; i < plan.cuts.length; i++) {
    if (Math.abs(plan.cuts[i].t0 - plan.cuts[i - 1].t1) > EPS) contiguous = false;
  }
  ok(contiguous, `${label}: cuts are contiguous`);
  ok(plan.cuts.every((c) => c.dur > 0.15), `${label}: no zero-length cuts`);
  ok(plan.duration > 5 && plan.duration < 200, `${label}: sane duration`, String(plan.duration));
  if (plan.hasBeat) {
    const expect = plan.bars * 4 * plan.music.bpm === undefined ? null : null;
    const beat = 60 / plan.music.bpm;
    const ratio = plan.duration / beat;
    ok(Math.abs(ratio - Math.round(ratio)) < 0.06, `${label}: duration is a whole number of beats`, ratio.toFixed(3));
  }
  // media coverage
  const used = new Set(plan.cuts.map((c) => c.assetId));
  const usable = assets.filter((a) => a.use);
  if (usable.length <= plan.cuts.length) {
    ok(used.size === usable.length, `${label}: every selected file is used`, `${used.size}/${usable.length}`);
  }
  // video trims must be inside the source and actually long enough
  for (const c of plan.cuts) {
    if (c.asset?.kind !== 'video') continue;
    const a = c.asset;
    ok(c.trimIn >= (a.trimIn || 0) - 1e-6, `${label}: trimIn inside range`);
    const out = c.trimOut ?? a.duration;
    ok(out <= (a.trimOut ?? a.duration) + 1e-6, `${label}: trimOut inside range`);
    ok(c.speed > 0.25 && c.speed <= 1.001, `${label}: speed sane`, String(c.speed));
    const needed = c.dur;
    const avail = (out - c.trimIn) / c.speed;
    ok(avail >= needed - 0.12, `${label}: enough source frames`, `${avail.toFixed(2)} < ${needed.toFixed(2)}`);
  }
  // no immediate repetition when avoidable
  let repeats = 0;
  for (let i = 1; i < plan.cuts.length; i++) if (plan.cuts[i].assetId === plan.cuts[i - 1].assetId) repeats++;
  if (usable.length > 2) ok(repeats <= 1, `${label}: rarely repeats back-to-back`, String(repeats));
  // overlays inside the timeline and inside their windows
  for (const o of plan.overlays) {
    ok(o.t0 >= 0 && o.t1 <= plan.duration + 0.01, `${label}: overlay inside timeline (${o.kind})`, `${o.t0}–${o.t1}`);
    ok(o.t1 > o.t0, `${label}: overlay has a window (${o.kind})`);
  }
  ok(plan.overlays.length >= 2, `${label}: has overlays`);
  const lineOverlays = plan.overlays.filter((o) => o.kind === 'line');
  const overlapping = lineOverlays.filter((a, i) => lineOverlays.some((b, j) => j !== i && a.t0 < b.t1 && b.t0 < a.t1));
  ok(overlapping.length === 0, `${label}: on-screen lines never overlap`, String(overlapping.length));
  ok(plan.copy.hook.length > 2, `${label}: hook generated`);
  ok(plan.copy.tags.length >= 12, `${label}: hashtags generated`, String(plan.copy.tags.length));
  ok(!/\{topic\}|\{n\}|\{cat\}/.test(plan.copy.caption), `${label}: placeholders filled`);
  ok(plan.width % 2 === 0 && plan.height % 2 === 0, `${label}: even dimensions (H.264)`);
}

section('plan builder');
{
  const music = musicFixture(120, 60);
  const settings = { duration: 30, quality: '1080p', aspect: '9:16' };
  const cases = [
    { n: 3, kinds: ['photo', 'photo', 'photo'], name: 'photos only' },
    { n: 8, kinds: ['photo', 'video', 'photo', 'video', 'photo', 'photo', 'video', 'photo'], name: 'mixed 8' },
    { n: 40, kinds: null, name: '40 files' },
    { n: 1, kinds: ['video'], name: 'single video' },
    { n: 2, kinds: ['video', 'video'], name: 'two short videos' },
  ];
  for (const c of cases) {
    const assets = Array.from({ length: c.n }, (_, i) => fakeAsset(
      i,
      c.kinds ? c.kinds[i % c.kinds.length] : (i % 3 === 0 ? 'video' : 'photo'),
      { duration: i % 2 ? 3 : 12, score: 0.3 + ((i * 7) % 60) / 100 },
    ));
    for (const preset of ['auto', 'cinematic', 'sport', 'noir', 'viral']) {
      const plan = buildPlan({
        assets, presetId: preset, music, settings: { ...settings, quality: '1080p' }, seed: 1234 + c.n,
      });
      validatePlan(plan, assets, `${c.name}/${preset}`);
    }
  }
  // no music at all
  const assets = Array.from({ length: 6 }, (_, i) => fakeAsset(i, i % 2 ? 'photo' : 'video', { duration: 6 }));
  const silent = buildPlan({ assets, presetId: 'vlog', music: null, settings, seed: 4 });
  validatePlan(silent, assets, 'no music');
  ok(silent.hasBeat === false, 'no music -> fallback grid');
  ok(Math.abs(silent.duration / 0.6 - Math.round(silent.duration / 0.6)) < 0.05, 'fallback grid is 100 BPM');

  // durations
  for (const d of [15, 20, 30, 45, 60]) {
    const p = buildPlan({ assets, presetId: 'auto', music, settings: { ...settings, duration: d }, seed: 9 });
    ok(Math.abs(p.duration - d) <= 2.5, `duration ${d}s respected`, `got ${p.duration.toFixed(2)}`);
  }
  // aspects
  for (const aspect of ['9:16', '4:5', '1:1', '16:9']) {
    const p = buildPlan({ assets, presetId: 'brand', music, settings: { ...settings, aspect }, seed: 3 });
    const expected = sizeForAspect(aspect, '1080p');
    ok(p.width === expected.width && p.height === expected.height, `aspect ${aspect} size`, `${p.width}x${p.height}`);
  }
  // 720p / 1440p
  for (const quality of ['720p', '1440p']) {
    const p = buildPlan({ assets, presetId: 'brand', music, settings: { ...settings, quality }, seed: 3 });
    const expected = sizeForAspect('9:16', quality);
    ok(p.width === expected.width && p.height === expected.height, `quality ${quality} size`, `${p.width}x${p.height}`);
  }
  // all presets build
  for (const preset of PRESETS) {
    const p = buildPlan({ assets, presetId: preset.id, music, settings, seed: 77 });
    validatePlan(p, assets, `preset ${preset.id}`);
  }
}

section('caption engine');
{
  const topics = [
    ['fa', '', 'general'], ['fa', 'کافه‌گردی در تهران', 'food'], ['fa', 'تمرین پا در باشگاه', 'fitness'],
    ['fa', 'سفر به شمال', 'travel'], ['fa', 'عروسی خواهرم', 'wedding'], ['fa', 'معرفی محصول جدید', 'product'],
    ['en', 'coffee shop tour', 'food'], ['en', 'my gym routine', 'fitness'], ['en', 'trip to the mountains', 'travel'],
    ['fa', 'روزمرگی‌های من', 'personal'], ['en', 'my cat', 'pet'],
  ];
  for (const [lang, topic, expectedCat] of topics) {
    for (const tone of ['auto', 'curious', 'bold', 'warm', 'funny', 'aesthetic']) {
      const copy = buildCopy({ lang, tone, topic, shots: 9, duration: 30, seed: Math.floor(Math.random() * 1e6), presetId: 'auto' });
      const label = `${lang}/${topic || '—'}/${tone}`;
      ok(copy.category === expectedCat, `${label}: category`, copy.category);
      ok(copy.hook.length > 3, `${label}: hook not empty`);
      ok(copy.lines.length >= 2, `${label}: on-screen lines`, String(copy.lines.length));
      ok(copy.body.length >= 1, `${label}: caption body`);
      ok(copy.tags.length >= 15, `${label}: hashtags`, String(copy.tags.length));
      ok(copy.tags.every((t) => t.startsWith('#')), `${label}: hashtags start with #`);
      ok(!/undefined|\[object/.test(copy.caption), `${label}: caption is clean`);
      ok(new Set(copy.tags).size === copy.tags.length, `${label}: hashtags unique`);
      if (topic) ok(copy.caption.includes(topic) || copy.hook.includes(topic) || copy.lines.some((l) => l.includes(topic)), `${label}: topic appears somewhere`);
    }
  }
  for (const [lang, cats] of Object.entries(CATEGORY_LABELS)) {
    ok(Object.keys(cats).length >= 12, `labels complete for ${lang}`);
  }
}

section('style data');
{
  for (const p of PRESETS) {
    ok(p.palette.length === 3, `${p.id}: palette`);
    ok(typeof p.grade.contrast === 'number' && typeof p.caption.size === 'number', `${p.id}: grade/caption params`);
    ok(p.caption.anim && p.motion && p.transition, `${p.id}: anim/motion/transition`);
  }
  const sizes = ['1080p', '720p', '1440p'].map((q) => sizeForAspect('9:16', q));
  ok(sizes[0].width === 1080 && sizes[0].height === 1920, '1080p vertical size');
  ok(sizes[1].width === 720, '720p vertical size');
  ok(sizes[2].height === 2560, '1440p vertical size');
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
