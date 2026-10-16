/** «وضعیت دستگاه» sheet — capability report the user can copy and send. */
import { el, faNum, copyText } from '../core/util.js';
import { openSheet, btn, toast } from './shell.js';
import { deviceReport, reportText, reportRows, lastErrors } from '../core/diag.js';

export function openDiagSheet() {
  openSheet(({ close }) => {
    const box = el('div', { class: 'stack' });
    const body = el('div', { class: 'list' }, [el('div', { class: 'muted', text: 'در حال بررسی دستگاه…' })]);
    box.append(body);
    const actions = el('div', { class: 'row' });
    box.append(actions);

    (async () => {
      const report = await deviceReport();
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
