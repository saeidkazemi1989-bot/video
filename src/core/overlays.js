/**
 * Overlay (on-screen text) scheduling — one implementation shared by the
 * automatic planner and the manual editor.
 */
import { getPreset } from '../data/styles.js';
import { clamp } from './util.js';
import { buildSubtitles } from './vad.js';

export function buildOverlays(plan) {
  const preset = getPreset(plan.presetId) || plan.preset;
  const copy = plan.copy || {};
  const settings = plan.settings || {};
  const overlays = [];
  const duration = plan.duration || 0;

  const hookEnd = settings.hook !== false && copy.hook
    ? Math.min(preset.intro.dur + 0.4, duration * 0.35)
    : 0;
  const outroDur = settings.outro !== false && copy.cta
    ? Math.min(preset.outro.dur, Math.max(1.2, duration * 0.18))
    : 0;

  if (settings.hook !== false && copy.hook) {
    overlays.push({
      kind: 'hook',
      text: copy.hook,
      t0: 0,
      t1: +hookEnd.toFixed(3),
      anim: preset.caption.anim,
    });
  }

  if (settings.captions !== false && copy.lines?.length) {
    const interior = plan.cuts.slice(1, Math.max(2, plan.cuts.length - 1));
    if (interior.length >= copy.lines.length) {
      const step = Math.max(1, Math.floor(interior.length / copy.lines.length));
      copy.lines.forEach((text, li) => {
        const cut = interior[(li * step) % interior.length];
        if (!cut) return;
        overlays.push({
          kind: 'line',
          text,
          t0: +(cut.t0 + Math.min(0.18, cut.dur * 0.12)).toFixed(3),
          t1: +(cut.t0 + Math.max(0.9, Math.min(cut.dur * 0.85, 2.6))).toFixed(3),
          anim: preset.caption.anim,
        });
      });
    } else if (duration > 1.8) {
      const winStart = clamp(hookEnd + 0.25, 0.2, Math.max(0.3, duration - 1.2));
      const winEnd = Math.max(winStart + 0.6, duration - outroDur - 0.2);
      const span = winEnd - winStart;
      const n = copy.lines.length;
      const slot = span / n;
      copy.lines.forEach((text, li) => {
        const s0 = winStart + li * slot;
        const pad = Math.min(0.18, slot * 0.08);
        const maxT1 = Math.max(s0 + 0.42, s0 + slot - 0.03);
        const t0 = clamp(s0 + pad, 0, Math.max(0, duration - 0.45));
        const t1 = clamp(Math.min(t0 + 2.6, maxT1), t0 + 0.35, Math.min(duration, s0 + slot - 0.01));
        if (t1 > t0 + 0.2) {
          overlays.push({
            kind: 'line',
            text,
            t0: +t0.toFixed(3),
            t1: +t1.toFixed(3),
            anim: preset.caption.anim,
          });
        }
      });
    }
  }

  if (settings.outro !== false && copy.cta) {
    overlays.push({
      kind: 'outro',
      text: copy.cta,
      handle: settings.handle
        ? (settings.handle.startsWith('@') ? settings.handle : `@${settings.handle}`)
        : '',
      t0: +(duration - outroDur).toFixed(3),
      t1: duration,
      anim: 'fade',
    });
  }
  return overlays;
}

/** Keep every overlay inside the (possibly changed) timeline. */
export function clampOverlays(overlays, duration) {
  for (const o of overlays) {
    if (o.kind === 'outro') continue;
    o.t0 = clamp(o.t0, 0, Math.max(0, duration - 0.4));
    o.t1 = clamp(o.t1, o.t0 + 0.4, duration);
  }
  const outro = overlays.find((o) => o.kind === 'outro');
  if (outro) {
    const len = Math.min(outro.t1 - outro.t0, duration * 0.3);
    outro.t0 = Math.max(0, duration - Math.max(1.2, len));
    outro.t1 = duration;
  }
  return overlays;
}

/**
 * Place subtitles on the timeline: the speech segments detected in each video
 * are mapped through its cut (trim, replay offset, slow-motion) and the text is
 * distributed over them with word-level timings.
 */
export function attachSubtitles(plan, source = plan._subtitleSource) {
  plan.subtitles = [];
  const text = source?.text || '';
  const segmentsByAsset = source?.segmentsByAsset || {};
  if (!text) return [];
  const allSegments = [];
  plan.cuts.forEach((cut) => {
    const asset = cut.asset;
    if (!asset || asset.kind !== 'video') return;
    const speech = segmentsByAsset[asset.id];
    if (!speech?.length) return;
    const speed = cut.speed || 1;
    for (const seg of speech) {
      const t0 = cut.t0 + (seg.t0 - (cut.trimIn || 0)) / speed;
      const t1 = cut.t0 + (seg.t1 - (cut.trimIn || 0)) / speed;
      if (t1 <= cut.t0 + 0.02 || t0 >= cut.t1 - 0.02) continue;
      allSegments.push({
        t0: +clamp(t0, cut.t0, cut.t1).toFixed(3),
        t1: +clamp(t1, cut.t0, cut.t1).toFixed(3),
        energy: seg.energy ?? 0.6,
      });
    }
  });
  if (!allSegments.length) return [];
  allSegments.sort((a, b) => a.t0 - b.t0);
  const built = buildSubtitles(allSegments, text, {
    maxWordsPerCue: plan.settings?.subtitleWords ?? 5,
  });
  plan.subtitles = built.cues;
  plan.subtitleStats = { segments: allSegments.length, cues: built.cues.length, speechRatio: built.speechRatio };
  return built.cues;
}

export function applyOverlays(plan) {
  plan.overlays = clampOverlays(buildOverlays(plan), plan.duration);
  if (plan.settings?.subtitles !== false && plan._subtitleSource) attachSubtitles(plan);
  return plan.overlays;
}
