/**
 * Per-clip auto-lighting & colour-cast harmonizer — «تنظیم خودکار نور».
 *
 * Uses the brightness (`luma`), contrast, shadow/highlight clipping (`clipLo`,
 * `clipHi`) and colour cast (`warmth`) already measured by `analyze.js` so dark
 * indoor clips, bright outdoor clips and flat shots sit smoothly next to one
 * another before the chosen style preset's colour grade is applied.
 *
 * Pure maths, zero DOM/GPU dependencies — unit-tested directly.
 */
import { clamp } from './util.js';

export const IDENTITY_AUTO_LIGHT = Object.freeze({
  exposureMul: 1,
  contrastMul: 1,
  gammaMul: 1,
  tempDelta: 0,
  liftDelta: 0,
  saturationMul: 1,
  applied: false,
  note: 'نور متعادل',
});

/**
 * Compute gentle, natural per-clip lighting adjustments from `asset.analysis`.
 * Already well-balanced clips stay untouched (`applied: false`).
 */
export function computeAutoLight(analysis) {
  if (!analysis || typeof analysis !== 'object' || !Number.isFinite(analysis.luma)) {
    return { ...IDENTITY_AUTO_LIGHT };
  }

  const luma = clamp(analysis.luma, 0, 1);
  const contrast = Number.isFinite(analysis.contrast) ? clamp(analysis.contrast, 0, 0.6) : 0.18;
  const saturation = Number.isFinite(analysis.saturation) ? clamp(analysis.saturation, 0, 1) : 0.25;
  const warmth = Number.isFinite(analysis.warmth) ? clamp(analysis.warmth, -1, 1) : 0;
  const clipHi = Number.isFinite(analysis.clipHi) ? clamp(analysis.clipHi, 0, 1) : 0;
  const clipLo = Number.isFinite(analysis.clipLo) ? clamp(analysis.clipLo, 0, 1) : 0;

  // 1) Exposure: lift dark clips, tame overexposed ones, guard highlights
  let exposureMul = 1;
  if (luma < 0.40) {
    const rawBoost = Math.pow(0.42 / Math.max(0.12, luma), 0.42);
    const hiGuard = 1 - clamp((clipHi - 0.05) * 6, 0, 0.75);
    exposureMul = clamp(1 + (rawBoost - 1) * hiGuard, 1, 1.35);
  } else if (luma > 0.56 || clipHi > 0.08) {
    const lumaPull = luma > 0.56 ? Math.pow(0.54 / Math.min(0.94, luma), 0.42) : 1;
    const hiPull = 1 - clamp((clipHi - 0.08) * 0.55, 0, 0.12);
    exposureMul = clamp(lumaPull * hiPull, 0.78, 1);
  }

  // 2) Shadow recovery / midtone gamma
  let gammaMul = 1;
  let liftDelta = 0;
  if (luma < 0.38 || (clipLo > 0.12 && luma < 0.46)) {
    gammaMul = clamp(
      1 + clamp(0.38 - luma, 0, 0.26) * 0.38 + clamp(clipLo - 0.12, 0, 0.4) * 0.12,
      1,
      1.14,
    );
    liftDelta = clamp(clamp(0.34 - luma, 0, 0.22) * 0.06, 0, 0.015);
  } else if (luma > 0.65 && clipLo < 0.01) {
    gammaMul = clamp(1 - clamp(luma - 0.65, 0, 0.25) * 0.22, 0.92, 1);
  }

  // 3) Contrast: open up flat/hazy clips, soften harsh extremes
  let contrastMul = 1;
  if (contrast < 0.14) {
    contrastMul = clamp(1 + (0.14 - contrast) * 1.05, 1, 1.14);
  } else if (contrast > 0.28) {
    contrastMul = clamp(1 - (contrast - 0.28) * 0.45, 0.91, 1);
  }

  // 4) White balance: neutralize strong indoor orange or outdoor blue cast
  let tempDelta = 0;
  if (warmth > 0.09) {
    tempDelta = -clamp((warmth - 0.09) * 0.5, 0, 0.12);
  } else if (warmth < -0.07) {
    tempDelta = clamp((-warmth - 0.07) * 0.5, 0, 0.12);
  }

  // 5) Subtle saturation recovery on washed-out clips
  let saturationMul = 1;
  if (saturation < 0.14 && luma > 0.18) {
    saturationMul = clamp(1 + (0.14 - saturation) * 0.65, 1, 1.09);
  }

  exposureMul = +exposureMul.toFixed(4);
  contrastMul = +contrastMul.toFixed(4);
  gammaMul = +gammaMul.toFixed(4);
  tempDelta = +tempDelta.toFixed(4);
  liftDelta = +liftDelta.toFixed(4);
  saturationMul = +saturationMul.toFixed(4);

  const applied = (
    Math.abs(exposureMul - 1) > 0.025
    || Math.abs(contrastMul - 1) > 0.025
    || Math.abs(gammaMul - 1) > 0.025
    || Math.abs(tempDelta) > 0.02
  );

  let note = 'نور متعادل';
  if (exposureMul > 1.04) note = 'روشن‌تر شد';
  else if (exposureMul < 0.96) note = 'مهار نور شدید';
  else if (contrastMul > 1.04) note = 'بهبود کنتراست';
  else if (Math.abs(tempDelta) > 0.02) note = 'تعادل دمای رنگ';

  return {
    exposureMul,
    contrastMul,
    gammaMul,
    tempDelta,
    liftDelta,
    saturationMul,
    applied,
    note,
  };
}

/**
 * Combine the preset's grade with a cut's per-clip auto-lighting adjustment.
 * Monochrome presets (`baseGrade.saturation < 0.2`, e.g. Noir) stay monochrome.
 */
export function mergeGradeWithAutoLight(baseGrade, autoLight, { enabled = true } = {}) {
  if (!baseGrade) return baseGrade;
  if (!enabled || !autoLight || !autoLight.applied) return baseGrade;

  const baseLift = Array.isArray(baseGrade.lift) ? baseGrade.lift : [0, 0, 0];
  const isMono = (baseGrade.saturation ?? 1) < 0.2;

  return {
    ...baseGrade,
    exposure: +clamp((baseGrade.exposure ?? 1) * (autoLight.exposureMul ?? 1), 0.55, 1.75).toFixed(4),
    contrast: +clamp((baseGrade.contrast ?? 1) * (autoLight.contrastMul ?? 1), 0.75, 1.5).toFixed(4),
    gamma: +clamp((baseGrade.gamma ?? 1) * (autoLight.gammaMul ?? 1), 0.7, 1.45).toFixed(4),
    temperature: +clamp((baseGrade.temperature ?? 0) + (autoLight.tempDelta ?? 0), -1, 1).toFixed(4),
    saturation: isMono
      ? baseGrade.saturation
      : +clamp((baseGrade.saturation ?? 1) * (autoLight.saturationMul ?? 1), 0, 1.6).toFixed(4),
    lift: baseLift.map((v) => +clamp((v || 0) + (autoLight.liftDelta || 0), -0.1, 0.2).toFixed(4)),
  };
}
