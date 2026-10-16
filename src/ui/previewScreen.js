/** Step 5 — live preview of the edit with the timeline strip. */
import { state } from '../state.js';
import { el, faNum, fmtTime, clamp, vibrate } from '../core/util.js';
import { ensurePlan, markDirty } from '../project.js';
import { TimelineRenderer } from '../core/render.js';
import { go, btn, toast, setBottomBar } from './shell.js';
import { openSubtitleSheet } from './subtitleScreen.js';
import { openLibrarySheet } from './librarySheet.js';
import { patchSettings } from '../project.js';

let renderer = null;

export function disposePreview() {
  renderer?.dispose();
  renderer = null;
}

export function getPreviewRenderer() { return renderer; }

export function renderPreviewScreen(root, { rerender } = {}) {
  const plan = ensurePlan();
  renderer?.dispose();
  const scale = clamp(540 / plan.width, 0.35, 1);
  const canvas = el('canvas', { style: { width: '100%', height: 'auto', display: 'block' } });
  renderer = new TimelineRenderer({
    plan,
    outCanvas: canvas,
    scale,
    musicBuffer: state.music?.buffer || null,
  });

  const playIcon = el('div', { class: 'player__play', text: '▶' });
  const timeLabel = el('span', { class: 'player__time mono', text: `۰:۰۰ / ${fmtTime(plan.duration)}` });
  const overlay = el('div', { class: 'player__overlay' }, [playIcon]);
  const player = el('div', {
    class: 'player',
    style: { aspectRatio: `${plan.width} / ${plan.height}` },
    onclick: () => toggle(),
  }, [canvas, overlay, el('div', { class: 'player__hud' }, [timeLabel])]);

  // ---- timeline strip ----
  const track = el('div', { class: 'timeline__track' });
  const beatsLayer = el('div', { class: 'timeline' });
  const playhead = el('div', { class: 'timeline__play', style: { right: '0%' } });
  const timeline = el('div', { class: 'timeline', style: { height: '44px' } });
  const palette = ['#7c5cff', '#ff3d81', '#ffb35c', '#22d39a', '#00e5ff', '#ffd166'];
  plan.cuts.forEach((c, i) => {
    const width = (c.dur / plan.duration) * 100;
    const seg = el('div', {
      class: 'timeline__seg',
      style: { width: `${width}%`, background: palette[i % palette.length], opacity: c.asset?.hero ? '1' : '0.75' },
      title: `${faNum(i + 1)} — ${c.asset?.name || ''}`,
      onclick: (e) => { e.stopPropagation(); seekTo(c.t0 + 0.02); },
    });
    track.append(seg);
  });
  timeline.append(track, playhead);

  // beat ticks
  let beatStrip = null;
  if (plan.hasBeat && state.music?.analysis?.beats) {
    const beats = state.music.analysis.beats;
    const offset = state.music.offset || 0;
    beatStrip = el('div', { class: 'timeline', style: { height: '20px' } });
    for (let i = 0; i < beats.length; i++) {
      const rel = beats[i] - offset - plan.musicStart;
      if (rel < 0 || rel > plan.duration) continue;
      const isStrong = i % 4 === 0;
      beatStrip.append(el('div', {
        class: `timeline__beat ${isStrong ? 'timeline__beat--strong' : ''}`,
        style: { right: `${(rel / plan.duration) * 100}%` },
      }));
    }
  }

  const stack = el('div', { class: 'stack' });
  root.innerHTML = '';
  root.append(stack);
  stack.append(player);
  if (beatStrip) stack.append(beatStrip);
  stack.append(timeline);

  stack.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'خلاصه تدوین' }),
      el('span', { class: 'badge badge--ok', text: plan.preset.name }),
    ]),
    el('div', { class: 'kv' }, [el('span', { text: 'مدت ریلز' }), el('b', { text: fmtTime(plan.duration) })]),
    el('div', { class: 'kv' }, [el('span', { text: 'تعداد نما' }), el('b', { text: faNum(plan.meta.shots) })]),
    el('div', { class: 'kv' }, [el('span', { text: 'میانگین طول هر نما' }), el('b', { text: `${faNum(plan.meta.avgShot)} ثانیه` })]),
    el('div', { class: 'kv' }, [el('span', { text: 'ریتم' }), el('b', { text: plan.hasBeat ? `${faNum(plan.bpm)} BPM روی ضرب` : 'شبکه ۱۰۰ ضربه' })]),
    el('div', { class: 'kv' }, [el('span', { text: 'فایل‌های استفاده‌شده' }), el('b', { text: `${faNum(plan.meta.assetsUsed)} از ${faNum(state.assets.filter((a) => a.use).length)}` })]),
    el('div', { class: 'kv' }, [el('span', { text: 'ترنزیشن‌ها' }), el('b', { text: faNum(plan.meta.transitions) })]),
    el('div', { class: 'kv' }, [el('span', { text: 'رزولوشن خروجی' }), el('b', { text: `${faNum(plan.width)}×${faNum(plan.height)}` })]),
    el('div', { class: 'row mt-8', style: { flexWrap: 'wrap' } }, [
      btn('✂️ تدوین دستی', { small: true, onClick: () => go(5.5) }),
      btn('💬 زیرنویس خودکار', { small: true, ghost: true, onClick: () => openSubtitleSheet({ onChange: () => { renderer.renderFrameAt(current, { playing: false }).catch(() => {}); } }) }),
      btn('🎼 کتابخانهٔ آهنگ', { small: true, ghost: true, onClick: () => openLibrarySheet({ duration: plan.duration, onPick: () => go(4) }) }),
      btn('🎲 تدوین متفاوت', { small: true, ghost: true, onClick: () => { ensurePlan({ force: true, reseed: true }); markDirty(); rerender?.(); } }),
      btn('🎨 سبک و طول', { small: true, ghost: true, onClick: () => go(2) }),
      btn('✏️ ویرایش متن', { small: true, ghost: true, onClick: () => go(3) }),
    ]),
  ]));

  stack.append(el('div', { class: 'card stack' }, [
    el('h3', { text: 'متن این ریلز' }),
    el('div', { class: 'cap-block' }, [
      el('h3', { text: '🏷️ جمله اول' }),
      el('div', { class: 'cap-text cap-hook', text: plan.copy.hook }),
    ]),
    el('div', { class: 'cap-block' }, [
      el('h3', { text: '💬 کپشن' }),
      el('div', { class: 'cap-text', text: plan.copy.body.join('\n') }),
    ]),
    el('div', { class: 'tags' }, plan.copy.tags.slice(0, 14).map((t) => el('span', { class: 'tag', text: t }))),
    el('div', { class: 'muted', text: 'برای دیدن و کپی کل متن، مرحله «متن و کپشن» را باز کن.' }),
  ]));

  setBottomBar([
    btn('مرحله بعد: خروجی نهایی', { primary: true, onClick: () => { stop(); go(6); } }),
  ]);

  /* ---------------- playback ---------------- */
  let audioCtx = null;
  let playing = false;
  let current = 0;

  function setHud(t) {
    current = t;
    timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(plan.duration)}`;
    playhead.style.right = `${(t / plan.duration) * 100}%`;
  }

  async function play() {
    if (playing) return;
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    await audioCtx.resume().catch(() => {});
    if (current >= plan.duration - 0.05) current = 0;
    playing = true;
    playIcon.textContent = '❚❚';
    vibrate(8);
    try {
      await renderer.startPreview({
        audioContext: audioCtx,
        startAt: current,
        onTick: (t) => setHud(t),
        onEnd: () => { playing = false; playIcon.textContent = '▶'; setHud(plan.duration); current = 0; },
      });
    } catch (e) {
      console.warn(e);
      toast('پیش‌نمایش قطع شد', 'err');
    }
    playing = false;
    playIcon.textContent = '▶';
  }

  function stop() {
    playing = false;
    renderer?.stopPreview();
    playIcon.textContent = '▶';
  }

  function toggle() { playing ? stop() : play(); }

  function seekTo(t) {
    stop();
    setHud(clamp(t, 0, plan.duration));
    renderer.renderFrameAt(current, { playing: false }).catch(() => {});
  }

  setHud(0);
  renderer.renderFrameAt(0, { playing: false }).catch((e) => {
    console.warn(e);
    toast('پیش‌نمایش ساخته نشد — دکمه پخش را بزن', 'err');
  });

  return { stop };
}
