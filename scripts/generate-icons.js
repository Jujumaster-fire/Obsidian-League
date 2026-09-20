const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const INPUT = path.join(__dirname, '..', 'public', 'logo.jpeg');
const OUTPUT_DIR = path.join(__dirname, '..', 'public');

const sizes = [
  { name: 'favicon-16x16.png', width: 16, height: 16 },
  { name: 'favicon-32x32.png', width: 32, height: 32 },
  { name: 'apple-touch-icon.png', width: 180, height: 180 },
  { name: 'android-chrome-192x192.png', width: 192, height: 192 },
  { name: 'android-chrome-512x512.png', width: 512, height: 512 },
  { name: 'og-image.png', width: 1200, height: 630 },
  { name: 'logo.png', width: 512, height: 512 },
];

async function generate() {
  if (!fs.existsSync(INPUT)) {
    console.error('Source image not found:', INPUT);
    process.exit(1);
  }

  console.log('Source:', INPUT);
  const meta = await sharp(INPUT).metadata();
  console.log(`Source size: ${meta.width}x${meta.height}, format: ${meta.format}`);

  for (const s of sizes) {
    const out = path.join(OUTPUT_DIR, s.name);
    await sharp(INPUT)
      .resize(s.width, s.height, { fit: 'cover', position: 'centre' })
      .png({ quality: 80, compressionLevel: 9 })
      .toFile(out);
    const stat = fs.statSync(out);
    console.log(`  ${s.name} (${s.width}x${s.height}) - ${(stat.size / 1024).toFixed(1)} KB`);
  }

  // Generate favicon.ico (multi-size)
  const icoPath = path.join(OUTPUT_DIR, 'favicon.ico');
  const ico16 = await sharp(INPUT).resize(16, 16, { fit: 'cover' }).png().toBuffer();
  const ico32 = await sharp(INPUT).resize(32, 32, { fit: 'cover' }).png().toBuffer();
  // Use the 32x32 as favicon.ico (browsers handle this well)
  await sharp(INPUT).resize(32, 32, { fit: 'cover' }).png().toFile(icoPath.replace('.ico', '-temp.png'));
  // Rename temp to ico (browsers accept PNG favicon)
  fs.renameSync(icoPath.replace('.ico', '-temp.png'), icoPath);
  const icoStat = fs.statSync(icoPath);
  console.log(`  favicon.ico (32x32) - ${(icoStat.size / 1024).toFixed(1)} KB`);

  // Generate a compressed logo for general use
  const compressedPath = path.join(OUTPUT_DIR, 'logo-compressed.jpeg');
  await sharp(INPUT)
    .resize(256, 256, { fit: 'cover' })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(compressedPath);
  const compStat = fs.statSync(compressedPath);
  console.log(`  logo-compressed.jpeg (256x256) - ${(compStat.size / 1024).toFixed(1)} KB`);

  console.log('\nAll icons generated successfully!');
}

generate().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
