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
    const retiredCount = bindings.length - active.length;
    expect(active).toHaveLength(4501);
    expect(retiredCount).toBe(0);
    expect(new Set(bindings.map((row) => row.listingId)).size).toBe(
      bindings.length
    );
    expect(new Set(active.map(sellableIdentityKey)).size).toBe(active.length);
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
