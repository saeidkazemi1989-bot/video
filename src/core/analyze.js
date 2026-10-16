/**
 * On-device media analysis. No network, no model downloads:
 * every asset gets measured for exposure, contrast, colour, sharpness and
 * (for video) motion + a suggested in-point. The director uses these numbers
 * to choose styles, order shots and place cuts.
 */
import { clamp, inv, mulberry32, smoothstep } from './util.js';
import { captureFrame, drawToCanvas } from './media.js';
import { detectFocus, smoothTrack, trackTravel, nativeFaceBoxes } from './face.js';

const ANALYSIS_MAX = 160;

function canvasStats(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  const luma = new Float32Array(n);
  let sumL = 0, sumS = 0, sumWarm = 0, clipHi = 0, clipLo = 0;
  let rSum = 0, gSum = 0, bSum = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    rSum += r; gSum += g; bSum += b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx === 0 ? 0 : (mx - mn) / mx;
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luma[i] = l;
    sumL += l; sumS += sat; sumWarm += (r - b) / 255;
    if (mx > 250) clipHi++;
    if (mx < 6) clipLo++;
  }
  const meanL = sumL / n;

  // contrast
  let varL = 0;
  for (let i = 0; i < n; i++) { const d = luma[i] - meanL; varL += d * d; }
  const contrast = Math.sqrt(varL / n);

  // sharpness + focus point (Sobel-ish gradient energy)
  let edge = 0, ex = 0, ey = 0, ew = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + w] - luma[i - w];
      const m = Math.hypot(gx, gy);
      edge += m;
      ex += m * x; ey += m * y; ew += m;
    }
  }
  const sharpness = edge / Math.max(1, (w - 2) * (h - 2));

  // edge density (how "busy" the frame is)
  let edgeCount = 0, edgeSum = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = luma[i + 1] - luma[i - 1];
      const gy = luma[i + w] - luma[i - w];
      const m = Math.hypot(gx, gy);
      edgeSum += m;
      if (m > 0.16) edgeCount++;
    }
  }
  const edgeDensity = edgeCount / Math.max(1, (w - 2) * (h - 2));

  // 3 dominant colours from a coarse 4x4x4 histogram
  const bins = new Map();
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const key = ((data[p] >> 6) << 4) | ((data[p + 1] >> 6) << 2) | (data[p + 2] >> 6);
    const b = bins.get(key) || { c: 0, r: 0, g: 0, b: 0 };
    b.c++; b.r += data[p]; b.g += data[p + 1]; b.b += data[p + 2];
    bins.set(key, b);
  }
  const colors = [...bins.values()]
    .sort((a, b) => b.c - a.c)
    .slice(0, 3)
    .map((b) => [Math.round(b.r / b.c), Math.round(b.g / b.c), Math.round(b.b / b.c)]);

  return {
    luma: meanL,
    contrast,
    saturation: sumS / n,
    warmth: sumWarm / n,
    clipHi: clipHi / n,
    clipLo: clipLo / n,
    avgColor: [Math.round(rSum / n), Math.round(gSum / n), Math.round(bSum / n)],
    sharpness,
    edgeDensity,
    edgeMean: edgeSum / Math.max(1, (w - 2) * (h - 2)),
    focus: { x: ew > 0 ? ex / ew / w : 0.5, y: ew > 0 ? ey / ew / h : 0.42 },
    colors,
    toneCurve: buildToneCurve(luma, n),
  };
}

/** 16-bucket luminance histogram (used to auto-fix exposure in the grade). */
function buildToneCurve(luma, n) {
  const hist = new Float32Array(16);
  for (let i = 0; i < n; i++) hist[Math.min(15, Math.floor(luma[i] * 16))]++;
  for (let i = 0; i < 16; i++) hist[i] /= n;
  return Array.from(hist);
}

