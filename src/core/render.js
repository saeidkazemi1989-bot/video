/**
 * Timeline renderer: pulls the right frame from each photo/video, applies the
 * preset grade + motion + transitions through WebGL, then paints the text
 * overlays on top. Used for both live preview and the final export.
 */
import { createGLRenderer, create2DRenderer } from './gl.js';
import { currentOrientationFlip, currentOrientationFlipX } from './orientation.js';
import { drawOverlays, ensureFonts } from './text.js';
import { decodeImage, makeVideoElement, prepareVideo, seekVideo, THUMB_MAX } from './media.js';
import { clamp, lerp, sleep, nextFrame, easeOutCubic, easeOutQuint, mulberry32 } from './util.js';
import { focusAtTime } from './face.js';
import { buildSoundtrack, audioBufferToWav, encodeAAC, musicLoop } from './audio.js';
import { createExporter } from './encode.js';
import { mergeGradeWithAutoLight } from './lighting.js';

/** Motion language per cut -> shader uniforms. */
export function computeMotion(cut, local, W, H, time) {
  const m = cut.motion || { type: 'kenburns', dirX: 0.3, dirY: -0.2, amount: 0.1, shake: 0.2 };
  const p = clamp(local, 0, 1);
  let zoom = 1, panX = 0, panY = 0, rotation = 0;
  const amt = m.amount || 0.1;
  switch (m.type) {
    case 'kenburns':
      zoom = lerp(1.06, 1.06 + amt * 1.2, p);
      panX = -m.dirX * W * amt * (p - 0.5);
      panY = -m.dirY * H * amt * (p - 0.5);
      break;
    case 'kenburns-slow':
      zoom = lerp(1.03, 1.03 + amt * 0.8, p);
      panX = -m.dirX * W * amt * 0.45 * (p - 0.5);
      panY = -m.dirY * H * amt * 0.45 * (p - 0.5);
      break;
    case 'zoomout':
      zoom = lerp(1.04 + amt * 1.5, 1.05, easeOutCubic(p));
      panX = m.dirX * W * amt * 0.3 * (p - 0.5);
      break;
    case 'pan':
      zoom = 1.1 + amt * 0.4;
      panX = -m.dirX * W * amt * 1.5 * (p - 0.5) * 2;
      panY = -m.dirY * H * amt * 0.5 * (p - 0.5) * 2;
      break;
    case 'punch': {
      const punch = 1 - easeOutQuint(clamp(p / 0.55, 0, 1));
      zoom = 1.03 + punch * (0.1 + amt * 0.35);
      panX = -m.dirX * W * amt * 0.25 * (p - 0.5);
      break;
    }
    case 'still':
    default:
      zoom = 1.0;
      break;
  }
  // impact shake on strong moments (decays fast)
  const shakeAmp = (m.shake || 0) * (m.type === 'punch' ? 1 : 0.35);
  if (shakeAmp > 0.01 && p < 0.45) {
    const decay = Math.pow(1 - p / 0.45, 2.2);
    const f = time * 46;
    panX += Math.sin(f * 1.7) * shakeAmp * W * 0.006 * decay;
    panY += Math.cos(f * 2.3) * shakeAmp * H * 0.004 * decay;
    rotation = Math.sin(f * 1.1) * shakeAmp * 0.004 * decay;
  }
  return { zoom, pan: [panX, panY], rotation };
}

export class TimelineRenderer {
  /**
   * @param {object} opts
   * @param {object} opts.plan
   * @param {HTMLCanvasElement} opts.outCanvas
   * @param {number} [opts.scale]  1 = full export resolution
   */
  constructor({ plan, outCanvas, scale = 1, musicBuffer = null }) {
    this.plan = plan;
    this.scale = scale;
    this.out = outCanvas;
    this.ctx = outCanvas.getContext('2d', { alpha: false });
    this.glCanvas = document.createElement('canvas');
    this.musicBuffer = musicBuffer;
    // the kept PCM may be a window of a longer track -> map file time to buffer time
    this.musicOffset = plan.music?.bufferOffset || 0;
    this.bitmaps = new Map();
    this.videos = new Map();
    this.currentCut = -1;
    this.transSnapshot = false;
    this.clockMode = 'playback';
    this.wantSourceAudio = false;
    this.renderer = null;
    this.resize();
  }

