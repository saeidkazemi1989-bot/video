/**
 * Manual timeline editing: move, trim, split, duplicate, delete, replace and
 * retime the shots of a plan without losing the music sync.
 *
 * Two resize modes:
 *  - 'absorb' (default): growing a shot steals the beats from its neighbours,
 *    so the reel keeps its length and stays on the grid;
 *  - 'extend': the reel gets longer/shorter.
 */
import { clamp } from './util.js';
import { resolveCutSource, usageCounts, MIN_CUT } from './cut.js';
import { applyOverlays } from './overlays.js';
import { nearestBeat } from './beats.js';

export function beatPeriodOf(plan) {
  return plan.music?.bpm ? 60 / plan.music.bpm : (plan.bpm ? 60 / plan.bpm : 0.6);
}

/** Recompute t0/t1 for every cut and the plan duration. */
export function retime(plan, { rebuildText = true } = {}) {
  let t = 0;
  plan.cuts.forEach((c, i) => {
    c.index = i;
    c.dur = Math.max(MIN_CUT, +c.dur.toFixed(4));
    c.t0 = +t.toFixed(4);
    c.t1 = +(t + c.dur).toFixed(4);
    t += c.dur;
  });
  plan.duration = +t.toFixed(4);
  plan.meta = {
    ...(plan.meta || {}),
    shots: plan.cuts.length,
    avgShot: +(plan.duration / Math.max(1, plan.cuts.length)).toFixed(2),
    transitions: plan.cuts.filter((c) => c.transition?.type && c.transition.type !== 'cut').length,
    assetsUsed: new Set(plan.cuts.map((c) => c.assetId)).size,
  };
  if (plan.music) {
    const maxStart = Math.max(0, (plan.music.duration || 0) - plan.duration - 0.05);
    plan.musicStart = clamp(plan.musicStart || 0, 0, maxStart);
    plan.music.startTime = plan.musicStart;
  }
  fitToMusic(plan);
  if (rebuildText) applyOverlays(plan);
  if (plan.subtitles) plan.subtitles = plan.subtitles.filter((c) => c.t0 < plan.duration);
  return plan;
}

/** Re-derive the source window of one cut (after a resize / asset change). */
export function refreshCutSource(plan, cut, { reuse = 0 } = {}) {
  const asset = cut.asset;
  if (!asset) return cut;
  const res = resolveCutSource({
    asset,
    dur: cut.dur,
    reuse,
    sourceGain: plan.settings?.sourceGain ?? 0.35,
    trimIn: cut.trimOverride ?? null,
    speed: cut.speedOverride ?? null,
  });
  cut.trimIn = res.trimIn;
  cut.trimOut = res.trimOut;
  cut.speed = res.speed;
  cut.planMute = res.planMute;
  return cut;
}

/** Re-derive every cut's window (used when the source gain changes). */
export function refreshAllSources(plan) {
  const counts = new Map();
  plan.cuts.forEach((cut) => {
    const reuse = counts.get(cut.assetId) || 0;
    counts.set(cut.assetId, reuse + 1);
    if (cut.trimOverride == null) refreshCutSource(plan, cut, { reuse });
  });
  return plan;
}

/* ------------------------------------------------------------------ */
/* operations                                                          */
/* ------------------------------------------------------------------ */

export function moveCut(plan, index, delta) {
  const to = clamp(index + delta, 0, plan.cuts.length - 1);
  if (to === index) return plan;
  // swap the *content* of the two slots so the music timing never shifts
  const a = plan.cuts[index], b = plan.cuts[to];
  for (const key of ['asset', 'assetId', 'trimIn', 'trimOut', 'speed', 'planMute', 'motion', 'trimOverride', 'speedOverride']) {
    const tmp = a[key];
    a[key] = b[key];
    b[key] = tmp;
  }
  return retime(plan);
}

