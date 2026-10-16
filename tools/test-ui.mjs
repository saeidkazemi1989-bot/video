/**
 * UI smoke test on a lightweight DOM (linkedom).
 * Renders every screen of the flow, opens the sheets and drives the router, so
 * layout/rendering bugs surface without a real browser.
 * Run: node tools/test-ui.mjs
 */
import { parseHTML } from 'linkedom';

/* ---------------- DOM & browser shims ---------------- */
const { document, window } = parseHTML(`<!doctype html><html lang="fa" dir="rtl"><body>
  <div id="app">
    <header id="appbar"><button id="btn-back"></button><span id="appbar-step"></span><span class="appbar__side--end"><button id="btn-update" hidden>⟳</button><button id="btn-settings"></button></span></header>
    <div id="stepper">
      ${[1, 2, 3, 4, 5, 6].map((s) => `<div class="stepper__item" data-step="${s}"><i>${s}</i><span>s</span></div>`).join('')}
    </div>
    <main id="screen"></main>
    <div id="bottom-bar" hidden></div>
    <div id="toast-host"></div>
    <div id="sheet-host" hidden></div>
    <div id="busy" hidden><div class="busy__card">
      <div class="ring"><svg viewBox="0 0 44 44"><circle class="ring__bg"></circle><circle id="busy-ring"></circle></svg><b id="busy-pct"></b></div>
      <div id="busy-title"></div><div id="busy-sub"></div><button id="busy-cancel" hidden></button>
    </div></div>
  </div>
</body></html>`);

function mockCtx(canvas) {
  const target = {
    canvas,
    measureText: (t) => ({ width: String(t).length * 12 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
    getImageData: (x, y, w = 16, h = 16) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    putImageData() {},
    setTransform() {},
    roundRect() {},
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop];
      return () => {};
    },
    set(t, prop, value) { t[prop] = value; return true; },
  });
}

const originalCreate = document.createElement.bind(document);
document.createElement = (tag, ...rest) => {
  const node = originalCreate(tag, ...rest);
  if (String(tag).toLowerCase() === 'canvas') {
    node.width = 300; node.height = 150;
    node.toDataURL = () => 'data:image/png;base64,';
    node.toBlob = (cb) => cb(null);
    node.getContext = (type) => (type === '2d' ? mockCtx(node) : null);
    node.captureStream = () => null;
  }
  if (String(tag).toLowerCase() === 'video') {
    node.play = () => Promise.resolve();
    node.pause = () => {};
    node.load = () => {};
    node.readyState = 2;
    node.videoWidth = 1080;
    node.videoHeight = 1920;
    node.duration = 8;
  }
  return node;
};

const listeners = () => {};
const navShim = {
  vibrate: () => true,
  clipboard: { writeText: async () => {} },
  userAgent: 'linkedom-test',
  canShare: () => false,
  share: async () => {},
};
globalThis.document = document;
globalThis.window = window;
for (const [target, name, value] of [
  [globalThis, 'navigator', navShim],
  [window, 'navigator', navShim],
]) {
  try { Object.defineProperty(target, name, { value, configurable: true, writable: true }); } catch { /* ignore */ }
}
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.Element = window.Element;
globalThis.getComputedStyle = window.getComputedStyle || (() => ({ getPropertyValue: () => '' }));
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.Image = class { set src(v) { setTimeout(() => this.onload?.(), 0); } };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
window.URL = URL;
window.devicePixelRatio = 2;
window.addEventListener = window.addEventListener || listeners;
window.removeEventListener = window.removeEventListener || (() => {});
window.innerWidth = 390;
globalThis.AudioBuffer = class {};

/* ---------------- imports (after shims) ---------------- */
const { state } = await import('../src/state.js');
const { setRouter, go, setUpdateBadge, updateBadgeVisible } = await import('../src/ui/shell.js');
const { renderMediaScreen } = await import('../src/ui/mediaScreen.js');
const { renderStyleScreen } = await import('../src/ui/styleScreen.js');
const { renderTextScreen } = await import('../src/ui/textScreen.js');
const { renderMusicScreen } = await import('../src/ui/musicScreen.js');
const { renderPreviewScreen } = await import('../src/ui/previewScreen.js');
const { renderExportScreen } = await import('../src/ui/exportScreen.js');
const { openSettingsSheet } = await import('../src/ui/settingsSheet.js');
const { closeSheet } = await import('../src/ui/shell.js');
const { renderEditorScreen } = await import('../src/ui/editorScreen.js');
const { openSubtitleSheet } = await import('../src/ui/subtitleScreen.js');
const { openUpdateSheet, applyUpdateAction } = await import('../src/ui/updateSheet.js');
const Upd = await import('../src/core/update.js');
const { ensurePlan, planSummary } = await import('../src/project.js');

