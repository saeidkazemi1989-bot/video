/**
 * Shared cut maths: given an asset and a slot length, decide which part of the
 * source is used (source window, replay offset and slow-motion factor).
 * Used by the automatic planner and by the manual timeline editor.
 */
import { clamp } from './util.js';

export const MIN_CUT = 0.35;

/**
 * @param {object} p
 * @param {object} p.asset
 * @param {number} p.dur      slot length on the timeline (seconds)
 * @param {number} [p.reuse]  how many times this asset was already used
 * @param {number} [p.sourceGain] 0 means "no original audio"
 * @param {number|null} [p.trimIn] explicit per-cut in-point (manual override)
 * @param {number|null} [p.speed] explicit per-cut speed
 */
export function resolveCutSource({
  asset, dur, reuse = 0, sourceGain = 0.35, trimIn = null, speed: forcedSpeed = null,
}) {
  if (!asset || asset.kind !== 'video') {
    return { trimIn: 0, trimOut: null, speed: 1, planMute: true };
  }
  const srcIn = asset.trimIn || 0;
  const srcOut = asset.trimOut ?? asset.duration ?? 0;
  const avail = Math.max(0.15, srcOut - srcIn);
  const speed = forcedSpeed != null ? clamp(forcedSpeed, 0.25, 3) : (avail >= dur ? 1 : clamp(avail / dur, 0.3, 1));
  const needed = dur * speed;                     // source seconds consumed

  let start;
  if (trimIn != null) start = trimIn;
  else if (asset.userTrimmed) start = srcIn;
  else if (asset.analysis?.suggestedIn != null) start = asset.analysis.suggestedIn;
  else start = srcIn;
  if (reuse > 0 && trimIn == null) start += needed * reuse;

  if (needed <= avail) {
    start = clamp(start, srcIn, Math.max(srcIn, srcOut - needed - 0.01));
    return {
      trimIn: +start.toFixed(4),
      trimOut: +(start + needed).toFixed(4),
      speed: +speed.toFixed(4),
      planMute: sourceGain <= 0.001 || speed < 0.999,
    };
  }
  // not enough material even slowed down: use everything we have at 1×
  return {
    trimIn: +srcIn.toFixed(4),
    trimOut: +srcOut.toFixed(4),
    speed: +clamp(avail / dur, 0.3, 1).toFixed(4),
    planMute: sourceGain <= 0.001,
  };
}

/** How many times each asset appears in a plan (for replay offsets). */
export function usageCounts(cuts, upToIndex = Infinity) {
  const map = new Map();
  cuts.slice(0, upToIndex).forEach((c) => {
    if (c.assetId) map.set(c.assetId, (map.get(c.assetId) || 0) + 1);
  });
  return map;
}
