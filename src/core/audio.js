/**
 * Audio pipeline: decode, mix (music + original clip sound), WAV export and
 * AAC encoding through WebCodecs for the final MP4.
 */
import { clamp } from './util.js';
import { decodeAudio } from './beats.js';

export async function decodeAnyAudio(file) {
  return decodeAudio(await file.arrayBuffer());
}

/**
 * The window a music bed should loop over when the reel is longer than the track.
 * Whole bars (bpm) so the wrap keeps the groove, plus a short seam crossfade.
 * The preview and the export both use this, so they agree.
 */
export function musicLoop({ buffer, bpm = 0, sampleRate = 0 } = {}) {
  const sr = sampleRate || buffer?.sampleRate || 44100;
  const len = buffer?.length || 0;
  if (!len) return { loopLen: 0, barSamples: 0, xfade: 0, loops: false, sampleRate: sr };
  const barSamples = bpm > 45 ? Math.round((4 * 60 / bpm) * sr) : 0;
  let loopLen = len;
  if (barSamples > 0) {
    const bars = Math.floor(len / barSamples);
    if (bars >= 2) loopLen = bars * barSamples;      // drop a trailing partial bar
  }
  const xfade = Math.min(Math.round(0.06 * sr), Math.floor(loopLen / 4));
  return { loopLen, barSamples, xfade, loops: true, sampleRate: sr };
}

/** Build the soundtrack on the timeline. Returns {sampleRate, channels:[L,R], length, loop} */
export async function buildSoundtrack({ music, musicBuffer, musicStart = 0, cuts = [], fps = 30, duck = 0.55, sourceGain = 0.9, fadeIn = 0.5, fadeOut = 1.1, loop = true, bpm = 0 }) {
  const sampleRate = musicBuffer?.sampleRate || 44100;
  const total = cuts.length ? (cuts[cuts.length - 1].t1 || 0) : 0;
  const length = Math.max(1, Math.ceil(total * sampleRate));
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const mCh = musicBuffer?.numberOfChannels || 0;
  const mData = [];
  for (let c = 0; c < Math.min(2, mCh); c++) mData.push(musicBuffer.getChannelData(c));
  const musicLen = musicBuffer?.length || 0;

  // --- music bed: a continuous slice of the track, cut exactly at the cuts ---
  const wrap = loop !== false && musicLen > 0;
  const bed = wrap ? musicLoop({ buffer: musicBuffer, bpm, sampleRate }) : { loopLen: musicLen, barSamples: 0, xfade: 0, loops: false, sampleRate };
  const loopLen = Math.max(1, bed.loopLen || musicLen || 1);
  if (mData.length) {
    // a device-paced generator can produce less music than the reel needs, and the
    // user's own song can simply be shorter — so the bed wraps at a bar boundary
    // with a 60 ms equal-power crossfade instead of falling silent mid-reel.
    const bedL = new Float32Array(loopLen);
    const bedR = new Float32Array(loopLen);
    const n = Math.min(loopLen, musicLen);
    for (let k = 0; k < n; k++) {
      bedL[k] = mData[0][k] || 0;
      bedR[k] = (mData[1] || mData[0])[k] || 0;
    }
    const xfade = wrap ? Math.min(bed.xfade || 0, Math.floor(loopLen / 4)) : 0;
    for (let k = 0; k < xfade; k++) {
      const t = (k + 1) / xfade;
      const g0 = Math.cos(t * Math.PI / 2), g1 = Math.sin(t * Math.PI / 2);
      const j = loopLen - xfade + k;
      bedL[j] = bedL[j] * g0 + (mData[0][k] || 0) * g1;
      bedR[j] = bedR[j] * g0 + ((mData[1] || mData[0])[k] || 0) * g1;
    }
    const startFrame = Math.round(clamp(musicStart, 0, Math.max(0, loopLen / sampleRate - 0.05)) * sampleRate);
    for (let i = 0; i < length; i++) {
      const p = startFrame + i;
      if (p >= loopLen) {
        if (!wrap) break;                    // loop:false keeps the old truncate-and-stop
        const si = p % loopLen;
        L[i] = bedL[si];
        R[i] = bedR[si];
        continue;
      }
      L[i] = bedL[p];
      R[i] = bedR[p];
    }
  }

  // --- original clip sound, remapped through each cut (slow-mo aware) ---
  const clips = cuts.filter((c) => c.asset?.kind === 'video' && !c.asset.muted && (c.asset.volume ?? 0) > 0 && !c.planMute);
  if (clips.length) {
    // pre-decode each unique video's audio once
    const cache = new Map();
    for (const c of clips) {
      const asset = c.asset;
      if (!cache.has(asset.id)) {
        let decoded = null;
        try { decoded = await decodeForAsset(asset); } catch { decoded = null; }
        cache.set(asset.id, decoded);
      }
      c._clipAudio = cache.get(asset.id);
    }
    for (const c of cuts) {
      if (!c._clipAudio) continue;
      const buf = c._clipAudio;
      const chan = [];
      for (let ch = 0; ch < Math.min(2, buf.numberOfChannels); ch++) chan.push(buf.getChannelData(ch));
      const gain = clamp((c.asset.volume ?? 1) * sourceGain, 0, 1.4) * duck;
      const t0 = Math.round(c.t0 * sampleRate);
      const t1 = Math.min(length - 1, Math.round(c.t1 * sampleRate));
      const speed = c.speed || 1;
      for (let i = t0; i <= t1; i++) {
        const local = (i - t0) / sampleRate;
        const srcT = (c.trimIn || 0) + local * speed;
        const si = Math.round(srcT * buf.sampleRate);
        if (si < 0 || si >= buf.length) continue;
        const l = chan[0]?.[si] || 0;
        const r = (chan[1] || chan[0])?.[si] || 0;
        L[i] += l * gain;
        R[i] += r * gain;
      }
    }
  }

  // --- fades + limiter ---
  const fi = Math.round(fadeIn * sampleRate);
  const fo = Math.round(fadeOut * sampleRate);
  for (let i = 0; i < length; i++) {
    let g = 1;
    if (i < fi) g *= i / fi;
    if (i > length - fo) g *= Math.max(0, (length - i) / fo);
    let l = L[i] * g, r = R[i] * g;
    l = Math.tanh(l * 1.05) * 0.97;
    r = Math.tanh(r * 1.05) * 0.97;
    L[i] = l; R[i] = r;
  }
  return { sampleRate, channels: [L, R], length, loop: { ...bed, loopLen, wrapped: wrap && length > loopLen } };
}

