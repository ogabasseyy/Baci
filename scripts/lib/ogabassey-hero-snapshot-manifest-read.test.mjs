import { describe, expect, it } from 'vitest';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';

describe('readSnapshotManifestTenants', () => {
  it('round-trips formatted output and preserves tenants', () => {
    const file =
      `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 3;\n\n` +
      `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<string, Record<string, object>> = ` +
      `{\n  ogabassey: {\n    'https://x/y.jpg': {\n      sourceUrl: 'https://x/y.jpg',\n    },\n  },\n};\n`;
    const { tenants, version } = readSnapshotManifestTenants(file);
    expect(version).toBe(3);
    expect(tenants.ogabassey['https://x/y.jpg'].sourceUrl).toBe(
      'https://x/y.jpg'
    );
  });

  it('rejects a corrupt body', () => {
    expect(() =>
      readSnapshotManifestTenants('> = { not valid !!!\n};\n')
    ).toThrow(/not parseable/);
  });

  it('rejects a body that cannot be located (truncated manifest)', () => {
    expect(() =>
      readSnapshotManifestTenants(
        'export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 2;\n'
      )
    ).toThrow(/cannot be located/);
  });
});
