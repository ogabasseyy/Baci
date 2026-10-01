import { describe, expect, it } from 'vitest';
import { getProductConnectivityDiscriminators } from './get-product-connectivity-discriminator';

describe('getProductConnectivityDiscriminators storage variants', () => {
  it('canonicalizes bare terabyte-equivalent PDP storage', () => {
    const discriminators = getProductConnectivityDiscriminators(
      ['Samsung Galaxy S25 Ultra 1024'],
      [],
      'smartphones'
    );

    expect(discriminators).toEqual(['1tb']);
  });

  it('normalizes quote-only laptop display sizes as PDP variants', () => {
    const discriminators = getProductConnectivityDiscriminators(
      ['Apple MacBook Pro M3 14”'],
      ['legacy-macbook-42'],
      'laptops'
    );

    expect(discriminators).toEqual(['14inch']);
  });

  it('retains stripped laptop CPU and GPU tiers as PDP variants', () => {
    expect(
      getProductConnectivityDiscriminators(
        ['Dell XPS 13 9340 Core Ultra 7'],
        [],
        'laptops'
      )
    ).toEqual(['coreultra7']);
    expect(
      getProductConnectivityDiscriminators(
        ['ASUS ROG G16 RTX 4060'],
        [],
        'gaming-laptops'
      )
    ).toEqual(['rtx4060']);
  });
});