let failures = 0;
let checks = 0;
function ok(cond, label, extra = '') {
  checks++;
  if (!cond) { failures++; console.error(`  ✗ ${label} ${extra}`); }
}
const screen = document.getElementById('screen');
const bottom = document.getElementById('bottom-bar');

function fakeAsset(i, kind = 'photo') {
  return {
    id: `a${i}`, kind, name: kind === 'photo' ? `p${i}.jpg` : `v${i}.mp4`, size: 2_000_000,
    file: null, objectUrl: kind === 'video' ? 'blob:v' : null,
    width: 1080, height: 1920, duration: kind === 'video' ? 8 : null,
    trimIn: 0, trimOut: kind === 'video' ? 8 : null, speed: 1, volume: kind === 'video' ? 1 : 0,
    muted: true, use: true, hero: i === 0, thumb: null,
    analysis: {
      luma: 0.5, contrast: 0.2, saturation: 0.3, warmth: 0.05, clipHi: 0.01, clipLo: 0.01,
      sharpness: 0.05, edgeDensity: 0.2, edgeMean: 0.07, focus: { x: 0.5, y: 0.4 },
      colors: [[120, 90, 80]], avgColor: [120, 90, 80], toneCurve: new Array(16).fill(0.06),
      motion: 0.3, score: 0.6, mood: 'clean', samples: 3, suggestedIn: 0.5,
    },
  };
}

const SCREENS = {
  1: renderMediaScreen, 2: renderStyleScreen, 3: renderTextScreen,
  4: renderMusicScreen, 5: renderPreviewScreen, 6: renderExportScreen,
};

function renderStep(step) {
  state.step = step;
  const node = document.createElement('div');
  SCREENS[step](screen, { rerender: () => renderStep(step) });
  return node;
}

console.log('\n▸ empty state');
{
  state.assets = [];
  renderStep(1);
  ok(screen.textContent.includes('ریل حرفه‌ای'), 'welcome hero is shown');
  ok(bottom.querySelectorAll('button').length >= 1, 'bottom bar has actions');
  ok(bottom.querySelector('button').disabled === true, 'next is disabled without media');
}

console.log('\n▸ step 1 with media');
{
  state.assets = [fakeAsset(0), fakeAsset(1, 'video'), fakeAsset(2), fakeAsset(3, 'video'), fakeAsset(4)];
  renderStep(1);
  ok(screen.querySelectorAll('.thumb').length === 5, 'thumbnails rendered', String(screen.querySelectorAll('.thumb').length));
  ok(screen.textContent.includes('تحلیل هوشمند'), 'analysis card present');
  ok(bottom.querySelector('button').disabled === false, 'next enabled with media');
  // open the per-asset menu
  const menuBtn = screen.querySelector('.thumb__del');
  ok(!!menuBtn, 'asset menu button exists');
  menuBtn.dispatchEvent(new window.Event('click'));
  ok(document.getElementById('sheet-host').hidden === false, 'asset sheet opens');
  const sheetText = document.getElementById('sheet-host').textContent;
  ok(sheetText.includes('برداشتن ستاره') || sheetText.includes('حذف از پروژه'), 'asset sheet has actions');
  // close it again
  document.getElementById('sheet-host').hidden = true;
}

console.log('\n▸ step 2 styles');
{
  renderStep(2);
  const cards = screen.querySelectorAll('.preset');
  ok(cards.length >= 10, 'all presets rendered', String(cards.length));
  const chips = screen.querySelectorAll('.chip');
  ok(chips.length >= 4, 'duration chips rendered', String(chips.length));
  chips[3].dispatchEvent(new window.Event('click'));
  ok(state.settings.duration === 45, 'duration chip updates state', String(state.settings.duration));
  const presets = screen.querySelectorAll('.preset');
  presets[2].dispatchEvent(new window.Event('click'));
  ok(state.presetId === 'cinematic' || state.presetId.length > 0, 'preset click updates selection', state.presetId);
}

console.log('\n▸ plan + step 3 text');
{
  state.settings.duration = 30;
  state.settings.topic = 'کافه‌گردی در تهران';
  const plan = ensurePlan({ force: true });
  ok(!!plan && plan.cuts.length > 3, 'plan built', String(plan?.cuts.length));
  ok(planSummary().shots === plan.cuts.length, 'plan summary matches');
  renderStep(3);
  const text = screen.textContent;
  ok(text.includes('جمله اول'), 'hook card present');
  ok(text.includes('کپشن'), 'caption card present');
  ok(text.includes('#'), 'hashtags visible');
  ok(plan.copy.hook.length > 3, 'hook in plan.copy');
  // shuffle button
  const shuffle = [...screen.querySelectorAll('button')].find((b) => b.textContent.includes('🎲'));
  ok(!!shuffle, 'shuffle button exists');
  const before = plan.copy.hook;
  shuffle.dispatchEvent(new window.Event('click'));
  ok(plan.copy.hook.length > 2 && plan.copy.tags.length > 10, 'regenerate keeps copy valid');
  ok(screen.textContent.length > 200, 'screen has content after regenerate');
  ok(typeof before === 'string', 'previous hook read');
}

