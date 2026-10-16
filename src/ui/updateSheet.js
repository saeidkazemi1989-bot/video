/**
 * «بروزرسانی» sheet + service-worker plumbing.
 *
 * • web / PWA  → asks the SW for a newer build and reloads into it
 * • Android/iOS → checks the published release and opens the new APK for install
 */
import { state, savePrefs } from '../state.js';
import { el, humanSize } from '../core/util.js';
import { openSheet, btn, toast, chips, setUpdateBadge } from './shell.js';
import {
  APP_VERSION, faVersion, statusText, updateAction, actionLabel,
  checkForUpdate, detectWebBuild, platformOf, isNative, openExternal,
  LATEST_RELEASE_PAGE, RELEASES_PAGE,
} from '../core/update.js';

const MODE_LABEL = { web: 'وب / PWA', android: 'اپ اندروید', ios: 'اپ iOS', native: 'اپ نصب‌شده' };

let registration = null;
let bootHadController = false;
let listeners = new Set();

const emit = () => { for (const fn of listeners) { try { fn(state.update); } catch (e) { console.error(e); } } };
export const onUpdateState = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* ------------------------------------------------------------------ */
/* start-up: register the worker and watch for new builds              */
/* ------------------------------------------------------------------ */

export async function initUpdates() {
  const u = state.update;
  u.mode = platformOf();

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    bootHadController = !!navigator.serviceWorker.controller;
    if (isNative()) {
      // The APK ships its own copy of the shell — a cached one would survive an APK
      // update and could point at files that no longer exist. Keep native installs
      // cache-free; their updates arrive through the ⟳ button / a new APK.
      try {
        const regs = (await navigator.serviceWorker.getRegistrations?.()) || [];
        await Promise.all(regs.map((r) => r.unregister?.()));
        if (typeof caches !== 'undefined') {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        registration = null;
      } catch { /* nothing to clean */ }
    } else {
      try {
        registration = (await navigator.serviceWorker.getRegistration?.()) || null;
        if (!registration && import.meta.env?.PROD) {
          registration = await navigator.serviceWorker.register('./sw.js');
        }
        trackRegistration(registration);
      } catch { /* no SW support — the update button still checks releases */ }
    }

    // a brand-new worker took over ⇒ the page is running an older build
    try {
      navigator.serviceWorker.addEventListener?.('controllerchange', () => {
        if (!bootHadController) return;      // first install, nothing new to apply
        state.update.webReady = true;
        setUpdateBadge(true, 'نسخهٔ جدید آماده است — بروزرسانی را بزن');
        emit();
      });
    } catch { /* ignore */ }
  }

  if (state.settings.autoUpdateCheck !== false) {
    setTimeout(() => { runUpdateCheck({ silent: true }); }, 2500);
  }
  return state.update;
}

function trackRegistration(reg) {
  if (!reg?.addEventListener) return;
  const check = () => {
    if (reg.waiting && bootHadController) {
      state.update.webReady = true;
      setUpdateBadge(true, 'نسخهٔ جدید آماده است — بروزرسانی را بزن');
      emit();
    }
  };
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw?.addEventListener) return;
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed' && bootHadController) {
        state.update.webReady = true;
        emit();
      }
    });
  });
  check();
}

/* ------------------------------------------------------------------ */
/* checking                                                            */
/* ------------------------------------------------------------------ */

