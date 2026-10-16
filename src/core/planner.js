/**
 * "The director": turns analysed media + a style preset + a song into a full
 * edit decision list (cuts on the beat, motion, transitions, text timing).
 */
import { getPreset, sizeForAspect } from '../data/styles.js';
import { clamp, mulberry32, shuffle } from './util.js';
import { energyAt, nearestBeat } from './beats.js';
import { rankAssets } from './analyze.js';
import { buildCopy } from './captions.js';

export const DEFAULT_SETTINGS = {
  duration: 30,
  aspect: '9:16',
  quality: '1080p',
  fps: 30,
  tone: 'auto',
  lang: 'fa',
  topic: '',
  customCaption: '',
  handle: '',
  watermark: true,
  progressBar: true,
  captions: true,
  hook: true,
  outro: true,
  orderMode: 'smart',   // 'smart' | 'intake'
  musicGain: 1,
  sourceGain: 0.35,
  musicStart: null,
};

function evenDistribute(total, parts, minEach, maxEach) {
  const out = new Array(parts).fill(minEach);
  let left = total - parts * minEach;
  if (left < 0) {
    // not enough beats for the requested shot count → fewer shots
    parts = Math.max(1, Math.floor(total / Math.max(1, minEach)));
    out.length = parts;
    out.fill(minEach);
    left = total - parts * minEach;
  }
  const rem = left;
  let acc = 0;
  for (let j = 0; j < parts; j++) {
    const target = Math.floor(((j + 1) * rem) / parts) - Math.floor((j * rem) / parts);
    out[j] = Math.min(maxEach, minEach + target);
    acc += out[j];
  }
  // fix any truncation caused by maxEach
  let diff = total - acc;
  let guard = 0;
  while (diff > 0 && guard++ < 1000) {
    for (let j = 0; j < parts && diff > 0; j++) {
      if (out[j] < maxEach) { out[j]++; diff--; }
    }
  }
  return out;
}

