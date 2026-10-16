/** Step 2 — pick the editing style and the output shape. */
import { state, notify } from '../state.js';
import { el, faNum, clamp, vibrate } from '../core/util.js';
import { PRESETS, DURATIONS, QUALITIES, ASPECTS, autoPreset } from '../data/styles.js';
import { go, btn, setBottomBar, chips, seg, switchRow, slider } from './shell.js';
import { patchSettings, markDirty } from '../project.js';
import { savePrefs } from '../state.js';

export function renderStyleScreen(root, { rerender } = {}) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);

  const autoPick = autoPreset(state.assets);

  wrap.append(el('div', { class: 'card card--pad-lg stack' }, [
    el('h3', { text: 'سبک تدوین' }),
    el('p', { class: 'muted', text: 'هر سبک، رنگ‌بندی، سرعت برش‌ها، نوع ترنزیشن و ظاهر متن‌ها را تعیین می‌کند.' }),
    el('div', { class: 'presets' }, PRESETS.map((p) => presetCard(p, autoPick))),
    state.presetId === 'auto'
      ? el('div', { class: 'badge badge--ok', text: `انتخاب خودکار بر اساس تحلیل تصاویر: ${autoPick.name}` })
      : null,
  ]));

  wrap.append(el('div', { class: 'card stack' }, [
    el('h3', { text: 'طول و شکل خروجی' }),
    el('div', { class: 'field' }, [
      el('label', { text: 'مدت ریلز (روی ضرب آهنگ تنظیم می‌شود)' }),
      chips(DURATIONS, state.settings.duration, (id) => { patchSettings({ duration: id }); savePrefs(); rerender?.(); }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'نسبت تصویر' }),
      seg(ASPECTS.map((a) => ({ id: a.id, label: a.label })), state.settings.aspect, (id) => { patchSettings({ aspect: id }); savePrefs(); rerender?.(); }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'کیفیت خروجی' }),
      el('div', { class: 'stack' }, QUALITIES.map((q) => el('button', {
        class: `listitem ${state.settings.quality === q.id ? 'is-on' : ''}`,
        style: state.settings.quality === q.id ? { borderColor: '#fff' } : {},
        onclick: () => { patchSettings({ quality: q.id }); savePrefs(); rerender?.(); },
      }, [
        el('span', { class: 'listitem__ico', text: q.id === '1080p' ? '⭐' : q.id === '720p' ? '⚡' : '💎' }),
        el('div', { class: 'listitem__body' }, [
          el('b', { text: q.label }),
          el('span', { text: `نرخ بیت حدود ${faNum(Math.round(q.bitrate / 1_000_000))} مگابیت بر ثانیه` }),
        ]),
      ]))),
    ]),
  ]));

  wrap.append(el('div', { class: 'card stack' }, [
    el('h3', { text: 'جزئیات حرفه‌ای' }),
    switchRow('متن روی تصویر', 'جمله اول و متن‌های کوتاه روی نماها', state.settings.captions !== false, (v) => { patchSettings({ captions: v }); rerender?.(); }),
    switchRow('جمله اول (هوک)', 'سه ثانیه اول، مهم‌ترین بخش ریلز است', state.settings.hook !== false, (v) => { patchSettings({ hook: v }); rerender?.(); }),
    switchRow('پایان‌بندی و دعوت به اقدام', 'متن پایانی + آیدی پیج', state.settings.outro !== false, (v) => { patchSettings({ outro: v }); rerender?.(); }),
    switchRow('نوار پیشرفت', 'نوار باریک پیشرفت در بالای کادر', state.settings.progressBar !== false, (v) => { patchSettings({ progressBar: v }); rerender?.(); }),
    switchRow('واترمارک آیدی', 'نمایش آیدی پیج روی ریلز', state.settings.watermark !== false, (v) => { patchSettings({ watermark: v }); rerender?.(); }),
    switchRow('قاب‌بندی هوشمند', 'تشخیص چهره/سوژه و حرکت آرام کادر همراه او', state.settings.smartReframe !== false, (v) => { patchSettings({ smartReframe: v }); rerender?.(); }),
    el('div', { class: 'field mt-8' }, [
      el('label', { text: 'صدای اصلی کلیپ‌ها زیر موسیقی' }),
      slider({
        min: 0, max: 100, step: 5, value: Math.round((state.settings.sourceGain ?? 0.35) * 100),
        format: (v) => `${faNum(v)}٪`,
        onInput: (v) => patchSettings({ sourceGain: v / 100 }),
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'ترتیب نماها' }),
      seg([
        { id: 'intake', label: 'همان ترتیب من' },
        { id: 'smart', label: 'هوشمند (بهترین اول)' },
      ], state.settings.orderMode, (id) => { patchSettings({ orderMode: id }); rerender?.(); }),
      el('div', { class: 'muted', text: state.settings.orderMode === 'intake'
        ? 'نماها به همان ترتیبی که اضافه کردی می‌آیند.'
        : 'اپ نماها را بر اساس کیفیت و تنوع مرتب می‌کند (ممکن است ترتیب عوض شود).' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'قاب‌بندی عکس و ویدیو در کادر ۹:۱۶' }),
      seg([
        { id: 'fit', label: 'کامل (بدون برش)' },
        { id: 'fill', label: 'پرکردن قاب' },
      ], state.settings.framing, (id) => { patchSettings({ framing: id }); rerender?.(); }),
      el('div', { class: 'muted', text: state.settings.framing === 'fill'
        ? 'قاب کاملاً پر می‌شود؛ بخشی از لبه‌های عکس برش می‌خورد (نگاه حرفه‌ای‌تر).'
        : 'همهٔ عکس دیده می‌شود و اطرافش با نسخهٔ محو خودِ عکس پر می‌شود.' }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'فریم بر ثانیه' }),
      seg([{ id: 30, label: '۳۰' }, { id: 60, label: '۶۰' }], state.settings.fps, (id) => { patchSettings({ fps: Number(id) }); rerender?.(); }),
    ]),
  ]));

  setBottomBar([
    btn('مرحله بعد: متن و کپشن', { primary: true, onClick: () => go(3) }),
  ]);
}

function presetCard(p, autoPick) {
  const active = state.presetId === p.id;
  return el('button', {
    class: `preset ${active ? 'is-on' : ''}`,
    style: { '--p1': p.palette[0], '--p2': p.palette[1], '--p3': p.palette[2] },
    onclick: () => {
      vibrate(6);
      state.presetId = p.id;
      markDirty();
      savePrefs();
      notify();
      renderStyleScreen(document.getElementById('screen'), { rerender: () => renderStyleScreen(document.getElementById('screen'), {}) });
    },
  }, [
    el('span', { class: 'preset__ico', text: p.icon }),
    el('span', { class: 'preset__name', text: p.name }),
    el('span', { class: 'preset__desc', text: p.id === 'auto' ? `پیشنهاد فعلی: ${autoPick.name}` : p.desc }),
    el('div', { class: 'row', style: { marginTop: '6px', gap: '4px' } }, p.palette.map((c) => el('i', {
      style: { width: '10px', height: '10px', borderRadius: '999px', background: c, display: 'block', border: '1px solid rgba(255,255,255,.5)' },
    }))),
  ]);
}
