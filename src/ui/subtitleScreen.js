/** Subtitle tool: offline speech detection, word-synced cues, AI/local Whisper. */
import { state } from '../state.js';
import { el, faNum, fmtTime, clamp } from '../core/util.js';
import { ensurePlan, markDirty } from '../project.js';
import { detectSpeechSegments, buildSubtitles, estimateWpm } from '../core/vad.js';
import { decodeAnyAudio } from '../core/audio.js';
import { aiEnabled, aiTranscribe } from '../core/ai.js';
import { SUBTITLE_STYLES } from '../core/text.js';
import { applyOverlays } from '../core/overlays.js';
import { openSettingsSheet } from './settingsSheet.js';
import { btn, toast, openSheet, closeSheet, startBusy, updateBusy, stopBusy, slider, seg, chips } from './shell.js';

const LANG_FA = { plain: 'ساده با هایلایت', box: 'کادر مشکی', karaoke: 'کاراوکه رنگی', bold: 'درشت و پرانرژی' };

export function openSubtitleSheet({ onChange } = {}) {
  const plan = ensurePlan();
  if (!state.subtitleSource) {
    state.subtitleSource = {
      text: state.settings.autoSubtitles
        ? [plan.copy.hook, ...plan.copy.body].join(' ')
        : plan.copy.hook,
      segmentsByAsset: {},
      wordsByAsset: {},
      method: 'none',
    };
  }
  const src = state.subtitleSource;

  openSheet(({ close }) => {
    const status = el('div', { class: 'muted', text: summarize(src, plan) });
    const textArea = el('textarea', {
      class: 'textarea',
      value: src.text,
      placeholder: 'متن گفتار را اینجا بنویس یا از ویدیو استخراج کن…',
      oninput: (e) => { src.text = e.target.value; scheduleApply(); },
    });

    const styleChips = chips(
      Object.keys(SUBTITLE_STYLES).map((id) => ({ id, label: LANG_FA[id] || id })),
      state.settings.subtitleStyle || 'plain',
      (id) => {
        state.settings.subtitleStyle = id;
        state.planDirty = true;
        applyNow();
      },
    );

    let applyTimer = null;
    function scheduleApply() {
      clearTimeout(applyTimer);
      applyTimer = setTimeout(applyNow, 350);
    }

    function applyNow() {
      const planNow = ensurePlan();
      planNow._subtitleSource = src;
      planNow.settings.subtitles = true;
      applyOverlays(planNow);
      status.textContent = summarize(src, planNow);
      cueList.innerHTML = '';
      renderCues(cueList, planNow, src);
      onChange?.();
    }

    const cueList = el('div', { class: 'stack' });

    return el('div', { class: 'stack' }, [
      el('p', { class: 'lead', text: 'زیرنویس کلمه‌به‌کلمه، دقیقاً هم‌زمان با گفتار. گفتار را روی دستگاه پیدا می‌کنم و متن را بین بخش‌های صحبت پخش می‌کنم.' }),
      el('div', { class: 'listitem' }, [
        el('span', { class: 'listitem__ico', text: '🎙' }),
        el('div', { class: 'listitem__body' }, [
          el('b', { text: '۱) تشخیص گفتار در ویدیوها' }),
          el('span', { text: 'بدون اینترنت، با تحلیل صدا (RMS + شارژ طیفی + فلت‌نس)' }),
        ]),
      ]),
      el('div', { class: 'row' }, [
        btn('🎙 تحلیل گفتار ویدیوها', { small: true, onClick: () => runDetect(status, cueList, applyNow) }),
        btn('✨ استخراج متن از گفتار (هوش مصنوعی)', {
          small: true, ghost: true,
          onClick: () => {
            if (!aiEnabled()) return openSettingsSheet(() => toast('کلید ذخیره شد؛ دوباره امتحان کن', 'ok'));
            runAiTranscribe(status, cueList, applyNow, textArea);
          },
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '۲) متن زیرنویس' }),
        textArea,
        el('div', { class: 'row' }, [
          btn('📝 از کپشن', { small: true, ghost: true, onClick: () => { src.text = [plan.copy.hook, ...plan.copy.body].join(' '); textArea.value = src.text; applyNow(); } }),
          btn('🏷 فقط هوک', { small: true, ghost: true, onClick: () => { src.text = plan.copy.hook; textArea.value = src.text; applyNow(); } }),
        ]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: '۳) ظاهر زیرنویس' }),
        styleChips,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'تعداد کلمه در هر خط' }),
        slider({
          min: 2, max: 8, step: 1, value: plan.settings.subtitleWords || 5,
          format: (v) => `${faNum(v)} کلمه`,
          onInput: (v) => { plan.settings.subtitleWords = v; markDirty(); scheduleApply(); },
        }),
      ]),
      status,
      cueList,
      el('div', { class: 'row' }, [
        btn('✅ تمام', {
          primary: true,
          onClick: () => { applyNow(); state.planDirty = true; close(); onChange?.(); },
        }),
        btn('✖ حذف زیرنویس‌ها', {
          ghost: true,
          onClick: () => {
            plan.subtitles = [];
            state.settings.subtitles = false;
            markDirty();
            close();
            toast('زیرنویس‌ها حذف شدند', 'ok');
            onChange?.();
          },
        }),
      ]),
    ]);
  }, { title: '💬 زیرنویس خودکار' });
}

