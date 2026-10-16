/**
 * «🎯 هدف کلیپ» — the card where the user writes one sentence about what the clip
 * is for, and the app reads it and sets the edit up: style, music genre + tempo,
 * duration, text tone, subtitles, framing.
 *
 * Mounted on step 1 (right after the media) and step 2 (where the style lives).
 */
import { state, notify, savePrefs } from '../state.js';
import { el, faNum, vibrate } from '../core/util.js';
import { BRIEF_EXAMPLES } from '../core/brief.js';
import { applyBrief, currentBrief, markDirty } from '../project.js';
import { btn, toast, go } from './shell.js';
import { openLibrarySheet } from './librarySheet.js';
import { applyGeneratedTrack } from './musicScreen.js';

export function briefCard({ rerender, compact = false } = {}) {
  const card = el('div', { class: `card stack brief${compact ? ' brief--compact' : ''}` });
  const analysis = currentBrief();

  card.append(el('div', { class: 'card__head' }, [
    el('h3', { text: '🎯 هدف کلیپت چیه؟' }),
    analysis?.ok ? el('span', { class: 'badge badge--ok', text: 'تنظیم شد' }) : null,
  ]));
  card.append(el('p', {
    class: 'muted',
    text: 'یک جمله بنویس چه می‌خواهی این کلیپ بگوید؛ سبک تدوین، موسیقی، ریتم، لحن متن و زیرنویس را از همان می‌چینم.',
  }));

  const ta = el('textarea', {
    class: 'input brief__text',
    rows: compact ? 2 : 3,
    placeholder: 'مثلاً: می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون ترغیب بشه بخره',
    value: state.settings.brief || '',
  });
  const status = el('div', { class: 'muted brief__hint', text: '' });

  ta.addEventListener('input', () => {
    state.settings.brief = ta.value;
    status.textContent = ta.value.trim() ? 'هنوز تنظیم نشده — دکمهٔ زیر را بزن' : '';
  });
  card.append(ta);

  // one-tap examples
  const examples = el('div', { class: 'brief__examples' }, [
    el('div', { class: 'muted', text: 'یا یکی از این‌ها را بزن:' }),
    el('div', { class: 'chips' }, BRIEF_EXAMPLES.slice(0, compact ? 4 : 8).map((ex) => el('button', {
      class: 'chip chip--example',
      type: 'button',
      onclick: () => {
        vibrate(6);
        ta.value = ex.text;
        state.settings.brief = ex.text;
        run();
      },
    }, [`${ex.icon} ${ex.label}`]))),
  ]);
  card.append(examples);

  const readBtn = btn('✨ هدف را بخوان و تدوین را بچین', {
    primary: true, block: true,
    onClick: () => run(),
  });
  card.append(readBtn, status);

  /* ---------- what came out of the sentence ---------- */
  if (analysis?.ok) {
    const rows = [
      ['هدف', analysis.intentLabel],
      ['موضوع', analysis.categoryLabel],
      ['سبک تدوین', analysis.presetName],
      ['موسیقی', `${analysis.musicName} — ${faNum(analysis.musicBpm)} ضرب در دقیقه`],
      ['طول و ریتم', `${faNum(analysis.duration)} ثانیه · ${analysis.energyLabel}`],
      ['لحن متن', analysis.toneLabel],
      ['زیرنویس', analysis.subtitles ? 'روشن' : 'خاموش'],
      ['قاب‌بندی', analysis.framing === 'fill' ? 'پرکردن قاب' : 'کامل (بدون برش)'],
    ];
    const box = el('div', { class: 'brief__result stack' }, [
      el('div', { class: 'card__head' }, [
        el('b', { text: 'از توضیحت این‌ها را برداشتم' }),
        el('span', { class: 'muted', text: analysis.keywords.length ? `کلیدواژه: ${analysis.keywords.join('، ')}` : '' }),
      ]),
      el('div', { class: 'kv' }, rows.map(([k, v]) => el('div', { class: 'kv__row' }, [
        el('span', { class: 'kv__k', text: k }),
        el('b', { class: 'kv__v', text: v }),
      ]))),
    ]);
    if (analysis.intent === 'general' && analysis.category === 'general') {
      box.append(el('div', { class: 'muted', text: 'دقیقاً نفهمیدم موضوع چیه؛ یک کلمه از موضوع اصلی هم اضافه کن (مثلاً «کافه»، «سفر»، «تمرین»).' }));
    }
    // the music is generated from the plan, so offer the jump right here
    box.append(el('div', { class: 'row' }, [
      btn(state.music?.generated ? '🎵 ساخت آهنگ جدید مطابق هدف' : '🎵 کتابخانهٔ آهنگ با همین ژانر', {
        small: true,
        onClick: () => openLibrarySheet({
          duration: state.settings.duration,
          onPick: (track) => { applyGeneratedTrack(track); markDirty(); toast('آهنگ مطابق هدف کلیپ انتخاب شد', 'ok'); (rerender || (() => {}))(); },
        }),
      }),
      btn('🎬 دیدن پیش‌نمایش', { small: true, ghost: true, onClick: () => go(5) }),
    ]));
    card.append(box);
  } else if (analysis && !analysis.ok) {
    card.append(el('div', { class: 'muted', text: analysis.notes?.[0] || '' }));
  }

  function run() {
    const text = ta.value;
    state.settings.brief = text;
    const res = applyBrief(text);
    if (!res.ok) {
      vibrate(24);
      status.textContent = 'یک جمله دربارهٔ هدف کلیپ بنویس (حداقل چند کلمه).';
      toast('هدف کلیپ خالی است', 'err');
      return;
    }
    savePrefs();
    markDirty();
    notify();
    vibrate(10);
    const a = res.analysis;
    toast(`خواندم: ${a.intentLabel} · سبک «${a.presetName}» · ${a.musicName}${res.keptMusic ? ' (موسیقی خودت حفظ شد)' : ''}`, 'ok', 4200);
    (rerender || (() => {}))();
  }

  return card;
}
