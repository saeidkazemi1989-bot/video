/* Small shared helpers: DOM, math, formatting, files. */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b - a === 0 ? 0 : clamp((v - a) / (b - a), 0, 1));

export function smoothstep(e0, e1, x) {
  const t = inv(e0, e1, x);
  return t * t * (3 - 2 * t);
}
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = (2 * Math.PI) / 3;
  return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

/** Deterministic PRNG so a given project always renders the same way. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const randInt = (rng, a, b) => Math.floor(a + rng() * (b - a + 1));
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];
export function shuffle(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Normalise Persian/Arabic text for matching and display: drops harakat and
 * tatweel and unifies the Arabic yeh/kaf with their Persian forms, so a brief
 * typed either way hits the same keywords. ZWNJ (نیم‌فاصله) is preserved —
 * `brief.js` treats it as optional while matching.
 */
export function stripDiacritics(input = '') {
  return String(input)
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u064a\u0649]/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9');
}

export function fmtTime(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
export function faNum(input) {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/\d/g, (d) => map[+d]);
}
export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Tiny hyperscript: el('div', {class:'x', onclick:fn}, [children]) */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list' && k !== 'form' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Copies text to the clipboard, whatever this runtime actually supports.
 *
 * Inside the Android/iOS app `navigator.clipboard` is often missing (or rejects
 * without a user gesture) and the old `execCommand` path needs a *visible*
 * selection, which is why «کپی گزارش» silently did nothing on the phone. Order:
 *   1. Capacitor Clipboard plugin (native, always allowed);
 *   2. the async Clipboard API (browser / PWA);
 *   3. a real, on-screen textarea + execCommand;
 *   4. `select()` and leave the text selected so the user can long-press → copy.
 *
 * @returns {Promise<boolean>} true when the text really reached the clipboard.
 */
export async function copyText(text) {
  const value = String(text ?? '');
  // 1) native plugin — the only path that works reliably in a WebView
  try {
    const mod = await import('@capacitor/clipboard');
    const Clipboard = mod?.Clipboard;
    if (Clipboard?.write) {
      await Clipboard.write({ string: value });
      return true;
    }
  } catch { /* plugin not bundled (web build / tests) — fall through */ }
  // 2) browser clipboard
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* not a secure context, or permission denied */ }
  // 3) execCommand, with the textarea actually laid out (opacity:0 breaks selection)
  try {
    const ta = el('textarea', {
      value,
      readonly: true,
      style: {
        position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
        padding: '0', border: '0', outline: 'none', background: 'transparent', color: 'transparent',
      },
    });
    document.body.append(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange?.(0, value.length);
    const ok = document.execCommand?.('copy');
    ta.remove();
    if (ok) return true;
  } catch { /* ignore */ }
  // 4) give the user something they can copy by hand
  try { selectText(value); } catch { /* ignore */ }
  return false;
}

/**
 * Puts `text` in front of the user, already selected, in a real textarea — the
 * last-resort path when no programmatic clipboard works. Returns the element.
 */
export function selectText(value, { doc = globalThis.document } = {}) {
  if (!doc?.body) return null;
  const ta = doc.createElement('textarea');
  ta.value = String(value ?? '');
  ta.readOnly = true;
  ta.className = 'copybox';
  ta.style.cssText = 'width:100%;min-height:160px;direction:ltr;text-align:left';
  doc.body.append(ta);
  textareaSelectAll(ta);
  return ta;
}

/**
 * Shares plain text through the OS sheet (Telegram, WhatsApp, Mail…). On the
 * phone this is the most reliable way to get a bug report out of the app —
 * no clipboard, no permissions.
 * @returns {Promise<'shared'|'cancelled'|'unsupported'>}
 */
export async function shareText(text, { title = 'گزارش ریل‌فورج', dialogTitle = 'ارسال گزارش' } = {}) {
  const value = String(text ?? '');
  try {
    const mod = await import('@capacitor/share');
    if (mod?.Share?.share) {
      await mod.Share.share({ title, text: value, dialogTitle });
      return 'shared';
    }
  } catch (e) {
    if (/cancel/i.test(String(e?.message || e))) return 'cancelled';
  }
  try {
    if (navigator.share) {
      await navigator.share({ title, text: value });
      return 'shared';
    }
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled';
  }
  return 'unsupported';
}

/** Selects everything inside a textarea (works on Android/iOS WebViews). */
export function textareaSelectAll(ta) {
  try {
    if (!ta) return false;
    ta.focus?.();
    if (typeof ta.setSelectionRange === 'function') {
      ta.setSelectionRange(0, String(ta.value || '').length);
      return true;
    }
    ta.select?.();
    return true;
  } catch { return false; }
}

/** Share files through the OS sheet (on iOS/Android this lists Instagram). */
export async function shareFile(blob, filename, text = '') {
  const file = new File([blob], filename, { type: blob.type || 'video/mp4' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function vibrate(pattern = 8) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

/* ---------- IndexedDB (project + settings persistence) ---------- */
const DB_NAME = 'reelforge';
let dbPromise = null;
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}
export async function idbSet(key, value) {
  const db = await openDB();
  if (!db) return;
  await new Promise((res) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = res; tx.onerror = res;
  });
}
export async function idbGet(key) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((res) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => res(null);
  });
}

/* ---------- misc ---------- */
export function textLinesFrom(str) {
  return String(str || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
export function pct(v) { return `${Math.round(clamp(v, 0, 1) * 100)}%`; }
