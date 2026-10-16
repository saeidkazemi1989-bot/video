/** Plan lifecycle: build / refresh / keep user copy edits. */
import { state, notify } from './state.js';
import { buildPlan } from './core/planner.js';
import { buildOverlays as buildOverlaysShared, attachSubtitles as attachSubtitlesShared } from './core/overlays.js';
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
  plan.settings = { ...state.settings };
  plan._subtitleSource = state.subtitleSource || null;
  if (state.copyOverride) {
    plan.copy = { ...plan.copy, ...state.copyOverride };
    rebuildOverlays(plan);
  }
  if (state.subtitleSource?.text && state.settings.subtitles !== false) {
    plan.subtitles = buildSubtitlesFromSource(plan, state.subtitleSource);
  }
  state.plan = plan;
  state.planDirty = false;
  return plan;
}

/** Build the speech-synced subtitle cues for a plan. */
export function buildSubtitlesFromSource(plan, source) {
  plan._subtitleSource = source;
  return attachSubtitlesShared(plan, source);
}

/** Re-time the overlays after the text was edited (no re-render needed). */
export function rebuildOverlays(plan) {
  plan.overlays = buildOverlaysShared(plan);
  return plan.overlays;
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
