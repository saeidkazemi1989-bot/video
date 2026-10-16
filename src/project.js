/** Plan lifecycle: build / refresh / keep user copy edits. */
import { state, notify } from './state.js';
import { buildPlan } from './core/planner.js';
import { autoPreset, getPreset } from './data/styles.js';

export function markDirty() { state.planDirty = true; }

export function ensurePlan({ force = false, reseed = false } = {}) {
  if (reseed) state.seed = Math.floor(Math.random() * 99999);
  if (state.plan && !force && !state.planDirty) return state.plan;
  const presetId = state.presetId === 'auto' ? autoPreset(state.assets).id : state.presetId;
  const plan = buildPlan({
    assets: state.assets,
    presetId,
    music: state.music?.analysis || null,
    settings: state.settings,
    seed: state.seed,
  });
  if (state.copyOverride) {
    plan.copy = { ...plan.copy, ...state.copyOverride };
    rebuildOverlays(plan);
  }
  state.plan = plan;
  state.planDirty = false;
  return plan;
}

/** Re-time the overlays after the text was edited (no re-render needed). */
export function rebuildOverlays(plan) {
  const copy = plan.copy;
  const preset = getPreset(plan.presetId);
  const overlays = [];
  if (plan.settings.hook !== false) {
    overlays.push({
      kind: 'hook', text: copy.hook, t0: 0,
      t1: Math.min(preset.intro.dur + 0.4, plan.duration * 0.35),
      anim: preset.caption.anim,
    });
  }
  if (plan.settings.captions !== false && copy.lines?.length) {
    const interior = plan.cuts.slice(1, Math.max(2, plan.cuts.length - 1));
    const step = Math.max(1, Math.floor(interior.length / copy.lines.length));
    copy.lines.forEach((text, li) => {
      const cut = interior[(li * step) % interior.length];
      if (!cut) return;
      overlays.push({
        kind: 'line', text,
        t0: cut.t0 + Math.min(0.18, cut.dur * 0.12),
        t1: cut.t0 + Math.max(0.9, Math.min(cut.dur * 0.85, 2.6)),
        anim: preset.caption.anim,
      });
    });
  }
  if (plan.settings.outro !== false) {
    const od = Math.min(preset.outro.dur, Math.max(1.2, plan.duration * 0.18));
    overlays.push({
      kind: 'outro', text: copy.cta,
      handle: plan.settings.handle ? (plan.settings.handle.startsWith('@') ? plan.settings.handle : `@${plan.settings.handle}`) : '',
      t0: plan.duration - od, t1: plan.duration, anim: 'fade',
    });
  }
  plan.overlays = overlays;
  return overlays;
}

export function commitCopy(patch) {
  state.copyOverride = { ...(state.copyOverride || {}), ...patch };
  if (state.plan) {
    state.plan.copy = { ...state.plan.copy, ...patch };
    rebuildOverlays(state.plan);
  }
  notify();
}

export function patchSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  markDirty();
  notify();
}

export function patchAsset(asset, patch) {
  Object.assign(asset, patch);
  markDirty();
  notify();
}

export function musicAnalysis() {
  return state.music?.analysis || null;
}

export function planSummary() {
  const p = state.plan;
  if (!p) return null;
  return {
    duration: p.duration,
    shots: p.meta.shots,
    bpm: p.bpm,
    hasBeat: p.hasBeat,
    preset: p.preset.name,
    assets: p.meta.assetsUsed,
    transitions: p.meta.transitions,
    width: p.width,
    height: p.height,
  };
}
