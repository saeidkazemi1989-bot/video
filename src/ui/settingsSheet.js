/** Settings sheet: your @handle + optional AI provider. */
import { state, savePrefs } from '../state.js';
import { el } from '../core/util.js';
import { openSheet, closeSheet, btn, toast, chips } from './shell.js';
import { openUpdateSheet } from './updateSheet.js';
import { APP_VERSION, faVersion } from '../core/update.js';

const PROVIDERS = [
  { id: 'none', label: 'خاموش (آفلاین)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'groq', label: 'Groq' },
  { id: 'custom', label: 'سرور دلخواه' },
];

const PRESET_URLS = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
};

export function openSettingsSheet(onSaved) {
  openSheet(({ close }) => {
    const handleInput = el('input', {
      class: 'input', value: state.settings.handle || '', placeholder: 'my.page',
      oninput: (e) => { state.settings.handle = e.target.value.trim(); },
    });
    const urlInput = el('input', {
      class: 'input', value: state.ai.baseUrl, dir: 'ltr',
      oninput: (e) => { state.ai.baseUrl = e.target.value.trim(); },
    });
    const modelInput = el('input', {
      class: 'input', value: state.ai.model, dir: 'ltr', placeholder: 'gpt-4o-mini',
      oninput: (e) => { state.ai.model = e.target.value.trim(); },
    });
    const keyInput = el('input', {
      class: 'input', type: 'password', value: state.ai.apiKey, dir: 'ltr', placeholder: 'sk-...',
      oninput: (e) => { state.ai.apiKey = e.target.value.trim(); },
    });

    const providerChips = chips(PROVIDERS, state.ai.provider, (id) => {
      state.ai.provider = id;
      if (PRESET_URLS[id]) {
        state.ai.baseUrl = PRESET_URLS[id];
        urlInput.value = PRESET_URLS[id];
      }
      if (id === 'openai' && !state.ai.model) { state.ai.model = 'gpt-4o-mini'; modelInput.value = 'gpt-4o-mini'; }
      [...providerChips.children].forEach((c, i) => c.classList.toggle('is-on', PROVIDERS[i].id === id));
    });

    return el('div', { class: 'stack' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'آیدی اینستاگرام (برای واترمارک و پایان‌بندی)' }),
        handleInput,
      ]),
      el('div', { class: 'field' }, [
        el('label', { text: 'تولید متن با هوش مصنوعی' }),
        providerChips,
        el('div', { class: 'muted', text: 'اختیاری است؛ بدون کلید هم اپ متن و هشتگ را آفلاین می‌سازد. کلید فقط روی همین گوشی ذخیره می‌شود.' }),
      ]),
      el('div', { class: 'field' }, [el('label', { text: 'آدرس سرور (Base URL)' }), urlInput]),
      el('div', { class: 'field' }, [el('label', { text: 'مدل' }), modelInput]),
      el('div', { class: 'field' }, [el('label', { text: 'کلید API' }), keyInput]),
      el('div', { class: 'field' }, [
        el('label', { text: 'بروزرسانی' }),
        el('div', { class: 'row row--between' }, [
          el('span', { class: 'muted', text: `نسخهٔ نصب‌شده: ${faVersion(APP_VERSION)}` }),
          btn('بررسی بروزرسانی ⟳', { small: true, onClick: () => openUpdateSheet() }),
        ]),
      ]),
      el('div', { class: 'row' }, [
        btn('ذخیره', {
          primary: true,
          onClick: async () => {
            await savePrefs();
            toast('تنظیمات ذخیره شد', 'ok');
            close();
            onSaved?.();
          },
        }),
        btn('انصراف', { ghost: true, onClick: close }),
      ]),
      el('div', { class: 'muted', text: 'نکته: کلید در حافظه محلی مرورگر (IndexedDB) می‌ماند و به هیچ سروری جز همان سرویس هوش مصنوعی ارسال نمی‌شود.' }),
    ]);
  }, { title: 'تنظیمات' });
}
