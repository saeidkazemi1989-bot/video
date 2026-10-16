/**
 * Music analysis on device: tempo (BPM), beat grid, energy curve and a
 * suggested in-point. Used so every cut of the reel lands exactly on the beat.
 *
 * Pipeline: STFT -> broadband + low-band spectral flux -> autocorrelation for
 * tempo (with sub-frame peak interpolation) -> phase search weighted towards
 * kick/bass onsets -> Theil–Sen robust grid fit with sub-frame snapping.
 */
import { FFT, hannWindow, movingAverage, autocorr, mean } from './fft.js';
import { clamp } from './util.js';

const FRAME = 2048;
const HOP = 512;
const ENV_HZ = 20;
const MIN_BPM = 55;
const MAX_BPM = 200;

export function decodeAudio(arrayBuffer, sampleRate = 44100) {
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new Ctx(2, 1, sampleRate);
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && typeof p.then === 'function') p.then(resolve).catch(reject);
  });
}

function toMono(audio, maxSeconds) {
  const sr = audio.sampleRate;
  const len = Math.min(audio.length, Math.round((maxSeconds || audio.duration) * sr));
  const out = new Float32Array(len);
  const chCount = Math.min(audio.numberOfChannels, 2);
  for (let c = 0; c < chCount; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i] / chCount;
  }
  return out;
}

/** Two onset envelopes: broadband flux and the low band (kick / bass). */
function onsetEnvelopes(mono, sr) {
  const win = hannWindow(FRAME);
  const fft = new FFT(FRAME);
  const bins = FRAME >> 1;
  const mag = new Float32Array(bins);
  const prev = new Float32Array(bins);
  const frames = Math.max(1, Math.floor((mono.length - FRAME) / HOP));
  const flux = new Float32Array(frames);
  const low = new Float32Array(frames);
  const binHz = sr / FRAME;
  const hiBin = Math.min(bins - 1, Math.round(5000 / binHz));
  const lowBin = Math.max(2, Math.round(180 / binHz));       // ~180 Hz
  const input = new Float32Array(FRAME);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) input[i] = (mono[off + i] || 0) * win[i];
    fft.magnitudes(input, mag);
    let sumFlux = 0, sumLow = 0;
    for (let b = 1; b <= hiBin; b++) {
      const v = Math.log1p(mag[b] * 12);
      const d = v - prev[b];
      if (d > 0) {
        sumFlux += d * (b <= lowBin ? 2.1 : 1);
        if (b <= lowBin) sumLow += d;
      }
      prev[b] = v;
    }
    flux[f] = sumFlux;
    low[f] = sumLow;
  }
  // remove slow drift, keep transients, normalise
  for (const arr of [flux, low]) {
    const slow = movingAverage(arr, 12);
    for (let i = 0; i < arr.length; i++) arr[i] = Math.max(0, arr[i] - slow[i] * 1.02);
    const avg = mean(arr) || 1;
    for (let i = 0; i < arr.length; i++) arr[i] /= avg;
  }
  return { flux, low, fps: sr / HOP };
}

function energyCurve(mono, sr, hz = ENV_HZ) {
  const step = Math.max(1, Math.round(sr / hz));
  const frames = Math.floor(mono.length / step);
  const out = new Float32Array(frames);
  let peak = 1e-6;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = 0; i < step; i++) { const v = mono[f * step + i] || 0; sum += v * v; }
    out[f] = Math.sqrt(sum / step);
    if (out[f] > peak) peak = out[f];
  }
  for (let i = 0; i < frames; i++) out[i] = clamp(out[i] / peak, 0, 1);
  return out;
}

function waveformPeaks(mono, buckets = 320) {
  const out = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(mono.length / buckets));
  let peak = 1e-6;
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    for (let i = 0; i < step; i++) {
      const v = Math.abs(mono[b * step + i] || 0);
      if (v > m) m = v;
    }
    out[b] = m;
    if (m > peak) peak = m;
  }
  for (let b = 0; b < buckets; b++) out[b] = Math.min(1, out[b] / peak);
  return out;
}

/** Parabolic sub-sample peak position around index i. */
function subPeak(arr, i) {
  if (i <= 0 || i >= arr.length - 1) return i;
  const a = arr[i - 1], b = arr[i], c = arr[i + 1];
  const den = a - 2 * b + c;
  if (Math.abs(den) < 1e-9) return i;
  const d = (0.5 * (a - c)) / den;
  return i + clamp(d, -0.5, 0.5);
}

function preferTempo(bpm) {
  const d = Math.log2(bpm / 108);
  return Math.exp(-(d * d) / (2 * 0.42 * 0.42));
}

