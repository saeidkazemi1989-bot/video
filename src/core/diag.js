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
  for (const codec of codecs) {
    try {
      const res = await VE.isConfigSupported({ codec, width: size.width, height: size.height, framerate: fps, bitrate: 8_000_000, avc: { format: 'avc' } });
      if (res?.supported) return { supported: true, codec };
    } catch { /* next */ }
  }
  return { supported: false, reason: 'no-supported-avc-config' };
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

/** One-shot snapshot of everything that decides whether rendering can work. */
export async function deviceReport(win = globalThis, { extra = null } = {}) {
  const nav = win?.navigator || {};
  const scr = win?.screen || {};
  const gl = await probeWebGL(win);
  const enc = await probeEncoder(win);
  const audio = probeAudio(win);
  const storage = await probeStorage(win);
  const cap = win?.Capacitor;
  const swReg = (() => { try { return !!nav.serviceWorker; } catch { return false; } })();

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
    serviceWorker: swReg,
    serviceWorkerActive: (() => { try { return !!nav.serviceWorker?.controller; } catch { return false; } })(),
    storage,
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
  push('serviceWorker', `${report.serviceWorker ? 'yes' : 'no'}${report.serviceWorkerActive ? ' (active)' : ''}`);
  if (report.storage) push('storage', `${report.storage.usageMB}/${report.storage.quotaMB} MB`);
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
    ['تشخیص چهره', report.faceDetector ? 'موتور نیتیو ✓' : 'الگوریتم داخلی'],
    ['سرویس‌ورکر', report.serviceWorker ? (report.serviceWorkerActive ? 'فعال' : 'ثبت‌شده') : 'ندارد'],
    ['حافظهٔ ذخیره', report.storage ? `${report.storage.usageMB} از ${report.storage.quotaMB} مگابایت` : 'نامشخص'],
  ];
  return rows.filter(([, v]) => v !== undefined && v !== null && v !== '');
}
