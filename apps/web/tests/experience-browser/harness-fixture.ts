import { readFileSync } from 'node:fs';
import type { ExperienceManifest } from '@baci/shared/experience';
import { fixtureManifest } from './fixtures/qualification-fixtures';
/** Ordinary authored source with a qualification-only provider, not the future SDK. */
export function wrappedFixture(name: string): ExperienceManifest {
  const manifest = fixtureManifest(name);
  manifest.entry = 'src/qualification-entry.tsx';
  manifest.packages.push({ name: 'react-dom', versionRef: 'platform-pinned' });
  manifest.files.push(
    {
      path: manifest.entry,
      content: readFileSync(
        new URL('./qualification-entry.tsx.txt', import.meta.url),
        'utf8'
      ),
    },
    {
      path: 'src/runtime-boundary.tsx',
      content: readFileSync(
        new URL(
          '../../experience-runtime/runtime-boundary.tsx',
          import.meta.url
        ),
        'utf8'
      ),
    }
  );
  manifest.assets = [
    { assetId: 'synthetic-image', alt: 'Synthetic blue swatch' },
    { assetId: 'synthetic-font', alt: 'Offline qualification font' },
  ];
  const css = manifest.files.find((file) => file.path.endsWith('.css'));
  if (!css) throw Error('Missing fixture CSS');
  css.content +=
    '\n@font-face{font-family:QualificationAuthored;src:url("/assets/synthetic-font") format("woff2")}.qualification-asset-swatch{background-image:url("/assets/synthetic-image");font-family:QualificationAuthored,sans-serif;color:white;padding:1rem;margin-top:1rem}';
  return manifest;
}
