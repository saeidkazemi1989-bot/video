/** Step 4 — music: analyse the track, show the beat grid, choose the start point. */
import { state, notify } from '../state.js';
import { el, faNum, fmtTime, clamp, vibrate } from '../core/util.js';
import { analyzeMusic, decodeAudio } from '../core/beats.js';
import { sliceAudioBuffer } from '../core/audio.js';
import { ensurePlan, markDirty, patchSettings } from '../project.js';
import { go, btn, toast, setBottomBar, startBusy, updateBusy, stopBusy, slider, seg, openSheet, closeSheet } from './shell.js';

const WINDOW_SECONDS = 180;

function musicInfo() {
  const m = state.music;
  if (!m?.analysis) return null;
  const offset = m.offset || 0;
  return {
    ...m.analysis,
    minStart: offset,
    duration: m.buffer ? offset + m.buffer.duration : (m.analysis.duration || 0),
  };
}

export { musicInfo };

export function renderMusicScreen(root, { rerender } = {}) {
  root.innerHTML = '';
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);
  const rerenderAll = () => renderMusicScreen(document.getElementById('screen'), {});

  const fileInput = el('input', {
    type: 'file', accept: 'audio/*,video/*', style: { display: 'none' },
    onchange: (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) loadMusic(f); },
  });
  wrap.append(fileInput);

  if (!state.music) {
    wrap.append(el('div', { class: 'card card--pad-lg stack' }, [
      el('h3', { text: 'آهنگ ریلز را انتخاب کن' }),
      el('p', { class: 'lead', text: 'هر فایل صوتی (mp3, m4a, wav…) یا حتی یک ویدیو که صدای مورد علاقه‌ات را دارد. تمپو و ضرب‌ها را خودم پیدا می‌کنم و برش‌ها را روی همان ضرب‌ها می‌گذارم.' }),
      el('div', { class: 'dropzone', onclick: () => fileInput.click() }, [
        el('div', { class: 'dropzone__icon', text: '🎵' }),
        el('b', { text: 'انتخاب فایل صوتی' }),
        el('div', { class: 'muted mt-8', text: 'صدا فقط روی دستگاه تو پردازش می‌شود' }),
      ]),
      btn('بدون موسیقی ادامه می‌دهم', {
        ghost: true, block: true, small: true,
        onClick: () => { state.music = null; patchSettings({ musicStart: null }); markDirty(); toast('بدون موسیقی — برش‌ها روی ضرب ۱۰۰ ساخته می‌شوند', 'info'); go(5); },
      }),
    ]));
  } else {
    wrap.append(musicCard(rerenderAll));
  }

  wrap.append(el('div', { class: 'card stack' }, [
    el('h3', { text: 'ترکیب صدا' }),
    el('div', { class: 'field' }, [
      el('label', { text: 'بلندی موسیقی' }),
      slider({
        min: 0, max: 150, step: 5, value: Math.round((state.settings.musicGain ?? 1) * 100),
        format: (v) => `${faNum(v)}٪`,
        onInput: (v) => patchSettings({ musicGain: v / 100 }),
      }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'بلندی صدای اصلی کلیپ‌ها' }),
      slider({
        min: 0, max: 100, step: 5, value: Math.round((state.settings.sourceGain ?? 0.35) * 100),
        format: (v) => (v === 0 ? 'قطع' : `${faNum(v)}٪`),
        onInput: (v) => patchSettings({ sourceGain: v / 100 }),
      }),
    ]),
    state.music ? btn('🗑 حذف آهنگ', { small: true, danger: true, ghost: true, onClick: () => { state.music = null; markDirty(); rerenderAll(); } }) : null,
  ]));

  const plan = ensurePlan();
  setBottomBar([
    btn('مرحله بعد: پیش‌نمایش', { primary: true, onClick: () => { ensurePlan({ force: true }); go(5); } }),
  ]);
}

