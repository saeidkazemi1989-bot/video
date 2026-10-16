/** Royalty-free music library: generated on the device, sampled live, then used. */
import { state, savePrefs } from '../state.js';
import { el, faNum, fmtTime, clamp, sleep, vibrate } from '../core/util.js';
import { GENRES, generateTrack } from '../core/musicgen.js';
import { markDirty } from '../project.js';
import { openSheet, closeSheet, btn, toast, slider, chips } from './shell.js';

let previewCtx = null;
let previewStop = null;

export function stopLibraryPreview() {
  try { previewStop?.(); } catch { /* noop */ }
  previewStop = null;
  try { previewCtx?.close(); } catch { /* noop */ }
  previewCtx = null;
}

/**
 * @param {(track:object)=>void} onPick called with a generated track
 * @param {{duration:number, musicStart?:number|null}} options
 */
export function openLibrarySheet({ onPick, duration = 30, startAt = 0 } = {}) {
  let selected = state.lastLibrary?.genre || 'pop';
  let seed = state.lastLibrary?.seed || Math.floor(Math.random() * 9999);
  let tempo = state.lastLibrary?.tempo || 1;
  let track = null;
  let playing = false;
  let includeOffset = 0;

  const status = el('div', { class: 'muted', text: 'پیش‌نمایش ۹ ثانیه‌ای ساخته می‌شود؛ نسخهٔ کامل بعد از انتخاب رندر می‌شود.' });
  const structureLine = el('div', { class: 'muted' });
  const waveCanvas = el('canvas', { style: { width: '100%', height: '52px', borderRadius: '10px', background: 'rgba(255,255,255,.04)' } });
  const playBtn = btn('▶ پیش‌نمایش', { small: true, onClick: () => (playing ? stop() : play()) });
  const useBtn = btn('✅ استفاده از این آهنگ', {
    primary: true, block: true, disabled: true,
    onClick: async () => {
      if (!track) return;
      persist();
      closeSheet();
      onPick?.(track);
    },
  });

  const genreChips = chips(GENRES.map((g) => ({ id: g.id, label: g.name, icon: g.icon })), selected, (id) => {
    selected = id;
    const g = GENRES.find((x) => x.id === id);
    tempo = clamp(tempo, 0.8, 1.25);
    seed = Math.floor(Math.random() * 9999);
    syncChips();
    buildPreview();
  });

  const seedBtn = btn('🎲 نسخهٔ دیگر', { small: true, ghost: true, onClick: () => { seed = Math.floor(Math.random() * 9999); buildPreview(); } });
  const speedSlider = slider({
    min: 80, max: 125, step: 1, value: Math.round(tempo * 100),
    format: (v) => `${faNum(v)}٪`,
    onInput: (v) => { tempo = v / 100; drawWave(); markDirty(); },
  });

  function persist() {
    state.lastLibrary = { genre: selected, seed, tempo };
    savePrefs();
  }

  function syncChips() {
    [...genreChips.children].forEach((c, i) => c.classList.toggle('is-on', GENRES[i].id === selected));
  }

  function drawWave() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = waveCanvas.parentElement?.clientWidth || 320;
    waveCanvas.width = w * dpr;
    waveCanvas.height = 52 * dpr;
    const ctx = waveCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, 52);
    const wave = track?.waveform;
    if (!wave) return;
    const n = wave.length;
    const cw = w / n;
    const startFrac = track.duration > duration ? clamp(includeOffset / track.duration, 0, 0.85) : 0;
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, wave[i] * 40);
      const inSel = i / n >= startFrac && i / n <= startFrac + duration / track.duration;
      ctx.fillStyle = inSel ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.28)';
      ctx.fillRect(i * cw + cw * 0.15, 26 - h / 2, Math.max(1, cw * 0.7), h);
    }
    // structure markers
    if (track.structure) {
      ctx.fillStyle = 'rgba(124,92,255,0.85)';
      for (const sec of track.structure) {
        if (sec.name === 'drop' || sec.name === 'drop2') {
          ctx.fillRect((sec.t0 / track.duration) * w, 44, 1.5, 6);
        }
      }
    }
  }

  async function buildPreview() {
    stop();
    useBtn.disabled = true;
    status.textContent = 'در حال ساخت پیش‌نمایش…';
    structureLine.textContent = '';
    const t0 = performance.now();
    try {
      const genre = GENRES.find((g) => g.id === selected);
      const fullDuration = clamp(Math.max(duration * 2.2, 75), 60, 150) * tempo;
      track = await generateTrack({
        genreId: selected,
        bpm: Math.round(genre.bpm * tempo),
        seed,
        onProgress: (p, label) => { status.textContent = `${label}… ${faNum(Math.round(p * 100))}٪`; },
      });
      // if the app only needs `duration` seconds, keep the best window
      if (track.duration > duration + 4) {
        includeOffset = clamp(track.bestStart - duration * 0.25, 0, Math.max(0, track.duration - duration - 0.5));
      } else includeOffset = 0;
      const secs = track.duration / Math.max(0.01, tempo);
      status.textContent = `آماده — ${Math.round(track.bpm)} BPM • ${Math.round(secs)} ثانیه (${((performance.now() - t0) / 1000).toFixed(1)} ثانیه ساخت)`;
      structureLine.textContent = (track.structure || [])
        .map((s) => `${({ intro: 'مقدمه', verse: 'بند', build: 'اوج‌گیری', drop: 'دراپ', break: 'استراحت', drop2: 'دراپ دوم', outro: 'پایان' })[s.name] || s.name}: ${fmtTime(s.t0)}`)
        .join(' • ');
      drawWave();
      useBtn.disabled = false;
    } catch (e) {
      console.error(e);
      status.textContent = `ساخت ناموفق بود: ${e.message}`;
    }
  }

  async function play() {
    if (!track) return;
    stop();
    previewCtx = new (window.AudioContext || window.webkitAudioContext)();
    await previewCtx.resume().catch(() => {});
    const src = previewCtx.createBufferSource();
    src.buffer = track.buffer;
    const gain = previewCtx.createGain();
    gain.gain.value = clamp((state.settings.musicGain ?? 1) * 0.9, 0, 1.5);
    const fade = previewCtx.createGain();
    fade.gain.setValueAtTime(0.0001, previewCtx.currentTime);
    fade.gain.exponentialRampToValueAtTime(1, previewCtx.currentTime + 0.25);
    src.connect(gain).connect(fade).connect(previewCtx.destination);
    const previewSeconds = 9;
    const startAtSec = clamp(includeOffset + 0.05, 0, Math.max(0, track.duration - previewSeconds));
    src.start(0, startAtSec, Math.min(previewSeconds, track.duration - startAtSec));
    const t0 = performance.now();
    playing = true;
    playBtn.textContent = '⏹ توقف';
    const tick = () => {
      if (!playing) return;
      const dt = (performance.now() - t0) / 1000;
      if (dt >= previewSeconds) return stop();
      drawProgress((startAtSec + dt) / track.duration);
      requestAnimationFrame(tick);
    };
    tick();
    previewStop = () => {
      try { src.stop(); } catch { /* noop */ }
      fade.gain.cancelScheduledValues(previewCtx?.currentTime || 0);
    };
  }

  function drawProgress(frac) {
    const w = waveCanvas.width / (Math.min(2, window.devicePixelRatio || 1));
    const h = 52;
    const ctx = waveCanvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = 'rgba(255,61,129,0.95)';
    ctx.fillRect(clamp(frac, 0, 1) * w, 0, 2, h);
    ctx.restore();
  }

  function stop() {
    playing = false;
    playBtn.textContent = '▶ پیش‌نمایش';
    try { previewStop?.(); } catch { /* noop */ }
    previewStop = null;
    try { previewCtx?.close(); } catch { /* noop */ }
    previewCtx = null;
    drawWave();
  }

  const close = openSheet(({ close: closeFn }) => el('div', { class: 'stack' }, [
    el('p', { class: 'lead', text: 'آهنگ خودم را می‌سازم — بدون کپی‌رایت و کاملاً روی همین گوشی. چون آهنگ را خودِ اپ می‌سازد، برش‌ها صد‌درصد روی ضرب می‌افتند.' }),
    genreChips,
    el('div', { class: 'row row--between' }, [
      el('div', {}, [el('b', { text: 'سرعت (تمپو)' }), el('div', { class: 'muted', text: 'بازهٔ طبیعی سبک' })]),
      seedBtn,
    ]),
    speedSlider,
    waveCanvas,
    el('div', { class: 'row' }, [playBtn, el('span', { class: 'muted', text: 'پیش‌نمایش از بهترین بخش آهنگ' })]),
    status,
    structureLine,
    useBtn,
    btn('بستن', { ghost: true, block: true, small: true, onClick: () => closeFn() }),
  ]), { title: '🎼 کتابخانهٔ آهنگ' });

  const wrappedClose = close;
  buildPreview();
  return wrappedClose;
}
