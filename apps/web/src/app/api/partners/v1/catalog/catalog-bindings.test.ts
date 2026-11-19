import { describe, expect, it } from 'vitest';
import { crossRemCatalogConfig } from './catalog-bindings';
import { sellableIdentityKey } from './sellable-identity-key';

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
});
