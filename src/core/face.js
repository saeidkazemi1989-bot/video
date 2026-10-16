/**
 * Smart reframe — on-device subject detection.
 *
 * Three layers, all offline:
 *  1. native `FaceDetector` when the browser provides it (Chrome/Android),
 *  2. a deterministic skin-tone blob detector (YCbCr ∪ RGB rules, morphology,
 *     connected components, shape scoring) — works everywhere,
 *  3. a saliency fallback (edge energy × saturation × centre bias) for
 *     products, landscapes and anything without a face.
 *
 * The result is a normalised focus point (0..1, 0..1) plus a confidence, and
 * for videos a smoothed focus *track* so the crop can follow the subject.
 */
import { clamp, smoothstep } from './util.js';

const ANALYSIS_W = 112; // working width for the mask (speed)

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/** Box-downscale ImageData into a small Float-ish record (r,g,b,width,height). */
export function downscale(imageData, targetW = ANALYSIS_W) {
  const { data, width, height } = imageData;
  const scale = Math.min(1, targetW / width);
  const w = Math.max(8, Math.round(width * scale));
  const h = Math.max(8, Math.round(height * scale));
  const out = new Uint8ClampedArray(w * h * 3);
  const xr = width / w;
  const yr = height / h;
  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(y * yr);
    const sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(x * xr);
      const sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * xr));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < width; sx++) {
          const p = (sy * width + sx) * 4;
          r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return { data: out, width: w, height: h };
}

/** Skin mask: YCbCr chroma rule combined with a classic RGB rule. */
export function skinMask(small) {
  const { data, width, height } = small;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const ycbcr = cb >= 76 && cb <= 133 && cr >= 131 && cr <= 179 && y > 30;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const rgbRule = r > 70 && g > 32 && b > 15 && r > g && r >= b && (r - Math.min(g, b)) > 12 && (mx - mn) > 12;
    mask[i] = ycbcr || (rgbRule && y > 25) ? 1 : 0;
  }
  return mask;
}

function morph(mask, w, h, op) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let any = 0, all = 1, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) { n++; continue; }
          const v = mask[ny * w + nx];
          if (v) any = 1; else all = 0;
          n++;
        }
      }
      out[i] = op === 'dilate' ? any : all && n > 0 ? 1 : 0;
    }
  }
  return out;
}

/** Connected components (4-connectivity) with bbox / centroid / fill stats. */
export function components(mask, w, h, minArea = 6) {
  const labels = new Int32Array(mask.length).fill(-1);
  const out = [];
  const stack = new Int32Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = out.length;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = id;
    let area = 0, sx = 0, sy = 0;
    let minX = w, maxX = -1, minY = h, maxY = -1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % w;
      const y = (i - x) / w;
      area++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      const neigh = [i - 1, i + 1, i - w, i + w];
      for (const n of neigh) {
        if (n < 0 || n >= mask.length) continue;
        if (Math.abs((n % w) - x) > 1) continue;   // wrap guard
        if (mask[n] && labels[n] === -1) { labels[n] = id; stack[sp++] = n; }
      }
    }
    if (area < minArea) continue;
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    out.push({
      id, area,
      cx: sx / area / w, cy: sy / area / h,
      x: minX / w, y: minY / h, bw: bw / w, bh: bh / h,
      fill: area / (bw * bh),
      aspect: bh / bw,
      areaRatio: area / (w * h),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* face / subject scoring                                              */
/* ------------------------------------------------------------------ */

function scoreBlob(b, { allowLarge = false } = {}) {
  if (b.areaRatio < 0.0025) return 0;
  if (b.areaRatio > (allowLarge ? 0.6 : 0.28)) return 0;
  if (b.fill < 0.42) return 0;
  if (b.bw < 0.02 || b.bh < 0.02) return 0;
  const aspect = clamp(b.aspect, 0.4, 3.2);
  // a head is taller than wide by roughly 1.1–1.6
  const aspectScore = 1 - Math.min(1, Math.abs(aspect - 1.3) / 0.95);
  const fillScore = smoothstep(0.42, 0.85, b.fill);
  const sizeScore = 1 - Math.min(1, Math.abs(Math.sqrt(b.areaRatio) - 0.28) / 0.38);
  const cx = b.cx - 0.5, cy = b.cy - 0.44;
  const central = 1 - Math.min(1, Math.hypot(cx, cy * 0.9) / 0.55);
  return clamp(0.3 * aspectScore + 0.24 * fillScore + 0.2 * sizeScore + 0.26 * central, 0, 1);
}

/** Saliency: where the eye goes when there is no face. */
export function saliencyFocus(small) {
  const { data, width: w, height: h } = small;
  const scores = new Float32Array(w * h);
  let total = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 3;
      const l = (o) => 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      const c = l(i);
      const gx = Math.abs(l(i + 3) - l(i - 3));
      const gy = Math.abs(l(i + w * 3) - l(i - w * 3));
      const mx = Math.max(data[i], data[i + 1], data[i + 2]);
      const mn = Math.min(data[i], data[i + 1], data[i + 2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      const centerBias = 1 - Math.min(1, Math.hypot(x / w - 0.5, y / h - 0.44) / 0.7);
      const s = (gx + gy) * 0.55 + sat * 40 + centerBias * 26 + Math.abs(c - 128) * 0.05;
      scores[y * w + x] = s;
      total += s;
    }
  }
  if (total <= 0) return { x: 0.5, y: 0.44, score: 0, source: 'salience' };
  // centroid of the strongest 12 % of pixels
  const sorted = Float32Array.from(scores).sort();
  const thresh = sorted[Math.floor(sorted.length * 0.88)] || 0;
  let sx = 0, sy = 0, sw = 0, peak = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const s = scores[y * w + x];
      if (s < thresh) continue;
      const wgt = s - thresh + 1e-3;
      sx += x * wgt; sy += y * wgt; sw += wgt;
      if (s > peak) peak = s;
    }
  }
  const x = sw > 0 ? sx / sw / w : 0.5;
  const y = sw > 0 ? sy / sw / h : 0.44;
  return { x: clamp(x, 0, 1), y: clamp(y, 0, 1), score: clamp(peak / (sorted[sorted.length - 1] || 1), 0, 1), source: 'salience' };
}

