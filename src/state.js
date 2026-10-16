/** Global app state + tiny pub/sub + preference persistence. */
import { DEFAULT_SETTINGS } from './core/planner.js';
import { idbGet, idbSet } from './core/util.js';

const listeners = new Set();

export const state = {
  step: 1,
  assets: [],
  analyzing: false,
  presetId: 'auto',
  settings: { ...DEFAULT_SETTINGS },
  music: null,         // { name, file, analysis, buffer }
  plan: null,
  output: null,        // { video: Blob, wav: Blob, url, size }
  seed: Math.floor(Math.random() * 99999),
  ai: { provider: 'none', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
  lastLibrary: null,          // last generated track config (genre/seed/tempo)
  briefAnalysis: null,        // what «هدف کلیپ» decided for the current sentence
  musicSpeed: null,           // measured offline-render speed of this device
  subtitleSource: null,       // { text, segmentsByAsset, method }
  editorIndex: 0,             // selected shot in the manual editor
  update: {                   // «بروزرسانی» state (see core/update.js)
    mode: 'web',              // 'web' | 'android' | 'ios'
    checking: false,
    available: false,         // a newer version exists online
    webReady: false,          // a new service worker is waiting to take over
    latest: null,
    error: '',
    checkedAt: 0,
  },
  busy: false,
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify() {
  for (const fn of listeners) { try { fn(state); } catch (e) { console.error(e); } }
}

export const STEP_TITLES = [
  'انتخاب عکس و ویدیو',
  'انتخاب سبک تدوین',
  'متن و کپشن',
  'موسیقی و ریتم',
  'پیش‌نمایش ریل',
  'خروجی نهایی',
];

export const PREFS_VERSION = 2;

/**
 * One-time upgrades for stored preferences. Returns true when something changed
 * (so the caller can write the migrated values back).
 *
 * v1 → v2: «ترتیب هوشمند» used to be the default and silently reordered the
 * user's media («ویدیو عکس‌ها را برعکس کرده بود»). Anyone who never opened that
 * control still has `orderMode: 'smart'` in their saved prefs, so on upgrade we
 * move them to the order they actually picked in the picker.
 */
export function migratePrefs(prefs = null) {
  const from = Number(prefs?.settingsVersion || 0);
  if (from >= PREFS_VERSION) return false;
  let changed = false;
  if (from < 2 && state.settings.orderMode === 'smart') {
    state.settings.orderMode = 'intake';
    changed = true;
  }
  return changed;
}

export async function loadPrefs() {
  const prefs = await idbGet('prefs');
  if (!prefs) return;
  if (prefs.presetId) state.presetId = prefs.presetId;
  if (prefs.settings) state.settings = { ...state.settings, ...prefs.settings };
  if (state.settings.autoUpdateCheck === undefined) state.settings.autoUpdateCheck = true;
  if (prefs.ai) state.ai = { ...state.ai, ...prefs.ai };
  if (migratePrefs(prefs)) await savePrefs();
}

export function savePrefs() {
  return idbSet('prefs', {
    settingsVersion: PREFS_VERSION,
    presetId: state.presetId,
    settings: state.settings,
    ai: state.ai,
  });
}

export function resetProject() {
  state.assets = [];
  state.briefAnalysis = null;
  state.subtitleSource = null;
  state.editorIndex = 0;
  state.music = null;
  state.plan = null;
  state.output = null;
  state.analyzing = false;
  state.step = 1;
}

export const usableAssets = () => state.assets.filter((a) => a.use && (a.kind === 'photo' || (a.duration || 0) > 0.3));
