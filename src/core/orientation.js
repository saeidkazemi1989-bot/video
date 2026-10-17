/**
 * Orientation self-healing — «جهت تصویر».
 *
 * The bug this file exists for: on a real phone the photos were upright while the
 * videos were «۱۸۰ درجه چرخیده», in the very same shader. The reason is that
 * `UNPACK_FLIP_Y_WEBGL` is applied by the driver *per source type* — an image
 * upload is flipped, a video frame often is not — so any code that trusts it makes
 * the two media disagree.
 *
 * The app no longer trusts it at all:
 *   1. the flag is forced **off** on every upload; the texture is always top-down
 *      (see gl.js `upload()`), video frames are blitted through a canvas first
 *      (`drawSourceToScratch`) so they take exactly the same path as photos;
 *   2. the shader owns orientation via `uFlipX` / `uFlipY`;
 *   3. the four possible corrections are tried on *this device* by rendering a
 *      known 4-quadrant pattern through the real compositor and reading the
 *      pixels back — the first one that reads upright is remembered.
 *
 * That means photos, videos, preview and export cannot disagree any more, and a
 * device that stores frames upside-down (or mirrored) is corrected instead of
 * being reported as broken.
 */
import { probeRenderOrientation, probeVideoOrientation } from './diag.js';

/**
 * Bumped whenever the texture convention changes. A cached answer from an older
 * build is then re-measured instead of being applied blindly — that is how a
 * phone can be left upside-down forever after an update.
 */
export const ORIENTATION_ALGO = 3;

/** What the current session renders with. */
const fresh = () => ({
  flipX: 0, flipY: 0, algo: ORIENTATION_ALGO,
  status: 'unverified', testedAt: 0,
  canvas: null, video: null, videoRaw: null, videoNote: '',
  mode: '', note: '',
});
let current = fresh();

export function getOrientationFix() { return { ...current }; }
export function currentOrientationFlip() { return current.flipY ? 1 : 0; }
export function currentOrientationFlipX() { return current.flipX ? 1 : 0; }
export function setOrientationFix(fix = {}) {
  current = { ...current, ...fix };
  return getOrientationFix();
}

/**
 * What a read-back means for the shader correction.
 * @returns {{flipX:0|1, flipY:0|1}|null} null = nothing was readable, keep what we had.
 */
export function decideFlip(result) {
  if (!result) return null;
  if (result.ok) return { flipX: 0, flipY: 0 };
  if (result.flippedY) return { flipX: 0, flipY: 1 };
  if (result.mirroredX) return { flipX: 1, flipY: 0 };
  if (result.rotated180) return { flipX: 1, flipY: 1 };
  return null;
}

/** Backwards-compatible helper: only the vertical result, or -1 when a 180/mirror. */
export function decideFlipY(result) {
  if (!result) return null;
  if (result.ok) return 0;
  if (result.flippedY) return 1;
  if (result.mirroredX || result.rotated180) return -1;
  return null;
}

/** Persian one-liner for the device report and the settings row. */
export function orientationReport(fix = current) {
  if (!fix) return 'بررسی نشده';
  const mode = fix.mode ? ` (${fix.mode})` : '';
  if (fix.status === 'ok') return `درست${mode} — بدون اصلاح لازم`;
  if (fix.status === 'fixed') {
    const what = fix.flipX && fix.flipY ? 'چرخش ۱۸۰°' : fix.flipX ? 'آینهٔ افقی' : 'چرخش عمودی';
    return `اصلاح شد${mode} — ${what} در شیدر جبران شد`;
  }
  if (fix.status === 'unfixable') return `نامتعارف${mode} — ${fix.note || 'هیچ‌کدام از چهار حالت جواب نداد'}`;
  if (fix.status === 'untested') return `بررسی نشد${fix.note ? ` — ${fix.note}` : ''}`;
  return 'بررسی نشده';
}

/** The four corrections, in the order a healthy device hits them. */
const CANDIDATES = [
  { flipX: 0, flipY: 0 },
  { flipX: 0, flipY: 1 },
  { flipX: 1, flipY: 0 },
  { flipX: 1, flipY: 1 },
];

