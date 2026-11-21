import { describe, expect, it, vi } from 'vitest';
import { crossRemCatalogConfig } from './catalog-bindings';
import { sellableIdentityKey } from './sellable-identity-key';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn } }));

describe('CrossRem catalog configuration', () => {
  it('binds the pinned Ogabassey CrossRem merchant ID', () => {
    expect(crossRemCatalogConfig.merchantId).toBe(
      '6b5cb8a4-5575-456c-b936-8cdfae30db74'
    );
  });

  it('pins the reviewed active and retired counts and rejects duplicate identities', () => {
    const { bindings } = crossRemCatalogConfig;
    const active = bindings.filter((row) => !row.retired);
    const retiredIds = bindings
      .filter((row) => row.retired)
      .map((row) => row.listingId);
    expect(retiredIds.sort()).toEqual([
      '30f0d807-0dde-49e5-837a-5bd9c7efbd5d',
      'afb7842c-f744-4f8c-8be1-87d940242600',
      'b91bfaf7-dc9d-4f75-a3af-cc023e7d7a47',
      'caf2702f-9b16-49f0-b97c-142538a37c1b',
      'd6b58ad5-860e-495e-8ba9-5ac5ca8f366a',
    ]);
    expect(active).toHaveLength(4496);
    expect(new Set(bindings.map((row) => row.listingId)).size).toBe(
      bindings.length
    );
    expect(new Set(bindings.map(sellableIdentityKey)).size).toBe(
      bindings.length
    );
  });

  it('uses an empty baseline if validation fails so the route can return 503', async () => {
    vi.doMock('./ogabassey-listing-bindings.json', () => ({
      default: [{ listingId: 'invalid' }],
    }));
    vi.resetModules();
    try {
      const { crossRemCatalogConfig: invalidConfig } = await import(
        './catalog-bindings'
      );
      expect(invalidConfig.bindings).toEqual([]);
      expect(warn).toHaveBeenCalledExactlyOnceWith({
        message: 'CrossRem catalog bindings failed validation',
        issueCount: 2,
        issues: [
          { code: 'invalid_type', path: '0.productId' },
          { code: 'invalid_value', path: '0.condition' },
        ],
      });
    } finally {
      vi.doUnmock('./ogabassey-listing-bindings.json');
      vi.resetModules();
    }
  });
});
