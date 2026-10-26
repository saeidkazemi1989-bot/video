/** Step 1 — pick the media, order it, tag a hero shot, run the analysis. */
import { state, notify, savePrefs } from '../state.js';
import { el, faNum, humanSize, fmtTime, clamp, vibrate } from '../core/util.js';
import { createAssetFromFile, assetDuration, makeVideoElement, seekVideo, prepareVideo, drawToCanvas } from '../core/media.js';
import { analyzeAll } from '../core/analyze.js';
import { makeDemoMedia } from '../core/demo.js';
import {
  go, btn, toast, startBusy, updateBusy, stopBusy, openSheet, closeSheet,
  setBottomBar, confirmSheet, setRouter, seg,
} from './shell.js';
import { patchSettings } from '../project.js';
import { briefCard } from './briefCard.js';

const MOOD_FA = {
  golden: 'گرم و طلایی', night: 'شبانه', mono: 'تکرنگ', vivid: 'پررنگ',
  action: 'پرانرژی', moody: 'حال‌وهوادار', clean: 'روشن و تمیز',
};

let abortRef = null;

export function renderMediaScreen(root) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);

  const rerenderAll = () => renderMediaScreen(root);

  if (!state.assets.length) wrap.append(heroCard());
  else wrap.append(gridCard(), analysisCard());

  wrap.append(addCard());
  // «هدف کلیپ» — the sentence that decides the whole edit
  wrap.append(briefCard({ rerender: rerenderAll }));
  setBottomBar([
    btn('مرحله بعد: سبک', {
      primary: true,
      disabled: !state.assets.some((a) => a.use),
      onClick: () => go(2),
    }),
  ]);
}

function heroCard() {
  return el('div', { class: 'hero' }, [
    el('span', { class: 'hero__pill', text: 'نسخه ۱.۰ • روی همین گوشی' }),
    el('h1', { html: 'ریل حرفه‌ای بساز،<br/><span class="grad-text">فقط با چند عکس و ویدیو</span>' }),
    el('p', { class: 'lead mt-8', text: 'سبک، ریتم، برش روی بیت، متن و کپشن مناسب و خروجی MP4 آمادهٔ اینستاگرام — همه به‌صورت خودکار و بدون آپلود روی سرور.' }),
    el('div', { class: 'steps-mini mt-16' }, [
      el('div', {}, [el('b', { text: '۱.' }), ' عکس‌ها و ویدیوهایت را اضافه می‌کنی']),
      el('div', {}, [el('b', { text: '۲.' }), ' اپ سبک و ریتم را انتخاب می‌کند (یا خودکار)']),
      el('div', {}, [el('b', { text: '۳.' }), ' متن، کپشن و هشتگ آماده می‌شود']),
      el('div', {}, [el('b', { text: '۴.' }), ' ریلز را می‌بینی و MP4 می‌گیری']),
    ]),
  ]);
}

function addCard() {
  const fileInput = el('input', {
    type: 'file', multiple: true, accept: 'image/*,video/*',
    style: { display: 'none' },
    onchange: (e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; },
  });
  const cameraInput = el('input', {
    type: 'file', accept: 'image/*,video/*', capture: 'environment',
    style: { display: 'none' },
    onchange: (e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; },
  });

  const zone = el('div', {
    class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); zone.classList.add('is-over'); },
    ondragleave: () => zone.classList.remove('is-over'),
    ondrop: (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const files = Array.from(e.dataTransfer?.files || []).filter((f) => f.type.startsWith('image') || f.type.startsWith('video'));
      if (files.length) addFiles(files);
      else toast('فقط عکس و ویدیو پشتیبانی می‌شود', 'err');
    },
    onclick: () => fileInput.click(),
  }, [
    el('div', { class: 'dropzone__icon', text: '🖼️' }),
    el('b', { text: state.assets.length ? 'افزودن عکس یا ویدیو' : 'گالری را باز کن و چند فایل انتخاب کن' }),
    el('div', {
      class: 'muted mt-8',
      text: state.settings.cutMode === 'sequence'
        ? 'حالت پشت‌سرهم فعال است — ویدیوها بدون برش و به ترتیب خودت می‌آیند'
        : 'محدودیتی در تعداد نیست — ویدیوهای طولانی را خودم کوتاه می‌کنم',
    }),
  ]);

  return el('div', { class: 'card card--pad-lg stack' }, [
    zone,
    fileInput, cameraInput,
    el('div', { class: 'row' }, [
      btn('📁 گالری', { small: true, onClick: () => fileInput.click() }),
      btn('📷 دوربین', { small: true, onClick: () => cameraInput.click() }),
      btn('✨ نمونهٔ آماده', { small: true, ghost: true, onClick: () => loadDemo() }),
    ]),
  ]);
}