function frameDifference(a, b) {
  const ca = a.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, a.width, a.height).data;
  const cb = b.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, b.width, b.height).data;
  const n = Math.min(ca.length, cb.length);
  let sum = 0, count = 0;
  for (let i = 0; i < n; i += 4) {
    sum += Math.abs(ca[i] - cb[i]) + Math.abs(ca[i + 1] - cb[i + 1]) + Math.abs(ca[i + 2] - cb[i + 2]);
    count++;
  }
  return sum / Math.max(1, count * 3) / 255; // 0..1
}

export function qualityScore(stats, motion = null) {
  const sharp = smoothstep(0.012, 0.075, stats.sharpness);
  const contrast = smoothstep(0.08, 0.26, stats.contrast);
  const exposure = 1 - clamp(stats.clipHi * 2.2, 0, 1) * 0.7 - clamp(stats.clipLo * 1.6, 0, 1) * 0.5;
  const colorfulness = smoothstep(0.06, 0.3, stats.saturation);
  const busy = 1 - clamp(stats.edgeDensity * 2.2, 0, 1) * 0.35;
  let score = 0.34 * sharp + 0.24 * contrast + 0.2 * exposure + 0.14 * colorfulness + 0.08 * busy;
  if (motion !== null) {
    const motionScore = 1 - Math.min(1, Math.abs(motion - 0.32) / 0.68);
    score = score * 0.82 + motionScore * 0.18;
  }
  return clamp(score, 0, 1);
}

export function moodOf(stats, motion = null) {
  const { luma, saturation, warmth, contrast } = stats;
  if (luma < 0.24) return 'night';
  if (warmth > 0.07 && luma > 0.42 && saturation > 0.2) return 'golden';
  if (saturation < 0.16 && contrast > 0.2) return 'mono';
  if (saturation > 0.4 && contrast > 0.16) return 'vivid';
  if (motion !== null && motion > 0.5) return 'action';
  if (contrast > 0.24) return 'moody';
  return 'clean';
}

