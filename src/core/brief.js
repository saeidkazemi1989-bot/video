/**
 * «هدف کلیپ» — the brief engine.
 *
 * The user writes one sentence about what the clip is for
 * («می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون بخره»), and this
 * module turns that sentence into a complete editing decision: style preset,
 * music genre + tempo, pacing/duration, text tone, subtitles and framing.
 *
 * Everything here is pure and offline (keyword scoring over Persian + English),
 * so it is unit-tested and works with no API key. `analyzeBrief` → `briefPatch`
 * (what to apply) → `briefSummary` (what to show the user).
 */
import { PRESETS, DURATIONS } from '../data/styles.js';
import { GENRES } from './musicgen.js';
import { TONES, CATEGORY_LABELS, detectCategory } from '../data/hooks.js';
import { clamp, stripDiacritics } from './util.js';

/* ------------------------------------------------------------------ */
/* examples shown as one-tap chips                                     */
/* ------------------------------------------------------------------ */
export const BRIEF_EXAMPLES = [
  { icon: '🛍', label: 'فروش محصول', text: 'می‌خوام کفش ورزشی جدید مغازه‌ام رو معرفی کنم و مخاطب جوون ترغیب بشه بخره' },
  { icon: '🏋️', label: 'انگیزشی باشگاه', text: 'کلیپ انگیزشی از تمرین‌های باشگاه، انرژی بالا و ریتم تند' },
  { icon: '🎂', label: 'تولد', text: 'جشن تولد دخترم، لحظه‌های قشنگ و احساسی با آهنگ شاد' },
  { icon: '🍽', label: 'معرفی کافه', text: 'معرفی منو و فضای دنج کافه‌ی جدیدمون' },
  { icon: '✈️', label: 'سفر', text: 'خلاصه‌ی سفر شمال، جاده و طبیعت، آرام و سینمایی' },
  { icon: '📚', label: 'آموزش', text: 'آموزش سه قدمی آرایش ساده برای مبتدی‌ها، حتماً زیرنویس داشته باشه' },
  { icon: '💪', label: 'قبل و بعد', text: 'نتیجه‌ی تمرین‌های سه ماهم رو نشون بدم، انگیزشی' },
  { icon: '🌆', label: 'حس و حال', text: 'ادیت هنری از غروب شهر با حس آرام و کمی غمگین' },
];

