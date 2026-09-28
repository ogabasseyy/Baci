import { describe, expect, it } from 'vitest';
import { SNAPSHOT_QUALITY } from './ogabassey-hero-snapshot-config.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { serializeSnapshotManifestFile } from './ogabassey-hero-snapshot-manifest-serialize.mjs';

function makeEntry(overrides = {}) {
  return {
    sourceUrl: 'https://cdn.ogabassey.com/core-assets/products/dell.jpg',
    srcSet: '/_hero/ogabassey/aaa-640.avif 640w',
    href: '/_hero/ogabassey/aaa-640.avif',
    quality: SNAPSHOT_QUALITY,
    widths: [640],
    sourceSha256: 'b'.repeat(64),
    bakedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('serializeSnapshotManifestFile', () => {
  it('emits a versioned file that round-trips through the reader', () => {
    const manifest = { ogabassey: { 'https://x/y.jpg': makeEntry() } };
    const file = serializeSnapshotManifestFile(
      manifest,
      7,
      '2026-01-01T00:00:00.000Z'
    );

    expect(file).toContain('MANIFEST_VERSION = 7');
    expect(file).toContain('Generated: 2026-01-01T00:00:00.000Z');
    const { tenants, version } = readSnapshotManifestTenants(file);
    expect(version).toBe(7);
    expect(tenants.ogabassey['https://x/y.jpg'].href).toBe(
      '/_hero/ogabassey/aaa-640.avif'
    );
  });

  it('refuses values that break single-quote serialization', () => {
    expect(() =>
      serializeSnapshotManifestFile(
        { ogabassey: { x: makeEntry({ sourceUrl: "o'brien" }) } },
        1,
        '2026-01-01T00:00:00.000Z'
      )
    ).toThrow(/breaks manifest serialization/);
  });
});
