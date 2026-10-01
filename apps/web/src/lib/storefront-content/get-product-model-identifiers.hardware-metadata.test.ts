import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers hardware metadata', () => {
  it('removes a CPU and GPU suffix while preserving the laptop model', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'gaming-laptops',
        brands: ['ASUS'],
        productNames: ['ASUS ROG G16 Core i7 RTX 4060'],
        productSlugs: [],
      })
    ).toEqual(['rog g16']);
  });

  it('removes a tier-only Ryzen CPU and trailing GPU suffix', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'gaming-laptops',
        brands: ['ASUS'],
        productNames: ['ASUS ROG Zephyrus G14 Ryzen 9 RTX 4070'],
        productSlugs: [],
      })
    ).toEqual(['rog zephyrus g14']);
  });

  it('strips monitor size, refresh rate, and resolution metadata', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'monitors',
        brands: ['LG'],
        productNames: ['LG UltraGear 27GN950-B 27 inch 144Hz 4K Monitor'],
        productSlugs: [],
      })
    ).toEqual(['ultragear 27gn950']);
  });

  it('strips a trailing wireless audio description', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'audio',
        brands: ['Sony'],
        productNames: ['Sony WH-1000XM5 Wireless Noise Cancelling Headphones'],
        productSlugs: [],
      })
    ).toEqual(['wh 1000xm5']);
  });
});