/* ------------------------------------------------------------------ */
/* intents: what the user is trying to achieve                         */
/* ------------------------------------------------------------------ */
export const INTENTS = {
  sell: {
    label: 'فروش و معرفی محصول',
    boost: 1.2,
    words: ['فروش', 'فروشی', 'بخره', 'بخرن', 'بخری', 'خرید', 'سفارش', 'تخفیف', 'قیمت', 'محصول', 'معرفی محصول', 'مغازه', 'فروشگاه', 'کاری کن', 'دی ام', 'دایرکت', 'لینک بایو', 'sell', 'buy', 'shop', 'offer', 'discount', 'order', 'promo', 'product'],
    preset: 'brand', tone: 'bold', music: 'pop', energy: 0.6, duration: 30, subtitles: false,
  },
  announce: {
    label: 'اعلان و رونمایی',
    boost: 0.6,
    words: ['اعلام', 'خبر', 'رونمایی', 'افتتاح', 'به‌زودی', 'به زودی', 'شروع کردیم', 'جدیدمون', 'معرفی می‌کنم', 'announce', 'launch', 'coming soon', 'unveil', 'opening'],
    preset: 'brand', tone: 'bold', music: 'pop', energy: 0.65, duration: 20, subtitles: false,
  },
  teach: {
    label: 'آموزش و نکته',
    boost: 1.3,
    words: ['آموزش', 'آموزشی', 'آموزش دادن', 'یاد بدم', 'یاد بگیری', 'مراحل', 'سه قدم', '۳ قدم', 'قدم به قدم', 'ترفند', 'نکته', 'راهنما', 'چطور', 'چگونه', 'tutorial', 'how to', 'tips', 'steps', 'learn', 'guide'],
    preset: 'vlog', tone: 'curious', music: 'lofi', energy: 0.45, duration: 45, subtitles: true,
  },
  show: {
    label: 'نمایش و پیش‌نمایش',
    boost: 0.8,
    words: ['نشون بدم', 'نشون بده', 'نمایش', 'ببینید', 'ببین', 'پیش‌نمایش', 'رونمایی', 'غلطک', 'show', 'reveal', 'preview', 'look at'],
    preset: 'cinematic', tone: 'curious', music: 'cinematic', energy: 0.5, duration: 30, subtitles: false,
  },
  celebrate: {
    label: 'جشن و مناسبت',
    boost: 1.2,
    words: ['تولد', 'عروسی', 'عقد', 'نامزدی', 'سالگرد', 'جشن', 'مهمونی', 'مهمانی', 'لحظه‌های قشنگ', 'birthday', 'wedding', 'anniversary', 'party', 'celebration'],
    preset: 'vlog', tone: 'warm', music: 'pop', energy: 0.6, duration: 30, subtitles: false,
  },
  motivate: {
    label: 'انگیزشی و پیشرفت',
    boost: 1.4,
    words: ['انگیزشی', 'انگیزه دادن', 'انگیزه', 'قبل و بعد', 'قبل بعد', 'نتیجه', 'پیشرفت', 'تلاش', 'عضله', 'کاهش وزن', 'لاغری', 'جا افتادم', 'motivation', 'progress', 'before after', 'transformation', 'grind'],
    preset: 'sport', tone: 'bold', music: 'sport', energy: 0.85, duration: 20, subtitles: false,
  },
  mood: {
    label: 'حس و حال / هنری',
    boost: 1.1,
    words: ['هنری', 'مود', 'حس', 'آرام', 'آرامش', 'غمگین', 'غم', 'احساسی', 'رمانتیک', 'چیل', 'دنج', 'dreamy', 'mood', 'aesthetic', 'chill', 'calm', 'emotional', 'cinematic'],
    preset: 'cinematic', tone: 'aesthetic', music: 'ambient', energy: 0.25, duration: 30, subtitles: false,
  },
  entertain: {
    label: 'سرگرمی و خنده',
    boost: 1.3,
    words: ['خنده', 'خنده‌دار', 'طنز', 'کمدی', 'بامزه', 'میم', 'شوخی', 'فان', 'funny', 'meme', 'comedy', 'lol', 'humor'],
    preset: 'viral', tone: 'funny', music: 'hiphop', energy: 0.8, duration: 15, subtitles: true,
  },
  document: {
    label: 'روزمرگی و روایت',
    boost: 0.9,
    words: ['روزمرگی', 'روزهای من', 'ولگ', 'ولاگ', 'خاطره', 'سفرنامه', 'روایت', 'داستان', 'vlog', 'daily', 'day in', 'story', 'memories'],
    preset: 'vlog', tone: 'warm', music: 'lofi', energy: 0.35, duration: 45, subtitles: false,
  },
};

/**
 * Intents whose *goal* dictates the look, so they beat the subject matter:
 * selling looks like a brand ad even when the product is a gym shoe.
 */
const PRIORITY_INTENTS = new Set(['sell', 'announce', 'motivate', 'entertain', 'mood']);

/** Category (from the copy engine) → the style that fits it best. */
const CATEGORY_PRESET = {
  food: 'food', travel: 'travel', nature: 'travel', fitness: 'sport', fashion: 'fashion',
  business: 'brand', wedding: 'vlog', city: 'cinematic', product: 'brand', pet: 'vlog',
  nightlife: 'viral', personal: 'vlog', general: null,
};

