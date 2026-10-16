/** Step 6 — render the final MP4, preview it, save/share and copy the caption. */
import { state } from '../state.js';
import { el, faNum, fmtTime, humanSize, downloadBlob, copyText, shareFile, clamp } from '../core/util.js';
import { QUALITIES } from '../data/styles.js';
import { ensurePlan, patchSettings } from '../project.js';
import { TimelineRenderer } from '../core/render.js';
import {
  go, btn, toast, setBottomBar, startBusy, updateBusy, stopBusy, slider, seg, openSheet, closeSheet,
} from './shell.js';
import { disposePreview } from './previewScreen.js';
import { openSubtitleSheet } from './subtitleScreen.js';

/** Export the edit decision list so a project can be re-opened elsewhere. */
function downloadPlanJson(plan) {
  const data = {
    app: 'ReelForge',
    version: plan.version,
    presetId: plan.presetId,
    settings: plan.settings,
    duration: plan.duration,
    bpm: plan.bpm,
    musicStart: plan.musicStart,
    cuts: plan.cuts.map((c) => ({
      assetId: c.assetId, assetName: c.asset?.name, t0: c.t0, dur: c.dur, trimIn: c.trimIn,
      trimOut: c.trimOut, speed: c.speed, transition: c.transition, motion: c.motion,
    })),
    overlays: plan.overlays,
    subtitles: plan.subtitles,
    copy: plan.copy,
  };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'reelforge-project.json');
  toast('فایل پروژه ذخیره شد', 'ok');
}

let exporting = false;

