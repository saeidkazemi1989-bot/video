/**
 * Update engine — «بروزرسانی».
 *
 * Decides what the update button has to do:
 *   • web / PWA  → a new service worker is waiting ⇒ soft reload into the new build
 *   • Android/iOS app → a newer GitHub Release exists ⇒ download/install the new APK
 *
 * Everything here is pure logic: the network call is injected, so the whole
 * decision tree is testable without a browser.
 */

/** Injected by vite (`define`) from package.json; the fallback keeps Node tests happy. */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev';

export const REPO = 'saeidkazemi1989-bot/video';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
export const LATEST_RELEASE_PAGE = `${RELEASES_PAGE}/latest`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/* ------------------------------------------------------------------ */
/* version maths                                                       */
/* ------------------------------------------------------------------ */

/** 'v1.2.3' | '1.2' | '1.2.3-beta.1' → { parts:[1,2,3], pre:'beta.1' } (null when unparsable) */
export function parseVersion(input) {
  const raw = String(input ?? '').trim().replace(/^v/i, '');
  if (!raw) return null;
  const m = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+](.+))?$/);
  if (!m) return null;
  return {
    parts: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)],
    pre: m[4] || '',
    text: raw,
  };
}

/** -1 | 0 | 1 — a release with a `-beta` suffix sorts *below* the same plain version. */
export function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A && !B) return 0;
  if (!A) return -1;
  if (!B) return 1;
  for (let i = 0; i < 3; i++) {
    if (A.parts[i] !== B.parts[i]) return A.parts[i] < B.parts[i] ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;   // 1.2.0 > 1.2.0-beta
  if (!B.pre) return -1;
  return A.pre < B.pre ? -1 : 1;
}

export function isNewer(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

/** '۱٫۲٫۳' — Persian digits with the Arabic decimal separator. */
export function faVersion(v) {
  return String(v ?? '')
    .replace(/^v/i, '')
    .replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d])
    .replace(/\./g, '٫');
}

/* ------------------------------------------------------------------ */
/* payloads                                                            */
/* ------------------------------------------------------------------ */

export const isApkName = (name = '') => /\.apk$/i.test(String(name));

/** Newest `.apk` asset of a release, if it ships one. */
export function pickApkAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const apks = assets.filter((a) => a && isApkName(a.name || a.browser_download_url || ''));
  if (!apks.length) return null;
  const preferred = apks.find((a) => /latest|debug|release/i.test(a.name || '')) || apks[0];
  return { name: preferred.name || 'reelforge.apk', url: preferred.browser_download_url || preferred.url || '', size: preferred.size || 0 };
}

/**
 * GitHub `releases/latest` payload → `{ version, name, notes, url, apkUrl … }`.
 * Drafts / pre-releases are ignored (they are not what users should install).
 */
export function normalizeRelease(json) {
  if (!json || typeof json !== 'object') return null;
  if (json.draft || json.prerelease) return null;
  const version = String(json.tag_name || json.name || '').replace(/^v/i, '').trim();
  if (!parseVersion(version)) return null;
  const apk = pickApkAsset(json);
  return {
    version,
    tag: json.tag_name || `v${version}`,
    name: json.name || json.tag_name || version,
    notes: String(json.body || '').trim().slice(0, 800),
    url: json.html_url || (version ? `${RELEASES_PAGE}/tag/v${version}` : LATEST_RELEASE_PAGE),
    apkUrl: apk?.url || '',
    apkName: apk?.name || '',
    apkSize: apk?.size || 0,
    publishedAt: json.published_at || '',
    source: 'github',
  };
}

/**
 * Self-hosted manifest: `{ "version": "1.2.0", "apk": "https://…/app.apk", "notes": "…" }`
 * (`apk` may also be an object `{ url, name, size }` — both spellings are accepted.)
 */
export function normalizeCustom(json) {
  if (!json || typeof json !== 'object') return null;
  const version = String(json.version || json.tag || json.tag_name || '').replace(/^v/i, '').trim();
  if (!parseVersion(version)) return null;
  const apk = json.apk && typeof json.apk === 'object' ? json.apk : { url: json.apk || json.apkUrl || '' };
  return {
    version,
    tag: json.tag || `v${version}`,
    name: json.name || version,
    notes: String(json.notes || json.body || '').trim().slice(0, 800),
    url: json.url || json.page || LATEST_RELEASE_PAGE,
    apkUrl: apk.url || '',
    apkName: apk.name || (apk.url ? String(apk.url).split('/').pop() : ''),
    apkSize: Number(apk.size || 0) || 0,
    publishedAt: json.date || json.published_at || '',
    source: 'custom',
  };
}