export async function runUpdateCheck({ silent = false } = {}) {
  const u = state.update;
  if (u.checking) return u;
  u.checking = true;
  emit();

  try {
    // 1) let the service worker look for a newer shell (no-op when unsupported)
    try {
      const reg = registration || (await navigator?.serviceWorker?.getRegistration?.());
      await reg?.update?.();
    } catch { /* offline / unsupported */ }

    // 2) is there a newer build deployed for the web app?
    const web = await detectWebBuild();
    if (web?.hasUpdate) u.webReady = true;

    // 3) is there a newer published release (tag / APK)?
    const remote = await checkForUpdate({ current: APP_VERSION, customUrl: state.settings.updateUrl || '' });
    u.latest = remote.latest;
    u.available = remote.hasUpdate;
    u.error = remote.ok ? '' : remote.error;
    u.notes = remote.notes;
    u.source = remote.source;
    u.url = remote.url || LATEST_RELEASE_PAGE;
    u.apkUrl = remote.apkUrl || '';
    u.checkedAt = Date.now();
    u.checkedOnce = true;
    u.ok = remote.ok;

    const fresh = u.available || u.webReady;
    setUpdateBadge(fresh, fresh ? 'نسخهٔ جدید آماده است — بروزرسانی را بزن' : '');
    if (!silent) {
      if (u.webReady) toast('نسخهٔ جدیدی از اپ نصب شد — بروزرسانی را بزن', 'ok');
      else if (u.available) toast(`نسخهٔ ${faVersion(u.latest?.version)} موجود است`, 'info');
      else if (u.error) toast(statusText(u, { mode: u.mode }), 'info');
      else toast('آخرین نسخه را داری 🎉', 'ok');
    }
  } finally {
    u.checking = false;
    emit();
  }
  return u;
}

/* ------------------------------------------------------------------ */
/* applying                                                            */
/* ------------------------------------------------------------------ */

/** Takes over the waiting worker (if any) and reloads into the new build. */
export async function applyUpdate() {
  const waiting = registration?.waiting;
  if (waiting?.postMessage) {
    await new Promise((resolve) => {
      const done = setTimeout(resolve, 900);
      try {
        navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(done); resolve(); }, { once: true });
      } catch { /* ignore */ }
      try { waiting.postMessage({ type: 'SKIP_WAITING' }); } catch { /* ignore */ }
    });
  }
  if (typeof location !== 'undefined' && location.reload) {
    location.reload();
    return true;
  }
  return false;
}

/** Runs the action the update button stands for; returns what it did. */
export async function applyUpdateAction(action = 'none') {
  const u = state.update;
  if (action === 'reload') return applyUpdate() ? 'reload' : 'none';
  if (action === 'download') { openExternal(u.apkUrl || u.url || LATEST_RELEASE_PAGE); return 'download'; }
  if (action === 'open') { openExternal(u.url || LATEST_RELEASE_PAGE); return 'open'; }
  await runUpdateCheck();
  return 'check';
}

/* ------------------------------------------------------------------ */
/* the sheet                                                           */
/* ------------------------------------------------------------------ */

