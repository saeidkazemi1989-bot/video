/**
 * Demo library generator: builds synthetic photos (and short videos when the
 * device can record a canvas stream) so the whole flow can be tried instantly.
 */
import { makeVideoElement, prepareVideo } from './media.js';

const PHOTO_SCENES = [
  { name: 'غروب ساحل', sky: ['#ff9a3c', '#ff4e50', '#3a1c4b'], kind: 'sunset' },
  { name: 'کافه گرم', sky: ['#f6d9b0', '#c98b5e', '#5b3a29'], kind: 'food' },
  { name: 'شب شهر', sky: ['#0b1d3a', '#123a63', '#00101f'], kind: 'night' },
  { name: 'جنگل مه‌آلود', sky: ['#cfe8ea', '#5c8a72', '#2b4a3f'], kind: 'nature' },
  { name: 'استودیو روشن', sky: ['#ffffff', '#efeae4', '#d9d2c8'], kind: 'product' },
  { name: 'نئون بنفش', sky: ['#2b0a4a', '#7c5cff', '#ff3d81'], kind: 'neon' },
  { name: 'کوچه بارانی', sky: ['#9fb3c8', '#5c6b7a', '#2f3a44'], kind: 'city' },
  { name: 'صحرا طلایی', sky: ['#ffd79a', '#e0a05a', '#8a5a2b'], kind: 'desert' },
];