export function buildPlan({
  assets = [],
  presetId = 'auto',
  music = null,
  settings = {},
  seed = 7,
  analysisDone = true,
} = {}) {
  const S = { ...DEFAULT_SETTINGS, ...settings };
  const preset = getPreset(presetId);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const usable = assets.filter((a) => a.use && (a.kind === 'photo' || (a.duration || 0) > 0.3));
  if (!usable.length) throw new Error('هیچ عکس یا ویدیویی برای تدوین انتخاب نشده است.');

  const { width, height } = sizeForAspect(S.aspect, S.quality);
  const fps = S.fps || 30;

  // ---------------- timing grid ----------------
  const hasBeat = !!(music && music.beats?.length && music.confidence > 0.18 && music.bpm > 45);
  const beatPeriod = hasBeat ? music.beatPeriod : 0.6;    // fallback: 100 BPM grid
  const barSec = beatPeriod * 4;

  let targetD = clamp(S.duration || 30, 6, 180);
  let bars = Math.max(2, Math.round(targetD / barSec));
  if (music && Number.isFinite(music.duration) && music.duration > 3) {
    const maxBars = Math.floor(((music.duration - (music.minStart || 0)) - 0.4) / barSec);
    if (maxBars >= 2) bars = Math.min(bars, maxBars);
  }
  let totalBeats = bars * 4;
  let duration = totalBeats * beatPeriod;

  let musicStart = S.musicStart ?? (hasBeat ? music.bestStart : 0) ?? 0;
  if (music) {
    const lo = music.minStart || 0;
    musicStart = clamp(musicStart, lo, Math.max(lo, (music.duration || 0) - duration - 0.05));
    if (hasBeat) musicStart = nearestBeat(music, musicStart, beatPeriod * 0.6);
  }

  // ---------------- shot count ----------------
  const minBeats = Math.max(1, Math.round(preset.minShot / beatPeriod));
  const maxBeats = Math.max(minBeats + 1, Math.round(preset.maxShot / beatPeriod));
  const desiredShotSec = clamp(2.7 / preset.pace, preset.minShot * 0.95, preset.maxShot);
  let shots = Math.max(3, Math.round(totalBeats / Math.max(1, Math.round(desiredShotSec / beatPeriod))));
  const capacity = Math.max(3, Math.floor(duration / (preset.minShot * 0.92)));
  shots = clamp(Math.max(shots, Math.min(usable.length, capacity)), 3, 60);

  let beatPattern = evenDistribute(totalBeats, shots, minBeats, maxBeats);

  // high-energy burst: borrow single beats from longer shots to double the cut rate
  if (hasBeat && preset.pace <= 1.0 && beatPattern.length < capacity) {
    const burstBudget = clamp(Math.round(beatPattern.length * 0.18), 1, 4);
    for (let b = 0, added = 0; b < beatPattern.length && added < burstBudget; b++) {
      const idx = Math.floor(rng() * beatPattern.length);
      if (beatPattern[idx] >= minBeats + 1 && minBeats >= 1) {
        beatPattern[idx] -= minBeats;
        beatPattern.splice(idx + 1, 0, minBeats);
        added++;
      }
    }
  }

  // ---------------- cuts ----------------
  const cuts = [];
  let t = 0;
  beatPattern.forEach((beats, i) => {
    const dur = beats * beatPeriod;
    cuts.push({
      index: i,
      t0: +t.toFixed(4),
      t1: +(t + dur).toFixed(4),
      dur: +dur.toFixed(4),
      beats,
      asset: null,
      assetId: null,
      trimIn: 0,
      trimOut: null,
      speed: 1,
      motion: null,
      transition: { type: 'cut', dur: 0 },
      planMute: false,
    });
    t += dur;
  });
  duration = +t.toFixed(4);

  // ---------------- asset order ----------------
  let ordered = S.orderMode === 'intake' ? usable.slice() : rankAssets(usable, seed);
  if (ordered.length > cuts.length) {
    const heroes = ordered.filter((a) => a.hero);
    const keep = Math.max(0, cuts.length - heroes.length);
    ordered = [...heroes, ...ordered.filter((a) => !a.hero).slice(0, keep)].slice(0, cuts.length);
  }

  const energies = cuts.map((c) => (music ? energyAt(music, musicStart + (c.t0 + c.t1) / 2) : 0.5));
  let peakIdx = 0;
  energies.forEach((v, i) => { if (v > energies[peakIdx]) peakIdx = i; });
  if (music?.dropTime && hasBeat) {
    const rel = music.dropTime - musicStart;
    if (rel > 0.5 && rel < duration - 0.5) {
      const idx = cuts.findIndex((c) => rel >= c.t0 && rel <= c.t1);
      if (idx >= 0) peakIdx = idx;
    }
  }

  // hero shot goes to the strongest musical moment, the rest follow in rank order
  const assignment = new Array(cuts.length).fill(null);
  const queue = ordered.slice();
  assignment[peakIdx] = queue.shift();
  for (let i = 0; i < cuts.length; i++) {
    if (assignment[i]) continue;
    if (!queue.length) queue.push(...shuffle(rng, ordered));
    let next = queue.shift();
    // avoid the same asset on back-to-back cuts
    let guard = 0;
    while (next && assignment[i - 1]?.id === next.id && queue.length && guard++ < 5) {
      queue.push(next);
      next = queue.shift();
    }
    assignment[i] = next;
  }

  // ---------------- per-cut decisions ----------------
  const usedCount = new Map();
  cuts.forEach((cut, i) => {
    const asset = assignment[i];
    cut.asset = asset;
    cut.assetId = asset?.id || null;
    if (!asset) return;
    const reuse = usedCount.get(asset.id) || 0;
    usedCount.set(asset.id, reuse + 1);

    if (asset.kind === 'video') {
      const srcIn = asset.trimIn || 0;
      const srcOut = asset.trimOut ?? asset.duration ?? 0;
      const avail = Math.max(0.15, srcOut - srcIn);
      const need = cut.dur;
      let start;
      if (asset.userTrimmed) {
        start = srcIn;
      } else if (asset.analysis?.suggestedIn != null) {
        start = asset.analysis.suggestedIn;
      } else {
        start = srcIn;
      }
      // different segment when the same clip is used again
      if (reuse > 0) start += need * reuse;
      let speed = 1;
      if (avail >= need) {
        start = clamp(start, srcIn, Math.max(srcIn, srcOut - need - 0.01));
        cut.trimIn = +start.toFixed(4);
        cut.trimOut = +(start + need).toFixed(4);
      } else {
        speed = clamp(avail / need, 0.3, 1);       // slow motion rather than a frozen frame
        cut.trimIn = +srcIn.toFixed(4);
        cut.trimOut = +srcOut.toFixed(4);
      }
      cut.speed = +speed.toFixed(4);
      // a slowed-down clip would sound pitch-shifted, so its own audio is dropped
      cut.planMute = S.sourceGain <= 0.001 || speed < 0.999;
    } else {
      cut.trimIn = 0;
      cut.trimOut = null;
      cut.speed = 1;
      cut.planMute = true;
    }

    // motion language
    const autoMotion = asset.kind === 'photo'
      ? (i % 3 === 0 ? 'kenburns' : i % 3 === 1 ? 'zoomout' : 'pan')
      : ((asset.analysis?.motion || 0) > 0.42 ? 'punch' : 'kenburns');
    const type = preset.motion === 'auto' ? autoMotion : preset.motion;
    const dirX = rng() * 2 - 1;
    const dirY = rng() * 2 - 1;
    cut.motion = {
      type,
      dirX: +dirX.toFixed(3),
      dirY: +dirY.toFixed(3),
      amount: +(0.06 + rng() * 0.12).toFixed(3),
      shake: clamp(0.18 + energies[i] * 0.5, 0, 0.7) * (type === 'punch' ? 1 : 0.4),
    };
  });

  // ---------------- transitions ----------------
  const heavy = new Set(['zoomblur', 'whip', 'glitch', 'lightleak', 'zoom', 'spin', 'flash']);
  const presetType = preset.transition === 'auto' ? 'cut' : preset.transition;
  let lastHeavy = false;
  cuts.forEach((cut, i) => {
    if (i === 0) return;
    const isDownbeat = (cuts[i - 1].beats % 4 === 0) || (i > 0 && cut.beats >= 4);
    const energyJump = energies[i] - energies[i - 1] > 0.12;
    const isPeak = i === peakIdx;
    let type = 'cut';
    if (isPeak || energyJump) type = pickHeavy(presetType, heavy, rng);
    else if (isDownbeat) type = presetType;
    else type = rng() < 0.25 ? presetType : 'cut';
    if (i === 1 && presetType !== 'cut') type = presetType;
    if (lastHeavy && heavy.has(type) && !isPeak) type = 'cut';
    if (i === cuts.length - 1 && duration > 4) type = presetType === 'cut' ? 'fade' : presetType;
    cut.transition = {
      type,
      dur: type === 'cut' ? 0 : +(preset.transDur * (type === 'flash' ? 0.7 : type === 'fade' ? 1.3 : 1)).toFixed(3),
    };
    lastHeavy = heavy.has(type);
  });
  // no transition on the very first frame
  cuts[0].transition = { type: 'cut', dur: 0 };

  // ---------------- copy / text ----------------
  const copy = buildCopy({
    assets: usable,
    presetId: preset.id,
    lang: S.lang,
    tone: S.tone,
    topic: S.topic,
    customCaption: S.customCaption,
    shots: cuts.length,
    duration,
    seed: seed + 11,
  });

  const overlays = [];
  if (S.hook) {
    overlays.push({
      kind: 'hook',
      text: copy.hook,
      t0: 0,
      t1: +Math.min(preset.intro.dur + 0.4, duration * 0.35).toFixed(3),
      anim: preset.caption.anim,
    });
  }
  if (S.captions && copy.lines.length) {
    const interior = cuts.slice(1, Math.max(2, cuts.length - 1));
    const step = Math.max(1, Math.floor(interior.length / copy.lines.length));
    copy.lines.forEach((text, li) => {
      const cut = interior[(li * step) % interior.length];
      if (!cut) return;
      const maxLen = Math.min(cut.dur * 0.85, 2.6);
      overlays.push({
        kind: 'line',
        text,
        t0: +(cut.t0 + Math.min(0.18, cut.dur * 0.12)).toFixed(3),
        t1: +(cut.t0 + Math.max(0.9, maxLen)).toFixed(3),
        anim: preset.caption.anim,
      });
    });
  }
  if (S.outro) {
    const od = Math.min(preset.outro.dur, Math.max(1.2, duration * 0.18));
    overlays.push({
      kind: 'outro',
      text: copy.cta,
      handle: S.handle ? (S.handle.startsWith('@') ? S.handle : `@${S.handle}`) : '',
      t0: +(duration - od).toFixed(3),
      t1: duration,
      anim: 'fade',
    });
  }

  const plan = {
    version: 1,
    seed,
    preset,
    presetId: preset.id,
    settings: S,
    width,
    height,
    fps,
    duration,
    beats: totalBeats,
    bars,
    bpm: hasBeat ? Math.round(music.bpm) : 100,
    hasBeat,
    music: music ? {
      duration: music.duration,
      bpm: music.bpm,
      confidence: music.confidence,
      startTime: musicStart,
      bufferOffset: music.minStart || 0,
      waveform: music.waveform,
      name: music.name || '',
    } : null,
    musicStart,
    cuts,
    overlays,
    copy,
    meta: {
      shots: cuts.length,
      avgShot: +(duration / cuts.length).toFixed(2),
      transitions: cuts.filter((c) => c.transition.type !== 'cut').length,
      assetsUsed: new Set(cuts.map((c) => c.assetId)).size,
      analysisDone,
    },
    generatedAt: Date.now(),
  };
  return plan;
}

function pickHeavy(presetType, heavy, rng) {
  if (heavy.has(presetType)) return presetType;
  const family = {
    fade: 'lightleak',
    cut: 'zoomblur',
    slide: 'zoom',
  };
  const mapped = family[presetType];
  if (mapped) return mapped;
  return 'zoomblur';
}

/** Re-time an existing plan after the user changes duration/quality (keeps media). */
export function retimePlan(plan, settings) {
  return buildPlan({
    assets: plan.cuts.map((c) => c.asset).filter(Boolean),
    presetId: plan.presetId,
    music: plan._music || null,
    settings: { ...plan.settings, ...settings },
    seed: plan.seed,
  });
}
