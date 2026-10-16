/** «وضعیت دستگاه» sheet — capability report the user can copy and send. */
import { el, faNum, copyText } from '../core/util.js';
import { state } from '../state.js';
import { briefReport } from '../project.js';
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
  };
}

export function openDiagSheet() {
  openSheet(({ close }) => {
    const box = el('div', { class: 'stack' });
    const body = el('div', { class: 'list' }, [el('div', { class: 'muted', text: 'در حال بررسی دستگاه…' })]);
    box.append(body);
    const actions = el('div', { class: 'row' });
    box.append(actions);

    (async () => {
      const report = await deviceReport(globalThis, { context: appContext() });
      body.innerHTML = '';
      for (const [label, value] of reportRows(report)) {
        body.append(el('div', { class: 'listitem' }, [
          el('div', { class: 'listitem__ico', text: '•' }),
          el('div', { class: 'listitem__body' }, [
            el('b', { text: label }),
            el('span', { text: String(value), dir: /^[\w\s.,:()×+\/\-]+$/.test(String(value)) ? 'ltr' : 'rtl' }),
          ]),
        ]));
      }
      const errs = lastErrors();
      if (errs.length) {
        body.append(el('div', { class: 'card' }, [
          el('div', { class: 'muted', text: `آخرین خطاها (${faNum(errs.length)})` }),
          ...errs.slice(-3).map((e) => el('div', { class: 'muted', dir: 'ltr', style: { textAlign: 'left', marginTop: '6px' }, text: `${e.where ? `${e.where} · ` : ''}${e.text}` })),
        ]));
      }
      actions.append(
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