function estimateTempo(flux, fps) {
  const minLag = Math.max(4, Math.floor((60 / MAX_BPM) * fps));
  const maxLag = Math.min(flux.length - 4, Math.ceil((60 / MIN_BPM) * fps));
  const ac = autocorr(flux, minLag, maxLag);
  let bestLag = minLag, bestScore = -1;
  const raws = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let v = ac[lag];
    if (lag * 2 <= maxLag) v += ac[lag * 2] * 0.35;      // harmonic support
    const half = Math.round(lag / 2);
    if (half >= minLag) v += ac[half] * 0.15;
    const bpm = (60 * fps) / lag;
    const score = v * preferTempo(bpm);
    raws.push(Math.max(0, ac[lag]));
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  // sub-frame refinement of the winning lag
  let lagRefined = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const a = ac[bestLag - 1], b = ac[bestLag], c = ac[bestLag + 1];
    const den = a - 2 * b + c;
    if (Math.abs(den) > 1e-9) lagRefined = bestLag + clamp((0.5 * (a - c)) / den, -0.5, 0.5);
  }
  let bpm = (60 * fps) / lagRefined;
  while (bpm < 65) bpm *= 2;
  while (bpm > 195) bpm /= 2;
  const avgRaw = mean(raws) || 1e-6;
  const peakRaw = Math.max(...raws);
  const confidence = clamp((peakRaw / avgRaw - 1) / 1.6, 0, 1);
  return { bpm, lagRefined, confidence };
}

/** Phase search: which offset puts the strongest kick onsets on the grid. */
function pickPhase(flux, low, fps, periodFrames) {
  const stepFrames = Math.max(6, periodFrames);
  let bestOffset = 0, bestScore = -1;
  const phaseSteps = Math.max(16, Math.round(periodFrames));
  for (let s = 0; s < phaseSteps; s++) {
    const off = (s / phaseSteps) * periodFrames;
    let sum = 0, n = 0;
    for (let t = off; t < flux.length - 1; t += stepFrames) {
      const i = Math.round(t);
      const kick = Math.max(low[i] || 0, (low[i - 1] || 0) * 0.7, (low[i + 1] || 0) * 0.7);
      const any = Math.max(flux[i] || 0, (flux[i - 1] || 0) * 0.7, (flux[i + 1] || 0) * 0.7);
      sum += kick * 1.0 + any * 0.35;
      n++;
    }
    const score = n > 0 ? sum / n : 0;
    if (score > bestScore) { bestScore = score; bestOffset = off; }
  }
  return { bestOffset, bestScore };
}

/** Snap to a sub-frame local peak of the onset envelope. */
function snapPeak(env, tFrames, window) {
  const i0 = Math.round(tFrames);
  let bi = i0, bv = -1;
  for (let k = -window; k <= window; k++) {
    const idx = i0 + k;
    if (idx < 1 || idx >= env.length - 1) continue;
    if (env[idx] > bv) { bv = env[idx]; bi = idx; }
  }
  return { t: subPeak(env, bi), strength: bv };
}

/** Theil–Sen style robust fit: median pairwise slope + median phase. */
function fitGrid(points, guess) {
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (const step of [1, 2, 4, 8, 16, 32]) {
      const j = i + step;
      if (j >= points.length) continue;
      const sl = (points[j] - points[i]) / step;
      if (sl > guess * 0.92 && sl < guess * 1.08) slopes.push(sl);
    }
  }
  slopes.sort((a, b) => a - b);
  let slope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : guess;
  if (!(slope > guess * 0.9 && slope < guess * 1.1)) slope = guess;
  const phases = points.map((t, i) => t - slope * i).sort((a, b) => a - b);
  const intercept = phases.length ? phases[Math.floor(phases.length / 2)] : 0;
  return { slope, intercept };
}

/**
 * Spectral flux peaks a fraction of a window before the audible transient, so
 * every frame-derived time gets this constant correction (≈35 ms at 44.1 kHz).
 */
function onsetLatency(fps) {
  const sampleRate = fps * HOP;
  return (FRAME * 0.75) / sampleRate;
}

function buildGrid(flux, low, fps, periodFrames) {
  const phaseEnv = new Float32Array(flux.length);
  for (let i = 0; i < flux.length; i++) phaseEnv[i] = low[i] * 1.0 + flux[i] * 0.35;
  const { bestOffset, bestScore } = pickPhase(flux, low, fps, periodFrames);
  const win = Math.max(1, Math.round(0.05 * fps));
  const collect = (offset, period) => {
    const pts = [];
    for (let t = offset; t < flux.length - 1; t += period) {
      const { t: snapped } = snapPeak(phaseEnv, t, win);
      pts.push(snapped);
    }
    return pts;
  };
  let model = fitGrid(collect(bestOffset, periodFrames), periodFrames);
  // second pass on the refined grid with a tighter window
  const win2 = Math.max(1, Math.round(0.035 * fps));
  const refined = [];
  for (let k = 0; ; k++) {
    const t = model.intercept + k * model.slope;
    if (t > flux.length - 1) break;
    refined.push(snapPeak(phaseEnv, t, win2).t);
  }
  model = fitGrid(refined, model.slope);
  const latency = onsetLatency(fps);
  const beats = new Float32Array(refined.length);
  for (let i = 0; i < refined.length; i++) {
    beats[i] = Math.max(0, (model.intercept + model.slope * i) / fps + latency);
  }
  return { beats, slope: model.slope, intercept: model.intercept, phaseScore: bestScore };
}