function summarize(src, plan) {
  const det = Object.keys(src.segmentsByAsset || {}).length;
  const cues = plan.subtitles?.length || 0;
  const ratio = plan.subtitleStats?.speechRatio;
  const wpm = plan.subtitles?.length ? estimateWpm(plan.subtitles) : 0;
  if (!det) return 'هنوز گفتاری تحلیل نشده — با دکمهٔ بالا شروع کن (یا متن را دستی بنویس).';
  return [
    `ویدیوهای تحلیل‌شده: ${faNum(det)}`,
    `بخش‌های گفتار: ${faNum(plan.subtitleStats?.segments || 0)}`,
    `خطوط زیرنویس: ${faNum(cues)}`,
    ratio != null ? `سهم گفتار: ${faNum(Math.round(ratio * 100))}٪` : '',
    wpm ? `سرعت گفتار: ${faNum(wpm)} کلمه/دقیقه` : '',
  ].filter(Boolean).join(' • ');
}

function renderCues(host, plan, src) {
  if (!plan.subtitles?.length) return;
  const head = el('div', { class: 'muted', text: 'پیش‌نمایش خطوط (با زمان‌بندی کلمه‌ای):' });
  host.append(head);
  plan.subtitles.slice(0, 40).forEach((cue) => {
    host.append(el('div', { class: 'row' }, [
      el('span', { class: 'badge', text: fmtTime(cue.t0) }),
      el('div', { class: 'tags' }, cue.words.map((w) => el('span', {
        class: 'tag',
        style: { opacity: '0.85' },
        text: `${w.w}`,
        title: `${w.t0.toFixed(2)}–${w.t1.toFixed(2)}`,
      }))),
    ]));
  });
}

async function runDetect(status, cueList, applyNow) {
  const vids = state.assets.filter((a) => a.use && a.kind === 'video');
  if (!vids.length) return toast('ویدیویی با صدا در پروژه نیست', 'err');
  const src = state.subtitleSource;
  const controller = new AbortController();
  startBusy('تحلیل گفتار…', 'روی همین گوشی', { onCancel: () => controller.abort() });
  try {
    for (let i = 0; i < vids.length; i++) {
      const asset = vids[i];
      updateBusy(i / vids.length, asset.name.slice(0, 24));
      try {
        const res = await fetch(asset.objectUrl);
        const buf = await res.arrayBuffer();
        const audio = await decodeAnyAudio(new File([buf], 'a.wav'));
        const vad = detectSpeechSegments(audio, { signal: controller.signal });
        src.segmentsByAsset[asset.id] = vad.segments;
        src.speechRatio = vad.speechRatio;
        // keep the per-clip cue hints for the UI
        src.wordsByAsset[asset.id] = vad.segments.length;
      } catch (e) {
        console.warn('vad failed for', asset.name, e);
      }
    }
    src.method = 'vad';
    stopBusy();
    applyNow();
    const total = Object.values(src.segmentsByAsset).reduce((a, b) => a + b.length, 0);
    toast(total ? `${faNum(total)} بخش گفتار پیدا شد` : 'گفتاری پیدا نشد — متن را دستی بنویس', total ? 'ok' : 'info', 4000);
  } catch (e) {
    stopBusy();
    if (e?.name !== 'AbortError') toast(`تحلیل گفتار ناموفق بود: ${e.message}`, 'err');
  }
}

async function runAiTranscribe(status, cueList, applyNow, textArea) {
  const asset = state.assets.find((a) => a.use && a.kind === 'video');
  if (!asset) return toast('ویدیویی پیدا نشد', 'err');
  startBusy('استخراج متن از گفتار…', 'ارسال به سرویس هوش مصنوعی', { onCancel: () => stopBusy() });
  try {
    const res = await aiTranscribe(asset.file, asset.name, state.settings.lang);
    stopBusy();
    if (!res?.text) throw new Error('متنی پیدا نشد');
    const src = state.subtitleSource;
    src.text = res.text;
    textArea.value = res.text;
    src.method = 'ai';
    if (res.words?.length) {
      // real word timestamps from the model → perfect subtitles
      src.aiWords = res.words;
      const plan = ensurePlan();
      plan.subtitles = groupWords(res.words, state.settings.subtitleWords || 5);
      plan.settings.subtitles = true;
      plan.subtitleStats = { segments: 1, cues: plan.subtitles.length, speechRatio: 1 };
      applyNow();
    } else {
      // no timings → still need the speech map; try a quick local pass
      await runDetect(status, cueList, applyNow);
    }
    toast('متن استخراج شد ✨', 'ok');
  } catch (e) {
    stopBusy();
    toast(e.message, 'err', 5000);
  }
}

function groupWords(words, maxWordsPerCue) {
  const cues = [];
  for (let i = 0; i < words.length; i += maxWordsPerCue) {
    const chunk = words.slice(i, i + maxWordsPerCue);
    if (!chunk.length) continue;
    cues.push({
      t0: chunk[0].t0,
      t1: chunk[chunk.length - 1].t1,
      text: chunk.map((w) => w.w).join(' '),
      words: chunk.map((w) => ({ w: w.w, t0: w.t0, t1: w.t1 })),
      source: 'ai',
    });
  }
  return cues;
}