/** Category → the genre that fits it best when nothing else decides. */
const CATEGORY_MUSIC = {
  food: 'lofi', travel: 'ambient', nature: 'ambient', fitness: 'sport', fashion: 'house',
  business: 'pop', wedding: 'pop', city: 'hiphop', product: 'pop', pet: 'pop',
  nightlife: 'house', personal: 'lofi', general: 'pop',
};

const ENERGY_UP = ['پرانرژی', 'انرژی', 'تند', 'سریع', 'ضربه', 'ترند', 'ترندی', 'هیجان', 'پامپ', 'ترکوندن', 'دیوانه', 'خفن', 'بomb', 'hype', 'fast', 'energetic', 'trend', 'punchy', 'upbeat'];
const ENERGY_DOWN = ['آرام', 'آرامش', 'ملایم', 'لطیف', 'دنج', 'کند', 'سینمایی', 'احساسی', 'غمگین', 'غم', 'رمانتیک', 'رویایی', 'chill', 'calm', 'slow', 'soft', 'cinematic', 'emotional', 'dreamy', 'gentle'];

/** Words the user may drop in to override the music explicitly. */
const MUSIC_WORDS = [
  { id: 'lofi', words: ['لو فای', 'لوفای', 'lofi', 'lo-fi'] },
  { id: 'pop', words: ['پاپ', 'pop'] },
  { id: 'pop', words: ['شاد', 'شادی', 'happy'], ctx: true },
  { id: 'hiphop', words: ['هیپ هاپ', 'هیپ‌هاپ', 'ترپ', 'رپ', 'hip hop', 'hiphop', 'trap', 'rap'] },
  { id: 'house', words: ['هاوس', 'دنس', 'تکنو', 'house', 'dance', 'techno', 'edm'] },
  { id: 'sport', words: ['sport', 'workout', 'gym'], },
  { id: 'sport', words: ['ورزشی', 'پرانرژی', 'باشگاه'], ctx: true },
  { id: 'cinematic', words: ['حماسی', 'سینمایی حماسی', 'ارکستر', 'epic', 'orchestral', 'trailer'] },
  { id: 'eastern', words: ['سنتی', 'شرقی', 'ایرانی', 'traditional', 'oriental', 'ethnic'] },
  { id: 'ambient', words: ['آمبینت', 'محو', 'ambient'] },
  { id: 'ambient', words: ['غمگین', 'غم', 'رمانتیک'], ctx: true },
];
/** «آهنگ ورزشی» یعنی موسیقی؛ «کفش ورزشی» یعنی محصول. */
const MUSIC_CONTEXT = ['آهنگ', 'موسیقی', 'ترک', 'بیس', 'ساند', 'song', 'track', 'music', 'beat', 'bpm', 'instrumental'];

const STOPWORDS = new Set([
  'و', 'در', 'به', 'از', 'که', 'این', 'اینکه', 'را', 'با', 'برای', 'می', 'رو', 'من', 'ما', 'تو', 'شما',
  'یه', 'یک', 'خیلی', 'هم', 'تا', 'بر', 'بدون', 'کلیپ', 'ویدیو', 'عکس', 'ریلز', 'ادیت', 'بساز', 'بسازم',
  'کن', 'کنم', 'کنه', 'میخوام', 'می‌خوام', 'میخواهم', 'می‌خواهم', 'لطفا', 'لطفاً', 'قصد', 'دارم', 'باید',
  'ها', 'های', 'شده', 'شد', 'است', 'هست', 'بود', 'بودن', 'the', 'a', 'an', 'and', 'of', 'to', 'for', 'my',
  'clip', 'video', 'reel', 'make', 'edit', 'want', 'with', 'that', 'this',
]);

