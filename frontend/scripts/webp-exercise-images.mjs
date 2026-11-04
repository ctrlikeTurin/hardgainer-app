// Converts the exercise demo photos to WebP (~half the size of JPEG) and points the library at them.
// Run after build-exercise-library.mjs: node scripts/webp-exercise-images.mjs
import { readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import sharp from 'sharp';

const LIB = new URL('../shared/exercise-library.json', import.meta.url);
const PUBLIC = fileURLToPath(new URL('../public', import.meta.url));
const library = JSON.parse(readFileSync(LIB, 'utf8'));
let before = 0;
let after = 0;

for (const ex of library) {
  ex.images = await Promise.all(
    ex.images.map(async (src) => {
      if (src.endsWith('.webp')) return src;
      const jpg = join(PUBLIC, src);
      const out = src.replace(/\.jpe?g$/, '.webp');
      const webp = join(PUBLIC, out);
      if (!existsSync(jpg)) return src;
      before += statSync(jpg).size;
      await sharp(jpg).webp({ quality: 72 }).toFile(webp);
      after += statSync(webp).size;
      unlinkSync(jpg);
      return out;
    }),
  );
}
writeFileSync(LIB, `${JSON.stringify(library, null, 1)}\n`);
console.log(`Converted: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
