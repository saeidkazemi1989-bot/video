/**
 * Overlay / caption renderer (2D canvas, RTL-aware) with beat-synced
 * animations: pop, slide, karaoke, word-by-word, typewriter, impact.
 */
import { clamp, lerp, smoothstep, easeOutBack, easeOutCubic, easeOutQuint, faNum } from './util.js';

const FONT_STACKS = {
  display: '"Vazirmatn","Arial Black",Impact,system-ui,sans-serif',
  sans: '"Vazirmatn",system-ui,-apple-system,"Segoe UI",sans-serif',
  serif: 'Georgia,"Times New Roman","Vazirmatn",serif',
};

let fontsReady = null;
export function ensureFonts() {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (!document.fonts) return;
    try {
      await Promise.all([
        document.fonts.load('400 64px Vazirmatn'),
        document.fonts.load('700 64px Vazirmatn'),
        document.fonts.load('800 64px Vazirmatn'),
        document.fonts.load('900 64px Vazirmatn'),
      ]);
      await document.fonts.ready;
    } catch { /* ignore */ }
  })();
  return fontsReady;
}

export function fontString(style, sizePx, weight) {
  return `${weight || style.weight || 800} ${Math.round(sizePx)}px ${FONT_STACKS[style.font] || FONT_STACKS.display}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapLines(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** Word positions for a single line (RTL aware). */
function lineWords(ctx, line, rtl) {
  const words = line.split(/\s+/).filter(Boolean);
  const space = ctx.measureText(' ').width;
  const widths = words.map((w) => ctx.measureText(w).width);
  const total = widths.reduce((a, b) => a + b, 0) + space * Math.max(0, words.length - 1);
  return { words, widths, space, total };
}

function scrim(ctx, W, H, from, to, alphaTop, alphaBottom) {
  const g = ctx.createLinearGradient(0, from, 0, to);
  g.addColorStop(0, `rgba(0,0,0,${alphaTop})`);
  g.addColorStop(1, `rgba(0,0,0,${alphaBottom})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, Math.min(from, to), W, Math.abs(to - from));
}

/**
 * Draw a block of text with the given animation.
 * @returns {number} the block height used
 */