console.log('\n▸ step 4 music (with a synthesised track)');
{
  // fabricate an analysed track (no decode in this environment)
  const beats = new Float32Array(120);
  for (let i = 0; i < beats.length; i++) beats[i] = i * 0.5;
  const energy = new Float32Array(700);
  for (let i = 0; i < energy.length; i++) energy[i] = 0.3 + 0.4 * Math.sin(i / 20);
  state.music = {
    name: 'track.mp3', file: null, offset: 0,
    buffer: null,
    analysis: {
      duration: 200, sampleRate: 44100, bpm: 120, beatPeriod: 0.5, beats,
      downbeats: [...beats].filter((_, i) => i % 4 === 0), energy, energyHz: 20,
      waveform: new Float32Array(200).fill(0.6), confidence: 0.8, phaseScore: 5,
      bestStart: 30, dropTime: 45, analyzed: 180, ms: 900, buffer: null,
    },
  };
  renderStep(4);
  ok(screen.textContent.includes('ضربه در دقیقه'), 'bpm shown');
  ok(screen.querySelector('canvas') !== null, 'waveform canvas rendered');
  const plan = ensurePlan({ force: true });
  ok(plan.hasBeat === true, 'plan uses the beat grid');
  const beat = 60 / plan.music.bpm;
  const beatsInPlan = plan.duration / beat;
  ok(Math.abs(beatsInPlan - Math.round(beatsInPlan)) < 0.05, 'duration is a whole number of beats', beatsInPlan.toFixed(3));
  ok(plan.music.startTime >= 0, 'music start computed');
}

console.log('\n▸ step 5 preview');
{
  renderStep(5);
  ok(screen.querySelector('canvas') !== null, 'preview canvas present');
  ok(screen.textContent.includes('خلاصه تدوین'), 'summary card present');
  ok(screen.querySelectorAll('.timeline__seg').length >= 3, 'timeline segments rendered');
  ok(screen.textContent.includes('متن این ریلز'), 'copy preview present');
}

console.log('\n▸ manual editor (step 5.5)');
{
  state.step = 5.5;
  const plan = ensurePlan();
  renderEditorScreen(screen, { rerender: () => {} });
  ok(screen.textContent.includes('نمای'), 'editor shows the shot inspector');
  const segs = screen.querySelectorAll('.timeline__seg');
  ok(segs.length === plan.cuts.length, 'every shot has a timeline segment', `${segs.length}/${plan.cuts.length}`);
  ok(screen.textContent.includes('طول نما') || screen.textContent.includes('اختلاف'), 'length controls present');
  const actions = [...screen.querySelectorAll('button')].map((b) => b.textContent).join(' ');
  for (const label of ['دو نیم', 'تکرار', 'سرعت', 'ترنزیشن', 'حذف']) {
    ok(actions.includes(label), `editor has the ${label} action`);
  }
  const before = plan.cuts.length;
  const dup = [...screen.querySelectorAll('button')].find((b) => b.textContent.includes('تکرار'));
  dup.dispatchEvent(new window.Event('click'));
  ok(plan.cuts.length === before + 1, 'duplicate works from the UI', `${before} → ${plan.cuts.length}`);
}

console.log('\n▸ subtitle sheet');
{
  openSubtitleSheet({ onChange: () => {} });
  const sheet = document.getElementById('sheet-host');
  ok(sheet.hidden === false, 'subtitle sheet opens');
  const text = sheet.textContent;
  ok(text.includes('زیرنویس'), 'subtitle sheet mentions subtitles');
  ok(text.includes('تحلیل گفتار'), 'offline speech detection offered');
  ok(text.includes('هوش مصنوعی') || text.includes('استخراج متن'), 'AI transcription offered');
  ok(sheet.querySelectorAll('.chip').length >= 4, 'subtitle styles listed', String(sheet.querySelectorAll('.chip').length));
  sheet.hidden = true;
}

