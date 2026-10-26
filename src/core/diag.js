/**
 * Device diagnostics — «گزارش دستگاه».
 *
 * The phone is the only place some of this stack actually runs (WebGL2 driver,
 * WebCodecs encoder, native FaceDetector…), so when a screen fails there we need
 * the environment in the report, not a screenshot of one line of text.
 *
 * Everything here is pure and injectable so it can be tested in Node.
 */
import { APP_VERSION } from './update.js';
import { createGLRenderer, NEUTRAL_GRADE, drawSourceToScratch } from './gl.js';

const RING = 12;
const errors = [];

/** Remembers the last few failures so an error card can show them. */
export function recordError(error, where = '') {
  const text = typeof error === 'string' ? error : (error?.message || String(error || ''));
  const entry = { where, text, at: Date.now() };
  errors.push(entry);
  if (errors.length > RING) errors.shift();
  return entry;
}
export const lastErrors = () => errors.slice();

const renders = [];
const saves = [];
const music = [];

/** Remembers how the last export went (frames, wall time, effective fps). */
export function recordRender(stats = {}) {
  const frames = Number(stats.frames) || 0;
  const seconds = Math.round((Number(stats.ms) || 0) / 100) / 10;
  const entry = {
    frames,
    seconds,
    fps: Math.round(((stats.fps || (seconds > 0 ? frames / seconds : 0)) || 0) * 10) / 10 || null,
    quality: stats.quality || '',
    renderer: stats.renderer || '',
    at: Date.now(),
  };
  renders.push(entry);
  if (renders.length > 3) renders.shift();
  return entry;
}
export const lastRenders = () => renders.slice();

/** Remembers how the last music build went (device speed, plan, phase, error). */
export function recordMusicBuild(stats = {}) {
  const entry = {
    genre: stats.genre || '',
    wanted: Number(stats.wanted) || 0,
    seconds: Math.round((Number(stats.ms) || 0) / 100) / 10,
    speed: stats.speed ? Math.round(stats.speed * 10) / 10 : null,
    plan: stats.plan || '',
    phase: stats.phase || '',
    ok: stats.ok !== false,
    error: stats.error || '',
    at: Date.now(),
  };
  music.push(entry);
  if (music.length > 3) music.shift();
  return entry;
}
export const lastMusicBuilds = () => music.slice();

/** Remembers where the last file went (so a report proves whether saving worked). */
export function recordSave(result = {}) {
  const entry = {
    ok: !!result.ok,
    method: result.method || '',
    path: result.path || '',
    display: result.display || '',
    bytes: Number(result.bytes) || 0,
    error: result.error || '',
    at: Date.now(),
  };
  saves.push(entry);
  if (saves.length > 3) saves.shift();
  return entry;
}
export const lastSaves = () => saves.slice();

/* ------------------------------------------------------------------ */
/* capability probes                                                   */
/* ------------------------------------------------------------------ */

