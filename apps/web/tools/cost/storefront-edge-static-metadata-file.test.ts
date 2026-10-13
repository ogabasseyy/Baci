import { describe, expect, it } from 'vitest';
import { isStorefrontStaticMetadataFile } from './storefront-edge-static-metadata-file';

describe('isStorefrontStaticMetadataFile', () => {
  it.each([
    'favicon.ico',
    'icon.png',
    'icon2.svg',
    'apple-icon.jpg',
    'opengraph-image.jpeg',
    'twitter-image.gif',
    'robots.txt',
    'sitemap.xml',
    'manifest.json',
  ])('recognizes the Next static metadata file %s', (fileName) => {
    expect(isStorefrontStaticMetadataFile(fileName)).toBe(true);
  });

  it.each([
    'page.tsx',
    'route.tsx',
    'logo.png',
    'manifest.webmanifest',
  ])('rejects the non-metadata file %s', (fileName) => {
    expect(isStorefrontStaticMetadataFile(fileName)).toBe(false);
  });
});
