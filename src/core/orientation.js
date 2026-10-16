/**
 * Orientation self-healing — «جهت تصویر».
 *
 * The bug the app actually hit on a phone: photos came out upright while videos
 * were 180° flipped, on the same device and with the same shader. The reason is
 * that `UNPACK_FLIP_Y_WEBGL` is applied by the driver *per source type* — an image
 * upload is flipped, a video frame often is not — so relying on it makes preview,
 * export and each media type disagree.
 *
 * The app therefore:
 *   1. never trusts the driver: video frames are drawn into a canvas first
 *      (`drawSourceToScratch`), so every source goes through the same path;
 *   2. measures the result on this very device by rendering a known 4-quadrant
 *      pattern through the real compositor and reading the pixels back
 *      (`probeRenderOrientation`);
 *   3. if the read-back says the frame is mirrored vertically, flips it in the
 *      shader (`uFlipY`) instead of guessing — and remembers the answer.
 *
 * Everything runs offline, once per device, and the outcome is reported in
 * «وضعیت دستگاه» so a wrong-looking frame can be traced without a screenshot.
 */
import { probeRenderOrientation, probeVideoOrientation } from './diag.js';

/** What the current session renders with (1 = the GPU stores textures bottom-up). */
let current = { flipY: 0, status: 'unverified', testedAt: 0, canvas: null, video: null, videoRaw: null, videoNote: '', mode: '', note: '' };

export function getOrientationFix() { return { ...current }; }
export function currentOrientationFlip() { return current.flipY ? 1 : 0; }
export function setOrientationFix(fix = {}) {
  current = { ...current, ...fix };
  return getOrientationFix();
}

/**
 * What a read-back means for the shader flip.
 * @returns {0|1|-1|null} 1 = needs a y-flip, 0 = already right, -1 = unfixable
 *   (a horizontal mirror or a real 180° rotation cannot be cured by flipping v),
 *   null = nothing was readable, so keep whatever we had.
 */
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
  if (fix.status === 'fixed') return `اصلاح شد${mode} — چرخش عمودی در شیدر جبران شد`;
  if (fix.status === 'unfixable') return `نامتعارف${mode} — ${fix.note || 'آینه‌ای افقی است و با تنظیم عمودی رفع نمی‌شود'}`;
  if (fix.status === 'untested') return `بررسی نشد${fix.note ? ` — ${fix.note}` : ''}`;
  return 'بررسی نشده';
}

/**
 * Probes the real render path and returns the correction to use.
 *
 * @param {object} opts
 * @param {string} [opts.via]      'image' (default) or 'video' — which source class to render
 * @param {object} [opts.cached]   a previously learned fix, used when the probe cannot run
 * @param {boolean}[opts.force]    re-measure even when a cached answer exists
 * @param {function}[opts.probe]   injectable for tests
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
  if (!force && cached && cached.flipY !== undefined && cached.testedAt) {
    setOrientationFix({ ...cached, status: cached.status || 'ok' });
    return getOrientationFix();
  }

  const first = await probe(win, doc, { flipY: cached?.flipY || 0, via });
  if (!first || first.ok === undefined || (!first.ok && !first.flippedY && !first.mirroredX && !first.rotated180)) {
    // no WebGL, no read-back, a blank frame… keep the cached answer and say so
    const fix = setOrientationFix({
      flipY: cached?.flipY || 0,
      status: 'untested',
      testedAt: cached?.testedAt || 0,
      mode: first?.mode || '',
      note: first?.reason || 'خواندن پیکسل‌ها ممکن نشد',
      canvas: first?.verdict || '',
    });
    return fix;
  }

  const needed = decideFlipY(first);
  let fix = {
    flipY: needed === 1 ? 1 : 0,
    status: needed === 0 ? 'ok' : needed === 1 ? 'fixed' : 'unfixable',
    testedAt: now(),
    mode: first.mode || '',
    canvas: first.verdict || '',
    note: needed === -1 ? (first.mirroredX ? 'آینه‌ای افقی خوانده شد' : '۱۸۰ درجه چرخیده خوانده شد') : '',
  };

  // confirm the corrected value actually renders upright, and check the video path
  if (needed === 1) {
    const second = await probe(win, doc, { flipY: 1, via });
    fix.confirmed = !!second?.ok;
    if (second && !second.ok) {
      fix.status = 'unfixable';
      fix.note = `بعد از اصلاح هم درست نشد (${second.verdict || second.reason || 'ناشناخته'})`;
    }
  }
  // two more measurements, both informational:
  //  · via:'video' → the canvas path a video frame now goes through
  //  · raw video texture → what the driver does with a <video> on its own, which is
  //    the asymmetry that made photos upright and videos upside down
  const canvasPath = await probe(win, doc, { flipY: fix.flipY, via: 'video' });
  fix.video = canvasPath?.verdict || canvasPath?.reason || '';
  const rawVideo = await videoProbe(win, doc, { flipY: fix.flipY });
  fix.videoRaw = rawVideo?.ok ? 'ok' : (rawVideo?.verdict || rawVideo?.reason || 'untested');
  if (rawVideo && !rawVideo.ok && (rawVideo.flippedY || rawVideo.rotated180) && fix.status !== 'unfixable') {
    fix.videoNote = 'تکسچر ویدیوی خام روی این گوشی برعکس است؛ فریم‌ها از مسیر کانواس آپلود می‌شوند';
  }

  return setOrientationFix(fix);
}

/** Test helper: how a fresh app would start (no learned value). */
export function resetOrientationFix() {
  current = { flipY: 0, status: 'unverified', testedAt: 0, canvas: null, video: null, videoRaw: null, videoNote: '', mode: '', note: '' };
}
