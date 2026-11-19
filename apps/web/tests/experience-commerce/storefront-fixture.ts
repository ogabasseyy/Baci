import { readFileSync } from 'node:fs';
import type { ExperienceManifest } from '@baci/shared/experience';
export function storefrontFixture(): ExperienceManifest {
  return {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'app.tsx',
    packages: [{ name: 'react', versionRef: 'platform-pinned' }],
    routes: [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
      { path: '/pages/story', view: 'editorial' },
    ],
    assets: [
      { assetId: 'synthetic-device-image', alt: 'Synthetic blue QA device' },
    ],
    capabilities: [
      'catalog.read',
      'cart.read-public',
      'cart.mutate',
      'checkout.prepare',
      'checkout.open',
      'navigation',
    ],
    files: [
      {
        path: 'style.css',
        content: readFileSync(
          new URL('./polished-storefront.css', import.meta.url),
          'utf8'
        ),
      },
      {
        path: 'app.tsx',
        content: readFileSync(
          new URL('./polished-storefront.tsx.txt', import.meta.url),
          'utf8'
        ),
      },
    ],
  };
}