/** Copy a window out of a decoded buffer (keeps memory sane for long songs). */
export function sliceAudioBuffer(buffer, startSec, lengthSec) {
  const sr = buffer.sampleRate;
  const start = Math.max(0, Math.round(startSec * sr));
  const len = Math.min(buffer.length - start, Math.round(lengthSec * sr));
  const out = new AudioBuffer({ length: Math.max(1, len), sampleRate: sr, numberOfChannels: buffer.numberOfChannels });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const src = buffer.getChannelData(c).subarray(start, start + len);
    out.copyToChannel(src, c, 0);
  }
  return out;
}

async function decodeForAsset(asset) {
  const res = await fetch(asset.objectUrl || URL.createObjectURL(asset.file));
  const buf = await res.arrayBuffer();
  return decodeAudio(buf);
}

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

export function audioBufferToWav({ sampleRate, channels }) {
  const numCh = channels.length;
  const len = channels[0].length;
  const bytes = len * numCh * 2;
  const ab = new ArrayBuffer(44 + bytes);
  const view = new DataView(ab);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, bytes, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clamp(channels[c][i], -1, 1);
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

export async function encodeAAC({ sampleRate, channels }, { bitrate = 192_000, onProgress } = {}) {
  if (typeof AudioEncoder === 'undefined') throw new Error('WebCodecs AudioEncoder پشتیبانی نمی‌شود');
  const numberOfChannels = channels.length;
  const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate };
  const support = await AudioEncoder.isConfigSupported(config).catch(() => null);
  if (!support?.supported) throw new Error('کدک AAC در این مرورگر پشتیبانی نمی‌شود');

  const chunks = [];
  let meta = null;
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, m) => {
      if (m) meta = m;
      chunks.push({ chunk, meta: m || meta });
      if (!meta && m) meta = m;
    },
    error: (e) => { failure = e; },
  });
  encoder.configure(support.config);

  const FRAME = 1024;
  const total = channels[0].length;
  const interleaved = new Float32Array(FRAME * numberOfChannels);
  for (let off = 0; off < total; off += FRAME) {
    if (failure) break;
    const frames = Math.min(FRAME, total - off);
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numberOfChannels; c++) interleaved[i * numberOfChannels + c] = channels[c][off + i] || 0;
    }
    const data = interleaved.subarray(0, frames * numberOfChannels);
    encoder.encode(new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: frames,
      numberOfChannels,
      timestamp: Math.round((off / sampleRate) * 1e6),
      data: data.slice(0).buffer,
    }));
    if (off % (FRAME * 64) === 0) {
      onProgress?.(off / total);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush().catch(() => {});
  encoder.close();
  if (failure) throw failure;
  onProgress?.(1);
  return { chunks, meta };
}

export function makeMusicPreview(music) {
  return { waveform: music.waveform, bpm: Math.round(music.bpm), confidence: music.confidence, duration: music.duration };
}
