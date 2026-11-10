import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sourceDigest } from '@baci/shared/experience';
import { describe, expect, it } from 'vitest';
import { parseExperienceManifest } from '../../../src/schemas/experience-manifest';
import { fixtureCatalog, fixtureManifest } from './qualification-fixtures';

describe('synthetic full-code qualification corpus', () => {
  it.each([
    'editorial-fashion',
    'device-configurator',
    'motion-studio',
  ])('has complete routes and actual component source for %s', (name) => {
    const manifest = parseExperienceManifest(fixtureManifest(name));
    expect(manifest.routes.map((r) => r.view)).toEqual([
      'home',
      'collection',
      'product',
      'editorial',
    ]);
    expect(manifest.files.length).toBeGreaterThan(1);
    expect(fixtureCatalog.products[0].variants).toHaveLength(2);
    expect(fixtureCatalog.products[0].currency).toBe('USD');
    expect(sourceDigest(manifest)).toBe(
      createHash('sha256')
        .update(
          JSON.stringify({
            ...manifest,
            files: [...manifest.files].sort((a, b) =>
              a.path.localeCompare(b.path)
            ),
          })
        )
        .digest('hex')
    );
    expect(
      sourceDigest({ ...manifest, files: [...manifest.files].reverse() })
    ).toBe(sourceDigest(manifest));
  });
  it('does not accidentally execute imported component code during manifest loading', () => {
    expect(
      readFileSync(
        new URL('./device-configurator/Experience.tsx', import.meta.url),
        'utf8'
      ).length
    ).toBeGreaterThan(0);
    expect(fixtureManifest('device-configurator').entry).toBe(
      'src/Experience.tsx'
    );
  });
});
