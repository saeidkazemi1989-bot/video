/** App shell: layout, navigation, bottom bar, toasts, sheets, busy overlay. */
import { $, el, faNum, vibrate } from '../core/util.js';
import { state, STEP_TITLES, notify, savePrefs } from '../state.js';

let router = null;
export function setRouter(fn) { router = fn; }

export function go(step) {
  if (step < 1) step = 1;
  if (step > 6) step = 6;
  state.step = step;
  vibrate(6);
  renderChrome();
  router?.(step);
}

export function renderChrome() {
  const bar = $('#appbar-step');
  const editor = state.step === 5.5;
  if (bar) {
    bar.textContent = editor
      ? 'تدوین دستی — تایم‌لاین را بکش و بچین'
      : `مرحله ${faNum(state.step)} از ۶ — ${STEP_TITLES[state.step - 1]}`;
  }
  document.querySelectorAll('.stepper__item').forEach((node) => {
    const n = Number(node.dataset.step);
    node.classList.toggle('is-active', editor ? n === 5 : n === state.step);
    node.classList.toggle('is-done', n < state.step);
  });
  const back = $('#btn-back');
  if (back) back.hidden = state.step === 1;
}

/**
 * App-bar «بروزرسانی» badge: visible only while a new build is waiting (or a
 * newer release exists). Clicking it is wired up in main.js.
 */
export function setUpdateBadge(on, title = '') {
  const node = $('#btn-update');
  if (!node) return false;
  node.hidden = !on;
  if (title) node.title = title;
  node.classList.toggle('is-live', !!on);
  return !!on;
}
export const updateBadgeVisible = () => {
  const node = $('#btn-update');
  return !!node && !node.hidden;
};

export function setBottomBar(children = []) {
  const bar = $('#bottom-bar');
  bar.innerHTML = '';
  const nodes = (Array.isArray(children) ? children : [children]).filter(Boolean);
  if (!nodes.length) { bar.hidden = true; return; }
  bar.hidden = false;
  nodes.forEach((n) => bar.append(n));
}

export function btn(label, { onClick, primary = false, small = false, block = false, ghost = false, disabled = false, icon = '' } = {}) {
  const classes = ['btn'];
  if (primary) classes.push('btn--primary');
  if (small) classes.push('btn--sm');
  if (block) classes.push('btn--block');
  if (ghost) classes.push('btn--ghost');
  return el('button', {
    class: classes.join(' '),
    disabled,
    onclick: (e) => { vibrate(5); onClick?.(e); },
  }, [icon ? `${icon} ${label}` : label]);
}

/* ---------------- toasts ---------------- */
export function toast(message, type = 'info', ms = 2600) {
  const host = $('#toast-host');
  const node = el('div', { class: `toast toast--${type}`, text: message });
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s, transform .25s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 300);
  }, ms);
}

/* ---------------- bottom sheet ---------------- */
export function openSheet(builder, { title = '' } = {}) {
  const host = $('#sheet-host');
  const content = el('div', { class: 'sheet' }, [
    el('div', { class: 'sheet__grab' }),
    title ? el('h2', { text: title, style: { marginBottom: '12px' } }) : null,
  ]);
  const close = () => closeSheet();
  content.append(builder({ close }));
  host.innerHTML = '';
  host.append(content);
  host.hidden = false;
  host.onclick = (e) => { if (e.target === host) close(); };
  return close;
}
export function closeSheet() {
  const host = $('#sheet-host');
  host.hidden = true;
  host.innerHTML = '';
}

export function confirmSheet({ title, message, confirmLabel = 'تأیید', danger = false }) {
  return new Promise((resolve) => {
    openSheet(({ close }) => el('div', { class: 'stack' }, [
      el('p', { class: 'lead', text: message }),
      el('div', { class: 'row' }, [
        btn(confirmLabel, { primary: !danger, onClick: () => { close(); resolve(true); } }),
        btn('انصراف', { ghost: true, onClick: () => { close(); resolve(false); } }),
      ]),
    ]), { title });
  });
}

/* ---------------- busy overlay ---------------- */
const CIRC = 2 * Math.PI * 19;
let busyCancel = null;

export function startBusy(title, sub = '', { onCancel = null } = {}) {
  state.busy = true;
  const node = $('#busy');
  $('#busy-title').textContent = title;
  $('#busy-sub').textContent = sub;
  $('#busy-pct').textContent = '۰٪';
  $('#busy-ring').style.strokeDashoffset = String(CIRC);
  const cancel = $('#busy-cancel');
  cancel.hidden = !onCancel;
  busyCancel = onCancel;
  cancel.onclick = () => { busyCancel?.(); cancel.hidden = true; };
  node.hidden = false;
}
export function updateBusy(progress, sub) {
  if (typeof progress === 'number') {
    const p = Math.max(0, Math.min(1, progress));
    $('#busy-ring').style.strokeDashoffset = String(CIRC * (1 - p));
    $('#busy-pct').textContent = `${faNum(Math.round(p * 100))}٪`;
  }
  if (sub !== undefined) $('#busy-sub').textContent = sub;
}
export function stopBusy() {
  state.busy = false;
  $('#busy').hidden = true;
  busyCancel = null;
}

/* ---------------- misc UI bits ---------------- */
export function field(label, control, hint) {
  return el('div', { class: 'field' }, [
    label ? el('label', { text: label }) : null,
    control,
    hint ? el('div', { class: 'muted', text: hint }) : null,
  ]);
}

export function chips(items, activeId, onPick) {
  return el('div', { class: 'pill-row' }, items.map((it) => el('button', {
    class: `chip ${it.id === activeId ? 'is-on' : ''}`,
    onclick: () => { vibrate(4); onPick?.(it.id); },
  }, [it.icon ? `${it.icon} ${it.label}` : it.label])));
}

export function seg(items, activeId, onPick) {
  return el('div', { class: 'seg' }, items.map((it) => el('button', {
    class: it.id === activeId ? 'is-on' : '',
    onclick: () => { vibrate(4); onPick?.(it.id); },
  }, [it.label])));
}

export function switchRow(label, hint, checked, onChange) {
  const input = el('input', { type: 'checkbox', checked, onchange: (e) => onChange?.(e.target.checked) });
  return el('label', { class: 'switchrow' }, [
    el('div', {}, [el('b', { text: label }), hint ? el('small', { text: hint }) : null]),
    el('span', { class: 'switch' }, [input, el('i')]),
  ]);
}

export function slider({ min = 0, max = 100, step = 1, value = 50, onInput, format }) {
  const out = el('b', { class: 'mono', text: format ? format(value) : String(value) });
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = Number(e.target.value);
      out.textContent = format ? format(v) : String(v);
      onInput?.(v);
    },
  });
  return el('div', {}, [el('div', { class: 'row row--between' }, [input, out])]);
}

export function switchStep(delta) {
  go(state.step + delta);
}

export function refresh() { notify(); renderChrome(); }