function gridCard() {
  const mediaGrid = el('div', { class: 'grid-media' });
  state.assets.forEach((asset, i) => mediaGrid.append(thumb(asset, i)));
  const isSeq = state.settings.cutMode === 'sequence';
  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: `${faNum(state.assets.length)} فایل انتخاب‌شده` }),
      el('button', {
        class: 'chip',
        onclick: () => reorderAlphabetically(),
        title: 'مرتب‌سازی بر اساس نام فایل',
      }, ['🔢 ترتیب نام فایل']),
    ]),
    mediaGrid,
    el('div', { class: 'row mt-8' }, [
      el('span', { class: 'muted', text: 'روی هر فایل بزنی، از ریلز حذف/اضافه می‌شود. دکمه ⋮ برای برش، ستاره و جابه‌جایی.' }),
    ]),
    el('div', { class: 'field mt-8' }, [
      el('label', { text: 'نحوهٔ چیدمان و برش ویدیوها' }),
      seg([
        { id: 'beat', label: '✂️ برش ریتمیک' },
        { id: 'sequence', label: '🎞️ پشت‌سرهم (بدون برش)' },
      ], state.settings.cutMode || 'beat', (id) => {
        patchSettings({ cutMode: id });
        savePrefs();
        renderMediaScreen(document.getElementById('screen'));
      }),
      el('div', {
        class: 'muted',
        text: isSeq
          ? 'هر ویدیو کامل و بدون برش، دقیقاً به ترتیب بالا پخش می‌شود؛ فقط در رفتن به ویدیوی بعدی ترنزیشن می‌خورد و قاب و نور تنظیم می‌شود.'
          : 'ویدیوها هماهنگ با ضرب آهنگ برش می‌خورند و چیده می‌شوند.',
      }),
    ]),
  ]);
}

function thumb(asset, index) {
  const node = el('div', {
    class: `thumb ${asset.use ? '' : 'is-off'} ${asset.hero ? 'thumb--hero' : ''}`,
    style: asset.use ? {} : { opacity: '0.4' },
    onclick: () => { asset.use = !asset.use; vibrate(6); notify(); renderMediaScreen(document.getElementById('screen')); },
  }, [
    el('span', { class: 'thumb__idx', text: faNum(index + 1) }),
    el('span', { class: 'thumb__kind', text: asset.kind === 'video' ? '🎬' : '📷' }),
    asset.thumb ? asset.thumb : el('div', { style: { width: '100%', height: '100%', background: '#111' } }),
    el('span', {
      class: 'thumb__meta',
      text: asset.kind === 'video' ? fmtTime(assetDuration(asset)) : humanSize(asset.size || 0),
    }),
    asset.hero ? el('span', { class: 'thumb__score', text: '⭐' }) : null,
    asset.analysis ? el('span', {
      class: `badge ${asset.analysis.score > 0.62 ? 'badge--ok' : asset.analysis.score < 0.4 ? 'badge--warn' : ''}`,
      style: { position: 'absolute', bottom: '7px', insetInlineStart: '6px' },
      text: `${faNum(Math.round(asset.analysis.score * 100))}٪`,
    }) : null,
    el('button', {
      class: 'thumb__del',
      text: '⋮',
      onclick: (e) => { e.stopPropagation(); openAssetMenu(asset, index); },
    }),
  ]);
  return node;
}

function openAssetMenu(asset, index) {
  openSheet(({ close }) => el('div', { class: 'stack' }, [
    el('div', { class: 'listitem' }, [
      el('span', { class: 'listitem__ico', text: asset.kind === 'video' ? '🎬' : '📷' }),
      el('div', { class: 'listitem__body' }, [
        el('b', { text: asset.name }),
        el('span', {
          text: `${faNum(asset.width)}×${faNum(asset.height)}` +
            (asset.kind === 'video' ? ` • ${fmtTime(assetDuration(asset))}` : '') +
            (asset.analysis ? ` • امتیاز ${faNum(Math.round(asset.analysis.score * 100))}٪ • ${MOOD_FA[asset.analysis.mood] || ''}` : ''),
        }),
      ]),
    ]),
    asset.kind === 'video' ? btn('✂️ برش و سرعت ویدیو', { onClick: () => { close(); openTrimSheet(asset); } }) : null,
    btn(asset.hero ? '⭐ برداشتن ستاره' : '⭐ نمایش اول ریلز (هیرو)', {
      onClick: () => { asset.hero = !asset.hero; close(); notify(); renderMediaScreen(document.getElementById('screen')); },
    }),
    btn(asset.use ? '🚫 حذف از ریلز' : '✅ افزودن به ریلز', {
      onClick: () => { asset.use = !asset.use; close(); notify(); renderMediaScreen(document.getElementById('screen')); },
    }),
    el('div', { class: 'row' }, [
      btn('⟵ قبلی', { small: true, disabled: index === 0, onClick: () => { move(index, -1); close(); } }),
      btn('بعدی ⟶', { small: true, disabled: index === state.assets.length - 1, onClick: () => { move(index, 1); close(); } }),
      btn('بردن به اول', { small: true, ghost: true, onClick: () => { move(index, -index); close(); } }),
    ]),
    btn('🗑 حذف از پروژه', {
      danger: true, ghost: true,
      onClick: async () => {
        close();
        const ok = await confirmSheet({ title: 'حذف فایل', message: 'این فایل از پروژه حذف شود؟', confirmLabel: 'حذف', danger: true });
        if (!ok) return;
        state.assets.splice(index, 1);
        state.plan = null;
        renderMediaScreen(document.getElementById('screen'));
      },
    }),
  ]), { title: 'تنظیم این فایل' });
}

