import './styles.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/500.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/700.css';
import '@fontsource/vazirmatn/800.css';
import '@fontsource/vazirmatn/900.css';

import { state, loadPrefs, savePrefs } from './state.js';
import { setRouter, go, renderChrome, toast } from './ui/shell.js';
import { openSettingsSheet } from './ui/settingsSheet.js';
import { renderMediaScreen } from './ui/mediaScreen.js';
import { renderStyleScreen } from './ui/styleScreen.js';
import { renderTextScreen } from './ui/textScreen.js';
import { renderMusicScreen } from './ui/musicScreen.js';
import { renderPreviewScreen, disposePreview } from './ui/previewScreen.js';
import { renderExportScreen } from './ui/exportScreen.js';
import { ensurePlan } from './project.js';
import { ensureFonts } from './core/text.js';

const $ = (s) => document.querySelector(s);

const SCREENS = {
  1: renderMediaScreen,
  2: renderStyleScreen,
  3: renderTextScreen,
  4: renderMusicScreen,
  5: renderPreviewScreen,
  6: renderExportScreen,
};

function rerender() {
  const step = state.step;
  renderChrome();
  const render = SCREENS[step];
  if (!render) return;
  if (step >= 3 && !state.assets.some((a) => a.use)) {
    toast('اول چند عکس یا ویدیو اضافه کن', 'info');
    state.step = 1;
    renderChrome();
    SCREENS[1]($('#screen'), { rerender });
    return;
  }
  try {
    if (step >= 3) ensurePlan();
  } catch (e) {
    console.warn(e);
    toast(e.message, 'err');
    state.step = 1;
  }
  if (step !== 5) disposePreview();
  try {
    SCREENS[state.step]($('#screen'), { rerender });
  } catch (e) {
    console.error(e);
    $('#screen').innerHTML = '';
    $('#screen').append(Object.assign(document.createElement('div'), {
      className: 'card',
      textContent: `خطا در نمایش این مرحله: ${e.message}`,
    }));
  }
}

function boot() {
  setRouter((step) => {
    // stop any running preview audio when leaving the preview step
    if (step !== 5) disposePreview();
    const render = SCREENS[step];
    try {
      if (step >= 3) ensurePlan();
      render($('#screen'), { rerender });
    } catch (e) {
      console.error(e);
      toast(e.message || 'خطای نامشخص', 'err');
    }
  });

  $('#btn-back').onclick = () => go(state.step - 1);
  $('#btn-settings').onclick = () => openSettingsSheet(() => rerender());
  $('#busy').addEventListener('click', (e) => { if (e.target.id === 'busy') { /* keep the overlay */ } });

  document.querySelectorAll('.stepper__item').forEach((node) => {
    node.addEventListener('click', () => {
      const target = Number(node.dataset.step);
      if (target === state.step) return;
      if (target >= 2 && !state.assets.some((a) => a.use)) return toast('اول رسانه اضافه کن', 'info');
      if (target === 5 || target === 6) {
        const usable = state.assets.filter((a) => a.use);
        const totalKnown = usable.every((a) => a.kind === 'photo' || (a.duration || 0) > 0.3);
        if (!totalKnown) return toast('فایل‌ها هنوز آماده نیستند', 'info');
      }
      go(target);
    });
  });

  renderChrome();
  ensureFonts();
  SCREENS[1]($('#screen'), { rerender });

  // keep prefs in sync
  window.addEventListener('pagehide', () => { savePrefs(); });
}

loadPrefs().finally(boot);

// PWA: install the service worker only for production builds
if (import.meta.env?.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// warn before losing media-heavy work
window.addEventListener('beforeunload', (e) => {
  if (state.assets.length && !state.output) {
    e.preventDefault();
    e.returnValue = '';
  }
});
