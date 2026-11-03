import { readFileSync } from 'node:fs';
import type {
  ExperienceManifest,
  PublicCatalog,
} from '@baci/shared/experience';
export const fixtureCatalog: PublicCatalog = {
  revision: 'synthetic-1',
  products: [
    {
      id: 'synthetic-device',
      slug: 'device',
      name: 'Synthetic QA Device',
      price: 10,
      currency: 'USD',
      image: null,
      variants: [
        { id: 'silver', label: 'Silver', available: true },
        { id: 'ink', label: 'Ink', available: true },
      ],
    },
  ],
};
export function fixtureManifest(name: string): ExperienceManifest {
  if (
    !['editorial-fashion', 'device-configurator', 'motion-studio'].includes(
      name
    )
  )
    throw new Error('Unknown synthetic fixture');
  const read = (file: string) =>
    readFileSync(new URL(file, import.meta.url), 'utf8');
  return {
    format: 'baci.experience/v2',
    runtime: 'react-browser-sandbox/v1',
    sdkVersion: 'commerce-bridge/v1',
    entry: 'src/Experience.tsx',
    files: [
      {
        path: 'src/Experience.tsx',
        content: read(`./${name}/Experience.tsx`).replace(
          '../qualification-commerce',
          './qualification-commerce'
        ),
      },
      {
        path: 'src/qualification-commerce.tsx',
        content: read('./qualification-commerce.tsx'),
      },
      { path: 'src/style.css', content: read(`./${name}/style.css`) },
    ],
    packages: [
      { name: 'react', versionRef: 'platform-pinned' },
      ...(name === 'motion-studio'
        ? [{ name: 'framer-motion', versionRef: 'platform-pinned' as const }]
        : []),
    ],
    routes: [
      { path: '/', view: 'home' },
      { path: '/collections/[handle]', view: 'collection' },
      { path: '/products/[handle]', view: 'product' },
      { path: '/journal/[handle]', view: 'editorial' },
    ],
    assets: [],
    capabilities: [
      'catalog.read',
      'cart.read-public',
      'cart.mutate',
      'navigation',
    ],
  };
}
