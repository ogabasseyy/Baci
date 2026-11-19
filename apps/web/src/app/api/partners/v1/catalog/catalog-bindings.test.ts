import { describe, expect, it } from 'vitest';
import {
  CROSSREM_CATALOG_BINDINGS,
  CROSSREM_MERCHANT_ID,
} from './catalog-bindings';
import { sellableIdentityKey } from './sellable-identity-key';

describe('CROSSREM_CATALOG_BINDINGS', () => {
  it('binds the pinned Ogabassey CrossRem merchant ID', () => {
    expect(CROSSREM_MERCHANT_ID).toBe('6b5cb8a4-5575-456c-b936-8cdfae30db74');
  });

  it('pins the reviewed active and retired counts and rejects duplicate identities', () => {
    const active = CROSSREM_CATALOG_BINDINGS.filter((row) => !row.retired);
    const retiredCount = CROSSREM_CATALOG_BINDINGS.length - active.length;
    expect(active).toHaveLength(4501);
    expect(retiredCount).toBe(0);
    expect(
      new Set(CROSSREM_CATALOG_BINDINGS.map((row) => row.listingId)).size
    ).toBe(CROSSREM_CATALOG_BINDINGS.length);
    expect(new Set(active.map(sellableIdentityKey)).size).toBe(active.length);
  });
});
