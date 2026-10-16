/** «وضعیت دستگاه» sheet — capability report the user can copy and send. */
import { el, faNum, copyText } from '../core/util.js';
import { state } from '../state.js';
import { briefReport, orientationStatus, checkOrientation, patchSettings } from '../project.js';
import { openSheet, btn, toast } from './shell.js';
import { deviceReport, reportText, reportRows, lastErrors } from '../core/diag.js';

/** What the user actually chose — so a report can explain "reversed"/"zoomed" bugs. */
export function appContext() {
  const photos = state.assets.filter((a) => a.kind === 'photo' && a.use).length;
  const videos = state.assets.filter((a) => a.kind === 'video' && a.use).length;
  return {
    stage: state.step === 5.5 ? '۵٫۵ تدوین دستی' : `مرحله ${faNum(state.step)}`,
    assets: `${faNum(photos)} عکس · ${faNum(videos)} ویدیو`,
    duration: state.settings.duration,
    framing: state.settings.framing || 'fit',
    order: state.settings.orderMode || 'intake',
    quality: state.settings.quality || '',
    fps: state.settings.fps || 30,
    preset: state.presetId,
    music: state.music ? (state.music.generated ? `ساخت اپ (${state.music.name || ''})` : state.music.name || 'فایل خودم') : 'بدون موسیقی',
    subtitles: state.settings.subtitles ? 'روشن' : 'خاموش',
    brief: briefReport(),
    orientation: orientationStatus(),
    videoTexture: state.orientationFix?.videoRaw ? `راستیابی تکسچر ویدیو: ${state.orientationFix.videoRaw}${state.orientationFix.videoNote ? ` — ${state.orientationFix.videoNote}` : ''}` : '',
  };
}

const isLatin = (v) => /^[\w\s.,:()×+\/-]+$/.test(String(v));

function row(label, value) {
  return el('div', { class: 'listitem' }, [
    el('div', { class: 'listitem__ico', text: '•' }),
    el('div', { class: 'listitem__body' }, [
      el('b', { text: label }),
      el('span', { text: String(value), dir: isLatin(value) ? 'ltr' : 'rtl' }),
    ]),
  ]);
}

export function openDiagSheet() {
  openSheet(({ close }) => {
    const box = el('div', { class: 'stack' });
    const body = el('div', { class: 'list' }, [el('div', { class: 'muted', text: 'در حال بررسی دستگاه…' })]);
    box.append(body);
    const actions = el('div', { class: 'row' });
    box.append(actions);

    /** The manual escape hatch — rebuilt with the body so it never disappears. */
    const manualRow = () => el('div', { class: 'field' }, [
      el('label', { text: 'جبران جهت تصویر (عکس و ویدیو)' }),
      el('div', { class: 'pill-row' }, [
        el('button', {
          class: `chip ${state.settings.orientationManual !== 'flip' ? 'is-on' : ''}`,
          onclick: async () => {
            patchSettings({ orientationManual: 'auto' });
            await checkOrientation({ force: true });
            toast(`جهت تصویر: ${orientationStatus()}`, 'ok', 4000);
          },
        }, ['🧭 خودکار (اندازه‌گیری روی همین گوشی)']),
        el('button', {
          class: `chip ${state.settings.orientationManual === 'flip' ? 'is-on' : ''}`,
          onclick: async () => {
            patchSettings({ orientationManual: 'flip' });
            const fix = await checkOrientation({ force: true });
            toast(`جهت تصویر: ${orientationStatus()}`, fix.status === 'unfixable' ? 'warn' : 'ok', 4200);
          },
        }, ['↕ برعکس کن (اگر همه‌چیز وارونه بود)']),
      ]),
    ]);

    function fill(report) {
      body.innerHTML = '';
      for (const [label, value] of reportRows(report)) body.append(row(label, value));
      body.append(manualRow());
      const errs = lastErrors();
      if (errs.length) {
        body.append(el('div', { class: 'card' }, [
          el('div', { class: 'muted', text: `آخرین خطاها (${faNum(errs.length)})` }),
          ...errs.slice(-3).map((e) => el('div', { class: 'muted', dir: 'ltr', style: { textAlign: 'left', marginTop: '6px' }, text: `${e.where ? `${e.where} · ` : ''}${e.text}` })),
        ]));
      }
    }

    (async () => {
      const report = await deviceReport(globalThis, { context: appContext() });
      fill(report);
      actions.append(
        // «جهت تصویر»: re-measure the real render path and correct it on the spot
        btn('🔁 بررسی و رفع جهت تصویر', {
          small: true,
          onClick: async () => {
            try {
              const fix = await checkOrientation({ force: true });
              toast(`جهت تصویر: ${orientationStatus()}`, fix.status === 'ok' || fix.status === 'fixed' ? 'ok' : 'warn', 4600);
              const fresh = await deviceReport(globalThis, { context: appContext() });
              fill(fresh);
              Object.assign(report, fresh);
            } catch (e) {
              toast(`بررسی جهت تصویر ممکن نشد (${e.message})`, 'err', 4200);
            }
          },
        }),
        btn('📋 کپی گزارش', {
          primary: true,
          onClick: async () => {
            const ok = await copyText(reportText(report));
            toast(ok ? 'گزارش کپی شد — آن را بفرست' : 'کپی نشد', ok ? 'ok' : 'err');
          },
        }),
        btn('بستن', { ghost: true, onClick: close }),
      );
    })().catch((e) => {
      body.innerHTML = '';
      body.append(el('div', { class: 'muted', text: `گزارش دستگاه ناموفق بود: ${e.message}` }));
    });

    return box;
  }, { title: 'وضعیت دستگاه' });
}
