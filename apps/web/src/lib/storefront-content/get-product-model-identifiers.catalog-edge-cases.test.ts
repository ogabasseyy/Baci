import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers catalog edge cases', () => {
  it('preserves a sub-10-inch tablet display prefix as metadata', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productSlugs: ['8-3-ipad-mini-6th-generation-2021'],
    });

    expect(identifiers).toEqual(['mini 6th generation']);
  });

  it('normalizes an Apple Watch SE family identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartwatches',
      brands: ['Apple'],
      productSlugs: ['apple-watch-series-se-40mm-gps'],
    });

    expect(identifiers).toEqual(['watch se']);
  });

  it('normalizes Apple Watch Series SE catalog revisions to the guide name', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartwatches',
      brands: ['Apple'],
      productNames: [
        'Apple Watch Series SE 44mm 2022 GPS',
        'Apple Watch Series SE 40mm 2022 GPS',
      ],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['watch se 2022']);
  });

  it('canonicalizes a singular AirPod catalog name', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'audio',
      brands: ['Apple'],
      productNames: ['Apple Airpod 2'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['airpods 2']);
  });

  it('removes a terminal quote-only display size from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['MSI'],
      productSlugs: ['msi-modern-15-b13m-laptop-15-6'],
    });

    expect(identifiers).toEqual(['modern 15 b13m']);
  });

  it('removes a terminal integer quote-only display size from a named laptop', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productNames: ['Lenovo ThinkPad T14 Gen 4 – 14”'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['thinkpad t14 gen 4']);
  });

  it('orders ThinkPad generation tokens for guide matching', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productSlugs: ['lenovo-thinkpad-gen-8-x1-14-inch'],
    });

    expect(identifiers).toEqual(['thinkpad x1 gen 8']);
  });

  it('retains Galaxy Buds family context in earbud identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'earbuds',
      brands: ['Samsung'],
      productSlugs: ['samsung-galaxy-buds-pro', 'samsung-galaxy-buds-live'],
    });

    expect(identifiers).toEqual(['galaxy buds pro', 'galaxy buds live']);
  });

  it('removes the all-in-one printer form factor from model identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'printers',
      brands: ['HP'],
      productSlugs: ['hp-smart-tank-750-all-in-one-printer'],
    });

    expect(identifiers).toEqual(['750']);
  });

  it('retains a leading all-in-one desktop model identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'desktops',
      brands: ['HP'],
      productSlugs: ['hp-all-in-one-24'],
    });

    expect(identifiers).toEqual(['all in one 24']);
  });

  it('falls back to a custom slug when a product name has no model identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Smartphone'],
      productSlugs: ['samsung-galaxy-s25'],
    });

    expect(identifiers).toEqual(['s25']);
  });

  it('removes retailer configuration SKUs while retaining convertible laptop family identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-inspiron-14-7440-7304blu-2-in-1'],
    });

    expect(identifiers).toEqual(['inspiron 14 7440 2 in 1']);
  });

  it('keeps a later numeric laptop model code after a display size', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-inspiron-14-7430-2-in-1'],
    });

    expect(identifiers).toEqual(['inspiron 14 7430 2 in 1']);
  });

  it('preserves an intervening Dell G3 model number before the final code', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'gaming-laptops',
      brands: ['Dell'],
      productNames: ['DELL G3 15 3579 Gaming Laptop 15.6” FHD'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['g3 15 3579']);
  });

  it('removes a bare Nokia storage value before labeled memory metadata', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Nokia'],
      productNames: ['Nokia X10 128 6GB'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['x10']);
  });

  it('preserves an HP model number that repeats the display size', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productNames: ['HP 15 15 inch i5 8GB 512GB'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['15']);
  });

  it('retains a laptop model after a leading decimal display size', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['15.6” Dell Inspiron 3520'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['inspiron 3520']);
  });

  it('strips concatenated capacity metadata from a phone model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productNames: ['iPhone 13 Pro Max 6GB512GB'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['13 pro max']);
  });

  it('keeps currency discriminators for same-denomination gift cards', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'gift-cards',
      productNames: [
        'PSN Card £50 Gift Card',
        'PSN Card $50 Gift Card',
        'PSN Card €50 Gift Card',
      ],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['gbp 50', 'usd 50', 'eur 50']);
  });

  it('preserves LaserJet as a printer model-family marker', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'printers',
      brands: ['HP'],
      productSlugs: ['hp-color-laserjet-pro-3203dw'],
    });

    expect(identifiers).toEqual(['color laserjet pro 3203dw']);
  });

  it('keeps a tablet generation year before an alphanumeric chip marker', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productNames: ['11" iPad Pro 5th Generation 2024 M4'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['pro 5th generation 2024 m4']);
  });

  it('retains a terminal tablet hardware revision year', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Samsung'],
      productNames: ['Samsung Tab S6 Lite 2024 4GB 64GB LTE'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['tab s6 lite 2024']);
  });

  it('keeps an explicit numeric generation after a numeric model token', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productNames: ['Lenovo ThinkPad 13 Yoga Gen 2 – 13.3”'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['thinkpad 13 yoga gen 2']);
  });

  it('removes an embedded quote-only tablet dimension before capacities', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Samsung'],
      productNames: ['Samsung Tab S9 Plus 5G 12.4" 12GB 256GB'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['tab s9 plus']);
  });

  it('removes a leading headset form factor before the JBL model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'audio',
      brands: ['JBL'],
      productNames: ['Headset JBL Quantum 100'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['quantum 100']);
  });

  it('strips a malformed numeric laptop processor suffix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productNames: ['HP EliteBook 830 G7 13 inch 15-10310U 8GB 512GB'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['830 g7']);
  });

  it('prefers a Dell model code over a trailing bare specification', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell Latitude 5310 15 8GB 256GB 13 inch'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['latitude 5310']);
  });
});
