/**
 * Style presets. Each preset is a complete "editing personality": colour
 * grade, motion language, transitions, pacing and caption look.
 * All values are plain numbers so the WebGL grader can consume them directly.
 */

const baseGrade = {
  exposure: 1.0,
  contrast: 1.04,
  saturation: 1.0,
  temperature: 0.0,   // -1 cool .. +1 warm
  tint: 0.0,          // -1 green .. +1 magenta
  vibrance: 0.1,
  lift: [0, 0, 0],    // shadow tint
  gain: [1, 1, 1],    // highlight tint / white balance
  gamma: 1.0,
  fade: 0.0,          // lifts blacks (film look)
  vignette: 0.18,
  grain: 0.04,
  sharpen: 0.3,
  chroma: 0.0,        // chromatic aberration
  bloom: 0.0,         // soft glow on highlights
  scanlines: 0.0,
  hueShift: 0.0,
  letterbox: 0.0,
  gateWeave: 0.0,     // subtle hand-held drift
};

const baseCaption = {
  font: 'display',
  weight: 900,
  size: 0.055,        // × canvas height
  color: '#ffffff',
  uppercase: false,
  letterSpacing: 0,
  lineHeight: 1.3,
  stroke: 0.09,       // × font size
  strokeColor: 'rgba(0,0,0,0.82)',
  shadow: 0.35,
  bg: null,
  highlight: '#ffd166',
  pos: 'center',
  anim: 'pop',
  progress: true,
  maxWords: 4,
};

const p = (o) => ({
  ...o,
  grade: { ...baseGrade, ...(o.grade || {}) },
  caption: { ...baseCaption, ...(o.caption || {}) },
});

