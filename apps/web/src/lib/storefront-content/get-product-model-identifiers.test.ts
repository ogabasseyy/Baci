import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers', () => {
  it('removes brand and category words while retaining model markers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Itel'],
      productSlugs: ['itel-power-80-128gb-4gb', 'itel-a06'],
    });

    expect(identifiers).toEqual(['power 80', 'a06']);
  });

  it('strips a leading Bluetooth descriptor while retaining the speaker model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'accessories',
      brands: ['JBL'],
      productNames: ['JBL Bluetooth Speaker Flip 6'],
    });

    expect(identifiers).toEqual(['flip 6']);
  });

  it('strips monitor response-time metadata from the model identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'monitors',
      brands: ['LG'],
      productNames: ['LG UltraGear 27GP850-B 1ms'],
    });

    expect(identifiers).toEqual(['ultragear 27gp850']);
  });

  it('strips separated battery-capacity units from the model identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'accessories',
      brands: ['Xiaomi'],
      productNames: ['Xiaomi 10000 mAh Power Bank'],
    });

    expect(identifiers).toEqual(['power bank']);
  });

  it('strips hardware color suffixes from game-category accessories', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-5',
      brands: ['Sony'],
      productNames: ['Sony DualSense Wireless Controller White'],
    });

    expect(identifiers).toEqual(['dualsense wireless controller']);
  });

  it('retains the tablet family for a generic iPad tier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productNames: ['Apple iPad Pro'],
    });

    expect(identifiers).toEqual(['ipad pro']);
  });

  it('normalizes compact decimal display sizes before model selection', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productNames: ['Apple iPad Pro 12.9inch'],
    });

    expect(identifiers).toEqual(['ipad pro']);
  });

  it('deduplicates identifiers across product variants', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productSlugs: [
        'samsung-galaxy-s25-128gb',
        'samsung-galaxy-s25-256gb',
        'samsung-galaxy-s24',
      ],
    });

    expect(identifiers).toEqual(['s25', 's24']);
  });

  it('removes configured brand aliases from nonnumeric model slugs', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productSlugs: ['samsung-galaxy-z-trifold'],
    });

    expect(identifiers).toEqual(['trifold']);
  });

  it('preserves the family marker for numeric model generations', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Tecno'],
      productSlugs: ['tecno-spark-40'],
    });

    expect(identifiers).toEqual(['spark 40']);
  });

  it('derives brand aliases from compare slugs when brands are omitted', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      productSlugs: ['samsung-galaxy-z-trifold'],
    });

    expect(identifiers).toEqual(['trifold']);
  });

  it('retains complete product aliases in a VR comparison', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'vr-headsets',
      productSlugs: ['apple-vision-pro', 'meta-quest-3'],
    });

    expect(identifiers).toEqual(['vision pro', 'quest 3']);
  });

  it('preserves plus variants from product names instead of collision slugs', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productNames: ['Samsung Galaxy S24+'],
      productSlugs: ['samsung-galaxy-s24-2'],
    });

    expect(identifiers).toEqual(['s24 plus']);
  });

  it('preserves variant markers after numeric model generations', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Google'],
      productSlugs: ['google-pixel-9-pro'],
    });

    expect(identifiers).toEqual(['9 pro']);
  });

  it('retains alphanumeric model suffix markers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productSlugs: ['samsung-galaxy-s25-ultra-12gb-256gb'],
    });

    expect(identifiers).toEqual(['s25 ultra']);
  });

  it('removes merchandising suffixes from model identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: ['iphone-13-pro-128gb-premium-used'],
    });

    expect(identifiers).toEqual(['13 pro']);
  });

  it('does not treat a leading Red Magic model token as merchandising', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Red Magic'],
      productSlugs: ['red-magic-10-pro'],
    });

    expect(identifiers).toEqual(['10 pro']);
  });

  it('retains AirPods in generation-only identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'audio',
      brands: ['Apple'],
      productSlugs: ['apple-airpods-2'],
    });

    expect(identifiers).toEqual(['airpods 2']);
  });

  it('removes a leading used condition without truncating the model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Sony'],
      productSlugs: ['used-xperia-1-vii'],
    });

    expect(identifiers).toEqual(['xperia 1 vii']);
  });

  it('keeps Ultra when it is a smartwatch model marker', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartwatches',
      brands: ['Apple'],
      productSlugs: ['apple-watch-ultra-2'],
    });

    expect(identifiers).toEqual(['watch ultra 2']);
  });

  it('retains model-family aliases in compound laptop identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Lenovo'],
      productSlugs: ['lenovo-legion-pro-9'],
    });

    expect(identifiers).toEqual(['legion pro 9']);
  });

  it('preserves numeric-only configured model families', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'laptops',
        brands: ['HP'],
        productSlugs: ['hp-omen-16'],
      })
    ).toEqual(['omen 16']);
    expect(
      getProductModelIdentifiers({
        categorySlug: 'laptops',
        brands: ['Dell'],
        productSlugs: ['dell-optiplex-7090'],
      })
    ).toEqual(['optiplex 7090']);
  });

  it('retains Dell family aliases that distinguish same-number models', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productNames: ['Dell Latitude 5410', 'Dell Inspiron 14 5410'],
      productSlugs: [],
    });

    expect(identifiers).toEqual(['latitude 5410', 'inspiron 5410']);
  });

  it('keeps model codes after CPU text', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'laptops',
        brands: ['Dell'],
        productNames: ['Dell Inspiron Core i5 3520'],
        productSlugs: [],
      })
    ).toEqual(['inspiron 3520']);
  });

  it('keeps two-digit laptop models before CPU text', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'laptops',
        brands: ['HP'],
        productNames: ['HP 15 Intel Core i5'],
        productSlugs: [],
      })
    ).toEqual(['15']);
  });

  it('retains numeric family aliases before GPU metadata', () => {
    expect(
      getProductModelIdentifiers({
        categorySlug: 'laptops',
        brands: ['HP'],
        productNames: ['HP Omen 16 RTX 4060'],
        productSlugs: [],
      })
    ).toEqual(['omen 16']);
  });

  it('removes optional Touch Bar suffixes from MacBook identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: ['13-macbook-pro-2022-m2-8gb-512gb-touch-bar'],
    });

    expect(identifiers).toEqual(['pro m2']);
  });

  it('removes standalone VRAM labels from MacBook identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: ['15-macbook-pro-2016-16gb-512gb-2gb-vram-i7-touchbar'],
    });

    expect(identifiers).toEqual(['pro 2016']);
  });
});