function openTrimSheet(asset) {
  const el_video = asset.objectUrl ? makeVideoElement(asset.objectUrl, { muted: true }) : null;
  if (el_video) {
    el_video.controls = true;
    el_video.style.width = '100%';
    el_video.style.borderRadius = '14px';
    el_video.style.background = '#000';
    el_video.style.maxHeight = '40vh';
  }
  const dur = asset.duration || 0;
  const state_ = { in: asset.trimIn || 0, out: asset.trimOut ?? dur, speed: asset.speed || 1 };

  return openSheet(({ close }) => {
    const info = el('div', { class: 'muted' });
    const sync = async () => {
      const used = Math.max(0.2, (state_.out - state_.in) / state_.speed);
      info.textContent = `بازه انتخابی: ${fmtTime(state_.out - state_.in)} → بعد از سرعت: ${fmtTime(used)}`;
      if (el_video) await seekVideo(el_video, state_.in + 0.05);
    };
    const inSlider = el('input', {
      type: 'range', min: 0, max: Math.max(0.2, dur), step: 0.05, value: state_.in,
      oninput: (e) => { state_.in = Math.min(Number(e.target.value), state_.out - 0.3); sync(); },
    });
    const outSlider = el('input', {
      type: 'range', min: 0, max: Math.max(0.2, dur), step: 0.05, value: state_.out,
      oninput: (e) => { state_.out = Math.max(Number(e.target.value), state_.in + 0.3); sync(); },
    });
    const speedRow = el('div', { class: 'seg' }, [0.5, 0.75, 1, 1.5, 2].map((s) => el('button', {
      class: state_.speed === s ? 'is-on' : '',
      text: `${faNum(s)}×`,
      onclick: (e) => {
        state_.speed = s;
        [...speedRow.children].forEach((c) => c.classList.remove('is-on'));
        e.currentTarget.classList.add('is-on');
        sync();
      },
    })));
    setTimeout(sync, 60);
    return el('div', { class: 'stack' }, [
      el_video,
      el('div', { class: 'field' }, [el('label', { text: `شروع: ${fmtTime(state_.in)}` }), inSlider]),
      el('div', { class: 'field' }, [el('label', { text: `پایان: ${fmtTime(state_.out)}` }), outSlider]),
      el('div', { class: 'field' }, [el('label', { text: 'سرعت پخش' }), speedRow]),
      info,
      el('div', { class: 'row' }, [
        btn('ذخیره', {
          primary: true,
          onClick: () => {
            asset.trimIn = clamp(state_.in, 0, dur);
            asset.trimOut = clamp(state_.out, asset.trimIn + 0.3, dur);
            asset.speed = state_.speed;
            asset.userTrimmed = true;
            asset.analysis = null;
            close();
            toast('برش ذخیره شد؛ فایل دوباره تحلیل می‌شود', 'ok');
            runAnalysis({ only: [asset] });
          },
        }),
        btn('حالت خودکار', {
          ghost: true,
          onClick: () => {
            asset.trimIn = 0;
            asset.trimOut = dur;
            asset.speed = 1;
            asset.userTrimmed = false;
            close();
            toast('برش دستی برداشته شد', 'ok');
          },
        }),
      ]),
    ]);
  }, { title: 'برش ویدیو' });
}