const FILLER_PREFIX = [
  'می‌خوام که', 'میخوام که', 'می‌خواهم که', 'میخواهم که', 'می‌خوام', 'میخوام', 'می‌خواهم', 'میخواهم',
  'قصد دارم که', 'قصد دارم', 'لطفاً', 'لطفا', 'باید', 'برای اینکه', 'برای این‌که', 'برای این که',
  'i want to', 'i want', 'make me', 'please',
];
const FILLER_SUFFIX = [
  'رو بساز', 'را بساز', 'بساز', 'ادیت کن', 'ادیت کنی', 'درست کن', 'آماده کن', 'می‌کنم', 'کنم',
  'نشون بده', 'نشان بده', 'make it', 'edit it',
];

const ZWNJ = /[\u200c\u200f\u202a-\u202e]/g;

const norm = (text) => stripDiacritics(text).replace(/[\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim();

/** Matching form: «می‌خوام» و «میخوام» باید یکی باشند. */
const lc = (text) => norm(text).toLowerCase().replace(ZWNJ, '').replace(/[«»"'’“”]/g, ' ').replace(/\s+/g, ' ').trim();

/** A prefix matcher that treats ZWNJ (and a stray space) as optional. */
function loosePrefix(word) {
  const body = lc(word).split('').map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\u200c\\s]{0,2}');
  return new RegExp(`^${body}`, 'i');
}

/* ------------------------------------------------------------------ */
/* analysis                                                            */
/* ------------------------------------------------------------------ */

/** Counts keyword hits with a small bonus for multi-word phrases. */
export function scoreWords(haystack, words) {
  let score = 0;
  for (const w of words) {
    const needle = lc(w);
    if (!needle) continue;
    if (!haystack.includes(needle)) continue;
    score += needle.includes(' ') ? 4 : 2;
    score += Math.min(2, needle.length / 6);
  }
  return score;
}

/** The intent with the best keyword score, or null when the text is too vague. */
export function detectIntent(text) {
  const hay = lc(text);
  if (!hay) return { id: null, score: 0 };
  let best = { id: null, score: 0 };
  for (const [id, def] of Object.entries(INTENTS)) {
    const score = scoreWords(hay, def.words) * (def.boost ?? 1);
    if (score > best.score) best = { id, score, id };
  }
  return best;
}

/** 0 … 1 — how fast/hard the edit should feel. */
export function detectEnergy(text, { base = 0.5 } = {}) {
  const hay = lc(text);
  let e = base;
  e += Math.min(0.3, 0.09 * ENERGY_UP.filter((w) => hay.includes(lc(w))).length);
  e -= Math.min(0.32, 0.1 * ENERGY_DOWN.filter((w) => hay.includes(lc(w))).length);
  if (/[!]{2,}|🔥|⚡|💥/.test(String(text))) e += 0.05;
  return clamp(e, 0.1, 1);
}

/** The user's sentence, boiled down to something that fits on screen. */
export function briefTopicLine(text, maxLen = 48) {
  let t = norm(text);
  if (!t) return '';
  t = t.split(/[.!?؟\n،,;]/)[0].trim();
  for (let guard = 0; guard < 4; guard++) {
    let hit = false;
    for (const p of FILLER_PREFIX) {
      const m = t.match(loosePrefix(p));
      if (m) { t = t.slice(m[0].length).replace(/^[\s،,:;-]+/, '').trim(); hit = true; break; }
    }
    if (!hit) break;
  }
  for (const s of FILLER_SUFFIX) {
    // no ^ here: the filler we strip sits at the END of the sentence
    const re = new RegExp(loosePrefix(s).source.replace(/^\^/, '') + '$', 'i');
    const m = t.match(re);
    if (m) t = t.slice(0, t.length - m[0].length).trim();
  }
  t = t.replace(/[«»"'’“”]/g, '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLen * 0.55 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Up to `max` meaningful words from the sentence. */
export function briefKeywords(text, max = 5) {
  const out = [];
  for (const raw of norm(text).split(/[\s،,.!?؟:;()«»"'–-]+/)) {
    const w = raw.trim();
    if (w.length < 3 || STOPWORDS.has(w.toLowerCase())) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

const presetName = (id) => PRESETS.find((p) => p.id === id)?.name || id;
const genreOf = (id) => GENRES.find((g) => g.id === id) || GENRES[0];
const toneLabel = (id) => TONES.find((t) => t.id === id)?.label || id;

/**
 * The whole decision for one brief.
 * @returns {{ok:boolean, reason?:string, text:string, category:string, categoryLabel:string,
 *   intent:string, intentLabel:string, presetId:string, musicGenre:string, musicBpm:number,
 *   musicTempo:number, duration:number, tone:string, energy:number, subtitles:boolean,
 *   captions:boolean, framing:'fit'|'fill', topicLine:string, keywords:string[], notes:string[]}}
 */
export function analyzeBrief(text = '', { lang = 'fa' } = {}) {
  const raw = norm(text);
  if (raw.length < 3) {
    return { ok: false, reason: 'empty', text: raw, notes: ['چیزی نوشته نشده — یک جمله دربارهٔ هدف کلیپ بنویس.'] };
  }

  const hay = lc(raw);
  const category = detectCategory(raw) || 'general';
  const { id: intentId, score: intentScore } = detectIntent(raw);
  // a single stray keyword should not hijack the edit — 4+ means the sentence really is about it
  const intent = intentScore >= 4 ? intentId : null;
  const def = intent ? INTENTS[intent] : null;
  const energy = detectEnergy(raw, { base: def?.energy ?? 0.5 });

  // ---- style ------------------------------------------------------
  // 1) an editing style the user asked for by name  2) the goal of the clip
  // 3) the subject matter  4) whatever the goal implies  5) the auto picker
  const styleHits = [
    ['cinematic', ['سینمایی', 'فیلم‌گونه', 'سینما', 'هنری', 'سینماتیک', 'cinematic']],
    ['retro', ['رترو', 'vhs', 'نوستالژی', 'قدیمی', 'retro', 'vintage']],
    ['noir', ['سیاه و سفید', 'نوآر', 'noir', 'black and white', 'monochrome']],
    ['viral', ['ترند', 'وایرال', 'تیک‌تاک', 'خنده‌دار', 'viral', 'tiktok']],
    ['beauty', ['آرایش', 'میکاپ', 'بیوتی', 'پوست', 'makeup', 'beauty', 'skincare']],
  ];
  let bestStyle = { id: null, score: 0 };
  for (const [id, words] of styleHits) {
    const sc = scoreWords(hay, words);
    if (sc > bestStyle.score) bestStyle = { id, score: sc };
  }
  let presetId;
  if (bestStyle.id && bestStyle.score >= 2.5) {
    presetId = bestStyle.id;
  } else if (def && PRIORITY_INTENTS.has(intent)) {
    presetId = def.preset;
  } else {
    presetId = CATEGORY_PRESET[category] || def?.preset || 'auto';
  }
  if (!PRESETS.some((p) => p.id === presetId)) presetId = 'auto';

  // ---- music ------------------------------------------------------
  const musicContext = MUSIC_CONTEXT.some((w) => hay.includes(lc(w)));
  let explicitGenre = null;
  for (const g of MUSIC_WORDS) {
    if (g.ctx && !musicContext) continue;
    if (g.words.some((w) => hay.includes(lc(w)))) { explicitGenre = g.id; break; }
  }
  let musicGenre;
  if (explicitGenre) {
    musicGenre = explicitGenre;
  } else if (def?.music && energy < 0.9) {
    musicGenre = def.music;                       // the goal already implies a genre
  } else if (energy >= 0.78) {
    musicGenre = category === 'fitness' || intent === 'motivate' ? 'sport' : 'house';
  } else if (energy <= 0.3) {
    musicGenre = /سینمایی|حماسی/.test(raw) || def?.music === 'cinematic'
      ? 'cinematic'
      : def?.music === 'ambient' ? 'ambient' : CATEGORY_MUSIC[category] || 'lofi';
  } else {
    musicGenre = def?.music || CATEGORY_MUSIC[category] || 'pop';
  }
  if (!GENRES.some((g) => g.id === musicGenre)) musicGenre = 'pop';
  const genre = genreOf(musicGenre);
  // fast genres do not need extra tempo on top — 140 bpm × 1.2 would be a blur
  const tempoCeil = genre.bpm >= 124 ? 1.05 : genre.bpm >= 110 ? 1.15 : 1.25;
  const musicTempo = +clamp(0.85 + energy * 0.35, 0.8, tempoCeil).toFixed(2);

  // ---- duration ---------------------------------------------------
  let duration = def?.duration ?? 30;
  if (/۲۰ ثانیه|20 ثانیه|کوتاه|سریع|جمع‌وجور/.test(raw)) duration = Math.min(duration, 20);
  if (/۱۵ ثانیه|15 ثانیه|خیلی کوتاه|استوری/.test(raw)) duration = 15;
  if (/۶۰ ثانیه|60 ثانیه|یک دقیقه|کامل توضیح|مفصل/.test(raw)) duration = 60;
  if (!DURATIONS.some((d) => d.id === duration)) duration = 30;

  // ---- text / subtitles / framing --------------------------------
  const tone = def?.tone && TONES.some((t) => t.id === def.tone) ? def.tone : 'curious';
  let subtitles = def?.subtitles === true;
  if (/زیرنویس|ساب\b|subtitle|sub\b/.test(hay)) subtitles = true;
  if (/بدون زیرنویس|زیرنویس نمی‌خوام|no subtitle/.test(hay)) subtitles = false;
  let captions = true;
  if (/بدون متن|بدون کپشن|متن نمی‌خوام|no text|no caption/.test(hay)) captions = false;
  let framing = 'fit';
  if (/پرکردن قاب|تمام صفحه|تمام‌صفحه|بدون حاشیه|فول فریم|full frame|fill the frame/.test(hay)) framing = 'fill';
  if (/بدون برش|کامل دیده|همه‌ی عکس|همه عکس/.test(hay)) framing = 'fit';

  let cutMode = null;
  if (/پشت\s*سر\s*هم|پشت\s*هم|برش\s*نزن|تکه\s*نکن|تیکه\s*نکن|بدون\s*تکه|به\s*ترتیب\s*خودم|back\s*to\s*back|no\s*cuts/.test(hay)) {
    cutMode = 'sequence';
  } else if (/برش\s*روی\s*ضرب|برش\s*ریتمیک|تند\s*برش/.test(hay)) {
    cutMode = 'beat';
  }

  const notes = [];
  notes.push(`نیت: ${def ? def.label : 'مشخص نشد'}${intentScore ? '' : ' (کلمهٔ کلیدی پیدا نشد)'}`);
  notes.push(`سطح انرژی: ${energy >= 0.7 ? 'بالا' : energy >= 0.42 ? 'متعادل' : 'آرام'}`);
  if (bestStyle.id && bestStyle.score >= 2.5) notes.push(`سبک از خودِ متن: ${presetName(bestStyle.id)}`);
  else notes.push(`سبک از موضوع (${CATEGORY_LABELS[lang]?.[category] || category}): ${presetName(presetId)}`);
  if (explicitGenre) notes.push(`موسیقی را خودت گفته‌ای: ${genreOf(musicGenre).name}`);
  if (cutMode === 'sequence') notes.push('چیدمان از متن: پشت‌سرهم (بدون برش)');

  return {
    ok: true,
    reason: 'ok',
    text: raw,
    category,
    categoryLabel: CATEGORY_LABELS[lang]?.[category] || category,
    intent: intent || 'general',
    intentLabel: def?.label || 'تدوین عمومی',
    presetId,
    presetName: presetName(presetId),
    musicGenre,
    musicName: genreOf(musicGenre).name,
    musicBpm: Math.round(genreOf(musicGenre).bpm * musicTempo),
    musicTempo,
    duration,
    tone,
    toneLabel: toneLabel(tone),
    energy: +energy.toFixed(3),
    energyLabel: energy >= 0.7 ? 'بالا' : energy >= 0.42 ? 'متعادل' : 'آرام',
    subtitles: !!subtitles,
    captions: !!captions,
    framing,
    cutMode,
    topicLine: briefTopicLine(raw),
    keywords: briefKeywords(raw),
    notes,
  };
}

/**
 * What to apply for an analysis — a plain data patch, so the caller decides
 * *when* to touch the app state (and the tests can inspect it without a DOM).
 */
export function briefPatch(analysis, { keepMusic = false } = {}) {
  if (!analysis?.ok) return null;
  const patch = {
    presetId: analysis.presetId,
    settings: {
      brief: analysis.text,
      briefPlan: {
        intent: analysis.intent, intentLabel: analysis.intentLabel,
        category: analysis.category, categoryLabel: analysis.categoryLabel,
        presetId: analysis.presetId, presetName: analysis.presetName,
        musicGenre: analysis.musicGenre, musicName: analysis.musicName,
        musicBpm: analysis.musicBpm, musicTempo: analysis.musicTempo,
        energy: analysis.energy, energyLabel: analysis.energyLabel,
        subtitles: analysis.subtitles, framing: analysis.framing,
        cutMode: analysis.cutMode || null,
        keywords: analysis.keywords, at: null,
      },
      topic: analysis.topicLine || analysis.text.slice(0, 48),
      tone: analysis.tone,
      duration: analysis.duration,
      captions: analysis.captions,
      hook: analysis.captions,
      outro: analysis.captions,
      subtitles: analysis.subtitles,
      framing: analysis.framing,
    },
    music: null,
  };
  if (analysis.cutMode === 'sequence' || analysis.cutMode === 'beat') {
    patch.settings.cutMode = analysis.cutMode;
  }
  // The user's own song always wins; only an in-app (generated) track follows the brief.
  if (!keepMusic && analysis.musicGenre) {
    patch.music = { genre: analysis.musicGenre, tempo: analysis.musicTempo, name: analysis.musicName, bpm: analysis.musicBpm };
  }
  return patch;
}

/** Rows for the UI / the device report: label + value, in the app's language. */
export function briefSummary(analysis, { faNum = (n) => String(n) } = {}) {
  if (!analysis?.ok) return [];
  const rows = [
    ['موضوع', analysis.categoryLabel],
    ['هدف', analysis.intentLabel],
    ['سبک تدوین', analysis.presetName],
    ['موسیقی', `${analysis.musicName} — ${faNum(analysis.musicBpm)} ضرب در دقیقه`],
    ['ریتم', `${analysis.energyLabel} (${faNum(Math.round(analysis.energy * 100))}٪)`],
    ['طول ریلز', analysis.cutMode === 'sequence' ? 'مجموع واقعی کلیپ‌ها (بدون برش)' : `${faNum(analysis.duration)} ثانیه`],
    ['لحن متن', analysis.toneLabel],
    ['زیرنویس', analysis.subtitles ? 'روشن' : 'خاموش'],
    ['قاب‌بندی', analysis.framing === 'fill' ? 'پرکردن قاب' : 'کامل (بدون برش)'],
  ];
  if (analysis.cutMode) {
    rows.push(['چیدمان کلیپ‌ها', analysis.cutMode === 'sequence' ? 'پشت‌سرهم (بدون برش)' : 'ریتمیک (برش روی ضرب)']);
  }
  return rows;
}

/** One-line form for logs and the diagnostics sheet. */
export function briefLine(analysis) {
  if (!analysis?.ok) return 'بدون هدف';
  return `${analysis.intentLabel} · ${analysis.categoryLabel} · سبک ${analysis.presetName} · ${analysis.musicName} ${analysis.musicBpm}bpm · ${analysis.duration}s · لحن ${analysis.toneLabel}`;
}
