/**
 * Regenerates the Android splash screens (dark background + centred icon) for
 * every density folder Capacitor ships with. Run after changing the icon:
 *   node tools/make-splash.mjs
 */
import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const RES = 'android/app/src/main/res';
const ICON = 'public/icons/icon-512.png';
const BG = { r: 8, g: 8, b: 13, alpha: 1 };

async function main() {
  const entries = await readdir(RES);
  const dirs = entries.filter((d) => d.startsWith('drawable'));
  let count = 0;
  for (const dir of dirs) {
    const file = path.join(RES, dir, 'splash.png');
    try {
      await stat(file);
    } catch {
      continue;
    }
    const meta = await sharp(file).metadata();
    const { width, height } = meta;
    const iconSize = Math.round(Math.min(width, height) * 0.34);
    const icon = await sharp(ICON).resize(iconSize, iconSize).png().toBuffer();
    await sharp({ create: { width, height, channels: 4, background: BG } })
      .composite([{ input: icon, left: Math.round((width - iconSize) / 2), top: Math.round((height - iconSize) / 2) }])
      .png({ compressionLevel: 9 })
      .toFile(file);
    count++;
  }
  console.log(`✓ ${count} splash images regenerated`);
}

main().catch((e) => { console.error(e); process.exit(1); });