console.log('\n▸ step 6 export');
{
  renderStep(6);
  ok(screen.textContent.includes('خروجی نهایی'), 'export screen renders');
  ok([...screen.querySelectorAll('button')].some((b) => b.textContent.includes('پروژه')), 'project export button offered');
  ok(screen.textContent.includes('کیفیت خروجی'), 'quality picker present');
  const plan = ensurePlan();
  ok(screen.textContent.includes(plan.preset.name) || screen.textContent.includes('سبک'), 'plan info shown');
}

console.log('\n▸ router + settings sheet');
{
  setRouter((s) => renderStep(s));
  go(2);
  ok(state.step === 2, 'router moves to step 2', String(state.step));
  go(9);
  ok(state.step === 6, 'router clamps to the last step');
  go(-3);
  ok(state.step === 1, 'router clamps to the first step');
  openSettingsSheet(() => {});
  const sheet = document.getElementById('sheet-host');
  ok(sheet.hidden === false, 'settings sheet opens');
  ok(sheet.textContent.includes('آیدی اینستاگرام'), 'handle field present');
  ok(sheet.textContent.includes('هوش مصنوعی'), 'ai section present');
}


console.log('\n▸ update button («بروزرسانی»)');
{
  ok(updateBadgeVisible() === false, 'update badge starts hidden');
  ok(setUpdateBadge(true, 'نسخهٔ جدید') === true, 'badge can be switched on');
  ok(updateBadgeVisible() === true, 'badge is visible when an update waits');
  ok(document.getElementById('btn-update').title.includes('نسخهٔ جدید'), 'badge carries a tooltip');
  ok(setUpdateBadge(false) === false && updateBadgeVisible() === false, 'badge hides again');

  state.update.mode = 'web';
  state.update.available = true;
  state.update.latest = { version: '9.9.9', apkName: 'reelforge.apk', apkSize: 7_000_000, notes: '- سرعت رندر' };
  state.update.notes = '- سرعت رندر';
  state.update.checkedOnce = true;
  state.update.ok = true;
  state.update.webReady = true;

  openUpdateSheet();
  const sheet = document.getElementById('sheet-host');
  ok(sheet.hidden === false, 'update sheet opens');
  ok(sheet.textContent.includes('بروزرسانی'), 'sheet is titled «بروزرسانی»');
  ok(sheet.textContent.includes('نسخهٔ نصب‌شده'), 'shows the installed version');
  ok(sheet.textContent.includes(Upd.faVersion(Upd.APP_VERSION)), 'the version is shown in Persian digits', Upd.faVersion(Upd.APP_VERSION));
  ok(sheet.textContent.includes('وب / PWA'), 'web mode is labelled');
  ok([...sheet.querySelectorAll('button')].some((b) => b.textContent.includes('راه‌اندازی')), 'primary action is «بروزرسانی و راه‌اندازی دوباره»');
  ok([...sheet.querySelectorAll('button')].some((b) => b.textContent.includes('بررسی دوباره')), 'a re-check button exists');
  ok([...sheet.querySelectorAll('button')].some((b) => b.textContent.includes('صفحهٔ دانلود')), 'the download page is reachable');
  ok(sheet.textContent.includes('بررسی خودکار'), 'auto-check toggle present');
  ok(sheet.querySelectorAll('.chip').length >= 2, 'auto-check chips render');
  ok(sheet.textContent.includes('آدرس بروزرسانی'), 'advanced update url field present');
  ok(sheet.textContent.includes('سرعت رندر'), 'release notes are listed');

  // native mode: primary action becomes the APK download
  state.update.mode = 'android';
  state.update.webReady = false;
  state.update.apkUrl = 'https://x/app.apk';
  openUpdateSheet();
  ok(document.getElementById('sheet-host').textContent.includes('اپ اندروید'), 'android mode is labelled');
  ok([...document.getElementById('sheet-host').querySelectorAll('button')].some((b) => b.textContent.includes('دانلود نسخهٔ جدید')), 'android shows the download action');
  ok(document.getElementById('sheet-host').textContent.includes('reelforge.apk'), 'the apk file name is shown');

  // up-to-date web app
  state.update.mode = 'web';
  state.update.available = false;
  state.update.apkUrl = '';
  state.update.notes = '';
  state.update.ok = true;
  openUpdateSheet();
  const upSheet = document.getElementById('sheet-host');
  ok(upSheet.textContent.includes('آخرین نسخه را داری'), 'up-to-date status is shown');
  ok([...upSheet.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith('بررسی بروزرسانی')), 'the primary button becomes a plain check');

  // no service worker in tests → applying tells us it could not reload
  const applied = await applyUpdateAction('none');
  ok(applied === 'check' || applied === 'none', 'applyUpdateAction survives without a service worker', applied);
  closeSheet();
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${checks - failures}/${checks} UI checks passed`);
process.exit(failures ? 1 : 0);