export const PRESETS = [
  p({
    id: 'auto',
    name: 'هوشمند (خودکار)',
    desc: 'بر اساس نور، رنگ و حرکت ویدیوها سبک را خودش انتخاب می‌کند',
    icon: '✨',
    palette: ['#7c5cff', '#ff3d81', '#ffb35c'],
    auto: true,
    pace: 1.0,
    minShot: 1.1,
    maxShot: 4.2,
    motion: 'auto',
    transition: 'auto',
    transDur: 0.22,
    music: { duck: 0.5 },
    intro: { enabled: true, dur: 2.0 },
    outro: { enabled: true, dur: 2.2 },
  }),
  p({
    id: 'cinematic',
    name: 'سینمایی',
    desc: 'کنتراست بالا، رنگ سرد-گرم، حرکت آرام و نماهای نفس‌گیر',
    icon: '🎬',
    palette: ['#0f2f3f', '#ff8a3d', '#e8e2d6'],
    grade: {
      contrast: 1.14, saturation: 0.94, temperature: -0.06, vibrance: 0.05,
      lift: [0.01, 0.014, 0.03], gain: [1.06, 1.0, 0.92], gamma: 0.98,
      fade: 0.03, vignette: 0.34, grain: 0.05, sharpen: 0.34, bloom: 0.18,
      letterbox: 0.0,
    },
    caption: { font: 'display', size: 0.048, letterSpacing: 0.01, pos: 'lower', anim: 'slideup', stroke: 0.06, shadow: 0.5, progress: true },
    pace: 1.45, minShot: 1.8, maxShot: 6.0,
    motion: 'kenburns-slow',
    transition: 'fade',
    transDur: 0.5,
    music: { duck: 0.35 },
    intro: { enabled: true, dur: 2.4 },
    outro: { enabled: true, dur: 2.6 },
  }),
  p({
    id: 'vlog',
    name: 'ولاگ روزانه',
    desc: 'روشن و صمیمی، برش‌های تند، متن تمیز و خوانا',
    icon: '📹',
    palette: ['#ffd9a0', '#8ad3ff', '#fff6ea'],
    grade: { exposure: 1.06, contrast: 1.02, saturation: 1.08, temperature: 0.1, vibrance: 0.18, vignette: 0.1, grain: 0.03, sharpen: 0.32 },
    caption: { font: 'sans', weight: 800, size: 0.05, pos: 'lower', anim: 'pop', bg: { color: 'rgba(0,0,0,0.42)', radius: 0.42, pad: 0.55 }, stroke: 0 },
    pace: 0.85, minShot: 0.9, maxShot: 3.2,
    motion: 'auto',
    transition: 'cut',
    transDur: 0.16,
    music: { duck: 0.55 },
    intro: { enabled: true, dur: 1.6 },
    outro: { enabled: true, dur: 2.0 },
  }),
  p({
    id: 'fashion',
    name: 'فشن و مدلینگ',
    desc: 'کول و پرکنتراست، متن سفید درشت، ترنزیشن‌های ضربه‌ای',
    icon: '🕶️',
    palette: ['#111318', '#c8b8a4', '#7f8ea3'],
    grade: { contrast: 1.2, saturation: 0.82, temperature: -0.1, tint: 0.04, vibrance: -0.05, lift: [0.004, 0.006, 0.014], gain: [1.02, 1.0, 1.0], fade: 0.05, vignette: 0.3, grain: 0.045, sharpen: 0.42 },
    caption: { font: 'display', size: 0.058, uppercase: true, letterSpacing: 0.06, pos: 'center', anim: 'wordpop', stroke: 0, shadow: 0.6, highlight: '#ffffff' },
    pace: 0.7, minShot: 1.0, maxShot: 3.4,
    motion: 'punch',
    transition: 'zoomblur',
    transDur: 0.24,
    music: { duck: 0.6 },
    intro: { enabled: true, dur: 1.8 },
    outro: { enabled: true, dur: 2.0 },
  }),
  p({
    id: 'sport',
    name: 'ورزشی و پرانرژی',
    desc: 'فلاش، شیک، اسلوموشن و برش روی هر ضرب',
    icon: '⚡',
    palette: ['#08090c', '#ff3b30', '#ffd60a'],
    grade: { contrast: 1.22, saturation: 1.14, temperature: 0.02, vibrance: 0.2, vignette: 0.34, grain: 0.06, sharpen: 0.5, bloom: 0.22 },
    caption: { font: 'display', size: 0.062, uppercase: true, letterSpacing: 0.02, pos: 'center', anim: 'impact', stroke: 0.1, shadow: 0.4, highlight: '#ffd60a' },
    pace: 0.55, minShot: 0.7, maxShot: 2.6,
    motion: 'punch',
    transition: 'flash',
    transDur: 0.18,
    music: { duck: 0.7 },
    intro: { enabled: true, dur: 1.4 },
    outro: { enabled: true, dur: 1.8 },
  }),
  p({
    id: 'viral',
    name: 'ویروسی (تیک‌تاکی)',
    desc: 'رنگ شاداب، متن کلمه‌به‌کلمه روی بیت، سرعت بالا',
    icon: '🚀',
    palette: ['#00e5ff', '#ff2d9b', '#ffe066'],
    grade: { exposure: 1.05, contrast: 1.1, saturation: 1.22, temperature: 0.04, vibrance: 0.3, vignette: 0.16, grain: 0.03, sharpen: 0.44, bloom: 0.12 },
    caption: { font: 'display', size: 0.06, weight: 900, pos: 'center', anim: 'karaoke', stroke: 0.11, strokeColor: 'rgba(0,0,0,0.9)', shadow: 0.3, highlight: '#00e5ff' },
    pace: 0.6, minShot: 0.8, maxShot: 2.8,
    motion: 'auto',
    transition: 'whip',
    transDur: 0.2,
    music: { duck: 0.45 },
    intro: { enabled: true, dur: 1.5 },
    outro: { enabled: true, dur: 1.8 },
  }),
  p({
    id: 'retro',
    name: 'رترو و VHS',
    desc: 'رنگ‌های پریده، دانه فیلم، گلیچ و اعوجاج رنگی',
    icon: '📼',
    palette: ['#f2c14e', '#c8553d', '#5b6c8f'],
    grade: { contrast: 0.96, saturation: 0.88, temperature: 0.14, tint: 0.05, fade: 0.14, vignette: 0.4, grain: 0.16, sharpen: 0.2, chroma: 0.5, scanlines: 0.22, bloom: 0.2 },
    caption: { font: 'display', size: 0.052, uppercase: true, letterSpacing: 0.04, pos: 'lower', anim: 'typewriter', stroke: 0.08, shadow: 0.4, highlight: '#f2c14e' },
    pace: 0.95, minShot: 1.2, maxShot: 4.0,
    motion: 'kenburns',
    transition: 'glitch',
    transDur: 0.3,
    music: { duck: 0.5 },
    intro: { enabled: true, dur: 2.0 },
    outro: { enabled: true, dur: 2.2 },
  }),
  p({
    id: 'noir',
    name: 'سیاه‌وسفید هنری',
    desc: 'مونوکروم پرکنتراست، حرکت آرام و متن مینیمال',
    icon: '🎞️',
    palette: ['#0d0d0d', '#e8e8e8', '#8f8f8f'],
    grade: { contrast: 1.26, saturation: 0.0, temperature: 0.0, fade: 0.04, vignette: 0.42, grain: 0.12, sharpen: 0.36, bloom: 0.1 },
    caption: { font: 'serif', size: 0.05, letterSpacing: 0.02, pos: 'bottom', anim: 'fade', stroke: 0, shadow: 0.5 },
    pace: 1.5, minShot: 2.0, maxShot: 6.5,
    motion: 'kenburns-slow',
    transition: 'fade',
    transDur: 0.55,
    music: { duck: 0.4 },
    intro: { enabled: true, dur: 2.6 },
    outro: { enabled: true, dur: 2.8 },
  }),
  p({
    id: 'food',
    name: 'غذا و کافه',
    desc: 'گرم و اشتهاآور، جزئیات واضح، متن نرم',
    icon: '🍽️',
    palette: ['#ff9f1c', '#e76f51', '#f6e7d8'],
    grade: { exposure: 1.05, contrast: 1.06, saturation: 1.12, temperature: 0.16, vibrance: 0.22, lift: [0.012, 0.006, 0.0], gain: [1.05, 1.0, 0.95], vignette: 0.22, grain: 0.03, sharpen: 0.42, bloom: 0.1 },
    caption: { font: 'display', size: 0.05, pos: 'lower', anim: 'slideup', stroke: 0.08, shadow: 0.45, highlight: '#ffb35c' },
    pace: 1.15, minShot: 1.4, maxShot: 4.4,
    motion: 'kenburns',
    transition: 'slide',
    transDur: 0.28,
    music: { duck: 0.5 },
    intro: { enabled: true, dur: 1.8 },
    outro: { enabled: true, dur: 2.0 },
  }),
  p({
    id: 'travel',
    name: 'سفر و طبیعت',
    desc: 'رنگ‌های زنده، پن نرم و انتقال‌های اسموت',
    icon: '🌍',
    palette: ['#1b9aaa', '#f5a623', '#e8f1f2'],
    grade: { exposure: 1.03, contrast: 1.1, saturation: 1.06, temperature: -0.02, vibrance: 0.26, vignette: 0.24, grain: 0.03, sharpen: 0.38, bloom: 0.14 },
    caption: { font: 'display', size: 0.05, pos: 'lower', anim: 'slideup', stroke: 0.07, shadow: 0.5 },
    pace: 1.25, minShot: 1.6, maxShot: 5.5,
    motion: 'pan',
    transition: 'zoom',
    transDur: 0.34,
    music: { duck: 0.45 },
    intro: { enabled: true, dur: 2.0 },
    outro: { enabled: true, dur: 2.2 },
  }),
  p({
    id: 'brand',
    name: 'برند و کسب‌وکار',
    desc: 'تمیز و مطمئن، برش‌های دقیق، متن پایین کادر',
    icon: '💼',
    palette: ['#0b3d91', '#6c8ae4', '#eef2f7'],
    grade: { exposure: 1.02, contrast: 1.05, saturation: 0.98, temperature: -0.04, vibrance: 0.12, vignette: 0.14, grain: 0.02, sharpen: 0.36 },
    caption: { font: 'sans', weight: 800, size: 0.045, pos: 'bottom', anim: 'fade', stroke: 0, shadow: 0.35, bg: { color: 'rgba(8,10,16,0.5)', radius: 0.4, pad: 0.5 } },
    pace: 1.3, minShot: 1.6, maxShot: 4.6,
    motion: 'auto',
    transition: 'cut',
    transDur: 0.2,
    music: { duck: 0.4 },
    intro: { enabled: true, dur: 2.0 },
    outro: { enabled: true, dur: 2.4 },
  }),
  p({
    id: 'beauty',
    name: 'بیوتی و آرایشی',
    desc: 'پوست نرم، نور پفکی، رنگ‌های پاستلی',
    icon: '💄',
    palette: ['#ffd1dc', '#f7a9a8', '#fff3f0'],
    grade: { exposure: 1.08, contrast: 0.98, saturation: 1.0, temperature: 0.08, tint: 0.03, vibrance: 0.14, fade: 0.06, vignette: 0.12, grain: 0.02, sharpen: 0.28, bloom: 0.3 },
    caption: { font: 'display', size: 0.052, pos: 'center', anim: 'wordpop', stroke: 0.04, shadow: 0.4, highlight: '#ff9ec4' },
    pace: 0.9, minShot: 1.2, maxShot: 3.6,
    motion: 'punch',
    transition: 'lightleak',
    transDur: 0.3,
    music: { duck: 0.5 },
    intro: { enabled: true, dur: 1.8 },
    outro: { enabled: true, dur: 2.0 },
  }),
];