async function probeWebGL(win) {
  const doc = win?.document;
  if (!doc?.createElement) return null;
  try {
    const canvas = doc.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const gl = canvas.getContext('webgl2');
    if (!gl) return { ok: false, reason: 'webgl2-unavailable' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      ok: true,
      vendor: (dbg && gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '',
      renderer: (dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '',
      version: gl.getParameter(gl.VERSION) || '',
      glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || '',
      highpFragment: !!gl.getShaderPrecisionFormat?.(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      floatBlend: !!gl.getExtension('EXT_float_blend'),
      floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    };
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    return info;
  } catch (e) {
    return { ok: false, reason: e?.message || 'webgl-probe-failed' };
  }
}

/** Video-encoding support for the sizes a Reel actually needs. */
export async function probeEncoder(win, size = { width: 1080, height: 1920 }, fps = 30) {
  const VE = win?.VideoEncoder;
  const VF = win?.VideoFrame;
  if (typeof VE === 'undefined' || typeof VF === 'undefined') return { supported: false, reason: 'no-webcodecs' };
  const codecs = ['avc1.640028', 'avc1.4d0028', 'avc1.42E032', 'avc1.42E028'];
  const modes = [['hardware', { hardwareAcceleration: 'prefer-hardware' }], ['default', {}]];
  for (const [mode, extra] of modes) {
    for (const codec of codecs) {
      try {
        const res = await VE.isConfigSupported({ codec, width: size.width, height: size.height, framerate: fps, bitrate: 8_000_000, avc: { format: 'avc' }, ...extra });
        if (res?.supported) return { supported: true, codec, mode };
      } catch { /* next */ }
    }
  }
  return { supported: false, reason: 'no-supported-avc-config' };
}

/** Real worker state — "the API exists" tells nobody anything. */
export async function probeServiceWorker(win = globalThis) {
  const nav = win?.navigator;
  if (!nav || !('serviceWorker' in nav)) return 'unsupported';
  try {
    const regs = (await nav.serviceWorker.getRegistrations?.()) || [];
    if (!regs.length) return 'not-registered';
    return nav.serviceWorker.controller ? 'active' : 'registered';
  } catch {
    return 'unknown';
  }
}

export function probeAudio(win) {
  const OAC = win?.OfflineAudioContext;
  return {
    audioContext: typeof win?.AudioContext !== 'undefined',
    offlineAudioContext: typeof OAC !== 'undefined',
    sampleRate: OAC ? 48000 : null,
  };
}

export async function probeStorage(win) {
  try {
    const est = await win?.navigator?.storage?.estimate?.();
    if (!est) return null;
    return { quotaMB: Math.round((est.quota || 0) / 1048576), usageMB: Math.round((est.usage || 0) / 1048576) };
  } catch {
    return null;
  }
}

/**
 * The reference pattern: four quadrants, asymmetric on both axes so a vertical
 * mirror, a horizontal mirror and a 180° rotation are all distinguishable.
 */
function paintQuadrants(ctx, size) {
  const h = size / 2;
  const paint = (x, y, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, h, h); };
  paint(0, 0, '#ff0000');        // top-left   red
  paint(h, 0, '#00ff00');        // top-right  green
  paint(0, h, '#0000ff');        // bottom-l   blue
  paint(h, h, '#ffffff');        // bottom-r   white
}

/** Renders that pattern through the real compositor and reads the corners back. */
function renderAndClassify({ doc, source, srcSize = 16, flipX = 0, flipY = 0, via = 'image' }) {
  const out = doc.createElement('canvas');
  out.width = 64; out.height = 64;
  const renderer = createGLRenderer(out, { flipX, flipY });
  if (!renderer) return { ok: false, reason: 'no-webgl' };
  renderer.resize(64, 64);
  renderer.draw({
    source, srcWidth: srcSize, srcHeight: srcSize, grade: NEUTRAL_GRADE,
    zoom: 1, pan: [0, 0], rotation: 0, focus: [0.5, 0.5],
    transition: null, time: 0, letterbox: 0, framing: 0,
  });
  return { renderer, out };
}

function readCorners({ doc, out, renderer, flipX, flipY, via }) {
  const grab = doc.createElement('canvas');
  grab.width = 64; grab.height = 64;
  const gctx = grab.getContext('2d');
  if (!gctx?.getImageData) return { ok: false, reason: 'no-readback' };
  gctx.drawImage(out, 0, 0);
  const px = (x, y) => {
    try {
      const d = gctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    } catch { return null; }
  };
  const corners = { topLeft: px(10, 10), topRight: px(53, 10), bottomLeft: px(10, 53), bottomRight: px(53, 53) };
  return { ...classifyQuadrants(corners, renderer.fallback ? '2d' : 'webgl2'), flipX: renderer.flipX, flipY: renderer.flipY, via, corners };
}

/**
 * Draws a known 4-quadrant pattern through the real GL compositor and reads the
 * pixels back. This is how we prove — on the actual phone — that the shader is
 * neither flipped nor shifted, without a screenshot or a second device.
 *
 * @param {'image'|'video'} [opts.via] 'video' routes the pattern through the exact
 *   canvas path a video frame takes (see drawSourceToScratch).
 */
export async function probeRenderOrientation(win = globalThis, doc = win?.document, { flipX = 0, flipY = 0, via = 'image' } = {}) {
  if (!doc?.createElement) return { ok: false, reason: 'no-document' };
  try {
    const SRC = 16;
    const src = doc.createElement('canvas');
    src.width = SRC; src.height = SRC;
    const sctx = src.getContext('2d');
    if (!sctx) return { ok: false, reason: 'no-2d' };
    paintQuadrants(sctx, SRC);

    let source = src;
    if (via === 'video') {
      const scratch = drawSourceToScratch(src, doc, { w: SRC, h: SRC });
      if (scratch) source = scratch;
    }
    const { renderer, out, reason } = renderAndClassify({ doc, source, srcSize: SRC, flipX, flipY, via });
    if (!renderer) return { ok: false, reason };
    return readCorners({ doc, out, renderer, flipX, flipY, via });
  } catch (e) {
    return { ok: false, reason: e?.message || 'probe-failed' };
  }
}

/**
 * The same read-back, but with a *real* <video> texture: the pattern canvas is
 * piped through captureStream into a video element and rendered raw. That is how
 * the app found out that this driver flips an image upload but not a video frame —
 * the exact reason photos were upright while videos were «۱۸۰ درجه چرخیده».
 * Best-effort: returns {ok:false, reason} wherever captureStream is unavailable.
 */
export async function probeVideoOrientation(win = globalThis, doc = win?.document, { flipX = 0, flipY = 0, timeoutMs = 1600 } = {}) {
  if (!doc?.createElement) return { ok: false, reason: 'no-document' };
  try {
    const SRC = 16;
    const src = doc.createElement('canvas');
    src.width = SRC; src.height = SRC;
    const sctx = src.getContext('2d');
    if (!sctx) return { ok: false, reason: 'no-2d' };
    paintQuadrants(sctx, SRC);
    if (typeof src.captureStream !== 'function') return { ok: false, reason: 'no-capture-stream' };

    const video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    const stream = src.captureStream(10);
    video.srcObject = stream;
    try { await video.play?.(); } catch { /* autoplay rules — the frame may still arrive */ }

    const gotFrame = await new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      const timer = setTimeout(() => finish(false), timeoutMs);
      if (typeof video.requestVideoFrameCallback === 'function') {
        video.requestVideoFrameCallback(() => { clearTimeout(timer); finish(true); });
      } else {
        setTimeout(() => { clearTimeout(timer); finish((video.readyState || 0) >= 2); }, Math.min(400, timeoutMs));
      }
    });
    if (!gotFrame) return { ok: false, reason: 'no-video-frame' };

    const w = video.videoWidth || SRC, h = video.videoHeight || SRC;
    const { renderer, out, reason } = renderAndClassify({ doc, source: video, srcSize: w, flipX, flipY, via: 'raw-video' });
    if (!renderer) return { ok: false, reason };
    const result = readCorners({ doc, out, renderer, flipX, flipY, via: 'raw-video' });
    try { video.pause?.(); } catch { /* ignore */ }
    try { video.srcObject = null; stream.getTracks?.().forEach((t) => t.stop?.()); } catch { /* ignore */ }
    return result;
  } catch (e) {
    return { ok: false, reason: e?.message || 'video-probe-failed' };
  }
}

