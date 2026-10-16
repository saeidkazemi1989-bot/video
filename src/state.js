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
  subtitleSource: null,       // { text, segmentsByAsset, method }
  editorIndex: 0,             // selected shot in the manual editor
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

export async function loadPrefs() {
  const prefs = await idbGet('prefs');
  if (!prefs) return;
  if (prefs.presetId) state.presetId = prefs.presetId;
  if (prefs.settings) state.settings = { ...state.settings, ...prefs.settings };
  if (prefs.ai) state.ai = { ...state.ai, ...prefs.ai };
}

export function savePrefs() {
  return idbSet('prefs', {
    presetId: state.presetId,
    settings: state.settings,
    ai: state.ai,
  });
}

export function resetProject() {
  state.assets = [];
  state.subtitleSource = null;
  state.editorIndex = 0;
  state.music = null;
  state.plan = null;
  state.output = null;
  state.analyzing = false;
  state.step = 1;
}

export const usableAssets = () => state.assets.filter((a) => a.use && (a.kind === 'photo' || (a.duration || 0) > 0.3));