export const TRANSITIONS = ['cut', 'fade', 'flash', 'zoomblur', 'whip', 'glitch', 'slide', 'zoom', 'lightleak', 'spin'];

export const MOOD_TO_PRESET = {
  golden: 'food',
  night: 'cinematic',
  mono: 'noir',
  vivid: 'travel',
  action: 'sport',
  moody: 'fashion',
  clean: 'vlog',
};

export function getPreset(id) {
  return PRESETS.find((x) => x.id === id) || PRESETS[0];
}

/** Pick a preset automatically from the analysed mood mix. */
export function autoPreset(assets) {
  const counts = new Map();
  let motion = 0, n = 0;
  for (const a of assets) {
    if (!a.analysis) continue;
    counts.set(a.analysis.mood, (counts.get(a.analysis.mood) || 0) + 1);
    motion += a.analysis.motion || 0;
    n++;
  }
  if (!counts.size) return getPreset('vlog');
  const [mood] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const avgMotion = motion / Math.max(1, n);
  if (avgMotion > 0.45) return getPreset('sport');
  return getPreset(MOOD_TO_PRESET[mood] || 'vlog');
}

/* ------------------------------------------------------------------ */
/* durations / export presets                                          */
/* ------------------------------------------------------------------ */

export const DURATIONS = [
  { id: 15, label: '۱۵ ثانیه' },
  { id: 20, label: '۲۰ ثانیه' },
  { id: 30, label: '۳۰ ثانیه' },
  { id: 45, label: '۴۵ ثانیه' },
  { id: 60, label: '۶۰ ثانیه' },
];

