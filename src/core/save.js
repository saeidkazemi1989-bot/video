/**
 * Saving files where the user can actually find them.
 *
 * In a browser an `<a download>` works. Inside the Capacitor WebView it does
 * nothing at all — which is why a rendered MP4 seemed to vanish. On a device we
 * write the file to the app's Documents folder (visible in the Files app) in
 * base64 chunks, and hand the URI to the system share sheet so it can go straight
 * to the gallery / Instagram.
 *
 * Everything is injectable (plugins + fs) so the whole flow is testable in Node.
 */
import { downloadBlob } from './util.js';
import { recordSave } from './diag.js';

/** Where files land on a device (inside the app's public Documents folder). */
export const SAVE_FOLDER = 'ReelForge';
export const SAVE_DISPLAY = 'Documents/ReelForge';
/** base64 chunk size — small enough to stay friendly to the phone's memory. */
export const CHUNK_BYTES = 3 * 1024 * 1024;

/** Splits a blob into transfer chunks (pure: unit-tested). */
export function sliceBlob(blob, size = CHUNK_BYTES) {
  const out = [];
  if (!blob || !blob.size) return out;
  for (let at = 0; at < blob.size; at += size) out.push(blob.slice(at, Math.min(blob.size, at + size)));
  return out;
}

export function base64ToBytes(b64) {
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
  if (typeof atob === 'function') {
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array();
}

export function blobToBase64(blob) {
  if (typeof FileReader !== 'undefined' && blob instanceof Blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).replace(/^data:[^;]+;base64,/, ''));
      fr.onerror = () => reject(new Error('خواندن فایل برای ذخیره ناموفق بود'));
      fr.readAsDataURL(blob);
    });
  }
  if (typeof blob?.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buf) => bytesToBase64(new Uint8Array(buf)));
  }
  return Promise.resolve('');
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return typeof btoa === 'function' ? btoa(bin) : '';
}

/** True when the app runs inside Capacitor on a device. */
export function isNativeApp(win = globalThis) {
  const cap = win?.Capacitor;
  if (!cap) return false;
  try {
    return typeof cap.isNativePlatform === 'function' ? !!cap.isNativePlatform() : !!cap.platform;
  } catch {
    return false;
  }
}

/**
 * Loads a plugin module. Never resolves to the plugin proxy itself — awaiting
 * that proxy calls an unimplemented `then()` and throws on device/web builds.
 */
async function loadModule(name) {
  try {
    if (name === 'filesystem') return await import('@capacitor/filesystem');
    if (name === 'share') return await import('@capacitor/share');
    if (name === 'core') return await import('@capacitor/core');
  } catch { /* plugin not bundled (web build / tests) */ }
  return null;
}

/**
 * Writes a blob to disk.
 *
 * @returns {Promise<{ok:boolean, method:'files'|'download', uri?:string, path?:string, display?:string, bytes:number, error?:string}>}
 */
export async function saveBlob(blob, filename, {
  win = globalThis,
  filesystem = null,
  directory = null,
  onProgress = null,
  chunkBytes = CHUNK_BYTES,
  download = null,               // injectable for tests
} = {}) {
  const bytes = blob?.size || 0;
  const native = isNativeApp(win);
  if (!native) {
    try { (download || downloadBlob)(blob, filename); } catch (e) { return { ok: false, method: 'download', bytes, error: e?.message || 'download failed' }; }
    return { ok: true, method: 'download', bytes, display: 'پوشهٔ دانلود دستگاه' };
  }

  const mod = await loadModule('filesystem');
  const FS = filesystem || mod?.Filesystem || null;
  const Dir = directory || mod?.Directory?.Documents || 'DOCUMENTS';
  if (!FS?.writeFile || !Dir) {
    // No plugin (e.g. a web-only preview of the native build): be honest about it.
    return { ok: false, method: 'files', bytes, error: 'filesystem-plugin-missing' };
  }

  const path = `${SAVE_FOLDER}/${filename}`;
  const chunks = sliceBlob(blob, chunkBytes);
  try {
    if (!chunks.length) {
      await FS.writeFile({ path, directory: Dir, data: '', encoding: 'utf8', recursive: true });
      return { ok: true, method: 'files', path, display: SAVE_DISPLAY, bytes: 0 };
    }
    let uri = null;
    for (let i = 0; i < chunks.length; i++) {
      const b64 = await blobToBase64(chunks[i]);
      if (i === 0) {
        const res = await FS.writeFile({ path, directory: Dir, data: b64, recursive: true });
        uri = res?.uri || null;
      } else {
        await FS.appendFile({ path, directory: Dir, data: b64 });
      }
      onProgress?.((i + 1) / (chunks.length + 0.35), `ذخیره روی گوشی… ${i + 1} از ${chunks.length}`);
    }
    try {
      const info = await FS.getUri?.({ path, directory: Dir });
      uri = info?.uri || uri;
    } catch { /* optional */ }
    return { ok: true, method: 'files', path, uri, display: SAVE_DISPLAY, bytes };
  } catch (e) {
    return { ok: false, method: 'files', path, bytes, error: e?.message || String(e) };
  }
}

/** The public Documents directory (or its enum value) for plugin calls. */
export async function resolveDirectory() {
  const mod = await loadModule('filesystem');
  return mod?.Directory?.Documents || 'DOCUMENTS';
}

/** Opens the system share sheet for a saved file (gallery, Instagram, WhatsApp…). */
export async function shareSavedFile({ uri = null, blob = null, filename = 'reelforge.mp4', text = '', dialogTitle = 'ذخیره یا اشتراک‌گذاری ریل' } = {}) {
  const [shareMod, coreMod] = [await loadModule('share'), await loadModule('core')];
  const Share = shareMod?.Share;
  if (Share?.share) {
    try {
      let url = uri;
      if (!url && blob) {
        // share the file:// handoff when we have no URI yet
        const Capacitor = coreMod?.Capacitor;
        const saved = await saveBlob(blob, filename);
        url = saved.uri ? (Capacitor?.convertFileSrc ? Capacitor.convertFileSrc(saved.uri) : saved.uri) : null;
      }
      if (url) {
        await Share.share({ title: filename, text, url, dialogTitle });
        return 'shared';
      }
    } catch (e) {
      if (String(e?.message || e).toLowerCase().includes('cancel')) return 'cancelled';
    }
  }
  // browser fallback
  if (typeof navigator !== 'undefined' && navigator.share && blob) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
      await navigator.share({ files: [file], text, title: filename });
      return 'shared';
    } catch { /* fall through */ }
  }
  return 'unsupported';
}

/** One call the UI can use: save, then say exactly where the file went. */
export async function saveWithReport(blob, filename, opts = {}) {
  const res = await saveBlob(blob, filename, opts);
  try { recordSave({ ...res, bytes: res.bytes ?? blob?.size }); } catch { /* diagnostics are best-effort */ }
  res.message = res.ok
    ? (res.method === 'files'
      ? `ذخیره شد در ${res.display}/${filename}`
      : `دانلود شد: ${filename}`)
    : (res.error === 'filesystem-plugin-missing'
      ? 'ذخیره‌سازی روی این دستگاه در دسترس نیست — از اشتراک‌گذاری استفاده کن'
      : `ذخیره نشد: ${res.error || 'خطای نامشخص'}`);
  return res;
}