function drawTextBlock(ctx, {
  text, cx, cy, maxWidth, sizePx, style, rtl, progress, elapsed, remain, W, H,
  perWordHighlight = false, forceAlpha = null, forceScaleBump = 0, align = 'center', stagger = 0,
}) {
  if (!text) return 0;
  const s = style;
  ctx.font = fontString(s, sizePx, s.weight);
  ctx.textBaseline = 'middle';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = align === 'center' ? 'center' : align;
  if ('letterSpacing' in ctx && s.letterSpacing) {
    ctx.letterSpacing = `${(s.letterSpacing * sizePx).toFixed(2)}px`;
  }

  let lines = wrapLines(ctx, s.uppercase && /^[\x00-\x7F\s]*$/.test(text) ? text.toUpperCase() : text, maxWidth);
  const lineHeight = sizePx * (s.lineHeight || 1.3);
  const blockH = lines.length * lineHeight;

  // ---- macro animation state ----
  const inT = clamp(elapsed / 0.32, 0, 1);
  const outFade = clamp(remain / 0.26, 0, 1);
  let alpha = clamp(inT * 1.6, 0, 1) * outFade;
  let scale = 1;
  let yOff = 0;
  const anim = s.anim || 'pop';

  if (anim === 'pop') scale = lerp(0.84, 1, easeOutBack(inT));
  else if (anim === 'slideup') { yOff = lerp(sizePx * 0.8, 0, easeOutCubic(inT)); }
  else if (anim === 'impact') { scale = lerp(1.42, 1, easeOutQuint(clamp(elapsed / 0.18, 0, 1))); }
  else if (anim === 'wordpop' || anim === 'karaoke') scale = lerp(0.94, 1, easeOutCubic(inT));
  else if (anim === 'fade') scale = 1;
  if (forceAlpha !== null) alpha = forceAlpha;
  scale *= 1 + forceScaleBump;

  const typewriter = anim === 'typewriter';
  const totalChars = lines.join(' ').length;
  let visibleChars = Infinity;
  if (typewriter) {
    visibleChars = Math.ceil(clamp(progress / 0.72, 0, 1) * totalChars * 1.04);
  }

  const c = s;
  const strokeW = (c.stroke || 0) * sizePx;
  const shadowBlur = (c.shadow || 0) * sizePx * 0.55;
  const hlColor = c.highlight || '#ffd166';

  ctx.save();
  if (c.bg) {
    const padX = sizePx * (c.bg.pad || 0.5) * 0.7;
    const padY = sizePx * (c.bg.pad || 0.5) * 0.45;
    let maxLine = 0;
    for (const l of lines) maxLine = Math.max(maxLine, ctx.measureText(l).width);
    const bw = Math.min(maxWidth, maxLine) + padX * 2;
    const bh = blockH + padY * 2;
    ctx.globalAlpha = alpha * 0.96;
    ctx.fillStyle = c.bg.color;
    roundRect(ctx, cx - bw / 2, cy - blockH / 2 - padY, bw, bh, sizePx * (c.bg.radius || 0.4));
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const wordAnim = anim === 'karaoke' || anim === 'wordpop';
  const baseY = cy + yOff + (scale !== 1 ? 0 : 0);

  lines.forEach((line, li) => {
    const ly = baseY - blockH / 2 + lineHeight * (li + 0.5);
    if (typewriter && visibleChars !== Infinity) {
      const before = lines.slice(0, li).join(' ').length + (li > 0 ? 1 : 0);
      const remaining = visibleChars - before;
      if (remaining <= 0) return;
      const shown = line.slice(0, remaining);
      ctx.save();
      ctx.translate(cx, ly);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      paint(ctx, shown, 0, 0);
      if (progress < 0.8) {
        const w = ctx.measureText(shown).width;
        ctx.fillStyle = hlColor;
        ctx.fillRect(rtl ? -w / 2 - sizePx * 0.12 : w / 2 + sizePx * 0.06, -sizePx * 0.32, sizePx * 0.1, sizePx * 0.64);
      }
      ctx.restore();
      return;
    }
    if (!wordAnim) {
      ctx.save();
      ctx.translate(cx, ly);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      paint(ctx, line, 0, 0);
      ctx.restore();
      return;
    }
    // word-level layout
    const { words, widths, space, total } = lineWords(ctx, line, rtl);
    let cursor = rtl ? total / 2 : -total / 2;
    const activeIdx = perWordHighlight ? Math.min(words.length - 1, Math.floor(progress * words.length * 1.02)) : -1;
    words.forEach((word, wi) => {
      const wWidth = widths[wi];
      let wordScale = 1;
      let wordAlpha = alpha;
      if (anim === 'wordpop') {
        const at = stagger ? clamp((progress - wi * (stagger / Math.max(1, words.length))) / 0.22, 0, 1) : clamp((elapsed - wi * 0.09) / 0.22, 0, 1);
        wordScale = lerp(0.6, 1, easeOutBack(at));
        wordAlpha = alpha * clamp(at * 1.8, 0, 1);
      }
      const isActive = anim === 'karaoke' && wi === activeIdx;
      if (isActive) wordScale = 1.1;
      const wx = rtl ? cursor - wWidth / 2 : cursor + wWidth / 2;
      ctx.save();
      ctx.translate(cx + wx * scale, ly);
      ctx.scale(scale * wordScale, scale * wordScale);
      ctx.globalAlpha = wordAlpha;
      paint(ctx, word, 0, 0, isActive ? hlColor : null);
      if (isActive && c.underline === true) {
        ctx.fillStyle = hlColor;
        ctx.fillRect(-wWidth / 2, sizePx * 0.42, wWidth, Math.max(2, sizePx * 0.055));
      }
      ctx.restore();
      cursor += (wWidth + space) * (rtl ? -1 : 1);
    });
  });
  ctx.restore();

  function paint(context, str, x, y, colorOverride) {
    if (strokeW > 0) {
      context.lineWidth = strokeW;
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeStyle = c.strokeColor || 'rgba(0,0,0,0.8)';
      context.strokeText(str, x, y);
    }
    context.fillStyle = colorOverride || c.color || '#fff';
    if (shadowBlur > 0) {
      context.shadowColor = `rgba(0,0,0,${clamp((c.shadow || 0) * 0.8, 0, 0.85)})`;
      context.shadowBlur = shadowBlur;
      context.shadowOffsetY = sizePx * 0.05;
    }
    context.fillText(str, x, y);
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
  }

  return blockH;
}

function positionFor(pos, H) {
  switch (pos) {
    case 'top': return H * 0.19;
    case 'center': return H * 0.48;
    case 'lower': return H * 0.66;
    case 'bottom': return H * 0.8;
    default: return H * 0.5;
  }
}

/** Main entry: paint every overlay that is active at time `t`. */
export function drawOverlays(ctx, plan, t, { preview = false } = {}) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const scale = H / 1920;
  const style = plan.preset.caption;
  const rtl = (plan.settings?.lang || 'fa') === 'fa';
  const opacity = plan.settings?.overlayOpacity ?? 1;
  ctx.save();
  ctx.globalAlpha = 1;

  const active = (o) => t >= o.t0 && t <= o.t1;

  // ---- intro hook ----
  if (plan.settings?.hook !== false) {
    const hook = plan.overlays.find((o) => o.kind === 'hook');
    if (hook && active(hook)) {
      const elapsed = t - hook.t0;
      const remain = hook.t1 - t;
      const p = clamp(elapsed / (hook.t1 - hook.t0), 0, 1);
      const scrimAlpha = 0.5 * smoothstep(0, 0.35, p) * (1 - smoothstep(0.75, 1, p));
      if (scrimAlpha > 0.01) scrim(ctx, W, H, 0, H * 0.75, scrimAlpha * 0.9 * opacity, scrimAlpha * 0.15 * opacity);
      const anchor = positionFor(style.pos === 'lower' ? 'center' : style.pos, H);
      drawTextBlock(ctx, {
        text: hook.text,
        cx: W / 2,
        cy: Math.min(anchor, H * 0.55),
        maxWidth: W * 0.84,
        sizePx: style.size * H * 1.32,
        style,
        rtl,
        progress: p,
        elapsed,
        remain,
        W, H,
        stagger: 0.55,
        forceAlpha: null,
      });
    }
  }

  // ---- per-cut lines ----
  if (plan.settings?.captions !== false) {
    for (const o of plan.overlays) {
      if (o.kind !== 'line' || !active(o)) continue;
      const elapsed = t - o.t0;
      const remain = o.t1 - t;
      const p = clamp(elapsed / (o.t1 - o.t0), 0, 1);
      drawTextBlock(ctx, {
        text: o.text,
        cx: W / 2,
        cy: positionFor(style.pos, H),
        maxWidth: W * 0.84,
        sizePx: style.size * H,
        style,
        rtl,
        progress: p,
        elapsed,
        remain,
        W, H,
        perWordHighlight: style.anim === 'karaoke',
        stagger: 0.6,
      });
    }
  }

  // ---- outro ----
  const outro = plan.overlays.find((o) => o.kind === 'outro');
  if (outro && active(outro)) {
    const elapsed = t - outro.t0;
    const remain = outro.t1 - t;
    const p = clamp(elapsed / (outro.t1 - outro.t0), 0, 1);
    const dim = 0.45 * smoothstep(0, 0.45, p) * opacity;
    ctx.fillStyle = `rgba(0,0,0,${dim})`;
    ctx.fillRect(0, 0, W, H);
    const styleOutro = { ...style, anim: 'slideup', pos: 'center', bg: null, stroke: Math.max(style.stroke, 0.05) };
    drawTextBlock(ctx, {
      text: outro.text, cx: W / 2, cy: H * 0.45, maxWidth: W * 0.8,
      sizePx: style.size * H * 1.05, style: styleOutro, rtl, progress: p, elapsed, remain, W, H,
    });
    if (outro.handle) {
      const hs = { ...style, anim: 'fade', size: style.size * 0.66, weight: 700, stroke: 0 };
      drawTextBlock(ctx, {
        text: outro.handle, cx: W / 2, cy: H * 0.56, maxWidth: W * 0.7,
        sizePx: hs.size * H, style: hs, rtl, progress: p, elapsed: Math.max(0, elapsed - 0.18), remain, W, H,
      });
    }
  }

  // ---- progress ----
  if (plan.settings?.progressBar !== false) {
    const barH = Math.max(3, H * 0.0032);
    const y = H * 0.014;
    const x0 = W * 0.04, x1 = W * 0.96;
    ctx.globalAlpha = 0.9 * opacity;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, x0, y, x1 - x0, barH, barH / 2);
    ctx.fill();
    const p = clamp(t / plan.duration, 0, 1);
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, plan.preset.palette[0]);
    g.addColorStop(0.55, plan.preset.palette[1]);
    g.addColorStop(1, plan.preset.palette[2] || plan.preset.palette[1]);
    ctx.fillStyle = g;
    roundRect(ctx, x0, y, Math.max(barH, (x1 - x0) * p), barH, barH / 2);
    ctx.fill();
    // beat ticks
    ctx.globalAlpha = 0.28 * opacity;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const cut of plan.cuts) {
      const cx = x0 + (x1 - x0) * (cut.t0 / plan.duration);
      ctx.fillRect(cx, y + barH, 1.4 * scale * 2, barH * 1.8);
    }
    ctx.globalAlpha = 1;
  }

  // ---- watermark ----
  if (plan.settings?.watermark && plan.settings?.handle) {
    const text = plan.settings.handle.startsWith('@') ? plan.settings.handle : `@${plan.settings.handle}`;
    ctx.globalAlpha = 0.5 * opacity;
    ctx.direction = 'ltr';
    ctx.textAlign = 'left';
    ctx.font = fontString({ font: 'sans', weight: 600 }, H * 0.017);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = H * 0.006;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, W * 0.05, H * 0.945);
    ctx.shadowBlur = 0;
  }

  // ---- global fade out ----
  const fadeOut = plan.settings?.fadeOut ?? 0.35;
  if (t > plan.duration - fadeOut) {
    const a = clamp((t - (plan.duration - fadeOut)) / fadeOut, 0, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();
}

/** Small helper used by the UI for the intro/hook preview. */
export function captionPreviewStyle(plan) {
  return { ...plan.preset.caption, size: plan.preset.caption.size };
}