export function renderExportScreen(root, { rerender } = {}) {
  const plan = ensurePlan();
  root.innerHTML = '';
  const wrap = el('div', { class: 'stack' });
  root.append(wrap);
  const rerenderAll = () => renderExportScreen(document.getElementById('screen'), {});

  wrap.append(el('div', { class: 'card stack' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { text: 'خروجی نهایی' }),
      el('span', { class: 'badge badge--ok', text: `${faNum(plan.width)}×${faNum(plan.height)}` }),
    ]),
    el('div', { class: 'kv' }, [el('span', { text: 'مدت' }), el('b', { text: fmtTime(plan.duration) })]),
    el('div', { class: 'kv' }, [el('span', { text: 'سبک' }), el('b', { text: plan.preset.name })]),
    el('div', { class: 'kv' }, [el('span', { text: 'فریم بر ثانیه' }), el('b', { text: faNum(plan.fps) })]),
    el('div', { class: 'kv' }, [el('span', { text: 'صدا' }), el('b', { text: plan.music ? `${plan.music.name || 'آهنگ انتخابی'} • ${faNum(plan.bpm)} BPM${plan.music.genre ? ' • ساخت اپ' : ''}` : 'صدای اصلی کلیپ‌ها' })]),
    plan.subtitles?.length ? el('div', { class: 'kv' }, [el('span', { text: 'زیرنویس' }), el('b', { text: `${faNum(plan.subtitles.length)} خط هم‌زمان با گفتار` })]) : null,
    el('div', { class: 'field mt-8' }, [
      el('label', { text: 'کیفیت خروجی' }),
      el('div', { class: 'stack' }, QUALITIES.map((q) => el('button', {
        class: 'listitem',
        style: state.settings.quality === q.id ? { borderColor: '#fff' } : {},
        onclick: () => { patchSettings({ quality: q.id }); rerenderAll(); },
      }, [
        el('span', { class: 'listitem__ico', text: q.id === '1080p' ? '⭐' : q.id === '720p' ? '⚡' : '💎' }),
        el('div', { class: 'listitem__body' }, [el('b', { text: q.label }), el('span', { text: q.width === plan.width ? 'همین حالا انتخاب شده' : `خروجی ${faNum(q.width)}×${faNum(q.height)}` })]),
        state.settings.quality === q.id ? el('span', { class: 'badge badge--ok', text: '✓' }) : null,
      ]))),
    ]),
    el('div', { class: 'muted', text: 'رندر روی همین گوشی انجام می‌شود؛ برای ریلز ۳۰ ثانیه‌ای معمولاً بین ۳۰ تا ۹۰ ثانیه زمان می‌برد. صفحه را روشن نگه دار.' }),
  ]));

  /* ---------------- result ---------------- */
  if (state.output?.url) {
    const vid = el('video', {
      src: state.output.url, controls: true, playsInline: true, loop: true,
      style: { width: '100%', borderRadius: '14px', background: '#000' },
    });
    wrap.append(el('div', { class: 'card stack' }, [
      el('div', { class: 'card__head' }, [
        el('h3', { text: '🎉 ریلز آماده است' }),
        el('span', { class: 'badge badge--ok', text: humanSize(state.output.video.size) }),
      ]),
      vid,
      el('div', { class: 'stack' }, [
        btn('📥 ذخیره در گالری / دانلود MP4', {
          primary: true, block: true,
          onClick: () => { downloadBlob(state.output.video, state.output.filename); toast('در پوشه دانلود ذخیره شد', 'ok'); },
        }),
        btn('📤 اشتراک‌گذاری (اینستاگرام، واتساپ…)', {
          block: true,
          onClick: async () => {
            const res = await shareFile(state.output.video, state.output.filename, plan.copy.hook);
            if (res === 'downloaded') toast('اشتراک‌گذاری پشتیبانی نشد؛ فایل دانلود شد', 'info');
          },
        }),
        el('div', { class: 'row' }, [
          btn('📋 کپی کپشن', { small: true, onClick: async () => { await copyText(plan.copy.caption); toast('کپشن کپی شد', 'ok'); } }),
          btn('📝 کپی هشتگ‌ها', { small: true, onClick: async () => { await copyText(plan.copy.tags.join(' ')); toast('هشتگ‌ها کپی شد', 'ok'); } }),
          state.output.wav ? btn('🎧 دانلود صدای نهایی (WAV)', { small: true, onClick: () => downloadBlob(state.output.wav, state.output.filename.replace('.mp4', '.wav')) }) : null,
        ]),
        btn('🖼️ ذخیره کپشن در فایل متنی', {
          small: true, ghost: true,
          onClick: () => {
            const text = `هوک: ${plan.copy.hook}\n\n${plan.copy.body.join('\n')}\n\n${plan.copy.cta}\n\n${plan.copy.tags.join(' ')}\n`;
            downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), state.output.filename.replace('.mp4', '.txt'));
          },
        }),
      ]),
      el('div', { class: 'card' }, [
        el('h3', { text: '📌 راهنمای انتشار در اینستاگرام' }),
        el('div', { class: 'steps-mini mt-8' }, [
          el('div', {}, [el('b', { text: '۱.' }), ' فایل MP4 را با دکمه بالا ذخیره کن.']),
          el('div', {}, [el('b', { text: '۲.' }), ' در اینستاگرام روی ➕ بزن و «Reel» را انتخاب کن.']),
          el('div', {}, [el('b', { text: '۳.' }), ' از گالری همین فایل را انتخاب کن (نسبت ۹:۱۶ آماده است).']),
          el('div', {}, [el('b', { text: '۴.' }), ' کپشن را از دکمه «کپی کپشن» پیست کن.']),
          el('div', {}, [el('b', { text: '۵.' }), ' اگر موسیقی آپلود آی‌جی را ترجیح می‌دهی، موسیقی داخل ریلز را کم کن و ترک اینستاگرام را اضافه کن.']),
        ]),
      ]),
    ]));
  }

  /* ---------------- text summary ---------------- */
  wrap.append(el('div', { class: 'card stack' }, [
    el('h3', { text: 'متن آماده' }),
    el('div', { class: 'cap-block' }, [el('div', { class: 'cap-text cap-hook', text: plan.copy.hook })]),
    el('div', { class: 'cap-block' }, [el('div', { class: 'cap-text', text: plan.copy.body.join('\n') })]),
    el('div', { class: 'cap-block' }, [el('div', { class: 'cap-text', text: plan.copy.tags.join(' ') })]),
    el('div', { class: 'row', style: { flexWrap: 'wrap' } }, [
      btn('✏️ ویرایش متن', { small: true, ghost: true, onClick: () => go(3) }),
      btn('✂️ تدوین دستی', { small: true, ghost: true, onClick: () => go(5.5) }),
      btn('💬 زیرنویس', { small: true, ghost: true, onClick: () => openSubtitleSheet({ onChange: () => { plan.settings = { ...state.settings }; } }) }),
      btn('💾 خروجی پروژه (JSON)', { small: true, ghost: true, onClick: () => downloadPlanJson(plan) }),
      btn('🔁 رندر دوباره', { small: true, ghost: true, disabled: exporting, onClick: () => exportNow() }),
    ]),
  ]));

  setBottomBar([
    btn(state.output?.url ? '🔁 رندر مجدد' : '🎬 ساخت ریلز (رندر)', {
      primary: true,
      disabled: exporting,
      onClick: () => exportNow(),
    }),
    state.output?.url ? btn('▶️ پیش‌نمایش', { onClick: () => go(5) }) : null,
  ]);

  async function exportNow() {
    if (exporting) return;
    exporting = true;
    const planRef = ensurePlan();
    const controller = new AbortController();
    startBusy('رندر ریلز…', 'آماده‌سازی…', { onCancel: () => controller.abort() });
    disposePreview();
    const renderer = new TimelineRenderer({
      plan: planRef,
      outCanvas: document.createElement('canvas'),
      scale: 1,
      musicBuffer: state.music?.buffer || null,
    });
    try {
      const quality = QUALITIES.find((q) => q.id === state.settings.quality) || QUALITIES[0];
      const result = await renderer.exportVideo({
        onProgress: (p, label) => updateBusy(p, label),
        signal: controller.signal,
        quality,
      });
      stopBusy();
      if (state.output?.url) URL.revokeObjectURL(state.output.url);
      const url = URL.createObjectURL(result.video);
      const filename = `reelforge-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`;
      state.output = { video: result.video, wav: result.wav, url, filename, config: result.config };
      toast('ریلز ساخته شد 🎉', 'ok');
      rerenderAll();
    } catch (e) {
      stopBusy();
      if (e?.name === 'AbortError') toast('رندر لغو شد', 'info');
      else {
        console.error(e);
        toast(`رندر نشد: ${e.message}`, 'err', 6000);
      }
    } finally {
      exporting = false;
      renderer.dispose();
    }
  }
}