/**
 * Main entry: focus point for a single frame.
 * @param {ImageData|{data,width,height}} imageData
 */
export function detectFocus(imageData, { nativeFaces = null } = {}) {
  if (nativeFaces?.length) {
    // prefer a real face detector when the platform has one
    const best = nativeFaces.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
    const cx = (best.x + best.width / 2) / imageData.width;
    const cy = (best.y + best.height / 2) / imageData.height;
    const areaRatio = (best.width * best.height) / (imageData.width * imageData.height);
    return {
      x: clamp(cx, 0, 1),
      y: clamp(cy, 0, 1),
      score: clamp(0.75 + Math.min(0.25, areaRatio * 2), 0, 1),
      source: 'face',
      box: { x: best.x / imageData.width, y: best.y / imageData.height, w: best.width / imageData.width, h: best.height / imageData.height },
      faces: nativeFaces.length,
    };
  }
  const small = downscale(imageData);
  const mask = morph(morph(skinMask(small), small.width, small.height, 'erode'), small.width, small.height, 'dilate');
  const blobs = components(mask, small.width, small.height, Math.max(6, Math.round(small.width * small.height * 0.002)));
  let best = null, bestScore = 0;
  for (const b of blobs) {
    const s = scoreBlob(b);
    if (s > bestScore) { bestScore = s; best = b; }
  }
  if (best && bestScore > 0.42) {
    return {
      x: clamp(best.cx, 0.04, 0.96),
      y: clamp(best.cy, 0.04, 0.96),
      score: bestScore,
      source: 'skin',
      box: { x: best.x, y: best.y, w: best.bw, h: best.bh },
      faces: 1,
    };
  }
  const sal = saliencyFocus(small);
  return { ...sal, faces: 0 };
}

/** Optional native detector (Chrome/Android). Never throws, never blocks long. */
export async function nativeFaceBoxes(source, timeoutMs = 1200) {
  const FD = globalThis.FaceDetector || globalThis.window?.FaceDetector;
  if (!FD || !source) return null;
  try {
    const detector = new FD({ fastMode: true, maxDetectedFaces: 3 });
    const result = await Promise.race([
      detector.detect(source),
      new Promise((r) => setTimeout(() => r(null), timeoutMs)),
    ]);
    if (!result) return null;
    return result.map((f) => f.boundingBox).filter(Boolean);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* focus tracks (video)                                                */
/* ------------------------------------------------------------------ */

export function smoothTrack(points, windowSize = 3) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    let sx = 0, sy = 0, sw = 0;
    for (let k = -windowSize; k <= windowSize; k++) {
      const p = points[clamp(i + k, 0, points.length - 1)];
      const w = 1 / (1 + Math.abs(k));
      sx += p.x * w; sy += p.y * w; sw += w;
    }
    out.push({ t: points[i].t, x: sx / sw, y: sy / sw, source: points[i].source, score: points[i].score });
  }
  return out;
}

/** How much the subject moves through the clip (drives dynamic reframing). */
export function trackTravel(track) {
  if (!track?.length) return 0;
  let max = 0;
  const xs = track.map((p) => p.x), ys = track.map((p) => p.y);
  const dx = Math.max(...xs) - Math.min(...xs);
  const dy = Math.max(...ys) - Math.min(...ys);
  max = Math.hypot(dx, dy);
  return clamp(max, 0, 1);
}

/** Focus point at a given source time using the analysed track. */
export function focusAtTime(analysis, t) {
  const track = analysis?.focusTrack;
  if (track?.length > 1) {
    if (t <= track[0].t) return { x: track[0].x, y: track[0].y };
    const last = track[track.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y };
    for (let i = 1; i < track.length; i++) {
      if (t <= track[i].t) {
        const a = track[i - 1], b = track[i];
        const span = Math.max(1e-3, b.t - a.t);
        const k = (t - a.t) / span;
        // ease so the crop drifts smoothly instead of jumping
        const e = k * k * (3 - 2 * k);
        return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
      }
    }
  }
  const f = analysis?.focus;
  if (Array.isArray(f)) return { x: f[0], y: f[1] };
  if (f && typeof f === 'object' && 'x' in f) return { x: f.x, y: f.y };
  return { x: 0.5, y: 0.42 };
}
