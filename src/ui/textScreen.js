/** Step 3 — hook, on-screen lines, caption, hashtags (offline engine + optional AI). */
import { state, notify } from '../state.js';
import { el, faNum, copyText, vibrate } from '../core/util.js';
import { TONES, LANGS, CATEGORY_LABELS, HASHTAGS } from '../data/hooks.js';
import { buildCopy, guessTone } from '../core/captions.js';
import { ensurePlan, commitCopy, rebuildOverlays, markDirty } from '../project.js';
import { aiEnabled, aiGenerateCopy, aiTranscribe, aiStatusLabel } from '../core/ai.js';
import { openSettingsSheet } from './settingsSheet.js';
import { go, btn, toast, setBottomBar, chips, seg, openSheet, closeSheet, startBusy, updateBusy, stopBusy } from './shell.js';

export function renderTextScreen(root, { rerender } = {}) {
  root.innerHTML = '';
  const plan = ensurePlan();
  const copy = plan.copy;
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);

  const rerenderAll = () => renderTextScreen(document.getElementById('screen'), { rerender: rerenderAll });

  /* ---------- tone / language / topic ---------- */
  wrap.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'زبان، لحن و موضوع' }),
      el('span', { class: 'badge', text: CATEGORY_LABELS[copy.lang]?.[copy.category] || copy.category }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'زبان متن' }),
      seg(LANGS.map((l) => ({ id: l.id, label: l.label })), state.settings.lang, (id) => {
        commitCopySilently({ lang: id });
        regenerate({ lang: id });
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'لحن' }),
      chips([{ id: 'auto', label: 'خودکار', icon: '🎯' }, ...TONES.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))],
        state.settings.tone, (id) => { commitCopySilently({ tone: id }); regenerate({ tone: id }); }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'موضوع یا توضیح (اختیاری)' }),
      el('input', {
        class: 'input',
        value: state.settings.topic,
        placeholder: 'مثلاً: کافه‌گردی در تهران / تمرین پا با وزنه',
        oninput: (e) => { state.settings.topic = e.target.value; },
        onchange: () => regenerate({ topic: state.settings.topic }),
      }),
      el('div', { class: 'muted', text: 'با نوشتن موضوع، متن‌ها و هشتگ‌ها دقیقاً به محتوای تو می‌خورند.' }),
    ]),
  ]));

  /* ---------- hook ---------- */
  wrap.append(simpleFieldCard({
    title: 'جمله اول (هوک)',
    hint: 'کوتاه و کنجکاوکننده؛ روی تصویر و در ابتدای کپشن استفاده می‌شود.',
    value: copy.hook,
    onChange: (v) => { copy.hook = v; commitCopy({ hook: v }); rebuildOverlays(plan); },
    onShuffle: () => { regenerate(); },
  }));

  /* ---------- on-screen lines ---------- */
  const linesCard = el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: `متن روی تصویر (${faNum(copy.lines.length)} مورد)` }),
      el('div', { class: 'row' }, [
        btn('🎲', { small: true, ghost: true, onClick: () => regenerate() }),
        btn('➕', { small: true, ghost: true, onClick: () => { copy.lines.push('متن جدید'); commitCopy({ lines: copy.lines }); rerenderAll(); } }),
      ]),
    ]),
  ]);
  copy.lines.forEach((line, i) => {
    linesCard.append(el('div', { class: 'row' }, [
      el('input', {
        class: 'input',
        value: line,
        oninput: (e) => { copy.lines[i] = e.target.value; commitCopy({ lines: [...copy.lines] }); },
      }),
      el('button', {
        class: 'iconbtn',
        text: '✕',
        onclick: () => { copy.lines.splice(i, 1); commitCopy({ lines: [...copy.lines] }); rerenderAll(); },
      }),
    ]));
  });
  wrap.append(linesCard);

  /* ---------- caption ---------- */
  const captionArea = el('textarea', {
    class: 'textarea',
    value: copy.body.join('\n'),
    oninput: (e) => { copy.body = e.target.value.split('\n'); commitCopy({ body: copy.body }); },
  });
  wrap.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'کپشن' }),
      el('div', { class: 'row' }, [
        btn('🎲 بازنویسی', { small: true, ghost: true, onClick: () => regenerate() }),
        btn('📋 کپی', { small: true, ghost: true, onClick: async () => { await copyText(plan.copy.caption); toast('کپشن کپی شد', 'ok'); } }),
      ]),
    ]),
    captionArea,
    el('div', { class: 'field' }, [
      el('label', { text: 'دعوت به اقدام (CTA)' }),
      el('input', {
        class: 'input', value: copy.cta,
        oninput: (e) => { copy.cta = e.target.value; commitCopy({ cta: e.target.value }); rebuildOverlays(plan); },
      }),
    ]),
  ]));

  /* ---------- hashtags ---------- */
  wrap.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: `هشتگ‌ها (${faNum(copy.tags.length)})` }),
      el('div', { class: 'row' }, [
        btn('🎲', { small: true, ghost: true, onClick: () => regenerate() }),
        btn('📋 کپی', {
          small: true, ghost: true,
          onClick: async () => { await copyText(copy.tags.join(' ')); toast('هشتگ‌ها کپی شدند', 'ok'); },
        }),
      ]),
    ]),
    el('div', { class: 'tags' }, copy.tags.map((t) => el('span', { class: 'tag', text: t }))),
    btn('📋 کپی کل متن (کپشن + هشتگ)', {
      block: true, small: true,
      onClick: async () => { await copyText(plan.copy.caption); toast('کل متن کپی شد — در اینستاگرام پیست کن', 'ok'); },
    }),
  ]));

  /* ---------- AI ---------- */
  wrap.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'بهبود با هوش مصنوعی (اختیاری)' }),
      el('span', { class: `badge ${aiEnabled() ? 'badge--ok' : ''}`, text: aiEnabled() ? 'فعال' : 'خاموش' }),
    ]),
    el('p', { class: 'muted', text: aiStatusLabel() }),
    el('div', { class: 'row' }, [
      btn(aiEnabled() ? '✨ نوشتن متن با هوش مصنوعی' : '⚙️ تنظیم کلید هوش مصنوعی', {
        small: true,
        onClick: () => {
          if (!aiEnabled()) return openSettingsSheet(() => rerenderAll());
          runAi();
        },
      }),
      aiEnabled() ? btn('🎙 زیرنویس خودکار از گفتار', { small: true, ghost: true, onClick: () => runTranscribe() }) : null,
    ]),
  ]));

  setBottomBar([
    btn('مرحله بعد: موسیقی', { primary: true, onClick: () => go(4) }),
  ]);

  function commitCopySilently(patch) {
    if (patch.lang) state.settings.lang = patch.lang;
    if (patch.tone) state.settings.tone = patch.tone;
    markDirty();
  }

  function regenerate(overrides = {}) {
    const merged = {
      lang: overrides.lang || state.settings.lang,
      tone: overrides.tone || state.settings.tone,
      topic: overrides.topic !== undefined ? overrides.topic : state.settings.topic,
      shots: plan.cuts.length,
      duration: plan.duration,
      seed: Math.floor(Math.random() * 99999),
    };
    const fresh = buildCopy({
      presetId: plan.presetId,
      customCaption: state.settings.customCaption,
      ...merged,
    });
    const patch = {
      hook: fresh.hook, lines: fresh.lines, body: fresh.body, cta: fresh.cta,
      tags: fresh.tags, lang: fresh.lang, tone: fresh.tone,
      category: fresh.category, categoryLabel: fresh.categoryLabel, topic: fresh.topic,
    };
    patch.caption = [patch.body.join('\n'), patch.cta, patch.tags.join(' ')].filter(Boolean).join('\n\n');
    Object.assign(plan.copy, patch);
    commitCopy(patch);
    rerenderAll();
  }

  async function runAi() {
    startBusy('هوش مصنوعی در حال نوشتن…', 'چند ثانیه صبر کن', { onCancel: () => stopBusy() });
    try {
      const res = await aiGenerateCopy({
        lang: plan.copy.lang,
        tone: plan.copy.tone || guessTone(plan.presetId),
        topic: state.settings.topic,
        category: plan.copy.category,
        presetName: plan.preset.name,
        shots: plan.cuts.length,
        duration: plan.duration,
      });
      if (!res) throw new Error('کلید هوش مصنوعی تنظیم نشده است');
      const patch = {
        hook: res.hook || plan.copy.hook,
        lines: res.lines?.length ? res.lines : plan.copy.lines,
        body: res.body?.length ? res.body : plan.copy.body,
        cta: res.cta || plan.copy.cta,
        tags: res.tags?.length ? res.tags : plan.copy.tags,
        source: 'ai',
      };
      patch.caption = [patch.body.join('\n'), patch.cta, patch.tags.join(' ')].filter(Boolean).join('\n\n');
      Object.assign(plan.copy, patch);
      commitCopy(patch);
      toast('متن با هوش مصنوعی نوشته شد ✨', 'ok');
      rerenderAll();
    } catch (e) {
      toast(e.message, 'err', 5000);
    } finally {
      stopBusy();
    }
  }

  async function runTranscribe() {
    const video = state.assets.find((a) => a.kind === 'video' && a.use);
    if (!video) return toast('ویدیویی با صدا پیدا نشد', 'err');
    startBusy('تبدیل گفتار به متن…', 'فقط برای ویدیوی اول', { onCancel: () => stopBusy() });
    try {
      const text = await aiTranscribe(video.file, video.name, state.settings.lang);
      stopBusy();
      if (!text) throw new Error('متنی پیدا نشد');
      const body = text.split(/(?<=[.!؟?])\s+/).filter(Boolean).slice(0, 6);
      const patch = { body, caption: [body.join('\n'), plan.copy.cta, plan.copy.tags.join(' ')].join('\n\n') };
      Object.assign(plan.copy, patch);
      commitCopy(patch);
      toast('زیرنویس ساخته شد', 'ok');
      rerenderAll();
    } catch (e) {
      stopBusy();
      toast(e.message, 'err', 5000);
    }
  }
}

function simpleFieldCard({ title, hint, value, onChange, onShuffle }) {
  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: title }),
      onShuffle ? btn('🎲 پیشنهاد دیگر', { small: true, ghost: true, onClick: onShuffle }) : null,
    ]),
    el('textarea', {
      class: 'textarea',
      style: { minHeight: '68px' },
      value,
      oninput: (e) => onChange(e.target.value),
    }),
    hint ? el('div', { class: 'muted', text: hint }) : null,
  ]);
}
