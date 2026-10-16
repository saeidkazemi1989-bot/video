/**
 * Offline speech detection + subtitle timing.
 *
 * `detectSpeechSegments` finds where somebody is talking (adaptive RMS +
 * zero-crossing + spectral-flatness voice activity detection, median smoothed),
 * and `buildSubtitles` lays the words you give it (your own script, the
 * generated caption, or the output of an AI/local Whisper endpoint) across
 * those segments with word-level timings — i.e. real kinetic subtitles that
 * follow the speech, no model download required.
 */
import { clamp } from './util.js';
import { FFT, hannWindow, movingAverage, mean } from './fft.js';

const FRAME_MS = 32;
const HOP_MS = 16;

function toMono(audio, maxSeconds = 240) {
  const sr = audio.sampleRate;
  const len = Math.min(audio.length, Math.round(Math.min(maxSeconds, audio.duration) * sr));
  const out = new Float32Array(len);
  const ch = Math.min(2, audio.numberOfChannels || 1);
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i] / ch;
  }
  return out;
}

function medianFilter(arr, radius = 2) {
  const out = new Float32Array(arr.length);
  const win = [];
  for (let i = 0; i < arr.length; i++) {
    win.length = 0;
    for (let k = -radius; k <= radius; k++) win.push(arr[clamp(i + k, 0, arr.length - 1)]);
    win.sort((a, b) => a - b);
    out[i] = win[Math.floor(win.length / 2)];
  }
  return out;
}

/**
 * Voice activity detection.
 * @returns {{segments: Array<{t0:number,t1:number,energy:number}>, speechRatio:number, noiseFloor:number, frames:{hop:number,rms:Float32Array,zcr:Float32Array,flat:Float32Array}}}
 */
export function detectSpeechSegments(audio, { onProgress, signal } = {}) {
  const sr = audio.sampleRate;
  const mono = toMono(audio);
  const frame = Math.max(128, Math.round((FRAME_MS / 1000) * sr));
  const hop = Math.max(64, Math.round((HOP_MS / 1000) * sr));
  const frames = Math.max(1, Math.floor((mono.length - frame) / hop));
  const rms = new Float32Array(frames);
  const zcr = new Float32Array(frames);
  const flat = new Float32Array(frames);
  const win = hannWindow(2 ** Math.round(Math.log2(frame)));
  const fftSize = win.length;
  const fft = new FFT(fftSize);
  const mag = new Float32Array(fftSize / 2);
  const input = new Float32Array(fftSize);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let sum = 0, zc = 0;
    let prev = 0;
    for (let i = 0; i < frame; i++) {
      const v = mono[off + i] || 0;
      sum += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    rms[f] = Math.sqrt(sum / frame);
    zcr[f] = zc / frame;
    // spectral flatness on every 4th frame (cheap speech/music discriminator)
    if (f % 4 === 0) {
      for (let i = 0; i < fftSize; i++) input[i] = (mono[off + i] || 0) * win[i];
      fft.magnitudes(input, mag);
      let logSum = 0, sumMag = 0, n = 0;
      for (let b = 2; b < mag.length * 0.6; b++) {
        const m = mag[b] + 1e-6;
        logSum += Math.log(m);
        sumMag += m;
        n++;
      }
      const geo = Math.exp(logSum / Math.max(1, n));
      const arith = sumMag / Math.max(1, n);
      flat[f] = clamp(geo / (arith + 1e-9), 0, 1);
    }
    if (f % 4096 === 0) onProgress?.(f / frames);
    if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
  }
  // fill the sparse flatness values
  for (let f = 1; f < frames; f++) if (f % 4) flat[f] = flat[f - 1];

  const rmsSmoothed = medianFilter(rms, 2);
  const sorted = Float32Array.from(rmsSmoothed).sort();
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 1e-5;
  const loud = sorted[Math.floor(sorted.length * 0.97)] || noiseFloor;
  const absFloor = Math.max(0.004, loud * 0.06);
  const thr = Math.max(noiseFloor * 3.2, absFloor);

  const isSpeech = new Uint8Array(frames);
  for (let f = 0; f < frames; f++) {
    const voiced = rmsSmoothed[f] > thr;
    const zcrOk = zcr[f] > 0.012 && zcr[f] < 0.34;
    const flatOk = flat[f] < 0.62;      // speech is peaky, music/noise is flat
    isSpeech[f] = voiced && zcrOk && flatOk ? 1 : 0;
  }
  // close short gaps and drop tiny blips
  const minGap = Math.round(220 / HOP_MS);
  const minRun = Math.round(180 / HOP_MS);
  for (let f = 1; f < frames - 1; f++) {
    if (!isSpeech[f]) {
      let ahead = 0;
      while (f + ahead < frames && !isSpeech[f + ahead] && ahead <= minGap) ahead++;
      if (ahead <= minGap && f + ahead < frames && isSpeech[f + ahead] && isSpeech[f - 1]) isSpeech[f] = 1;
    }
  }
  for (let f = 0; f < frames; f++) {
    if (isSpeech[f]) {
      let run = 0;
      while (f + run < frames && isSpeech[f + run]) run++;
      if (run < minRun) for (let k = 0; k < run; k++) isSpeech[f + k] = 0;
      f += run;
    }
  }

  const segments = [];
  const hopSec = hop / sr;
  let start = -1;
  for (let f = 0; f <= frames; f++) {
    const on = f < frames && isSpeech[f] === 1;
    if (on && start < 0) start = f;
    if (!on && start >= 0) {
      let e = 0;
      for (let k = start; k < f; k++) e += rmsSmoothed[k];
      segments.push({
        t0: +(start * hopSec).toFixed(3),
        t1: +(f * hopSec).toFixed(3),
        energy: +(e / Math.max(1, f - start) / (loud || 1)).toFixed(3),
      });
      start = -1;
    }
  }
  // merge segments separated by < 200 ms
  const merged = [];
  for (const s of segments) {
    const last = merged[merged.length - 1];
    if (last && s.t0 - last.t1 < 0.2) {
      last.t1 = s.t1;
      last.energy = Math.max(last.energy, s.energy);
    } else merged.push({ ...s });
  }
  const speechFrames = merged.reduce((acc, s) => acc + (s.t1 - s.t0), 0);
  return {
    segments: merged,
    speechRatio: clamp(speechFrames / Math.max(0.1, mono.length / sr), 0, 1),
    noiseFloor,
    frames: { hop: hopSec, rms: rmsSmoothed, zcr, flat },
  };
}