const EXPECTED = { topLeft: [255, 0, 0], topRight: [0, 255, 0], bottomLeft: [0, 0, 255], bottomRight: [255, 255, 255] };
const near = (c, t, tol = 70) => Array.isArray(c) && Math.abs(c[0] - t[0]) < tol && Math.abs(c[1] - t[1]) < tol && Math.abs(c[2] - t[2]) < tol;

/** Decides what a read-back of the test pattern means (pure → unit-tested). */
export function classifyQuadrants(corners = {}, mode = 'webgl2') {
  const got = (k) => corners[k];
  const ok = Object.keys(EXPECTED).every((k) => near(got(k), EXPECTED[k]));
  const swappedY = { topLeft: 'bottomLeft', bottomLeft: 'topLeft', topRight: 'bottomRight', bottomRight: 'topRight' };
  const swappedX = { topLeft: 'topRight', topRight: 'topLeft', bottomLeft: 'bottomRight', bottomRight: 'bottomLeft' };
  const flippedY = Object.keys(EXPECTED).every((k) => near(got(k), EXPECTED[swappedY[k]]));
  const mirroredX = Object.keys(EXPECTED).every((k) => near(got(k), EXPECTED[swappedX[k]]));
  const rotated180 = Object.keys(EXPECTED).every((k) => near(got(k), EXPECTED[swappedY[swappedX[k]]]));
  const sawAny = Object.values(corners).some((c) => Array.isArray(c) && (c[0] || c[1] || c[2]));
  return {
    ok,
    mode,
    flippedY,
    mirroredX,
    rotated180,
    blank: !sawAny && !ok,
    corners,
    verdict: ok ? 'درست' : rotated180 ? '۱۸۰ درجه چرخیده' : flippedY ? 'وارونه' : mirroredX ? 'آینه‌ای' : 'خوانده نشد',
  };
}

