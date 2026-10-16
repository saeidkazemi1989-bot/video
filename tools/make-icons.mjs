/**
 * Icon pipeline: from one 1024×1024 source PNG produce every size the web app,
 * Android launcher and iOS app icon need.
 *
 * Usage:  node tools/make-icons.mjs [source.png]
 * Requires `sharp` (dev dependency).
 */
import sharp from 'sharp';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const SRC = process.argv[2] || 'public/icons/icon-1024.png';
const BG = '#08080d';

const ANDROID_DENSITIES = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function main() {
  // read the master icon into memory so we can safely overwrite the same path
  const master = await sharp(await readFile(SRC)).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
  const src = sharp(master);

  /* ---------- web / PWA ---------- */
  await ensureDir('public/icons');
  for (const size of [1024, 512, 192]) {
    await src.clone().resize(size, size).png({ compressionLevel: 9 }).toFile(`public/icons/icon-${size}.png`);
  }
  await src.clone().resize(180, 180).png({ compressionLevel: 9 }).toFile('public/icons/apple-touch-icon.png');

  /* ---------- android ---------- */
  for (const [density, legacy, adaptive] of ANDROID_DENSITIES) {
    const dir = `android/app/src/main/res/mipmap-${density}`;
    await ensureDir(dir);
    await src.clone().resize(legacy, legacy).png().toFile(path.join(dir, 'ic_launcher.png'));
    // round variant: circle mask
    const roundMask = Buffer.from(
      `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`,
    );
    await src.clone().resize(legacy, legacy).composite([{ input: roundMask, blend: 'dest-in' }]).png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));
    // adaptive foreground: content inside the 66 % safe area, transparent elsewhere
    const inner = Math.round(adaptive * 0.66);
    const fg = await src.clone().resize(inner, inner).png().toBuffer();
    await sharp({ create: { width: adaptive, height: adaptive, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: fg, left: Math.round((adaptive - inner) / 2), top: Math.round((adaptive - inner) / 2) }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  // adaptive background colour
  await writeFile(
    'android/app/src/main/res/values/ic_launcher_background.xml',
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`,
  );

  /* ---------- ios ---------- */
  const iosIconDir = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  await ensureDir(iosIconDir);
  await src.clone().resize(1024, 1024).png().toFile(path.join(iosIconDir, 'AppIcon-512@2x.png'));

  console.log('✓ icons written for web, android and ios');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
