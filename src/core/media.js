/**
 * Media intake: turns user files (photos / videos) into `Asset` objects with
 * dimensions, duration, a cached thumbnail canvas and edit fields.
 */
import { clamp, uid } from './util.js';

export const THUMB_MAX = 460;

/* ------------------------------------------------------------------ */
/* decoding helpers                                                    */
/* ------------------------------------------------------------------ */

export async function decodeImage(blob, maxDim = 0) {
  const opts = { imageOrientation: 'from-image' };
  if (maxDim) { opts.resizeWidth = maxDim; opts.resizeQuality = 'high'; }
  try {
    return await createImageBitmap(blob, opts);
  } catch (e) {
    // Safari fallback via <img> + object URL
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('خواندن تصویر ناموفق بود'));
        i.src = url;
      });
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
  }
}

export function makeVideoElement(src, { muted = true, crossOrigin } = {}) {
  const v = document.createElement('video');
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.preload = 'auto';
  v.muted = muted;
  v.volume = muted ? 0 : 1;
  if (crossOrigin) v.crossOrigin = crossOrigin;
  v.src = src;
  v.load?.();
  return v;
}

export function waitForEvent(target, type, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const ok = (e) => { if (!done) { done = true; cleanup(); resolve(e); } };
    const bad = () => { if (!done) { done = true; cleanup(); reject(new Error(`رویداد ${type} دریافت نشد`)); } };
    const cleanup = () => {
      target.removeEventListener(type, ok);
      target.removeEventListener('error', bad);
      clearTimeout(timer);
    };
    const timer = setTimeout(bad, timeout);
    target.addEventListener(type, ok, { once: true });
    target.addEventListener('error', bad, { once: true });
  });
}

export async function prepareVideo(el) {
  if (el.readyState >= 2 && el.videoWidth) return el;
  if (el.readyState < 1) await waitForEvent(el, 'loadedmetadata');
  if (el.readyState < 2) await waitForEvent(el, 'loadeddata', 20_000).catch(() => {});
  return el;
}

export function seekVideo(el, time) {
  const target = clamp(time, 0, Math.max(0, (el.duration || 0) - 0.02));
  if (Math.abs((el.currentTime || 0) - target) < 0.004 && el.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('seeked', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2500);
    el.addEventListener('seeked', done, { once: true });
    try { el.currentTime = target; } catch { done(); }
  });
}

/** Draw (and downscale) a bitmap/video element into a fresh canvas. */
export function drawToCanvas(source, maxDim) {
  const sw = source.width || source.videoWidth || 1;
  const sh = source.height || source.videoHeight || 1;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  return c;
}

/** Capture a photo/video frame at `t` seconds into a canvas (max `maxDim`). */
export async function captureFrame(asset, t, maxDim = THUMB_MAX) {
  if (asset.kind === 'photo') {
    if (asset.thumb && maxDim >= asset.thumb.width) return drawToCanvas(asset.thumb, maxDim);
    const bitmap = await decodeImage(asset.file, Math.max(maxDim, 2));
    const c = drawToCanvas(bitmap, maxDim);
    if (bitmap !== asset.thumb) bitmap.close?.();
    return c;
  }
  const el = asset.el || (asset.el = makeVideoElement(asset.objectUrl || URL.createObjectURL(asset.file)));
  await prepareVideo(el);
  await seekVideo(el, t);
  let c = drawToCanvas(el, maxDim);
  if (isLikelyBlank(c)) {
    // iOS sometimes hands back an empty frame until playback has started once.
    try {
      await el.play();
      await new Promise((r) => {
        if (el.requestVideoFrameCallback) el.requestVideoFrameCallback(() => r());
        else setTimeout(r, 120);
      });
      el.pause();
      await seekVideo(el, t + 0.001);
      c = drawToCanvas(el, maxDim);
    } catch { /* keep first attempt */ }
  }
  return c;
}

export function isLikelyBlank(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, Math.min(w, 32), Math.min(h, 32)).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
  return sum / (data.length / 4) < 6;
}

/* ------------------------------------------------------------------ */
/* asset creation                                                      */
/* ------------------------------------------------------------------ */

export function blankAsset(partial = {}) {
  return {
    id: uid('a'),
    kind: 'photo',
    name: 'media',
    size: 0,
    file: null,
    objectUrl: null,
    width: 0,
    height: 0,
    duration: null,
    thumb: null,
    bitmap: null,
    el: null,
    // edit state
    trimIn: 0,
    trimOut: null,
    speed: 1,
    volume: 1,
    muted: false,
    use: true,
    hero: false,
    analysis: null,
    demo: false,
    ...partial,
  };
}

export async function createAssetFromFile(file) {
  const isVideo = file.type.startsWith('video') || /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.name);
  const isImage = file.type.startsWith('image') || /\.(jpe?g|png|webp|heic|heif|avif|gif|bmp)$/i.test(file.name);
  if (!isVideo && !isImage) throw new Error(`فرمت پشتیبانی نمی‌شود: ${file.name}`);

  if (isImage) {
    // decode only once: build the (small) thumbnail, then free the full-res bitmap
    const bitmap = await decodeImage(file);
    const asset = blankAsset({
      kind: 'photo',
      name: file.name,
      size: file.size,
      file,
      width: bitmap.width,
      height: bitmap.height,
    });
    asset.thumb = drawToCanvas(bitmap, THUMB_MAX);
    bitmap.close?.();
    return asset;
  }

  const objectUrl = URL.createObjectURL(file);
  const el = makeVideoElement(objectUrl);
  await prepareVideo(el);
  const duration = Number.isFinite(el.duration) ? el.duration : 0;
  const asset = blankAsset({
    kind: 'video',
    name: file.name,
    size: file.size,
    file,
    objectUrl,
    el,
    width: el.videoWidth,
    height: el.videoHeight,
    duration,
    trimIn: 0,
    trimOut: duration,
    muted: true,
    volume: 0,
  });
  const posterT = Math.min(duration * 0.25, 1.2);
  asset.thumb = await captureFrame(asset, posterT, THUMB_MAX);
  return asset;
}

/** Local blob URL (or data URL) for <img>/background use in the UI. */
export function assetPreviewUrl(asset) {
  if (asset.objectUrl) return asset.objectUrl;
  if (asset.thumb) return asset.thumb.toDataURL('image/jpeg', 0.72);
  return '';
}

/** Usable (trimmed) duration of an asset. */
export function assetDuration(asset) {
  if (asset.kind === 'photo') return null;
  const tIn = asset.trimIn || 0;
  const tOut = (asset.trimOut ?? asset.duration) || 0;
  return Math.max(0.15, (tOut - tIn) / (asset.speed || 1));
}

/** Forget heavy resources (called when leaving a project). */
export function releaseAsset(asset) {
  try { asset.bitmap?.close?.(); } catch { /* noop */ }
  asset.bitmap = null;
  if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
  asset.objectUrl = null;
  asset.el = null;
}
