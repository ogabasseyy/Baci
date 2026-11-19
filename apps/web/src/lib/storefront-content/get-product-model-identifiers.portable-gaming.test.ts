import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers portable gaming', () => {
  it('retains a proven single-letter handheld model suffix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'portable-gaming',
      brands: ['ASUS'],
      productNames: ['ASUS ROG Ally X'],
    });

    expect(identifiers).toEqual(['rog ally x']);
  });

  it('retains gaming laptop model family aliases in product slugs', () => {
    const predator = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['Acer'],
      productSlugs: ['acer-predator-helios-16'],
    });
    expect(predator).toEqual(['predator helios 16']);

    const nitro = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['Acer'],
      productSlugs: ['acer-nitro-v-15'],
    });
    expect(nitro).toEqual(['nitro 15']);

    const aorus = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['Gigabyte'],
      productSlugs: ['gigabyte-aorus-16x'],
    });
    expect(aorus).toEqual(['aorus 16x']);

    const blade = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['Razer'],
      productSlugs: ['razer-blade-16'],
    });
    expect(blade).toEqual(['blade 16']);

    const tuf = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['ASUS'],
      productSlugs: ['asus-tuf-gaming-f15'],
    });
    expect(tuf).toEqual(['tuf f15']);
  });

  it('retains family aliases for non-gaming laptop category slugs', () => {
    const latitude = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-latitude-5410'],
    });
    expect(latitude).toEqual(['latitude 5410']);

    const omen = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-omen-16'],
    });
    expect(omen).toEqual(['omen 16']);
  });
});
