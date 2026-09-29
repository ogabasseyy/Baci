import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_HOME_HERO_SNAPSHOT_TENANT } from '@/config/ogabassey-home-hero-snapshot-tenant';
import { resolveOgabasseyHomeHeroSnapshot } from './ogabassey-home-hero-snapshot';

const FLAG = 'NEXT_PUBLIC_OGABASSEY_HOME_HERO_SAME_ORIGIN_ENABLED';

// A manifest that passed generation but carries hostile/corrupt entries must
// fail closed (null → CDN fallback), never render attacker-chosen bytes.
vi.mock('@/config/ogabassey-home-hero-snapshot-manifest', () => ({
  OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION: 1,
  OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: {
    ogabassey: {
      'https://cdn.ogabassey.com/off-origin.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/off-origin.avif',
        srcSet: 'https://evil.example/x.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/off-origin-href.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/off-origin-href.avif',
        srcSet: '/_hero/ogabassey/abcdef012345-640.avif 640w',
        href: 'https://evil.example/x.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/traversal.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/traversal.avif',
        srcSet: '/_hero/ogabassey/../secret.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/wrong-route.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/wrong-route.avif',
        srcSet: '/api/admin/x.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/mismatch.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/other.avif',
        srcSet: '/_hero/ogabassey/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/empty.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/empty.avif',
        srcSet: '   ',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/encoded-traversal.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/encoded-traversal.avif',
        srcSet: '/_hero/ogabassey/%2e%2e/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/double-encoded.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/double-encoded.avif',
        srcSet: '/_hero/ogabassey/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/%252e%252e-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/unmanaged-name.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/unmanaged-name.avif',
        srcSet: '/_hero/ogabassey/hand-dropped.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/wrong-tenant-dir.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/wrong-tenant-dir.avif',
        srcSet: '/_hero/other/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
      'https://cdn.ogabassey.com/expired.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/expired.avif',
        srcSet: '/_hero/ogabassey/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      },
      'https://cdn.ogabassey.com/fresh.avif': {
        sourceUrl: 'https://cdn.ogabassey.com/fresh.avif',
        srcSet: '/_hero/ogabassey/abcdef012345-640.avif 640w',
        href: '/_hero/ogabassey/abcdef012345-640.avif',
        quality: 70,
        widths: [640],
        sourceSha256: '0'.repeat(64),
        bakedAt: new Date().toISOString(),
      },
    },
  },
}));

describe('resolveOgabasseyHomeHeroSnapshot validation', () => {
  beforeEach(() => {
    process.env[FLAG] = 'true';
  });

  afterEach(() => {
    delete process.env[FLAG];
  });

  it.each([
    'https://cdn.ogabassey.com/off-origin.avif',
    'https://cdn.ogabassey.com/off-origin-href.avif',
    'https://cdn.ogabassey.com/traversal.avif',
    'https://cdn.ogabassey.com/wrong-route.avif',
    'https://cdn.ogabassey.com/empty.avif',
    'https://cdn.ogabassey.com/mismatch.avif',
    'https://cdn.ogabassey.com/encoded-traversal.avif',
    'https://cdn.ogabassey.com/double-encoded.avif',
    'https://cdn.ogabassey.com/unmanaged-name.avif',
    'https://cdn.ogabassey.com/wrong-tenant-dir.avif',
  ])('rejects a malformed entry (%s)', (sourceUrl) => {
    expect(
      resolveOgabasseyHomeHeroSnapshot(
        OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
        sourceUrl
      )
    ).toBeNull();
  });

  // Bake age never gates serving: the resolver is wall-clock-free so the
  // prerendered preload slot and the request-time <picture> always agree.
  // Freshness (hash drift + re-bake cadence) is enforced by the scheduled
  // `--check`, which fails loudly instead of silently disabling the path.
  it('serves an old entry identically in every render phase', () => {
    const snapshot = resolveOgabasseyHomeHeroSnapshot(
      OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
      'https://cdn.ogabassey.com/expired.avif'
    );
    expect(snapshot?.href).toBe('/_hero/ogabassey/abcdef012345-640.avif');
  });

  it('resolves a well-formed fresh entry', () => {
    const snapshot = resolveOgabasseyHomeHeroSnapshot(
      OGABASSEY_HOME_HERO_SNAPSHOT_TENANT,
      'https://cdn.ogabassey.com/fresh.avif'
    );
    expect(snapshot?.href).toBe('/_hero/ogabassey/abcdef012345-640.avif');
  });
});