/**
 * The DSP entry point. Accepts anything shaped like an AudioBuffer
 * ({ sampleRate, duration, length, numberOfChannels, getChannelData }).
 */
export function analyzeDecoded(audio, { onProgress, signal, maxAnalyze = 180 } = {}) {
  const started = Date.now();
  onProgress?.(0.3, 'تحلیل ضرب‌آهنگ');
  const sr = audio.sampleRate;
  const mono = toMono(audio, Math.min(maxAnalyze, audio.duration));
  const { flux, low, fps } = onsetEnvelopes(mono, sr);
  onProgress?.(0.6, 'پیدا کردن تمپو');

  const tempo = estimateTempo(flux, fps);
  onProgress?.(0.8, 'قرار دادن شبکه ضرب');

  let grid = buildGrid(flux, low, fps, (60 / tempo.bpm) * fps);
  let bpm = (60 * fps) / grid.slope;
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 220) {
    // fall back to the autocorrelation estimate if the fit went wild
    bpm = tempo.bpm;
    grid = buildGrid(flux, low, fps, (60 / bpm) * fps);
  }
  const beatPeriod = 60 / bpm;

  const energy = energyCurve(mono, sr);
  const waveform = waveformPeaks(mono);
  onProgress?.(0.96, 'آماده');

  // strongest window (for choosing where the reel starts inside the song)
  const winSec = clamp(Math.min(audio.duration, 30), 5, 60);
  const winFrames = Math.round(winSec * ENV_HZ);
  const stride = Math.max(1, Math.round(ENV_HZ * 0.5));
  let bestStart = 0, bestSum = -1;
  let runSum = 0;
  for (let i = 0; i < Math.min(winFrames, energy.length); i++) runSum += energy[i];
  for (let start = 0; start + winFrames <= energy.length; start += stride) {
    if (start > 0) {
      for (let k = 0; k < Math.min(stride, energy.length); k++) {
        runSum -= energy[start - 1 + k] || 0;
        runSum += energy[start - 1 + k + winFrames] || 0;
      }
    }
    if (runSum > bestSum) { bestSum = runSum; bestStart = start / ENV_HZ; }
  }
  // drop: biggest energy surge after the first 20 %
  const smooth = movingAverage(energy, 4);
  let dropTime = 0, bestSurge = -1;
  for (let i = Math.floor(smooth.length * 0.2); i < smooth.length; i++) {
    const surge = smooth[i] - smooth[Math.max(0, i - ENV_HZ)];
    if (surge > bestSurge) { bestSurge = surge; dropTime = i / ENV_HZ; }
  }
  const snapToBeat = (time) => {
    let best = time, d = Infinity;
    for (let i = 0; i < grid.beats.length; i++) {
      const dd = Math.abs(grid.beats[i] - time);
      if (dd < d) { d = dd; best = grid.beats[i]; }
      if (grid.beats[i] > time + 2) break;
    }
    return best;
  };

  return {
    duration: audio.duration,
    sampleRate: sr,
    bpm,
    beatPeriod,
    beats: grid.beats,
    downbeats: grid.beats.filter((_, i) => i % 4 === 0),
    energy,
    energyHz: ENV_HZ,
    waveform,
    confidence: tempo.confidence,
    phaseScore: grid.phaseScore,
    bestStart: snapToBeat(bestStart),
    dropTime,
    analyzed: Math.min(maxAnalyze, audio.duration),
    ms: Date.now() - started,
    buffer: audio,
  };
}

export async function analyzeMusic(file, { onProgress, signal, maxAnalyze = 180 } = {}) {
  onProgress?.(0.05, 'خواندن فایل آهنگ');
  const buf = await file.arrayBuffer();
  if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
  const audio = await decodeAudio(buf);
  onProgress?.(0.25, 'تحلیل ضرب‌آهنگ');
  return analyzeDecoded(audio, { onProgress, signal, maxAnalyze });
}

/** All beats inside [from, to] (times are absolute seconds of the source file). */
export function beatsInRange(music, from, to) {
  const out = [];
  for (let i = 0; i < music.beats.length; i++) {
    const t = music.beats[i];
    if (t >= from - 1e-3 && t <= to + 1e-3) out.push(t);
  }
  return out;
}

export function energyAt(music, time) {
  if (!music?.energy?.length) return 0.5;
  const i = clamp(Math.round(time * music.energyHz), 0, music.energy.length - 1);
  return music.energy[i];
}

export function nearestBeat(music, time, maxDistance = Infinity) {
  if (!music?.beats?.length) return time;
  let best = time, d = Infinity;
  for (let i = 0; i < music.beats.length; i++) {
    const dd = Math.abs(music.beats[i] - time);
    if (dd < d) { d = dd; best = music.beats[i]; }
    if (music.beats[i] > time + (maxDistance === Infinity ? 1 : maxDistance)) break;
  }
  return d <= maxDistance ? best : time;
}
