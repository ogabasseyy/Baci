import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers mobile variants', () => {
  it('removes NFID condition markers from iPhone identifiers', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productSlugs: ['iphone-x-3gb-64gb-nfid'],
      })
    ).toEqual(['x']);
  });

  it('ignores region suffixes before selecting a single-character model', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'smartphones',
        brands: ['Apple'],
        productSlugs: ['iphone-x-64gb-uk-used'],
      })
    ).toEqual(['x']);
  });

  it('removes optional connectivity suffixes from model identifiers', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'smartphones',
        brands: ['Tecno'],
        productSlugs: ['tecno-spark-pro-dual-sim'],
      })
    ).toEqual(['spark pro']);
  });

  it('removes a compound connectivity marker run before sim', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'smartphones',
        brands: ['Samsung'],
        productSlugs: ['samsung-galaxy-s22-ultra-12gb-256gb-dual-physical-sim'],
      })
    ).toEqual(['s22 ultra']);
  });
});
