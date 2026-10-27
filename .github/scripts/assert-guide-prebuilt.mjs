import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertGuidePrebuilt(root) {
  const images = readdirSync(resolve(root, 'public/guides'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
    .map((entry) => resolve(entry.parentPath, entry.name).slice(resolve(root, 'public/guides').length + 1));
  if (images.length === 0) throw new Error('No guide images found');
  for (const image of images) {
    const source = readFileSync(resolve(root, 'public/guides', image));
    const output = readFileSync(resolve(root, '.vercel/output/static/guides', image));
    if (!output.equals(source)) throw new Error(`Prebuilt guide image differs: ${image}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertGuidePrebuilt(process.cwd());
  console.log('All guide images are present in the Vercel prebuilt output.');
}
