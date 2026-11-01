/**
 * Keys the magenta background out of the commander drawings in art-source/ and writes small
 * WebP sprites to public/art/ (same technique as the slime-mold repo's tools/process-art.mjs).
 * Run: npm run art
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = 'art-source';
const OUT = 'public/art';
const SIZE = 384;
fs.mkdirSync(OUT, { recursive: true });

const magentaness = (r, g, b) => Math.max(0, Math.min(1, (Math.min(r, b) - g) / 255));

async function keyed(file) {
  const { data, info } = await sharp(path.join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(data);
  // some drawings have a hot pink background rather than pure magenta: key those by distance from the corner colour
  const [br, bg, bb] = [data[0], data[1], data[2]];
  const offMagenta = magentaness(br, bg, bb) < 0.7;
  for (let i = 0; i < out.length; i += 4) {
    const [r, g, b] = [out[i], out[i + 1], out[i + 2]];
    let alpha = 1 - Math.max(0, Math.min(1, (magentaness(r, g, b) - 0.12) / 0.55));
    if (offMagenta) {
      const dist = Math.hypot(r - br, g - bg, b - bb) / 441;
      alpha = Math.max(0, Math.min(1, (dist - 0.06) / 0.14));
      if (alpha > 0.02) continue; // keep real colours as they are
    }
    if (alpha <= 0.02) { out[i + 3] = 0; continue; }
    const k = 1 - alpha;
    out[i] = Math.max(0, Math.min(255, (r - k * 255) / alpha));
    out[i + 1] = Math.max(0, Math.min(255, g / alpha));
    out[i + 2] = Math.max(0, Math.min(255, (b - k * 255) / alpha));
    out[i + 3] = Math.round(alpha * 255);
  }
  return { data: out, width: info.width, height: info.height };
}

for (const file of fs.readdirSync(SRC).filter((f) => f.startsWith('commander-'))) {
  const { data, width, height } = await keyed(file);
  await sharp(data, { raw: { width, height, channels: 4 } })
    .trim()
    .resize(SIZE, SIZE, { fit: 'inside' })
    .webp({ quality: 85 })
    .toFile(path.join(OUT, file.replace('.png', '.webp')));
  console.log('wrote', file);
}
