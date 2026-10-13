import { describe, expect, it } from 'vitest';
import { extractImageCandidates } from './index';

describe('extractImageCandidates condition offers', () => {
  it('supports condition-offer images as product-level manifest candidates', () => {
    const [candidate] = extractImageCandidates('product-1', [
      { url: 'https://cdn.example.com/offers/used-phone.jpg' },
    ]);
    expect(candidate).toEqual({
      product_id: 'product-1',
      source_url: 'https://cdn.example.com/offers/used-phone.jpg',
      is_primary: true,
      position: 0,
    });
  });

  it('ignores empty condition-offer image URLs', () => {
    expect(
      extractImageCandidates('product-1', [{ url: '  ' }, { url: '' }])
    ).toEqual([]);
  });

  it('skips malformed non-string offer image entries without throwing', () => {
    expect(
      extractImageCandidates('product-1', [
        { url: 123 },
        { url: { nested: true } },
        456,
        { url: 'https://cdn.example.com/offers/used-phone.jpg' },
      ] as never)
    ).toEqual([
      {
        product_id: 'product-1',
        source_url: 'https://cdn.example.com/offers/used-phone.jpg',
        is_primary: true,
        position: 0,
      },
    ]);
  });
});