/* ------------------------------------------------------------------ */
/* environment                                                         */
/* ------------------------------------------------------------------ */

/** 'android' | 'ios' | 'web' — how the app is running right now. */
export function platformOf(win = globalThis) {
  const cap = win?.Capacitor;
  const p = String(cap?.getPlatform?.() || cap?.platform || '').toLowerCase();
  if (p === 'android') return 'android';
  if (p === 'ios') return 'ios';
  if (cap?.isNativePlatform?.()) return p || 'native';
  return 'web';
}

export const isNative = (win = globalThis) => platformOf(win) !== 'web';

/** Opens a URL outside the WebView when possible (browser tab / system browser). */
export function openExternal(url, win = globalThis) {
  if (!url) return 'none';
  const browser = win?.Capacitor?.Plugins?.Browser;
  if (browser?.open) {
    try { browser.open({ url }); return 'browser'; } catch { /* fall through */ }
  }
  if (typeof win?.open === 'function') {
    try {
      const handle = win.open(url, '_blank', 'noopener,noreferrer');
      if (handle) return 'window';
    } catch { /* fall through */ }
  }
  if (win?.location) { try { win.location.href = url; return 'location'; } catch { /* ignore */ } }
  return 'none';
}

/* ------------------------------------------------------------------ */
/* checking                                                            */
/* ------------------------------------------------------------------ */

const TIMEOUT = Symbol('timeout');

function withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMEOUT), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Human explanation for a failed check (used by the sheet). */
export function explainError(error) {
  const code = String(error || '');
  if (!code) return '';
  if (code === 'offline' || code === 'network' || code === 'Failed to fetch' || code === 'no-fetch') return 'اینترنت در دسترس نیست — بررسی نسخه ممکن نشد.';
  if (code === 'timeout') return 'پاسخی از سرور نیامد (مهلت تمام شد).';
  if (code === 'http-404' || code === 'bad-payload') return 'مخزن خصوصی است؛ برای بررسی خودکار نسخه، آدرس بروزرسانی را در همین صفحه وارد کن یا صفحهٔ دانلود را باز کن.';
  if (code.startsWith('http-403')) return 'گیت‌هاب اجازهٔ بررسی خودکار نداد (محدودیت نرخ درخواست).';
  return `بررسی نسخه ناموفق بود (${code}).`;
}

/**
 * Looks for a newer build.
 *
 * @param {object}   o
 * @param {string}   o.current      version currently running
 * @param {Function} o.fetchImpl    fetch work-alike (injected for tests)
 * @param {string}   o.customUrl    user-supplied JSON manifest (checked first)
 * @param {object}   o.headers      extra headers (e.g. a token for a private repo)
 * @param {number}   o.timeoutMs
 * @returns {Promise<{ok:boolean,current:string,latest:object|null,hasUpdate:boolean,url:string,apkUrl:string,notes:string,source:string,error:string,checkedAt:number}>}
 */
export async function checkForUpdate({
  current = APP_VERSION,
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  customUrl = '',
  headers = {},
  timeoutMs = 9000,
  now = Date.now,
} = {}) {
  const result = {
    ok: false,
    current,
    latest: null,
    hasUpdate: false,
    url: LATEST_RELEASE_PAGE,
    apkUrl: '',
    notes: '',
    source: '',
    error: '',
    checkedAt: (typeof now === 'function' ? now : () => now)(),
  };
  if (!fetchImpl) { result.error = 'no-fetch'; return result; }

  const sources = [];
  if (customUrl) sources.push({ id: 'custom', url: customUrl, kind: 'custom' });
  sources.push({ id: 'github', url: LATEST_RELEASE_API, kind: 'release' });

  let error = '';
  for (const src of sources) {
    try {
      const res = await withTimeout(
        fetchImpl(src.url, {
          cache: 'no-store',
          headers: { accept: 'application/json', 'user-agent': 'ReelForge', ...headers },
        }),
        timeoutMs,
      );
      if (res === TIMEOUT) { error = 'timeout'; continue; }
      if (!res || !res.ok) { error = `http-${res?.status ?? 0}`; continue; }
      const json = await res.json();
      const info = src.kind === 'release' ? normalizeRelease(json) : normalizeCustom(json);
      if (!info) { error = 'bad-payload'; continue; }
      result.ok = true;
      result.source = info.source;
      result.latest = info;
      result.hasUpdate = isNewer(info.version, current);
      result.url = info.url || result.url;
      result.apkUrl = info.apkUrl || '';
      result.notes = info.notes || '';
      result.error = '';
      return result;
    } catch (e) {
      error = e?.name === 'AbortError' ? 'timeout' : (e?.message === 'Failed to fetch' ? 'offline' : (e?.message || 'network'));
    }
  }
  result.error = error || 'network';
  return result;
}