/** One-shot snapshot of everything that decides whether rendering can work. */
export async function deviceReport(win = globalThis, { extra = null, context = null } = {}) {
  const nav = win?.navigator || {};
  const scr = win?.screen || {};
  const gl = await probeWebGL(win);
  const enc = await probeEncoder(win);
  const audio = probeAudio(win);
  const storage = await probeStorage(win);
  const cap = win?.Capacitor;
  const workers = await probeServiceWorker(win);
  const orientation = await probeRenderOrientation(win, win?.document);

  const report = {
    app: `ReelForge ${APP_VERSION}`,
    platform: cap?.getPlatform?.() || cap?.platform || 'web',
    native: !!cap?.isNativePlatform?.(),
    userAgent: String(nav.userAgent || '').slice(0, 220),
    language: nav.language || '',
    cores: nav.hardwareConcurrency || 0,
    memoryGB: nav.deviceMemory || null,
    screen: scr.width && scr.height ? `${scr.width}×${scr.height} @${win?.devicePixelRatio || 1}x` : '',
    webgl2: gl,
    encoder: enc,
    audio,
    faceDetector: typeof win?.FaceDetector !== 'undefined',
    serviceWorker: workers,
    orientation,
    storage,
    context: context || null,
    renders: lastRenders(),
    saves: lastSaves(),
    musicBuilds: lastMusicBuilds(),
    extras: extra,
    errors: lastErrors().slice(-4).map((e) => `${e.where ? `${e.where}: ` : ''}${e.text}`),
    at: new Date().toISOString(),
  };
  return report;
}

/** Compact, copy-pasteable text version (what goes on the clipboard). */
export function reportText(report = {}) {
  const lines = [];
  const push = (k, v) => { if (v !== null && v !== undefined && v !== '') lines.push(`${k}: ${v}`); };
  push('app', report.app);
  push('platform', `${report.platform}${report.native ? ' (native)' : ' (browser)'}`);
  push('screen', report.screen);
  push('cores/mem', `${report.cores || '?'} cores${report.memoryGB ? `, ${report.memoryGB}GB` : ''}`);
  const gl = report.webgl2;
  push('webgl2', !gl ? 'unknown' : gl.ok
    ? `ok · ${gl.renderer || gl.vendor} · ${gl.glsl} · highp=${gl.highpFragment ? 'yes' : 'no'} · maxTex=${gl.maxTexture}`
    : `FAILED (${gl.reason})`);
  push('encoder', report.encoder?.supported ? `ok (${report.encoder.codec})` : `unsupported (${report.encoder?.reason || '?'})`);
  push('audio', `OAC=${report.audio?.offlineAudioContext ? 'yes' : 'no'}`);
  push('faceDetector', report.faceDetector ? 'native' : 'skin-blob fallback');
  push('serviceWorker', report.serviceWorker || 'unknown');
  if (report.orientation) {
    push('renderOrientation', report.orientation.ok
      ? `ok (${report.orientation.mode})`
      : `WRONG — ${report.orientation.verdict}${report.orientation.reason ? ` (${report.orientation.reason})` : ''} [${JSON.stringify(report.orientation.corners)}]`);
  }
  if (report.storage) push('storage', `${report.storage.usageMB}/${report.storage.quotaMB} MB (browser space)`);
  if (report.context) {
    const c = report.context;
    push('stage', c.stage);
    push('assets', c.assets);
    if (c.brief) push('brief', c.brief);
    if (c.orientation) push('orientation', c.orientation);
    if (c.videoTexture) push('video-texture', c.videoTexture);
    push('plan', [c.duration ? `duration=${c.duration}s` : '', c.cutMode ? `cutMode=${c.cutMode}` : '',
      c.framing ? `framing=${c.framing}` : '', c.autoLight !== undefined ? `autoLight=${c.autoLight ? 'on' : 'off'}` : '',
      c.order ? `order=${c.order}` : '', c.quality ? `quality=${c.quality}` : '', c.fps ? `fps=${c.fps}` : '',
      c.preset ? `preset=${c.preset}` : '', c.music ? `music=${c.music}` : ''].filter(Boolean).join(' '));
  }
  for (const r of report.renders || []) {
    push('render', `${r.frames} frames in ${r.seconds}s${r.fps ? ` (${r.fps} fps)` : ''}${r.quality ? ` · ${r.quality}` : ''}${r.renderer ? ` · ${r.renderer}` : ''}`);
  }
  for (const sv of report.saves || []) {
    push('save', sv.ok ? `ok · ${sv.method} · ${sv.display || sv.path || ''}` : `FAILED (${sv.error})`);
  }
  for (const m of report.musicBuilds || []) {
    push('music', `${m.genre} · ${m.seconds}s · ${m.speed ? `${m.speed}x realtime · ` : ''}${m.plan}${m.ok ? '' : ` · FAILED at "${m.phase}" (${m.error})`}`);
  }
  push('ua', report.userAgent);
  if (report.extras && Object.keys(report.extras).length) push('extras', JSON.stringify(report.extras));
  if (report.errors?.length) {
    lines.push('recent errors:');
    for (const e of report.errors) lines.push(`  - ${e}`);
  }
  lines.push(`at: ${report.at}`);
  return lines.join('\n');
}