export function openUpdateSheet() {
  openSheet(({ close }) => {
    const box = el('div', { class: 'stack' });

    const versionRow = () => el('div', { class: 'card card--pad-lg' }, [
      el('div', { class: 'row row--between' }, [
        el('div', {}, [
          el('div', { text: `نسخهٔ نصب‌شده: ${faVersion(APP_VERSION)}`, style: { fontWeight: '600' } }),
          el('div', { class: 'muted', text: MODE_LABEL[state.update.mode] || MODE_LABEL.web }),
        ]),
        el('span', {
          class: `badge ${state.update.available || state.update.webReady ? 'badge--warn' : 'badge--ok'}`,
          text: state.update.checking ? 'در حال بررسی…'
            : state.update.available || state.update.webReady ? 'نسخهٔ جدید موجود' : 'به‌روز',
        }),
      ]),
      el('p', { class: 'lead', style: { marginTop: '10px', marginBottom: '0' }, text: describe() }),
    ]);

    const notesRow = () => {
      const notes = String(state.update.notes || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6);
      if (!notes.length || !state.update.available) return null;
      return el('div', { class: 'card' }, [
        el('div', { class: 'muted', text: `تازه‌های نسخهٔ ${faVersion(state.update.latest?.version)}:` }),
        el('ul', { class: 'lead', style: { margin: '8px 0 0', paddingInlineStart: '18px' } },
          notes.map((line) => el('li', { text: line.replace(/^[-*•]\s*/, '').replace(/^#+\s*/, '') }))),
      ]);
    };

    const actionRow = () => {
      const action = updateAction({
        mode: state.update.mode,
        hasUpdate: state.update.available,
        webReady: state.update.webReady,
        apkUrl: state.update.apkUrl,
      });
      const primary = btn(actionLabel(action), {
        primary: true, block: true,
        onClick: async () => {
          if (action === 'none') { await runUpdateCheck(); render(); return; }
          const did = await applyUpdateAction(action);
          if (did === 'download') {
            toast('فایل نصبی باز شد — بعد از دانلود نصب کن', 'ok');
            close();
          }
        },
      });
      return el('div', { class: 'stack' }, [
        primary,
        el('div', { class: 'row' }, [
          btn(state.update.checking ? 'در حال بررسی…' : 'بررسی دوباره', {
            ghost: true, small: true, disabled: state.update.checking,
            onClick: async () => { render(); await runUpdateCheck(); render(); },
          }),
          btn('صفحهٔ دانلود', { ghost: true, small: true, onClick: () => openExternal(RELEASES_PAGE) }),
        ]),
        state.update.apkUrl
          ? el('div', { class: 'muted', text: `فایل آماده: ${state.update.latest?.apkName || 'reelforge-debug.apk'}${state.update.latest?.apkSize ? ` (${humanSize(state.update.latest.apkSize)})` : ''}` })
          : null,
      ]);
    };

    const autoRow = () => el('div', { class: 'field' }, [
      el('label', { text: 'بررسی خودکار هنگام باز شدن اپ' }),
      chips([{ id: 'on', label: 'روشن' }, { id: 'off', label: 'خاموش' }],
        state.settings.autoUpdateCheck !== false ? 'on' : 'off',
        (id) => {
          state.settings.autoUpdateCheck = id === 'on';
          savePrefs();
          render();
        }),
      el('div', { class: 'muted', text: 'در حالت وب، اپ هر بار نگاهی می‌اندازد که نسخهٔ تازه‌تری منتشر شده یا نه؛ در اپ اندروید همین کار نسخهٔ جدید APK را پیدا می‌کند.' }),
    ]);

    const urlRow = () => {
      const input = el('input', {
        class: 'input', dir: 'ltr', value: state.settings.updateUrl || '',
        placeholder: 'https://example.com/reelforge/latest.json',
        oninput: (e) => { state.settings.updateUrl = e.target.value.trim(); },
        onchange: () => savePrefs(),
      });
      return el('div', { class: 'field' }, [
        el('label', { text: 'آدرس بروزرسانی (اختیاری)' }),
        input,
        el('div', { class: 'muted', text: 'اگر مخزن خصوصی است، می‌توانی یک فایل JSON کوچک با این شکل جایی بگذاری: { "version": "1.2.0", "apk": "https://…/reelforge.apk" }' }),
      ]);
    };

    const render = () => {
      box.innerHTML = '';
      box.append(versionRow());
      const notes = notesRow();
      if (notes) box.append(notes);
      box.append(actionRow(), autoRow(), urlRow());
    };

    render();
    // refresh the sheet once the pending check (if any) lands
    const timer = setInterval(() => {
      if (state.update.checking) return;
      clearInterval(timer);
      render();
    }, 350);
    setTimeout(() => clearInterval(timer), 20000);
    return box;
  }, { title: 'بروزرسانی' });
}

function describe() {
  const u = state.update;
  if (u.checking) return 'در حال بررسی نسخهٔ جدید…';
  if (u.webReady) return 'نسخهٔ تازه‌ای از اپ آماده است — با یک ضربه نصب و اپ دوباره راه‌اندازی می‌شود (اطلاعات پروژه‌ات روی همین گوشی می‌ماند).';
  if (!u.checkedOnce) return 'می‌خواهی بررسی کنم نسخهٔ جدیدی منتشر شده یا نه؟';
  return statusText(u, { mode: u.mode });
}

export const __internals = { describe, MODE_LABEL };