/** Where should the crop look? (face → skin blob → saliency) */
export function focusFromCanvas(canvas, ctx2d = null) {
  try {
    const ctx = ctx2d || canvas.getContext('2d', { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return detectFocus(imageData);
  } catch {
    return { x: 0.5, y: 0.42, score: 0, source: 'salience', faces: 0 };
  }
}

function focusToTuple(f) {
  return [clamp(f.x, 0, 1), clamp(f.y, 0, 1)];
}

/**
 * Analyse one asset. For videos we sample several frames to estimate motion and
 * find the most interesting in-point.
 */
export async function analyzeAsset(asset, { signal, onProgress } = {}) {
  const start = performance.now();
  if (asset.kind === 'photo') {
    const canvas = await captureFrame(asset, 0, ANALYSIS_MAX);
    const stats = canvasStats(canvas);
    let focus = focusFromCanvas(canvas);
    const native = await nativeFaceBoxes(canvas).catch(() => null);
    if (native?.length) focus = detectFocus(canvas.getContext('2d'), { nativeFaces: native });
    const analysis = {
      ...stats,
      motion: null,
      score: qualityScore(stats),
      mood: moodOf(stats),
      samples: 1,
      focus: focusToTuple(focus),
      focusSource: focus.source,
      faces: focus.faces || 0,
      focusTrack: [{ t: 0, x: focus.x, y: focus.y, source: focus.source, score: focus.score }],
      reframe: { travel: 0, dynamic: false },
      ms: Math.round(performance.now() - start),
    };
    asset.analysis = analysis;
    onProgress?.(1);
    return analysis;
  }

  const dur = asset.duration || 0;
  const count = clamp(Math.round(dur / 1.2) + 2, 3, 8);
  const times = [];
  for (let i = 0; i < count; i++) times.push(clamp(((i + 0.5) / count) * dur, 0.05, Math.max(0.1, dur - 0.06)));

  const frames = [];
  const statsList = [];
  const focusPoints = [];
  for (let i = 0; i < times.length; i++) {
    if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
    const c = await captureFrame(asset, times[i], ANALYSIS_MAX);
    frames.push(c);
    statsList.push(canvasStats(c));
    // smart reframe: where is the subject in this frame?
    let focus = focusFromCanvas(c);
    if (i < 2) {
      const native = await nativeFaceBoxes(c).catch(() => null);
      if (native?.length) focus = detectFocus(c.getContext('2d'), { nativeFaces: native });
    }
    focusPoints.push({ t: times[i], x: focus.x, y: focus.y, source: focus.source, score: focus.score, faces: focus.faces || 0 });
    onProgress?.((i + 1) / times.length);
  }

  let motion = 0;
  for (let i = 1; i < frames.length; i++) motion += frameDifference(frames[i - 1], frames[i]);
  motion = motion / Math.max(1, frames.length - 1);

  const avg = (key) => statsList.reduce((s, x) => s + x[key], 0) / statsList.length;
  const merged = {
    luma: avg('luma'),
    contrast: avg('contrast'),
    saturation: avg('saturation'),
    warmth: avg('warmth'),
    clipHi: avg('clipHi'),
    clipLo: avg('clipLo'),
    sharpness: avg('sharpness'),
    edgeDensity: avg('edgeDensity'),
    edgeMean: avg('edgeMean'),
    focus: statsList[0].focus,
    colors: statsList[0].colors,
    avgColor: statsList[0].avgColor,
    toneCurve: statsList[0].toneCurve,
  };
  merged.motion = motion;

  // best in-point: strongest average sharpness over a ~2.5s window, cheap scan
  const winCount = Math.max(1, Math.min(frames.length - 1, Math.round(2.5 / Math.max(0.6, dur / frames.length))));
  let bestI = 0, bestVal = -1;
  for (let i = 0; i + winCount <= frames.length; i++) {
    let v = 0;
    for (let k = 0; k < winCount; k++) v += statsList[i + k].sharpness + statsList[i + k].contrast * 0.4;
    v /= winCount;
    if (v > bestVal) { bestVal = v; bestI = i; }
  }
  const suggestedIn = times[bestI] ?? 0;

  // smooth the focus track so the crop drifts with the subject instead of jumping
  const track = smoothTrack(focusPoints, 2);
  const travel = trackTravel(track);
  const bestFocus = track.reduce((a, b) => (b.score > a.score ? b : a), track[0]);
  const faces = Math.max(...track.map((p) => p.faces || 0), 0);
  const analysis = {
    ...merged,
    score: qualityScore(merged, motion),
    mood: moodOf(merged, motion),
    samples: frames.length,
    suggestedIn,
    focus: [bestFocus.x, bestFocus.y],
    focusSource: bestFocus.source,
    faces,
    focusTrack: track,
    reframe: { travel, dynamic: travel > 0.12 },
    ms: Math.round(performance.now() - start),
  };
  asset.analysis = analysis;
  return analysis;
}

/** Analyse a whole library with progress + a small concurrency limit. */
export async function analyzeAll(assets, { onProgress, signal } = {}) {
  const list = assets.filter((a) => a.use);
  let done = 0;
  const results = [];
  const queue = list.slice();
  const workers = new Array(Math.min(3, queue.length || 1)).fill(0).map(async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
      const asset = queue.shift();
      try {
        results.push(await analyzeAsset(asset, { signal }));
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        asset.analysis = null;
        results.push(null);
      }
      done++;
      onProgress?.(done / list.length, asset);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Rank helper used by the planner: better assets first, mild jitter for variety. */
export function rankAssets(assets, seed = 1) {
  const rng = mulberry32(seed);
  return assets
    .map((a, i) => ({ a, i, key: (a.analysis?.score ?? 0.4) + rng() * 0.06 }))
    .sort((x, y) => y.key - x.key)
    .map((x) => x.a);
}

export { canvasStats as _canvasStats, drawToCanvas, inv };