function wordWeight(word) {
  // rough syllable estimate: Persian/Arabic vowels + latin vowel groups
  const persianVowels = (word.match(/[اآاوهیي]/g) || []).length;
  const latinVowels = (word.match(/[aeiouy]+/gi) || []).length;
  const base = persianVowels + latinVowels;
  return clamp(0.6 + Math.max(base, Math.max(1, word.length * 0.28)), 0.6, 4.2);
}

/**
 * Lay words over speech segments with word-level timings.
 * @param {Array} segments from detectSpeechSegments
 * @param {string} text the script / caption / transcription
 * @returns {{cues:Array<{t0:number,t1:number,text:string,words:Array<{w:string,t0:number,t1:number}>}>, speechRatio:number}}
 */
export function buildSubtitles(segments, text, { maxWordsPerCue = 5, minCue = 0.7, offset = 0 } = {}) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  if (!segments?.length || !words.length) return { cues: [], speechRatio: 0 };
  const totalDur = segments.reduce((s, x) => s + Math.max(0.12, x.t1 - x.t0), 0);
  const cues = [];

  // distribute words over segments proportionally to spoken duration x energy
  const weights = segments.map((s) => Math.max(0.12, s.t1 - s.t0) * (0.6 + s.energy * 0.7));
  const totalW = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  segments.forEach((seg, si) => {
    const share = Math.round((weights[si] / totalW) * words.length);
    const count = clamp(share, 0, words.length - cursor);
    const chunk = words.slice(cursor, cursor + count);
    cursor += count;
    // last segment absorbs the remainder so nothing is dropped
    if (si === segments.length - 1 && cursor < words.length) chunk.push(...words.slice(cursor));
    if (!chunk.length) return;
    // split the chunk into cues of at most `maxWordsPerCue`
    const segDur = Math.max(0.12, seg.t1 - seg.t0);
    const parts = Math.ceil(chunk.length / maxWordsPerCue);
    const partDur = segDur / parts;
    for (let p = 0; p < parts; p++) {
      const partWords = chunk.slice(p * maxWordsPerCue, (p + 1) * maxWordsPerCue);
      if (!partWords.length) continue;
      const t0 = seg.t0 + p * partDur + offset;
      const t1 = seg.t0 + (p + 1) * partDur + offset;
      const wTotal = partWords.reduce((a, w) => a + wordWeight(w), 0);
      let wCursor = t0;
      const timed = partWords.map((w) => {
        const share = (wordWeight(w) / wTotal) * (t1 - t0);
        const ww = { w, t0: +wCursor.toFixed(3), t1: +(wCursor + share).toFixed(3) };
        wCursor += share;
        return ww;
      });
      cues.push({
        t0: +t0.toFixed(3),
        t1: +t1.toFixed(3),
        text: partWords.join(' '),
        words: timed,
        source: 'vad',
      });
    }
  });
  return { cues, speechRatio: clamp(totalDur / Math.max(0.1, (segments[segments.length - 1]?.t1 || 1)), 0, 1) };
}

/** Map absolute source-audio times onto the reel timeline. */
export function remapCues(cues, { cutStartSrc, cutT0, speed = 1, window = [0, 1] }) {
  return cues
    .map((c) => {
      const t0 = cutT0 + (c.t0 - cutStartSrc) / speed;
      const t1 = cutT0 + (c.t1 - cutStartSrc) / speed;
      return {
        ...c,
        t0,
        t1,
        words: c.words.map((w) => ({
          ...w,
          t0: cutT0 + (w.t0 - cutStartSrc) / speed,
          t1: cutT0 + (w.t1 - cutStartSrc) / speed,
        })),
      };
    })
    .filter((c) => c.t1 > window[0] && c.t0 < window[1]);
}

/** Words per minute — a sanity signal (normal Persian speech ≈ 120–170 wpm). */
export function estimateWpm(cues) {
  if (!cues.length) return 0;
  const words = cues.reduce((acc, c) => acc + c.words.length, 0);
  const dur = cues[cues.length - 1].t1 - cues[0].t0;
  return dur > 0.5 ? Math.round((words / dur) * 60) : 0;
}

export { mean, movingAverage };
