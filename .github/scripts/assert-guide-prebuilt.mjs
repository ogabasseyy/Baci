import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const guideImages = [
  'ad-platforms/meta-settings.jpg',
  'ad-platforms/tiktok-settings.jpg',
  'ad-platforms/snapchat-pixel-settings.jpg',
  'ad-platforms/x-connection-settings.jpg',
  'chatgpt-ads/01-pixel-setup.png',
  'chatgpt-ads/02-successful-payment.png',
  'chatgpt-ads/03-pixel-event.png',
  'chatgpt-ads/04-capi-event.png',
  'chatgpt-ads/05-create-capi-key.png',
];

export function assertGuidePrebuilt(root) {
  for (const image of guideImages) {
    const source = readFileSync(resolve(root, 'public/guides', image));
    const output = readFileSync(resolve(root, '.vercel/output/static/guides', image));
    if (!output.equals(source)) throw new Error(`Prebuilt guide image differs: ${image}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertGuidePrebuilt(process.cwd());
  console.log('All guide images are present in the Vercel prebuilt output.');
}