export function resizeCut(plan, index, beatsDelta, { mode = 'absorb' } = {}) {
  const beat = beatPeriodOf(plan);
  const cut = plan.cuts[index];
  if (!cut) return plan;
  const minDur = Math.max(MIN_CUT, beat * 0.5);
  let delta = beatsDelta * beat;
  if (Math.abs(delta) < 1e-4) return plan;
  delta = Math.max(delta, minDur - cut.dur);

  if (mode === 'absorb' && delta > 0) {
    // take time from the following cuts, then from the previous ones
    let need = delta;
    for (const dir of [1, -1]) {
      for (let k = 1; k <= plan.cuts.length && need > 1e-4; k++) {
        const j = index + dir * k;
        const other = plan.cuts[j];
        if (!other) break;
        const take = Math.min(need, Math.max(0, other.dur - minDur));
        if (take > 0) { other.dur = +(other.dur - take).toFixed(4); need -= take; }
      }
    }
    delta -= need;                      // whatever could not be absorbed
  } else if (mode === 'absorb' && delta < 0) {
    // shrinking gives the freed time back, so the reel keeps its length
    const freed = -delta;
    const targets = [
      ...plan.cuts.slice(index + 1),
      ...plan.cuts.slice(0, index).reverse(),
    ].filter((c) => c !== cut);
    if (targets.length) {
      const share = freed / targets.length;
      targets.forEach((c, i) => {
        const add = i === 0 ? freed - share * (targets.length - 1) : share;
        c.dur = +(c.dur + add).toFixed(4);
      });
      delta = 0;
    }
  }
  cut.dur = Math.max(minDur, +(cut.dur + delta).toFixed(4));
  cut.durChanged = true;
  if (cut.asset?.kind === 'video' && cut.trimOverride == null) refreshCutSource(plan, cut);
  return retime(plan);
}

export function setCutSpeed(plan, index, speed) {
  const cut = plan.cuts[index];
  if (!cut?.asset || cut.asset.kind !== 'video') return plan;
  cut.speedOverride = clamp(speed, 0.25, 3);
  refreshCutSource(plan, cut);
  return retime(plan);
}

export function setCutTrim(plan, index, trimIn) {
  const cut = plan.cuts[index];
  if (!cut?.asset || cut.asset.kind !== 'video') return plan;
  cut.trimOverride = Math.max(0, trimIn);
  refreshCutSource(plan, cut);
  return retime(plan);
}

export function setTransition(plan, index, type, dur = null) {
  const cut = plan.cuts[index];
  if (!cut) return plan;
  if (index === 0) {
    cut.transition = { type: 'cut', dur: 0 };
    return plan;
  }
  const presetDur = plan.preset?.transDur ?? 0.28;
  cut.transition = {
    type,
    dur: type === 'cut' ? 0 : +clamp(dur ?? presetDur, 0.08, 1.2).toFixed(3),
  };
  return retime(plan);
}

export function deleteCut(plan, index) {
  if (plan.cuts.length <= 1) return plan;
  plan.cuts.splice(index, 1);
  return retime(plan);
}

export function duplicateCut(plan, index) {
  const cut = plan.cuts[index];
  if (!cut) return plan;
  const copy = {
    ...cut,
    transition: { ...(cut.transition || { type: 'cut', dur: 0 }) },
    motion: { ...(cut.motion || {}) },
  };
  plan.cuts.splice(index + 1, 0, copy);
  return retime(plan);
}

export function replaceAsset(plan, index, asset) {
  const cut = plan.cuts[index];
  if (!cut || !asset) return plan;
  cut.asset = asset;
  cut.assetId = asset.id;
  cut.trimOverride = null;
  cut.speedOverride = null;
  const counts = usageCounts(plan.cuts, index);
  refreshCutSource(plan, cut, { reuse: counts.get(asset.id) || 0 });
  plan.meta.assetsUsed = new Set(plan.cuts.map((c) => c.assetId)).size;
  return retime(plan);
}