/**
 * Probes the real render path and returns the correction to use.
 *
 * @param {object} opts
 * @param {string} [opts.via]    'image' (default) or 'video' — which source class to render
 * @param {object} [opts.cached] a previously learned fix, used when the probe cannot run
 * @param {boolean}[opts.force]  re-measure even when a cached answer exists
 * @param {function}[opts.probe] injectable for tests
 */
export async function ensureOrientationFix({
  win = globalThis,
  doc = win?.document,
  via = 'image',
  cached = null,
  force = false,
  probe = probeRenderOrientation,
  videoProbe = probeVideoOrientation,
  now = () => Date.now(),
} = {}) {
  // A learned value is only usable if it was measured with the current pipeline.
  const usable = cached && cached.algo === ORIENTATION_ALGO && cached.testedAt;
  if (!force && usable) {
    setOrientationFix({ ...cached, status: cached.status || 'ok' });
    return getOrientationFix();
  }

  // Try every correction and keep the first that reads upright. Four 64×64 renders
  // cost a fraction of a frame on the phone and remove all guesswork.
  let chosen = null;
  let first = null;
  let last = null;
  for (const c of CANDIDATES) {
    const r = await probe(win, doc, { flipX: c.flipX, flipY: c.flipY, via });
    if (!first) first = r;
    last = r;
    if (r?.ok) { chosen = c; last = r; break; }
    // No WebGL / no read-back at all: stop after the first attempt, it will not vary.
    if (!r || r.ok === undefined || (!r.flippedY && !r.mirroredX && !r.rotated180)) break;
  }

  if (!chosen) {
    const readable = last && (last.flippedY || last.mirroredX || last.rotated180);
    if (!readable) {
      // nothing readable — keep the cached answer (if it matches this pipeline) and say so
      const keep = usable ? cached : null;
      return setOrientationFix({
        ...fresh(),
        flipX: keep?.flipX || 0,
        flipY: keep?.flipY || 0,
        status: 'untested',
        testedAt: keep?.testedAt || 0,
        mode: last?.mode || first?.mode || '',
        note: last?.reason || first?.reason || 'خواندن پیکسل‌ها ممکن نشد',
        canvas: last?.verdict || first?.verdict || '',
      });
    }
    return setOrientationFix({
      ...fresh(),
      flipX: 0, flipY: 0,
      status: 'unfixable',
      testedAt: now(),
      mode: last.mode || '',
      note: `هیچ‌کدام از چهار حالت درست نشد (${last.verdict || 'ناشناخته'})`,
      canvas: last.verdict || '',
    });
  }

  const fix = {
    ...fresh(),
    flipX: chosen.flipX,
    flipY: chosen.flipY,
    status: chosen.flipX === 0 && chosen.flipY === 0 ? 'ok' : 'fixed',
    confirmed: true,
    testedAt: now(),
    mode: last?.mode || '',
    canvas: last?.verdict || '',
    note: '',
  };

  // Two more measurements, both informational:
  //  · via:'video' → the canvas path a video frame goes through
  //  · raw video texture → what the driver does with a <video> on its own, which is
  //    the asymmetry that made photos upright and videos upside down in older builds.
  const canvasPath = await probe(win, doc, { flipX: fix.flipX, flipY: fix.flipY, via: 'video' });
  fix.video = canvasPath?.verdict || canvasPath?.reason || '';
  const rawVideo = await videoProbe(win, doc, { flipX: fix.flipX, flipY: fix.flipY });
  fix.videoRaw = rawVideo?.ok ? 'ok' : (rawVideo?.verdict || rawVideo?.reason || 'untested');
  if (rawVideo && !rawVideo.ok && (rawVideo.flippedY || rawVideo.rotated180 || rawVideo.mirroredX)) {
    fix.videoNote = 'تکسچر خام ویدیو روی این گوشی کج است؛ فریم‌ها از مسیر کانواس آپلود می‌شوند و این اصلاح روی آن‌ها هم اعمال می‌شود';
  }

  return setOrientationFix(fix);
}

/** Test helper: how a fresh app would start (no learned value). */
export function resetOrientationFix() {
  current = fresh();
}