/** Human-readable lines for the diagnostics sheet. */
export function reportRows(report = {}) {
  const gl = report.webgl2;
  const rows = [
    ['نسخهٔ اپ', report.app],
    ['پلتفرم', `${report.platform}${report.native ? ' (نیتیو)' : ' (مرورگر)'}`],
    ['صفحه', report.screen],
    ['پردازنده/حافظه', `${report.cores || '؟'} هسته${report.memoryGB ? ` · ${report.memoryGB}GB` : ''}`],
    ['گرافیک (WebGL2)', !gl ? 'نامشخص' : gl.ok ? `فعال — ${gl.renderer || gl.vendor || 'نامشخص'}` : `غیرفعال (${gl.reason})`],
    ['GLSL', gl?.ok ? `${gl.glsl}${gl.highpFragment ? ' · highp ✓' : ' · highp ✗'}` : '—'],
    ['کدگذار ویدیو', report.encoder?.supported ? `فعال — ${report.encoder.codec}` : `غیرفعال (${report.encoder?.reason || '؟'})`],
    ['صدا', report.audio?.offlineAudioContext ? 'OfflineAudioContext ✓' : 'محدود'],
    ['تشخیص چهره', report.faceDetector ? 'موتور نیتیو ✓' : 'الگوریتم داخلی (رنگ پوست)'],
    ['سرویس‌ورکر', ({ active: 'فعال', registered: 'ثبت‌شده', 'not-registered': 'غیرفعال', unsupported: 'پشتیبانی نمی‌شود' })[report.serviceWorker] || 'نامشخص'],
    ['جهت تصویر در رندر', report.orientation
      ? (report.orientation.ok ? `درست (${report.orientation.mode === '2d' ? 'کمپوزیتور ۲D' : 'WebGL2'})` : `اشتباه — ${report.orientation.verdict}`)
      : 'نامشخص'],
    ['حافظهٔ ذخیره', report.storage ? `${report.storage.usageMB} از ${report.storage.quotaMB} مگابایت (فضای مرورگر)` : 'نامشخص'],
  ];
  const c = report.context;
  if (c) {
    rows.push(
      ['مرحله', c.stage || '—'],
      ['رسانه', c.assets || '—'],
      ['تنظیمات تدوین', [
        c.cutMode === 'sequence' ? 'پشت‌سرهم (بدون برش)' : '',
        c.framing === 'fill' ? 'پرکردن قاب' : 'کامل',
        c.order === 'smart' ? 'ترتیب هوشمند' : 'ترتیب خودم',
        c.autoLight === false ? 'نور خام' : '',
        c.quality || '', c.fps ? `${c.fps} فریم` : '', c.preset || '', c.music || ''].filter(Boolean).join(' · ')],
    );
    if (c.brief) rows.push(['هدف کلیپ', c.brief]);
    if (c.orientation) rows.push(['جهت تصویر (عکس/ویدیو)', c.orientation]);
    if (c.videoTexture) rows.push(['تکسچر ویدیو', c.videoTexture]);
  }
  if (report.renders?.length) {
    const r = report.renders.at(-1);
    rows.push(['آخرین رندر', `${r.frames} فریم در ${r.seconds} ثانیه${r.fps ? ` (${r.fps} فریم/ثانیه)` : ''}${r.renderer ? ` · ${r.renderer}` : ''}`]);
  }
  if (report.saves?.length) {
    const sv = report.saves.at(-1);
    rows.push(['آخرین ذخیره', sv.ok ? `موفق — ${sv.display || sv.path}` : `ناموفق (${sv.error})`]);
  }
  if (report.musicBuilds?.length) {
    const m = report.musicBuilds.at(-1);
    rows.push(['آخرین ساخت آهنگ', m.ok
      ? `${m.seconds} ثانیه${m.speed ? ` (${m.speed}× سرعت واقعی)` : ''}${m.plan ? ` · ${m.plan}` : ''}`
      : `ناموفق در «${m.phase}» — ${m.error}`]);
  }
  rows.push(['کدگذار', report.encoder?.supported ? `فعال — ${report.encoder.codec}${report.encoder.mode === 'hardware' ? ' (سخت‌افزاری)' : ''}` : 'غیرفعال']);
  return rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
}
