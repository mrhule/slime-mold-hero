// Makes the home-screen icons from the General Goo drawing: node tools/make-icons.mjs
import sharp from 'sharp';

for (const size of [192, 512]) {
  const art = await sharp('public/art/commander-general-goo.webp').resize(Math.round(size * 0.78), Math.round(size * 0.78), { fit: 'inside' }).toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#14180f' } })
    .composite([{ input: art, gravity: 'center' }])
    .png()
    .toFile(`public/icon-${size}.png`);
}