function analysisCard() {
  const usable = state.assets.filter((a) => a.use);
  const analyzed = usable.filter((a) => a.analysis);
  const totalVideo = usable.filter((a) => a.kind === 'video').reduce((s, a) => s + (assetDuration(a) || 0), 0);
  const moods = {};
  for (const a of analyzed) if (a.analysis?.mood) moods[a.analysis.mood] = (moods[a.analysis.mood] || 0) + 1;
  const topMood = Object.entries(moods).sort((a, b) => b[1] - a[1])[0];

  const progress = el('div', { class: 'meter' }, [el('i', { style: { width: `${(analyzed.length / Math.max(1, usable.length)) * 100}%` } })]);
  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'تحلیل هوشمند تصاویر' }),
      el('span', {
        class: `badge ${analyzed.length === usable.length ? 'badge--ok' : ''}`,
        text: analyzed.length === usable.length ? 'کامل شد' : `${faNum(analyzed.length)}/${faNum(usable.length)}`,
      }),
    ]),
    progress,
    el('div', { class: 'muted', text: 'نور، کنتراست، رنگ، شارپنس و حرکت هر فایل اندازه‌گیری می‌شود تا سبک، ترتیب نماها و نقاط برش بهتر انتخاب شوند. همه چیز روی همین گوشی پردازش می‌شود.' }),
    el('div', { class: 'row mt-8' }, [
      el('span', { class: 'badge', text: `${faNum(usable.filter((a) => a.kind === 'photo').length)} عکس` }),
      el('span', { class: 'badge', text: `${faNum(usable.filter((a) => a.kind === 'video').length)} ویدیو` }),
      el('span', { class: 'badge', text: `${fmtTime(totalVideo)} ویدیو خام` }),
      topMood ? el('span', { class: 'badge badge--ok', text: `حال‌وهوا: ${MOOD_FA[topMood[0]] || topMood[0]}` }) : null,
    ]),
    btn('🔄 تحلیل مجدد', { small: true, ghost: true, onClick: () => runAnalysis({ force: true }) }),
  ]);
}

/* ---------------- actions ---------------- */

async function addFiles(files) {
  if (!files.length) return;
  const controller = new AbortController();
  abortRef = controller;
  startBusy('در حال افزودن فایل‌ها…', `۰ از ${faNum(files.length)}`, { onCancel: () => controller.abort() });
  let added = 0;
  for (let i = 0; i < files.length; i++) {
    if (controller.signal.aborted) break;
    const f = files[i];
    updateBusy(i / files.length, `${faNum(i + 1)} از ${faNum(files.length)} — ${f.name.slice(0, 24)}`);
    try {
      const asset = await createAssetFromFile(f);
      state.assets.push(asset);
      added++;
    } catch (err) {
      console.warn(err);
      toast(`«${f.name}» اضافه نشد: ${err.message}`, 'err', 4000);
    }
  }
  stopBusy();
  abortRef = null;
  notify();
  renderMediaScreen(document.getElementById('screen'));
  if (added) {
    toast(`${faNum(added)} فایل اضافه شد`, 'ok');
    runAnalysis();
  }
}

async function runAnalysis({ force = false, only = null } = {}) {
  const targets = only || state.assets.filter((a) => a.use && (force || !a.analysis));
  if (!targets.length) return;
  const controller = new AbortController();
  abortRef = controller;
  state.analyzing = true;
  startBusy('تحلیل تصاویر…', 'نور، رنگ و حرکت', { onCancel: () => controller.abort() });
  try {
    await analyzeAll(targets, {
      signal: controller.signal,
      onProgress: (p, asset) => updateBusy(p, asset ? asset.name.slice(0, 26) : ''),
    });
    state.plan = null;
  } catch (e) {
    if (e?.name !== 'AbortError') toast(`تحلیل کامل نشد: ${e.message}`, 'err');
  } finally {
    state.analyzing = false;
    stopBusy();
    abortRef = null;
    notify();
    const screen = document.getElementById('screen');
    if (screen) renderMediaScreen(screen);
  }
}

async function loadDemo() {
  startBusy('ساخت نمونه‌های آزمایشی…', 'چند ثانیه صبر کن');
  try {
    const media = await makeDemoMedia({ onProgress: (p, s) => updateBusy(p * 0.6, s) });
    stopBusy();
    const files = media.map((m) => m.file);
    await addFiles(files);
  } catch (e) {
    stopBusy();
    toast(`نمونه ساخته نشد: ${e.message}`, 'err');
  }
}

function move(index, delta) {
  const to = clamp(index + delta, 0, state.assets.length - 1);
  if (to === index) return;
  const [a] = state.assets.splice(index, 1);
  state.assets.splice(to, 0, a);
  state.settings.orderMode = 'manual';
  notify();
  renderMediaScreen(document.getElementById('screen'));
}

function reorderAlphabetically() {
  state.assets.sort((a, b) => a.name.localeCompare(b.name, 'fa', { numeric: true }));
  state.settings.orderMode = 'intake';
  toast('بر اساس نام فایل مرتب شد', 'ok');
  renderMediaScreen(document.getElementById('screen'));
}