  resize() {
    const W = Math.max(2, Math.round(this.plan.width * this.scale));
    const H = Math.max(2, Math.round(this.plan.height * this.scale));
    this.W = W; this.H = H;
    this.out.width = W; this.out.height = H;
    this.glCanvas.width = W; this.glCanvas.height = H;
    this.renderer = createGLRenderer(this.glCanvas, { flipX: currentOrientationFlipX(), flipY: currentOrientationFlip() }) || create2DRenderer(this.glCanvas);
    this.isFallback = !!this.renderer.fallback;
  }

  get useGL() { return !this.isFallback; }

  /* ---------------- media access ---------------- */

  async getImage(asset) {
    const hit = this.bitmaps.get(asset.id);
    if (hit) { hit.last = performance.now(); return hit.bitmap; }
    const bitmap = await decodeImage(asset.file);
    this.bitmaps.set(asset.id, { bitmap, last: performance.now() });
    if (this.bitmaps.size > 6) {
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of this.bitmaps) if (v.last < oldest) { oldest = v.last; oldestKey = k; }
      if (oldestKey && oldestKey !== asset.id) {
        const old = this.bitmaps.get(oldestKey);
        try { old.bitmap.close?.(); } catch { /* noop */ }
        this.bitmaps.delete(oldestKey);
      }
    }
    return bitmap;
  }

  getVideo(asset) {
    let entry = this.videos.get(asset.id);
    if (!entry) {
      const el = asset.el || makeVideoElement(asset.objectUrl || (asset.objectUrl = URL.createObjectURL(asset.file)));
      el.muted = true;
      el.playsInline = true;
      el.loop = false;
      el.preload = 'auto';
      entry = { el, ready: prepareVideo(el) };
      this.videos.set(asset.id, entry);
    }
    entry.last = performance.now();
    if (this.videos.size > 3) {
      let oldestKey = null, oldest = Infinity;
      for (const [k, v] of this.videos) if (v.last < oldest) { oldest = v.last; oldestKey = k; }
      if (oldestKey && oldestKey !== asset.id) {
        const old = this.videos.get(oldestKey);
        try { old.el.pause(); } catch { /* noop */ }
        this.videos.delete(oldestKey);
      }
    }
    return entry;
  }

  pauseAll(exceptId = null) {
    for (const [id, v] of this.videos) {
      if (id === exceptId) continue;
      try { if (!v.el.paused) v.el.pause(); } catch { /* noop */ }
    }
  }

  async beginCut(index, { playing = true } = {}) {
    const cut = this.plan.cuts[index];
    if (!cut?.asset) return;
    this.transSnapshot = false;
    if (cut.asset.kind === 'video') {
      const { el, ready } = this.getVideo(cut.asset);
      await ready.catch(() => {});
      try { el.playbackRate = clamp(cut.speed || 1, 0.25, 4); } catch { /* noop */ }
      this.pauseAll(cut.asset.id);
      const wantSourceAudio = this.wantSourceAudio && !cut.planMute;
      el.muted = !wantSourceAudio;
      if (wantSourceAudio) {
        el.volume = clamp((cut.asset.volume ?? 1) * clamp((this.plan.settings.sourceGain ?? 0.35) * 2.4, 0, 1), 0, 1);
      }
      if (Math.abs(el.currentTime - (cut.trimIn || 0)) > 0.06) await seekVideo(el, cut.trimIn || 0);
      if (playing && this.clockMode === 'playback') {
        try { await el.play(); } catch { this.clockMode = 'seek'; }
      }
    } else {
      this.pauseAll();
      await this.getImage(cut.asset);
    }
  }

  /** Smart reframe: the crop follows the subject through the shot. */
  focusFor(asset, srcTime) {
    if (this.plan.settings?.smartReframe === false) {
      const f = asset.analysis?.focus;
      if (Array.isArray(f)) return f;
      return [0.5, 0.42];
    }
    const f = focusAtTime(asset.analysis, srcTime);
    return [f.x, f.y];
  }

  /** Returns {source, width, height, focus} for the given timeline time. */
  async sourceFor(cut, t) {
    const asset = cut.asset;
    const srcTime = (cut.trimIn || 0) + (t - cut.t0) * (cut.speed || 1);
    const focus = this.focusFor(asset, srcTime);
    if (asset.kind === 'photo') {
      const bmp = await this.getImage(asset);
      return { source: bmp, width: bmp.width || asset.width, height: bmp.height || asset.height, focus };
    }
    const { el, ready } = this.getVideo(asset);
    await ready.catch(() => {});
    const needed = (cut.trimIn || 0) + (t - cut.t0) * (cut.speed || 1);
    if (this.clockMode === 'playback') {
      const now = el.currentTime || 0;
      if (el.readyState < 2) {
        await seekVideo(el, needed);
      } else if (now < needed - 0.055) {
        // the clip has to catch up: play it and wait a moment
        if (el.paused && this.playing) { try { await el.play(); } catch { this.clockMode = 'seek'; } }
        const t0 = performance.now();
        while ((el.currentTime || 0) < needed - 0.012 && performance.now() - t0 < 700 && !el.ended) {
          await sleep(2);
        }
        if (Math.abs((el.currentTime || 0) - needed) > 0.16) await seekVideo(el, needed);
      } else if (now > needed + 0.055) {
        // rendering is slower than playback: freeze the clip so no frame is skipped
        if (!el.paused) el.pause();
        await seekVideo(el, needed);
      }
    } else {
      await seekVideo(el, needed);
    }
    return {
      source: el,
      width: el.videoWidth || asset.width || 1080,
      height: el.videoHeight || asset.height || 1920,
      focus,
    };
  }

  /* ---------------- frame composition ---------------- */

  async renderFrameAt(t, { playing = true } = {}) {
    const plan = this.plan;
    this.playing = playing;
    const time = clamp(t, 0, Math.max(0, plan.duration - 1e-4));
    const cut = plan.cuts.find((c) => time >= c.t0 && time <= c.t1) || plan.cuts[plan.cuts.length - 1];
    if (cut.index !== this.currentCut) {
      this.currentCut = cut.index;
      await this.beginCut(cut.index, { playing });
    }
    const local = cut.dur > 0 ? clamp((time - cut.t0) / cut.dur, 0, 1) : 0;
    const src = await this.sourceFor(cut, time);
    const motion = computeMotion(cut, local, this.W, this.H, time);

    let transition = null;
    const tr = cut.transition;
    if (tr && tr.type !== 'cut' && tr.dur > 0 && time - cut.t0 < tr.dur) {
      if (!this.transSnapshot) {
        this.renderer.snapshotPrev();
        this.transSnapshot = true;
      }
      transition = {
        type: tr.type,
        progress: clamp((time - cut.t0) / tr.dur, 0, 1),
        dir: [cut.motion?.dirX >= 0 ? 1 : -1, cut.motion?.dirY >= 0 ? 1 : -1],
      };
    }

    const grade = mergeGradeWithAutoLight(plan.preset.grade, cut.autoLight, {
      enabled: plan.settings?.autoLight !== false,
    });

    this.renderer.draw({
      source: src.source,
      srcWidth: src.width,
      srcHeight: src.height,
      grade,
      zoom: motion.zoom,
      pan: motion.pan,
      rotation: motion.rotation,
      focus: src.focus,
      transition,
      time,
      letterbox: grade.letterbox || 0,
      framing: plan.settings?.framing === 'fill' ? 0 : 1,   // default: show the whole picture
    });

    this.ctx.drawImage(this.glCanvas, 0, 0, this.W, this.H);
    drawOverlays(this.ctx, plan, time, { preview: this.scale !== 1 });
  }

  /* ---------------- preview playback ---------------- */

  async startPreview({ audioContext, startAt = 0, onTick, onEnd, signal } = {}) {
    await ensureFonts();
    const plan = this.plan;
    let source = null;
    let startTime = 0;
    if (this.musicBuffer && audioContext) {
      source = audioContext.createBufferSource();
      source.buffer = this.musicBuffer;
      const gain = audioContext.createGain();
      gain.gain.value = clamp(plan.settings.musicGain ?? 1, 0, 2);
      source.connect(gain).connect(audioContext.destination);
      startTime = audioContext.currentTime + 0.08 - startAt;
      // the same bar-aligned loop window the export mixes (WebAudio cuts hard at the
      // seam, the export crossfades it — the preview must not fall silent early)
      const bed = musicLoop({ buffer: this.musicBuffer, bpm: plan.music?.bpm || 0 });
      if (bed.loops && plan.duration > bed.loopLen / bed.sampleRate + 0.05) {
        source.loop = true;
        source.loopStart = 0;
        source.loopEnd = bed.loopLen / bed.sampleRate;
      }
      const bufT = clamp(plan.musicStart + startAt - this.musicOffset, 0, Math.max(0, Math.min(this.musicBuffer.duration, bed.loopLen / bed.sampleRate) - 0.05));
      source.start(startTime, bufT);
    }
    // original clip sound is played by the video elements themselves
    this.wantSourceAudio = (plan.settings.sourceGain ?? 0.35) > 0.01;
    for (const cut of plan.cuts) {
      if (cut.asset?.kind === 'video') {
        const { el } = this.getVideo(cut.asset);
        const on = this.wantSourceAudio && !cut.planMute;
        el.muted = !on;
        el.volume = on ? clamp((cut.asset.volume ?? 1) * clamp((plan.settings.sourceGain ?? 0.35) * 2.4, 0, 1), 0, 1) : 0;
      }
    }
    this.previewStart = performance.now() - startAt * 1000;
    const clock = () => (performance.now() - this.previewStart) / 1000;
    let stopped = false;
    this._stopPreview = () => { stopped = true; };
    try {
      while (!stopped && !signal?.aborted) {
        const t = clock();
        if (t >= plan.duration) break;
        await this.renderFrameAt(t);
        onTick?.(t);
        await nextFrame();
      }
    } finally {
      try { source?.stop(); } catch { /* noop */ }
      this.pauseAll();
      this._stopPreview = null;
    }
    if (!signal?.aborted) onEnd?.();
  }

  stopPreview() {
    this._stopPreview?.();
    this.pauseAll();
  }

  /* ---------------- export ---------------- */

  async exportVideo({ onProgress, signal, quality = null, includeAudio = true } = {}) {
    const plan = this.plan;
    await ensureFonts();
    this.wantSourceAudio = false;         // the mix is built separately and muxed as AAC
    for (const v of this.videos.values()) { v.el.muted = true; v.el.volume = 0; }
    if (this.scale !== 1) { this.scale = 1; this.resize(); }

    const hasSourceAudio = plan.cuts.some((c) => c.asset?.kind === 'video' && !c.planMute && (c.asset.volume ?? 1) > 0);
    let soundtrack = null;
    if (includeAudio && (this.musicBuffer || hasSourceAudio)) {
      onProgress?.(0.01, 'ساخت موسیقی و میکس صدا…');
      soundtrack = await buildSoundtrack({
        musicBuffer: this.musicBuffer,
        bpm: plan.music?.bpm || 0,
        musicStart: Math.max(0, (plan.musicStart || 0) - this.musicOffset),
        cuts: plan.cuts.map((c) => ({ ...c, asset: c.asset })),
        duck: this.musicBuffer ? (plan.preset.music?.duck ?? 0.5) : 1,
        sourceGain: this.musicBuffer ? clamp(plan.settings.sourceGain ?? 0.3, 0, 1.5) : 1,
        fadeIn: 0.4,
        fadeOut: Math.min(1.2, plan.duration * 0.1),
      });
    }

    let audioChunks = null;
    if (soundtrack) {
      onProgress?.(0.03, 'کدگذاری صدا…');
      try {
        const { chunks } = await encodeAAC(soundtrack, {
          bitrate: 192_000,
          onProgress: (p) => onProgress?.(0.03 + p * 0.06, 'کدگذاری صدا…'),
        });
        audioChunks = chunks;
      } catch (e) {
        console.warn('audio encode failed', e);
        onProgress?.(0.09, 'صدا کدگذاری نشد — ویدیو بدون صدا ساخته می‌شود');
      }
    }

    const bitrate = quality?.bitrate || 9_000_000;
    const exporter = await createExporter({
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      bitrate,
      audio: audioChunks?.length
        ? { sampleRate: soundtrack.sampleRate, numberOfChannels: 2 }
        : null,
    });
    if (audioChunks?.length) exporter.addAudio(audioChunks);

    const fps = plan.fps;
    const total = Math.max(1, Math.round(plan.duration * fps));
    this.clockMode = 'playback';
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('لغو شد', 'AbortError');
      const t = i / fps;
      await this.renderFrameAt(t);
      await exporter.addFrame(this.out, i, fps);
      if (i % 3 === 0 || i === total - 1) {
        onProgress?.(0.09 + (i / total) * 0.9, `رندر فریم ${i + 1} از ${total}`);
        await sleep(0); // let the UI breathe
      }
    }
    onProgress?.(0.99, 'نهایی‌سازی فایل…');
    const blob = await exporter.finish();
    this.pauseAll();
    return {
      video: blob,
      wav: soundtrack ? audioBufferToWav(soundtrack) : null,
      config: exporter.config,
    };
  }

  dispose() {
    this.stopPreview();
    for (const v of this.videos.values()) v.el.pause?.();
    this.videos.clear();
    for (const b of this.bitmaps.values()) { try { b.bitmap.close?.(); } catch { /* noop */ } }
    this.bitmaps.clear();
  }
}