function drawScene(ctx, w, h, scene, t = 0) {
  const [c1, c2, c3] = scene.sky;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, c1);
  g.addColorStop(0.55, c2);
  g.addColorStop(1, c3);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const rand = (i) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };

  if (scene.kind === 'sunset') {
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.18 - i * 0.04;
      ctx.fillStyle = '#fff2c9';
      ctx.beginPath();
      ctx.arc(w * 0.5, h * (0.72 - i * 0.03), w * (0.22 + i * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2a1730';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.82);
    ctx.quadraticCurveTo(w * 0.3, h * 0.72, w * 0.55, h * 0.86);
    ctx.quadraticCurveTo(w * 0.8, h * 0.95, w, h * 0.84);
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  } else if (scene.kind === 'night') {
    for (let i = 0; i < 90; i++) {
      ctx.globalAlpha = 0.4 + rand(i) * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rand(i * 3) * w, rand(i * 7) * h * 0.5, 2.5, 2.5);
    }
    ctx.globalAlpha = 1;
    for (let b = 0; b < 7; b++) {
      const bw = w * (0.08 + rand(b) * 0.1);
      const bh = h * (0.25 + rand(b * 2) * 0.45);
      const bx = (b / 7) * w + rand(b * 5) * 20;
      ctx.fillStyle = '#060b16';
      ctx.fillRect(bx, h - bh, bw, bh);
      for (let wy = 0; wy < bh - 20; wy += 26) {
        for (let wx = 0; wx < bw - 14; wx += 22) {
          if (rand(b + wy + wx) > 0.55) {
            ctx.fillStyle = `rgba(255,214,120,${0.25 + rand(wx) * 0.6})`;
            ctx.fillRect(bx + wx + 6, h - bh + wy + 12, 8, 12);
          }
        }
      }
    }
  } else if (scene.kind === 'food') {
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.52, w * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3b2a1d';
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.52, w * 0.34, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = ['#e2643c', '#f0a83c', '#8fbf5a', '#f7e0b5'][i % 4];
      ctx.beginPath();
      ctx.arc(w * (0.28 + rand(i) * 0.44), h * (0.4 + rand(i * 3) * 0.26), w * (0.02 + rand(i * 9) * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (scene.kind === 'nature') {
    for (let layer = 0; layer < 4; layer++) {
      ctx.globalAlpha = 0.25 + layer * 0.2;
      ctx.fillStyle = ['#cfe8ea', '#7fa892', '#4d7563', '#22392f'][layer];
      ctx.beginPath();
      ctx.moveTo(0, h);
      ctx.lineTo(0, h * (0.5 + layer * 0.1));
      for (let x = 0; x <= w; x += w / 12) {
        ctx.lineTo(x, h * (0.5 + layer * 0.1) - Math.sin(x / w * Math.PI * (2 + layer)) * h * 0.05);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (scene.kind === 'product') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.62, w * 0.36, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1b1f';
    ctx.beginPath();
    ctx.roundRect?.(w * 0.34, h * 0.34, w * 0.32, h * 0.3, 28);
    if (!ctx.roundRect) ctx.rect(w * 0.34, h * 0.34, w * 0.32, h * 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(w * 0.38, h * 0.38, w * 0.06, h * 0.2);
  } else if (scene.kind === 'neon') {
    for (let i = 0; i < 6; i++) {
      ctx.strokeStyle = ['#7c5cff', '#ff3d81', '#00e5ff', '#ffd166'][i % 4];
      ctx.lineWidth = 6 + rand(i) * 10;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(rand(i) * w, 0);
      ctx.bezierCurveTo(rand(i + 2) * w, h * 0.35, rand(i + 4) * w, h * 0.7, rand(i + 6) * w, h);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (scene.kind === 'city') {
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const x = rand(i) * w;
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 40, h);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(20,28,36,0.55)';
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    ctx.fillStyle = 'rgba(255,220,150,0.5)';
    ctx.beginPath();
    ctx.ellipse(w * 0.6, h * 0.55, w * 0.3, h * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    for (let i = 0; i < 5; i++) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = i % 2 ? '#fff' : '#e0a05a';
      ctx.beginPath();
      ctx.moveTo(0, h * (0.55 + i * 0.08));
      ctx.quadraticCurveTo(w * 0.5, h * (0.42 + i * 0.09), w, h * (0.6 + i * 0.07));
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (t > 0) {
    // animated accents for the demo clips
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const x = w * (0.5 + 0.36 * Math.cos(t * 1.7));
    const y = h * (0.45 + 0.3 * Math.sin(t * 1.3));
    ctx.beginPath();
    ctx.arc(x, y, w * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, w * (0.2 + 0.1 * Math.sin(t)), t, t + 2.2);
    ctx.stroke();
  }

  // grain
  const img = ctx.getImageData(0, 0, Math.min(w, 220), Math.min(h, 220));
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 12;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

async function recordCanvas(durationSec, w, h, scene) {
  if (typeof MediaRecorder === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream?.(30);
  if (!stream) return null;
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported?.(t));
  if (!mime) return null;
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  } catch {
    return null;
  }
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { recorder.onstop = res; });
  recorder.start(120);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const t = (performance.now() - t0) / 1000;
      drawScene(ctx, w, h, scene, t);
      if (t < durationSec) requestAnimationFrame(loop);
      else resolve();
    };
    requestAnimationFrame(loop);
  });
  recorder.stop();
  await stopped;
  return new Blob(chunks, { type: mime });
}

export async function makeDemoMedia({ onProgress } = {}) {
  const out = [];
  const scenes = PHOTO_SCENES.slice(0, 6);
  for (let i = 0; i < scenes.length; i++) {
    onProgress?.((i / (scenes.length + 2)) * 0.7, `ساخت نمونه ${i + 1}`);
    const width = i % 3 === 0 ? 1080 : 1440;
    const height = i % 3 === 0 ? 1350 : 1080;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    drawScene(canvas.getContext('2d'), width, height, scenes[i]);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    out.push({ file: new File([blob], `demo-photo-${i + 1}.jpg`, { type: 'image/jpeg' }), kind: 'photo' });
  }
  for (let v = 0; v < 2; v++) {
    onProgress?.(0.7 + v * 0.15, `ضبط نمونه ویدیویی ${v + 1}`);
    const scene = PHOTO_SCENES[(v + 2) % PHOTO_SCENES.length];
    const blob = await recordCanvas(3.2, 720, 1280, scene);
    if (blob) {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      out.push({ file: new File([blob], `demo-clip-${v + 1}.${ext}`, { type: blob.type }), kind: 'video' });
    }
  }
  onProgress?.(1, 'آماده');
  return out;
}

export { drawScene };