export const QUALITIES = [
  { id: '1080p', label: '۱۰۸۰×۱۹۲۰ (پیشنهادی)', width: 1080, height: 1920, bitrate: 9_000_000 },
  { id: '720p', label: '۷۲۰×۱۲۸۰ (سبک و سریع)', width: 720, height: 1280, bitrate: 5_000_000 },
  { id: '1440p', label: '۱۴۴۰×۲۵۶۰ (کیفیت حداکثری)', width: 1440, height: 2560, bitrate: 16_000_000 },
];

export const ASPECTS = [
  { id: '9:16', label: 'ریل / استوری ۹:۱۶', ratio: 9 / 16 },
  { id: '4:5', label: 'پست اینستاگرام ۴:۵', ratio: 4 / 5 },
  { id: '1:1', label: 'مربع ۱:۱', ratio: 1 },
  { id: '16:9', label: 'افقی ۱۶:۹', ratio: 16 / 9 },
];

export function sizeForAspect(aspect, quality) {
  const a = ASPECTS.find((x) => x.id === aspect) || ASPECTS[0];
  const q = QUALITIES.find((x) => x.id === quality) || QUALITIES[0];
  // keep the long edge from the quality preset, derive the short edge from ratio
  const scale = q.height / 1920;
  if (a.ratio <= 1) {
    const h = q.height;
    let w = Math.round(h * a.ratio);
    if (w % 2) w++;
    return { width: w, height: h };
  }
  const w = q.height;
  let h = Math.round(w / a.ratio);
  if (h % 2) h++;
  return { width: w, height: h };
}
