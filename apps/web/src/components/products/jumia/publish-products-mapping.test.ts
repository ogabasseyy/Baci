import { describe, expect, it } from 'vitest';
import { isJumiaProductFullyMapped } from './publish-products-mapping';

describe('isJumiaProductFullyMapped', () => {
  it('blocks a product when any mapping is not an error', () => {
    expect(
      isJumiaProductFullyMapped([
        { sellerSku: 'PHONE-BLACK', syncStatus: 'synced' },
        { sellerSku: 'PHONE-WHITE', syncStatus: 'pending' },
      ])
    ).toBe(true);
  });

  it('blocks a partially mapped product instead of offering a create retry', () => {
    // The server rejects a create retry with 409 jumia_mapping_exists when
    // any non-error mapping exists, so the accepted variant must block the
    // rejected one from another create submission.
    expect(
      isJumiaProductFullyMapped([
        { sellerSku: 'PHONE-BLACK', syncStatus: 'synced' },
        { sellerSku: 'PHONE-WHITE', syncStatus: 'error' },
      ])
    ).toBe(true);
  });

  it('keeps a mapped product blocked after its local SKU changes', () => {
    expect(
      isJumiaProductFullyMapped([
        { sellerSku: 'CASE-OLD', syncStatus: 'synced' },
      ])
    ).toBe(true);
  });

  it('does not block a product when every mapping failed', () => {
    expect(
      isJumiaProductFullyMapped([
        { sellerSku: 'PHONE-BLACK', syncStatus: 'error' },
        { sellerSku: 'PHONE-WHITE', syncStatus: 'error' },
      ])
    ).toBe(false);
  });

  it('does not block a product without mappings', () => {
    expect(isJumiaProductFullyMapped(undefined)).toBe(false);
    expect(isJumiaProductFullyMapped([])).toBe(false);
  });
});
