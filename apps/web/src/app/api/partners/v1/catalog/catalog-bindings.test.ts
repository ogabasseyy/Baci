import { describe, expect, it } from 'vitest';
import {
  CROSSREM_CATALOG_BINDINGS,
  CROSSREM_MERCHANT_ID,
} from './catalog-bindings';

describe('CROSSREM_CATALOG_BINDINGS', () => {
  it('binds the pinned Ogabassey CrossRem merchant ID', () => {
    expect(CROSSREM_MERCHANT_ID).toBe('6b5cb8a4-5575-456c-b936-8cdfae30db74');
  });

  it('loads validated CrossRem catalog bindings from the versioned baseline', () => {
    expect(CROSSREM_CATALOG_BINDINGS.length).toBeGreaterThan(0);
    for (const binding of CROSSREM_CATALOG_BINDINGS) {
      expect(binding.listingId.length).toBeGreaterThan(0);
      expect(binding.productId.length).toBeGreaterThan(0);
    }
  });
});