/* ------------------------------------------------------------------ */
/* web build detection (works even when the repo is private)            */
/* ------------------------------------------------------------------ */

/** Hash of the JS bundle this page is actually running, e.g. 'index-BqDkpcj7.js'. */
export function runningAssetName(doc = globalThis.document, perf = globalThis.performance) {
  try {
    const entries = perf?.getEntriesByType?.('resource') || [];
    const hit = entries.map((e) => e.name).find((n) => /\/assets\/[^/]*index-[A-Za-z0-9_-]+\.js(\?|$)/.test(n));
    if (hit) return hit.split('/').pop().split('?')[0];
  } catch { /* ignore */ }
  try {
    const scripts = doc ? Array.from(doc.querySelectorAll('script[src]')) : [];
    const src = scripts.map((n) => n.getAttribute('src') || '').find((t) => /assets\/.*index-[A-Za-z0-9_-]+\.js/.test(t));
    if (src) return src.split('/').pop().split('?')[0];
  } catch { /* ignore */ }
  return '';
}

/** The deployed index.html points at a different bundle ⇒ a newer build is live. */
export async function detectWebBuild({
  fetchImpl = typeof fetch !== 'undefined' ? fetch : null,
  doc = globalThis.document,
  perf = globalThis.performance,
  timeoutMs = 6000,
} = {}) {
  const running = runningAssetName(doc, perf);
  if (!running || !fetchImpl) return null;
  try {
    const res = await withTimeout(fetchImpl('./index.html', { cache: 'no-store' }), timeoutMs);
    if (res === TIMEOUT || !res || !res.ok || !res.text) return null;
    const html = await res.text();
    const m = String(html).match(/assets\/index-([A-Za-z0-9_-]+)\.js/);
    if (!m) return null;
    const remote = `index-${m[1]}.js`;
    return { running, remote, hasUpdate: remote !== running };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* what the button does                                                */
/* ------------------------------------------------------------------ */

/**
 * 'reload'   → a new web build is sitting in the service worker: reload into it
 * 'download' → native app: open the new APK (installs over the current one)
 * 'open'     → we know there is a newer version but not a direct file: open the page
 * 'none'     → already up to date
 */
export function updateAction({ mode = 'web', hasUpdate = false, webReady = false, apkUrl = '' } = {}) {
  if (webReady) return 'reload';
  if (!hasUpdate) return 'none';
  if (apkUrl) return 'download';
  return mode === 'web' ? 'reload' : 'open';
}

/** Label of the primary button for an action. */
export function actionLabel(action) {
  return {
    reload: 'بروزرسانی و راه‌اندازی دوباره',
    download: 'دانلود نسخهٔ جدید',
    open: 'بازکردن صفحهٔ دانلود',
    none: 'بررسی بروزرسانی',
  }[action] || 'بروزرسانی';
}

/** Short status line under the version. */
export function statusText(info = {}, { mode = 'web' } = {}) {
  if (info.ok !== true && info.error) return explainError(info.error);
  const latest = info.latest?.version;
  if (info.hasUpdate) {
    return mode === 'web'
      ? `نسخهٔ ${faVersion(latest)} منتشر شده — نصب می‌کنم و دوباره راه‌اندازی می‌کنم.`
      : `نسخهٔ ${faVersion(latest)} آماده است (نسخهٔ تو ${faVersion(info.current)}).`;
  }
  return `آخرین نسخه را داری (${faVersion(info.current || latest)}).`;
}