function musicCard(rerenderAll) {
  const m = state.music;
  const a = m.analysis;
  const info = musicInfo();
  const planDuration = state.settings.duration;

  const canvas = el('canvas', { style: { width: '100%', height: '84px', borderRadius: '12px', background: 'rgba(255,255,255,.04)' } });
  const head = el('span', { class: `badge ${a.confidence > 0.4 ? 'badge--ok' : 'badge--warn'}`, text: a.confidence > 0.4 ? 'ضرب‌آهنگ واضح' : 'ضرب‌آهنگ نامطمئن' });

  let start = clamp(state.settings.musicStart ?? info.minStart, info.minStart, Math.max(info.minStart, info.duration - planDuration - 0.05));
  const startLabel = el('b', { class: 'mono', text: fmtTime(start) });
  const setStart = (v, { fromUser = true } = {}) => {
    const maxStart = Math.max(info.minStart, info.duration - planDuration - 0.05);
    start = clamp(v, info.minStart, maxStart);
    if (fromUser) {
      // snap to the closest beat so the first cut lands on the grid
      const beats = a.beats || [];
      let best = start, d = Infinity;
      for (const b of beats) { const dd = Math.abs(b - start); if (dd < d) { d = dd; best = b; } }
      if (d < 0.22) start = clamp(best, info.minStart, maxStart);
    }
    startLabel.textContent = fmtTime(start);
    patchSettings({ musicStart: start });
    draw();
  };

  const draw = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.parentElement?.clientWidth || 320;
    canvas.width = w * dpr;
    canvas.height = 84 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, 84);
    const wave = a.waveform || new Float32Array(0);
    const n = wave.length;
    const cw = w / Math.max(1, n);
    // selection
    ctx.fillStyle = 'rgba(124,92,255,0.22)';
    const selX = (start / info.duration) * w;
    const selW = (planDuration / info.duration) * w;
    ctx.fillRect(selX, 0, selW, 84);
    // waveform
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, wave[i] * 64);
      const x = i * cw;
      const inSel = x >= selX && x <= selX + selW;
      ctx.fillStyle = inSel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.32)';
      ctx.fillRect(x + cw * 0.15, 42 - h / 2, Math.max(1, cw * 0.7), h);
    }
    // beats
    const beats = a.beats || [];
    const step = Math.max(1, Math.ceil(beats.length / 300));
    for (let i = 0; i < beats.length; i += step) {
      const x = (beats[i] / info.duration) * w;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(255,179,92,0.75)' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, 6, 1, 12);
    }
    // playhead
    ctx.fillStyle = '#ff3d81';
    ctx.fillRect(selX, 0, 2, 84);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 80, w, 4);
    ctx.fillStyle = 'rgba(255,61,129,0.9)';
    ctx.fillRect(0, 80, Math.max(0, selX), 4);
  };

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const move = (ev) => {
      const x = clamp(ev.clientX - rect.left, 0, rect.width);
      setStart((x / rect.width) * info.duration);
    };
    move(e);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  setTimeout(draw, 30);
  window.addEventListener('resize', draw, { once: true });

  return el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('div', {}, [el('b', { text: m.name }), el('div', { class: 'muted', text: `${fmtTime(info.duration)} • ${faNum(a.bpm)} ضربه در دقیقه` })]),
      head,
    ]),
    canvas,
    el('div', { class: 'row row--between' }, [
      el('span', { class: 'muted', text: 'نقطه شروع (روی ضرب می‌پرد)' }),
      startLabel,
    ]),
    el('div', { class: 'row' }, [
      btn('⏮ اول آهنگ', { small: true, ghost: true, onClick: () => setStart(0) }),
      btn('✨ بهترین بخش', { small: true, ghost: true, onClick: () => setStart(a.bestStart ?? 0, { fromUser: false }) }),
      btn('💥 روی دراپ', { small: true, ghost: true, onClick: () => setStart(a.dropTime ?? 0, { fromUser: false }) }),
    ]),
    el('div', { class: 'muted', text: 'با کشیدن روی موج صوتی، نقطه شروع را جابه‌جا کن. برش‌های ریلز دقیقاً روی همین شبکه ضرب می‌افتند.' }),
  ]);
}

async function loadMusic(file) {
  const controller = new AbortController();
  startBusy('تحلیل آهنگ…', 'خواندن و پیدا کردن ضرب‌ها', { onCancel: () => controller.abort() });
  try {
    const analysis = await analyzeMusic(file, {
      signal: controller.signal,
      onProgress: (p, label) => updateBusy(p, label),
    });
    // keep memory sane: work on a window of long tracks
    const decoded = analysis.buffer;
    let buffer = decoded;
    let offset = 0;
    if (decoded.duration > WINDOW_SECONDS) {
      offset = clamp(analysis.bestStart - 30, 0, decoded.duration - WINDOW_SECONDS);
      buffer = sliceAudioBuffer(decoded, offset, WINDOW_SECONDS);
      updateBusy(0.98, 'آماده‌سازی پنجره صوتی');
    }
    state.music = { name: file.name, file, analysis, buffer, offset };
    state.settings.musicStart = null;
    markDirty();
    const plan = ensurePlan({ force: true });
    stopBusy();
    toast(`آهنگ خوانده شد — ${faNum(analysis.bpm)} ضربه در دقیقه`, 'ok');
    renderMusicScreen(document.getElementById('screen'), {});
  } catch (e) {
    stopBusy();
    if (e?.name === 'AbortError') return;
    toast(`آهنگ خوانده نشد: ${e.message}`, 'err', 5000);
  }
}

/** Free the decoded PCM once the project is finished/saved. */
export function releaseMusicBuffer(keepAnalysis = false) {
  if (!state.music) return;
  const { name, file, analysis } = state.music;
  state.music = { name, file, analysis, buffer: null, offset: 0 };
}
