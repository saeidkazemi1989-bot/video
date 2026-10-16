/** Step 5 — manual editor: timeline, per-shot editing, live preview. */
import { state, notify } from '../state.js';
import { el, faNum, fmtTime, clamp, sleep, vibrate } from '../core/util.js';
import { ensurePlan, markDirty } from '../project.js';
import { TimelineRenderer } from '../core/render.js';
import { TRANSITIONS } from '../data/styles.js';
import { captureFrame } from '../core/media.js';
import * as Edit from '../core/editPlan.js';
import { openSubtitleSheet } from './subtitleScreen.js';
import { openLibrarySheet } from './librarySheet.js';
import {
  go, btn, toast, setBottomBar, openSheet, closeSheet, slider, seg,
} from './shell.js';

const PALETTE = ['#7c5cff', '#ff3d81', '#ffb35c', '#22d39a', '#00e5ff', '#ffd166'];

export function renderEditorScreen(root, { rerender } = {}) {
  const plan = ensurePlan();
  let selected = state.editorIndex ?? 0;
  let audioCtx = null;
  let playing = false;

  root.innerHTML = '';
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);
  const rerenderAll = () => {
    state.editorIndex = selected;
    dispose();
    renderEditorScreen(document.getElementById('screen'), {});
  };

  /* ---------------- preview ---------------- */
  const scale = clamp(480 / plan.width, 0.3, 1);
  const canvas = el('canvas', { style: { width: '100%', display: 'block' } });
  const renderer = new TimelineRenderer({ plan, outCanvas: canvas, scale, musicBuffer: state.music?.buffer || null });
  const playIcon = el('div', { class: 'player__play', text: '▶' });
  const timeLabel = el('span', { class: 'player__time mono', text: `۰:۰۰ / ${fmtTime(plan.duration)}` });
  const cutBadge = el('span', { class: 'player__time', text: '' });
  const player = el('div', {
    class: 'player',
    style: { aspectRatio: `${plan.width} / ${plan.height}` },
    onclick: (e) => { if (e.target === player || e.target === canvas) toggle(); },
  }, [canvas, el('div', { class: 'player__overlay' }, [playIcon]), el('div', { class: 'player__hud' }, [timeLabel, cutBadge])]);

  let current = 0;
  function setHud(t) {
    current = t;
    timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(plan.duration)}`;
    playhead.style.right = `${(t / plan.duration) * 100}%`;
    const c = Edit.cutAt(plan, t);
    cutBadge.textContent = c ? `نمای ${faNum(c.index + 1)} • ${faNum(c.dur.toFixed(1))}ث` : '';
    highlight(c?.index);
  }

  async function play() {
    if (playing) return;
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    await audioCtx.resume().catch(() => {});
    if (current >= plan.duration - 0.05) current = 0;
    playing = true;
    playIcon.textContent = '❚❚';
    try {
      await renderer.startPreview({
        audioContext: audioCtx,
        startAt: current,
        onTick: setHud,
        onEnd: () => { playing = false; playIcon.textContent = '▶'; current = 0; setHud(0); },
      });
    } catch (e) {
      console.warn(e);
    }
    playing = false;
    playIcon.textContent = '▶';
  }
  function stopPlay() { playing = false; renderer.stopPreview(); playIcon.textContent = '▶'; }
  function toggle() { playing ? stopPlay() : play(); }
  function seekTo(t) { stopPlay(); setHud(clamp(t, 0, plan.duration)); renderer.renderFrameAt(current, { playing: false }).catch(() => {}); }
  function dispose() { stopPlay(); renderer.dispose(); }

  /* ---------------- timeline ---------------- */
  const track = el('div', { class: 'timeline__track', style: { borderRadius: '8px', height: '46px', top: '0', overflow: 'hidden', position: 'relative' } });
  const playhead = el('div', { class: 'timeline__play', style: { right: '0%', top: '0', height: '46px' } });
  const thumbsLayer = el('div', { style: { position: 'absolute', inset: '0', display: 'flex' } });
  track.append(thumbsLayer);
  const timeline = el('div', { class: 'timeline', style: { height: '46px' } }, [track, playhead]);

  const segNodes = [];
  function buildSegments() {
    thumbsLayer.innerHTML = '';
    segNodes.length = 0;
    plan.cuts.forEach((c, i) => {
      const seg = el('div', {
        class: 'timeline__seg',
        style: {
          width: ((c.dur / plan.duration) * 100).toFixed(3) + '%',
          background: PALETTE[i % PALETTE.length],
          position: 'relative',
          borderInlineEnd: '2px solid rgba(0,0,0,.55)',
          overflow: 'visible',
          touchAction: 'none',
        },
        onclick: (e) => { e.stopPropagation(); select(i); seekTo(c.t0 + 0.03); },
      });
      // drag handles: resize this shot (snapped to the beat grid)
      seg.append(handle(c, i, 'start'), handle(c, i, 'end'));
      segNodes.push(seg);
      thumbsLayer.append(seg);
      // async thumbnail
      if (c.asset) {
        captureFrame(c.asset, (c.trimIn || 0) + Math.min(c.dur * 0.35, 1.2), 120)
          .then((cv) => {
            if (!cv) return;
            cv.style.width = '100%';
            cv.style.height = '100%';
            cv.style.objectFit = 'cover';
            cv.style.opacity = '0.92';
            seg.prepend(cv);
          })
          .catch(() => {});
      }
    });
  }

  /** Drag handle on a clip edge. `side` is 'start' (right in RTL) or 'end'. */
  function handle(cut, index, side) {
    const isStart = side === 'start';
    const node = el('div', {
      style: {
        position: 'absolute',
        top: '0',
        bottom: '0',
        [isStart ? 'right' : 'left']: '-6px',
        width: '14px',
        borderRadius: '6px',
        background: 'rgba(255,255,255,0.28)',
        border: '1px solid rgba(255,255,255,0.55)',
        cursor: 'ew-resize',
        zIndex: '3',
        touchAction: 'none',
      },
      title: isStart ? 'کوتاه/بلند کردن از ابتدای نما' : 'کوتاه/بلند کردن از انتهای نما',
      onclick: (e) => e.stopPropagation(),
    });
    let startX = 0, startDur = 0, dragging = false;
    const down = (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      startDur = cut.dur;
      node.style.background = 'rgba(255,255,255,0.85)';
      select(index);
    };
    const move = (e) => {
      if (!dragging) return;
      const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      if (!x) return;
      const rect = track.getBoundingClientRect();
      const secPerPx = plan.duration / Math.max(1, rect.width);
      // in RTL the start edge is on the right: dragging right shrinks the shot
      const deltaSec = (isStart ? startX - x : x - startX) * secPerPx;
      const beat = Edit.beatPeriodOf(plan);
      const snapped = Math.round((startDur + deltaSec) / beat) * beat;
      if (Math.abs(snapped - cut.dur) < beat * 0.4) return;
      Edit.setCutBeats(plan, index, snapped / beat);
      markDirty();
      layout();
    };
    const up = () => {
      if (!dragging) return;
      dragging = false;
      node.style.background = 'rgba(255,255,255,0.28)';
      setHud(current);
    };
    node.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return node;
  }

  /** Cheap layout refresh: only widths / offsets change while dragging. */
  function layout() {
    plan.cuts.forEach((c, i) => {
      const node = segNodes[i];
      if (!node) return;
      node.style.width = ((c.dur / plan.duration) * 100).toFixed(3) + '%';
    });
    playhead.style.right = `${(current / plan.duration) * 100}%`;
  }

  function highlight(index) {
    segNodes.forEach((n, i) => {
      n.style.outline = i === index ? '2px solid #fff' : 'none';
      n.style.outlineOffset = '-2px';
    });
  }

  function select(i) {
    selected = clamp(i, 0, plan.cuts.length - 1);
    state.editorIndex = selected;
    highlight(selected);
    renderInspector();
  }

  // drag / scrub on the timeline
  let dragging = false;
  timeline.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.timeline__seg')) return;
    dragging = true;
    scrub(e);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointermove', (e) => { if (dragging) scrub(e); });
  function scrub(e) {
    const rect = timeline.getBoundingClientRect();
    const frac = clamp(1 - (e.clientX - rect.left) / rect.width, 0, 1);
    seekTo(frac * plan.duration);
  }

  /* ---------------- inspector ---------------- */
  const inspector = el('div', { class: 'card stack' });

  function renderInspector() {
    inspector.innerHTML = '';
    const cut = plan.cuts[selected];
    if (!cut) return;
    const beat = Edit.beatPeriodOf(plan);
    inspector.append(
      el('div', { class: 'card__head' }, [
        el('h3', { text: `نمای ${faNum(selected + 1)} از ${faNum(plan.cuts.length)}` }),
        el('span', { class: 'badge', text: `${faNum(cut.dur.toFixed(2))} ثانیه • ${faNum((cut.dur / beat).toFixed(1))} ضرب` }),
      ]),
      el('div', { class: 'listitem' }, [
        el('span', { class: 'listitem__ico', text: cut.asset?.kind === 'video' ? '🎬' : '📷' }),
        el('div', { class: 'listitem__body' }, [
          el('b', { text: cut.asset?.name || '—' }),
          el('span', {
            text: cut.asset?.kind === 'video'
              ? `منبع ${fmtTime(cut.trimIn)} → ${fmtTime(cut.trimOut)} • سرعت ${faNum(cut.speed.toFixed(2))}×`
              : 'تصویر (با حرکت دوربین)',
          }),
        ]),
      ]),
    );

    // length
    const lenLabel = el('b', { class: 'mono', text: `${faNum((cut.dur / beat).toFixed(1))} ضرب` });
    inspector.append(el('div', { class: 'field' }, [
      el('label', { text: 'طول نما (روی ضرب)' }),
      el('div', { class: 'row' }, [
        btn('−', { small: true, onClick: () => { Edit.resizeCut(plan, selected, -0.5); markDirty(); rerenderAll(); } }),
        btn('+', { small: true, onClick: () => { Edit.resizeCut(plan, selected, 0.5); markDirty(); rerenderAll(); } }),
        btn('−۲×', { small: true, ghost: true, onClick: () => { Edit.resizeCut(plan, selected, -2); markDirty(); rerenderAll(); } }),
        btn('+۲×', { small: true, ghost: true, onClick: () => { Edit.resizeCut(plan, selected, 2); markDirty(); rerenderAll(); } }),
        lenLabel,
      ]),
      el('div', { class: 'muted', text: 'زمان از نماهای همسایه گرفته می‌شود تا ریلز روی ضرب بماند.' }),
    ]));

    // actions
    inspector.append(el('div', { class: 'row', style: { flexWrap: 'wrap' } }, [
      btn('◀', { small: true, onClick: () => { Edit.moveCut(plan, selected, -1); select(selected - 1); markDirty(); rerenderAll(); } }),
      btn('▶', { small: true, onClick: () => { Edit.moveCut(plan, selected, 1); select(selected + 1); markDirty(); rerenderAll(); } }),
      btn('✂️ دو نیم', { small: true, onClick: () => { Edit.splitCut(plan, selected, plan.cuts[selected].t0 + plan.cuts[selected].dur / 2); markDirty(); rerenderAll(); } }),
      btn('⧉ تکرار', { small: true, onClick: () => { Edit.duplicateCut(plan, selected); markDirty(); rerenderAll(); } }),
      btn('🔁 فایل دیگر', { small: true, ghost: true, onClick: () => openReplaceSheet() }),
      btn('🕒 سرعت', { small: true, ghost: true, disabled: cut.asset?.kind !== 'video', onClick: () => openSpeedSheet() }),
      btn('🎞 ترنزیشن', { small: true, ghost: true, onClick: () => openTransitionSheet() }),
      btn('🗑 حذف', { small: true, danger: true, ghost: true, onClick: () => { Edit.deleteCut(plan, selected); select(Math.max(0, selected - 1)); markDirty(); rerenderAll(); } }),
    ]));
    return inspector;
  }

  function openReplaceSheet() {
    const usable = state.assets.filter((a) => a.use);
    openSheet(({ close }) => el('div', { class: 'stack' }, usable.map((a) => el('button', {
      class: 'listitem',
      onclick: () => {
        Edit.replaceAsset(plan, selected, a);
        markDirty();
        close();
        rerenderAll();
      },
    }, [
      el('span', { class: 'listitem__ico', text: a.kind === 'video' ? '🎬' : '📷' }),
      el('div', { class: 'listitem__body' }, [
        el('b', { text: a.name }),
        el('span', { text: a.kind === 'video' ? fmtTime(a.duration) : `${faNum(a.width)}×${faNum(a.height)}` }),
      ]),
      plan.cuts.some((c) => c.assetId === a.id) ? el('span', { class: 'badge', text: 'استفاده شده' }) : null,
    ]))), { title: 'انتخاب فایل برای این نما' });
  }

  function openSpeedSheet() {
    const cut = plan.cuts[selected];
    const speeds = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];
    openSheet(({ close }) => el('div', { class: 'stack' }, [
      el('p', { class: 'muted', text: 'سرعت آهسته باعث می‌شود صدای خود کلیپ حذف شود (تا زیر موسیقی فالش نشود).' }),
      seg(speeds.map((s) => ({ id: String(s), label: `${faNum(s)}×` })), String(cut.speedOverride ?? cut.speed), (id) => {
        Edit.setCutSpeed(plan, selected, Number(id));
        markDirty();
        close();
        rerenderAll();
      }),
    ]), { title: 'سرعت پخش' });
  }

  function openTransitionSheet() {
    const cut = plan.cuts[selected];
    const current = cut.transition?.type || 'cut';
    openSheet(({ close }) => el('div', { class: 'stack' }, [
      el('div', { class: 'pill-row' }, TRANSITIONS.map((t) => el('button', {
        class: `chip ${t === current ? 'is-on' : ''}`,
        text: t === 'cut' ? 'برش ساده' : t,
        onclick: () => { Edit.setTransition(plan, selected, t); markDirty(); close(); rerenderAll(); },
      }))),
      el('div', { class: 'field' }, [
        el('label', { text: 'طول انتقال' }),
        slider({
          min: 8, max: 120, step: 2, value: Math.round((cut.transition?.dur || 0.28) * 100),
          format: (v) => `${faNum((v / 100).toFixed(2))} ثانیه`,
          onInput: (v) => { Edit.setTransition(plan, selected, current, v / 100); },
        }),
      ]),
    ]), { title: `انتقال بین نمای ${faNum(selected)} و ${faNum(selected + 1)}` });
  }

  /* ---------------- assembly ---------------- */
  buildSegments();
  wrap.append(
    el('div', { class: 'row row--between' }, [
      el('div', { class: 'row' }, [
        btn('🎲 چیدمان دوباره', { small: true, ghost: true, onClick: () => { ensurePlan({ force: true, reseed: true }); markDirty(); rerenderAll(); } }),
        btn('🧲 چسباندن به ضرب', { small: true, ghost: true, onClick: () => { Edit.snapToGrid(plan); markDirty(); rerenderAll(); toast('همه برش‌ها روی ضرب نشستند', 'ok'); } }),
        btn('💬 زیرنویس', { small: true, ghost: true, onClick: () => openSubtitleSheet({ onChange: () => { setHud(current); } }) }),
        btn('🎼 کتابخانهٔ آهنگ', { small: true, ghost: true, onClick: () => openLibrarySheet({
          duration: plan.duration,
          onPick: (track) => { markDirty(); go(4); toast('آهنگ ساخته شد؛ در مرحلهٔ موسیقی اعمال کن', 'ok'); },
        }) }),
      ]),
      el('span', { class: 'badge', text: `${faNum(plan.cuts.length)} نما` }),
    ]),
    player,
    timeline,
    inspector,
    el('div', { class: 'card stack' }, [
      el('h3', { text: 'متن روی تصویر' }),
      ...plan.overlays.filter((o) => o.kind !== 'outro').map((o, idx) => el('div', { class: 'row' }, [
        el('span', { class: 'badge', text: fmtTime(o.t0) }),
        el('input', {
          class: 'input',
          value: o.text,
          oninput: (e) => { o.text = e.target.value; markDirty(); },
        }),
      ])),
      el('div', { class: 'muted', text: 'متن روی هر نما روی بیت‌های همان نما نمایش داده می‌شود؛ در مرحلهٔ متن می‌توانی فهرست کامل را ویرایش کنی.' }),
      btn('✏️ ویرایش کامل متن‌ها', { small: true, ghost: true, onClick: () => go(3) }),
    ]),
  );

  setBottomBar([
    btn('مرحله بعد: خروجی', { primary: true, onClick: () => { state.editorIndex = selected; stopPlay(); go(6); } }),
    btn('💾 ذخیره متنی پروژه', { onClick: () => savePlanJson(plan) }),
  ]);

  select(selected);
  setHud(0);
  renderer.renderFrameAt(0, { playing: false }).catch(() => {});
  return { dispose };
}

function savePlanJson(plan) {
  const data = {
    version: plan.version,
    presetId: plan.presetId,
    settings: plan.settings,
    duration: plan.duration,
    bpm: plan.bpm,
    cuts: plan.cuts.map((c) => ({
      assetId: c.assetId, assetName: c.asset?.name, t0: c.t0, dur: c.dur,
      trimIn: c.trimIn, trimOut: c.trimOut, speed: c.speed, transition: c.transition,
    })),
    overlays: plan.overlays,
    subtitles: plan.subtitles,
    copy: plan.copy,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reelforge-project.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  toast('فایل پروژه ذخیره شد', 'ok');
}