/** Change the slot length to an exact number of beats (used by the UI slider). */
export function setCutBeats(plan, index, beats, { mode = 'absorb' } = {}) {
  const beat = beatPeriodOf(plan);
  const cut = plan.cuts[index];
  if (!cut) return plan;
  const target = Math.max(0.5, beats) * beat;
  return resizeCut(plan, index, (target - cut.dur) / beat, { mode });
}

/**
 * Never run past the end of the song: trim trailing cuts instead of letting the
 * reel play silence.
 */
export function fitToMusic(plan) {
  if (!plan.music?.duration) return plan;
  const beat = beatPeriodOf(plan);
  const minDur = Math.max(MIN_CUT, beat * 0.5);
  const avail = Math.max(0.5, plan.music.duration - (plan.musicStart || 0) - 0.05);
  let excess = plan.duration - avail;
  if (excess <= 1e-3) return plan;
  while (excess > 1e-3 && plan.cuts.length > 1) {
    const last = plan.cuts[plan.cuts.length - 1];
    if (last.dur - excess >= minDur) { last.dur = +(last.dur - excess).toFixed(4); excess = 0; break; }
    excess -= last.dur;
    plan.cuts.pop();
  }
  const last = plan.cuts[plan.cuts.length - 1];
  if (last && excess > 1e-3) {
    const take = Math.min(excess, Math.max(0, last.dur - minDur));
    last.dur = +(last.dur - take).toFixed(4);
  }
  return plan;
}

/** Snap every cut boundary back onto the beat grid (whole beats). */
export function snapToGrid(plan) {
  if (!plan.music?.bpm) return plan;
  const beat = beatPeriodOf(plan);
  plan.cuts.forEach((c) => {
    c.dur = +Math.max(beat, Math.round(c.dur / beat) * beat).toFixed(4);
  });
  return retime(plan);
}

/** Split the cut at `t` (absolute timeline seconds). */
export function splitCut(plan, index, t) {
  const cut = plan.cuts[index];
  if (!cut) return plan;
  const beat = beatPeriodOf(plan);
  const splitAt = plan.music?.bpm ? nearestBeat({ beats: plan.music.beats || [], bpm: plan.bpm }, t) : t;
  const left = clamp(splitAt, cut.t0 + beat * 0.5, cut.t1 - beat * 0.5);
  if (left <= cut.t0 || left >= cut.t1) return plan;
  const second = {
    ...cut,
    transition: { type: 'cut', dur: 0 },
    motion: { ...(cut.motion || {}) },
    trimOverride: null,
  };
  cut.dur = +(left - cut.t0).toFixed(4);
  second.dur = +(cut.t1 - left).toFixed(4);
  // the second half continues where the first one stopped
  if (cut.asset?.kind === 'video') {
    const consumed = (cut.trimOut - cut.trimIn);
    second.trimOverride = +(cut.trimIn + consumed).toFixed(4);
    refreshCutSource(plan, second);
  }
  plan.cuts.splice(index + 1, 0, second);
  return retime(plan);
}

/** Points of interest used by the UI (thumbnails, playhead jumps). */
export function cutAt(plan, t) {
  return plan.cuts.find((c) => t >= c.t0 && t <= c.t1) || plan.cuts[plan.cuts.length - 1];
}

export function planProblems(plan, assets = []) {
  const problems = [];
  if (!plan.cuts.length) problems.push('هیچ نمایی در تایم‌لاین نیست.');
  for (const c of plan.cuts) {
    if (!c.asset) problems.push(`نمای ${c.index + 1} فایل ندارد.`);
    if (c.asset?.kind === 'video' && c.trimOut != null) {
      const out = c.asset.trimOut ?? c.asset.duration ?? 0;
      if (c.trimOut > out + 1e-3) problems.push(`نمای ${c.index + 1} از انتهای ویدیو بیرون زده.`);
    }
  }
  const unused = assets.filter((a) => a.use && !plan.cuts.some((c) => c.assetId === a.id));
  if (unused.length) problems.push(`${unused.length} فایل انتخاب‌شده در ریلز استفاده نشده.`);
  return problems;
}
