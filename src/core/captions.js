/**
 * Offline caption engine: composes hook, on-screen lines, caption body,
 * CTA and hashtags from the analysed footage + user topic.
 */
import { HOOKS, BEAT_LINES, CAPTIONS, CTAS, QUESTIONS, HASHTAGS, detectCategory, CATEGORY_LABELS, TONES } from '../data/hooks.js';
import { mulberry32, pick, shuffle, clamp } from './util.js';

/** Universal tags used to top the list up when a category has few of its own. */
const TOPUP = {
  fa: ['#ریلز', '#ریلزفارسی', '#ویدیو', '#اکسپلور', '#ترند', '#ایران', '#لحظه_ها', '#خاطره', '#موزیک', '#فالو'],
  en: ['#reels', '#reelsinstagram', '#explorepage', '#viral', '#trending', '#instagood', '#videooftheday', '#fyp', '#reelsvideo', '#contentcreator'],
};

const PRESET_TONE = {
  sport: 'bold',
  viral: 'funny',
  food: 'warm',
  wedding: 'warm',
  noir: 'aesthetic',
  beauty: 'aesthetic',
  cinematic: 'aesthetic',
  fashion: 'bold',
  brand: 'bold',
  travel: 'aesthetic',
  retro: 'funny',
  vlog: 'warm',
  auto: 'curious',
};

function fill(text, ctx) {
  return String(text)
    .replace(/\{topic\}/g, ctx.topic || ctx.categoryLabel)
    .replace(/\{n\}/g, ctx.count)
    .replace(/\{cat\}/g, ctx.categoryLabel)
    .trim();
}

function tonePool(items, tone) {
  if (!items) return [];
  const exact = items.filter((x) => x.tones?.includes(tone));
  const rest = items.filter((x) => !x.tones || x.tones.length === 0);
  return (exact.length ? exact : items).concat(rest.length && !exact.length ? [] : []);
}

export function guessTone(presetId) {
  return PRESET_TONE[presetId] || 'curious';
}

export function buildCopy({
  assets = [],
  presetId = 'auto',
  lang = 'fa',
  tone = 'auto',
  topic = '',
  brief = '',
  customCaption = '',
  shots = 8,
  duration = 30,
  seed = 1,
  includeHashtags = true,
} = {}) {
  const rng = mulberry32(seed);
  // the «هدف کلیپ» sentence is the best description of the subject we get
  const category = detectCategory([topic, brief].filter(Boolean).join(' ')) || 'general';
  const categoryLabel = CATEGORY_LABELS[lang]?.[category] || category;
  const finalTone = tone && tone !== 'auto' ? tone : guessTone(presetId);
  const ctx = { topic: topic.trim(), categoryLabel, count: shots };

  // ---- hook -------------------------------------------------------
  const hookPool = tonePool(HOOKS[lang]?.[category], finalTone);
  const generalHooks = tonePool(HOOKS[lang]?.general, finalTone);
  const hookSource = (hookPool?.length ? hookPool : generalHooks) || generalHooks;
  const hook = hookSource?.length ? pick(rng, hookSource).t : '{topic}';

  // ---- on-screen lines -------------------------------------------
  const catLines = BEAT_LINES[lang]?.category?.[category] || [];
  const genLines = BEAT_LINES[lang]?.general || [];
  const lineCount = clamp(Math.round(shots / 2.4), 2, 6);
  const pool = shuffle(rng, [...catLines, ...genLines]);
  const lines = [];
  if (ctx.topic) lines.push(ctx.topic);
  for (const l of pool) {
    if (lines.length >= lineCount) break;
    if (!lines.includes(l)) lines.push(l);
  }

  // ---- caption body ----------------------------------------------
  let bodyLines;
  if (customCaption.trim()) {
    bodyLines = customCaption.split('\n').map((s) => s.trim()).filter(Boolean);
  } else {
    const variants = CAPTIONS[lang]?.[category] || CAPTIONS[lang]?.general || [['']];
    const variant = variants[Math.floor(rng() * variants.length) % variants.length];
    bodyLines = variant.map((l) => fill(l, ctx));
    if (rng() > 0.45) {
      const q = pick(rng, QUESTIONS[lang] || []);
      if (q && !bodyLines.some((b) => b.includes(q.slice(0, 8)))) bodyLines.push(q);
    }
  }
  const cta = pick(rng, CTAS[lang] || ['']);

  // ---- hashtags ---------------------------------------------------
  const tags = [];
  if (includeHashtags) {
    const catTags = shuffle(rng, HASHTAGS[lang]?.[category] || []);
    const broadTags = shuffle(rng, HASHTAGS[lang]?.general || []);
    const cross = lang === 'fa' ? HASHTAGS.en.general : HASHTAGS.fa.general;
    tags.push(...catTags.slice(0, 9));
    tags.push(...broadTags.slice(0, 7));
    tags.push(...shuffle(rng, cross).slice(0, 5));
    // topic words as hashtags
    if (ctx.topic) {
      for (const w of ctx.topic.split(/[\s,،.]+/).filter((w) => w.length > 3).slice(0, 3)) {
        const tag = `#${w.replace(/[^\p{L}\p{N}_]/gu, '')}`;
        if (tag.length > 3) tags.push(tag);
      }
    }
  }
  let uniqueTags = [...new Set(tags)];
  if (uniqueTags.length < 18) {
    const extra = shuffle(rng, [...(HASHTAGS[lang]?.general || []), ...TOPUP[lang] || []]);
    for (const t of extra) {
      if (uniqueTags.length >= 22) break;
      if (!uniqueTags.includes(t)) uniqueTags.push(t);
    }
  }
  uniqueTags = uniqueTags.slice(0, 24);

  const captionFull = [bodyLines.join('\n'), cta, uniqueTags.join(' ')].filter(Boolean).join('\n\n');

  return {
    lang,
    tone: finalTone,
    toneLabel: TONES.find((t) => t.id === finalTone)?.label || finalTone,
    category,
    categoryLabel,
    topic: ctx.topic,
    hook: fill(hook, ctx),
    lines: lines.map((l) => fill(l, ctx)),
    body: bodyLines,
    cta,
    tags: uniqueTags,
    caption: captionFull,
    source: 'offline',
  };
}

/** Split a line into chunks of at most `maxWords` words (for karaoke captions). */
export function splitWords(text) {
  return String(text).split(/\s+/).filter(Boolean).map((w, i) => ({ w, i }));
}

export function chunkWords(text, maxWords) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i += maxWords) out.push(words.slice(i, i + maxWords).join(' '));
  return out;
}
