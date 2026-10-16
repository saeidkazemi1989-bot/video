/**
 * Framing geometry — «قاب‌بندی».
 *
 * Two ways to put a photo/video inside the 9:16 reel frame:
 *   • cover  («پرکردن»)  — fill the frame, cropping the edges (what the app did before)
 *   • contain(«کامل»)    — show the whole picture, with a blurred copy filling the rest
 *
 * The WebGL shader mirrors this maths; the 2D fallback compositor uses these exact
 * functions, so preview and export always agree. Pure functions → unit-tested.
 */
import { clamp } from './util.js';

/** Cover: the source completely covers the output frame (edges get cropped). */
export function coverRect(srcW, srcH, outW, outH, { zoom = 1, focus = [0.5, 0.42], pan = [0, 0] } = {}) {
  const sw = Math.max(1, srcW), sh = Math.max(1, srcH);
  const scale = Math.max(outW / sw, outH / sh) * Math.max(0.05, zoom);
  const w = sw * scale, h = sh * scale;
  const fx = clamp(focus?.[0] ?? 0.5, 0, 1), fy = clamp(focus?.[1] ?? 0.42, 0, 1);
  // the offset *into* the scaled image that the subject sits at …
  const wantX = clamp(fx * w - outW * 0.5, 0, Math.max(0, w - outW));
  const wantY = clamp(fy * h - outH * 0.42, 0, Math.max(0, h - outH));
  // … blended with a small bias towards the centre, then expressed as the
  // *destination* offset of the drawn image (always <= 0 when it overflows).
  const offX = clamp((w - outW) / 2 * 0.35 + wantX * 0.65 + (pan?.[0] || 0), 0, Math.max(0, w - outW));
  const offY = clamp((h - outH) / 2 * 0.35 + wantY * 0.65 + (pan?.[1] || 0), 0, Math.max(0, h - outH));
  return { x: -offX, y: -offY, w, h };
}

/** Contain: the whole source fits inside the frame, centred (nothing is cropped). */
export function containRect(srcW, srcH, outW, outH, { zoom = 1 } = {}) {
  const sw = Math.max(1, srcW), sh = Math.max(1, srcH);
  const scale = Math.min(outW / sw, outH / sh) * clamp(zoom, 0.2, 1);
  const w = sw * scale, h = sh * scale;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

/** Fraction of the frame the contained image occupies (used for the UI hint). */
export function pillowBars(srcW, srcH, outW, outH) {
  const f = containRect(srcW, srcH, outW, outH);
  return { sides: (outW - f.w) / outW, top: (outH - f.h) / outH };
}

export const FRAMINGS = [
  { id: 'fit', label: 'کامل (بدون برش)', hint: 'همهٔ عکس دیده می‌شود، اطرافش پس‌زمینهٔ محو' },
  { id: 'fill', label: 'پرکردن قاب', hint: 'قاب کاملاً پر می‌شود، لبه‌ها برش می‌خورند' },
];
