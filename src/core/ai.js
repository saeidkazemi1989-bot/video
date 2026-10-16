/**
 * Optional AI upgrade for the copy engine. Works with any OpenAI-compatible
 * endpoint (OpenAI, OpenRouter, Groq, a local server…). The app never *needs*
 * it: without a key everything is generated offline.
 */
import { state } from '../state.js';
import { clamp } from './util.js';

export function aiEnabled() {
  return state.ai.provider !== 'none' && (state.ai.apiKey || '').trim().length > 8;
}

function endpoint() {
  const base = (state.ai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return `${base}/chat/completions`;
}

const SYSTEM = {
  fa: `تو یک کوپی‌رایتر حرفه‌ای اینستاگرام فارسی هستی. برای یک ریلز کوتاه، متن‌های کوتاه، طبیعی، بدون کلیشه و بدون اغراق تولید می‌کنی.
خروجی را فقط به شکل JSON و دقیقاً با این کلیدها بده:
{"hook":"جمله اول کوتاه و گیرا (حداکثر ۷ کلمه)","lines":["۳ تا ۵ متن کوتاه روی تصویر (هر کدام حداکثر ۴ کلمه)"],"caption":["۲ تا ۴ خط کپشن"],"cta":"یک دعوت به اقدام کوتاه","tags":["۲۰ تا ۲۴ هشتگ فارسی و انگلیسی مرتبط"]}`,
  en: `You are a professional Instagram reel copywriter. Write short, natural, non-cheesy copy.
Return JSON only with exactly these keys:
{"hook":"short scroll-stopping first line (max 7 words)","lines":["3-5 short on-screen phrases (max 4 words each)"],"caption":["2-4 caption lines"],"cta":"one short call to action","tags":["20-24 relevant hashtags, mix of English and local language"]}`,
};

export async function aiGenerateCopy({ lang = 'fa', tone = 'curious', topic = '', category = 'general', presetName = '', shots = 8, duration = 30 } = {}) {
  if (!aiEnabled()) return null;
  const userPrompt = lang === 'fa'
    ? `موضوع/توضیح کاربر: ${topic || 'ندارد'}
دسته‌بندی: ${category}
لحن: ${tone}
سبک تدوین: ${presetName}
تعداد نما: ${shots} — مدت ریلز: ${duration} ثانیه`
    : `User topic: ${topic || 'none'}
Category: ${category}
Tone: ${tone}
Edit style: ${presetName}
Shots: ${shots} — Reel length: ${duration}s`;

  const res = await fetch(endpoint(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.ai.apiKey}`,
    },
    body: JSON.stringify({
      model: state.ai.model || 'gpt-4o-mini',
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM[lang] || SYSTEM.fa },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`درخواست هوش مصنوعی ناموفق بود (${res.status}) ${text.slice(0, 120)}`);
  }
  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || '{}';
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    data = m ? JSON.parse(m[0]) : {};
  }
  const lines = Array.isArray(data.lines) ? data.lines.slice(0, 6).map((s) => String(s).slice(0, 40)) : [];
  const caption = Array.isArray(data.caption)
    ? data.caption
    : String(data.caption || '').split('\n').filter(Boolean);
  const tags = Array.isArray(data.tags)
    ? data.tags.map((t) => (String(t).startsWith('#') ? String(t) : `#${String(t).replace(/\s+/g, '_')}`)).slice(0, 26)
    : [];
  return {
    hook: String(data.hook || '').slice(0, 90),
    lines,
    body: caption.map((s) => String(s).slice(0, 220)).slice(0, 6),
    cta: String(data.cta || '').slice(0, 90),
    tags,
    source: 'ai',
  };
}

/**
 * Optional speech-to-text. Works with any OpenAI-compatible Whisper endpoint,
 * including a local server (e.g. faster-whisper / whisper.cpp on your own
 * machine) exposed as http://localhost:8000/v1.
 */
export async function aiTranscribe(blob, filename = 'media.webm', lang = 'fa', { wordTimestamps = true } = {}) {
  if (!aiEnabled()) return null;
  const base = (state.ai.baseUrl || '').replace(/\/+$/, '');
  const form = new FormData();
  form.append('file', blob, filename);
  form.append('model', state.ai.transcribeModel || 'whisper-1');
  if (lang) form.append('language', lang);
  if (wordTimestamps) {
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'word');
  }
  const res = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.ai.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`تبدیل گفتار به متن ناموفق بود (${res.status})`);
  const json = await res.json();
  const text = (json.text || '').trim();
  const words = Array.isArray(json.words)
    ? json.words.map((w) => ({ w: String(w.word || w.text || '').trim(), t0: Number(w.start) || 0, t1: Number(w.end) || 0 }))
        .filter((w) => w.w)
    : null;
  return { text, words, language: json.language };
}

/** Load a locally stored Whisper model from the device (File System Access API). */
export async function pickLocalModel() {
  if (!window.showOpenFilePicker) throw new Error('این مرورگر از انتخاب فایل مدل پشتیبانی نمی‌کند');
  const [handle] = await window.showOpenFilePicker({
    types: [{ description: 'Whisper model', accept: { 'application/octet-stream': ['.bin', '.gguf', '.onnx'] } }],
  });
  const file = await handle.getFile();
  return { name: file.name, size: file.size, file };
}

/** Short summary used by the UI. */
export function aiStatusLabel() {
  if (state.ai.provider === 'none') return 'خاموش — متن‌ها آفلاین ساخته می‌شوند';
  if (!aiEnabled()) return 'کلید API ثبت نشده';
  return `فعال — ${state.ai.model || 'gpt-4o-mini'}`;
}

export function clampTokens(t, n = 20) {
  return clamp(t, 0, n);
}
