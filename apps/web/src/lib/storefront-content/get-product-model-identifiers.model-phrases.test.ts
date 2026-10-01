import { describe, expect, it } from 'vitest';
import { getProductModelIdentifiers } from './get-product-model-identifiers';

describe('getProductModelIdentifiers model phrases', () => {
  it('prefers a model code over dimensions, years, and capacities', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: ['macbook-air-13-inch-2022-m2-8gb-256gb'],
    });

    expect(identifiers).toEqual(['air m2']);
  });

  it('retains an XPS family and later model code after a screen-size token', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-xps-13-9350'],
    });

    expect(identifiers).toEqual(['xps 9350']);
  });

  it('keeps the laptop family and generation together', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-probook-440-g8'],
    });

    expect(identifiers).toEqual(['probook 440 g8']);
  });

  it('preserves configured laptop family aliases', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-pavilion-15'],
    });

    expect(identifiers).toEqual(['pavilion 15']);
  });

  it('keeps MacBook line markers distinct before a chip identifier', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: [
        'macbook-air-m4-16gb-256gb-13-inch-new',
        'macbook-pro-m4-16gb-512gb-14-inch-new',
      ],
    });

    expect(identifiers).toEqual(['air m4', 'pro m4']);
  });

  it('strips a trailing processor tier from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-elitebook-840-g11-ultra-7-32gb'],
    });

    expect(identifiers).toEqual(['840 g11']);
  });

  it('strips a trailing RTX tier from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-alienware-m18-r3-rtx-5080'],
    });

    expect(identifiers).toEqual(['alienware m18 r3']);
  });

  it('strips a trailing Intel processor tier from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-probook-440-g5-14-inch-i5-8gb-256gb'],
    });

    expect(identifiers).toEqual(['probook 440 g5']);
  });

  it('strips a complete Core i-series suffix from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-precision-7540-core-i7-16gb-512gb-15-inch'],
    });

    expect(identifiers).toEqual(['precision 7540']);
  });

  it('strips a decimal display suffix while retaining the XPS laptop family', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-xps-15-9560-15-6-4k-touchscreen'],
    });

    expect(identifiers).toEqual(['xps 9560']);
  });

  it('strips a leading quoted display size from a laptop model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: ['13-macbook-air-2023-8gb-512gb-m3'],
    });

    expect(identifiers).toEqual(['air m3']);
  });

  it('retains year-only laptop generations as model discriminators', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Apple'],
      productSlugs: [
        '13-macbook-air-2015-8gb-128gb-i5',
        '13-macbook-air-2017-8gb-128gb-i5',
      ],
    });

    expect(identifiers).toEqual(['air 2015', 'air 2017']);
  });

  it('strips a leading filler article before selecting a phone model', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: ['the-iphone-11-4gb-128gb'],
    });

    expect(identifiers).toEqual(['11']);
  });

  it('retains product lines before alphanumeric laptop models', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-spectre-x360', 'hp-envy-x360'],
    });

    expect(identifiers).toEqual(['spectre x360', 'envy x360']);
  });

  it('strips a generated counter after a textual product suffix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'printers',
      brands: ['HP'],
      productSlugs: ['hp-officejet-pro-8123-all-in-one-printer-2'],
    });

    expect(identifiers).toEqual(['officejet pro 8123']);
  });

  it('preserves legitimate game years after a platform number', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-5',
      productSlugs: ['play-station-5-madden-23', 'play-station-5-madden-24'],
    });

    expect(identifiers).toEqual(['madden 23', 'madden 24']);
  });

  it('preserves both numbers in a convertible model phrase', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['Dell'],
      productSlugs: ['dell-14-plus-2-in-1'],
    });

    expect(identifiers).toEqual(['14 plus 2 in 1']);
  });

  it('removes generic pc descriptors from laptop identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'laptops',
      brands: ['HP'],
      productSlugs: ['hp-250-g10-notebook-pc'],
    });

    expect(identifiers).toEqual(['250 g10']);
  });

  it('removes standalone ram labels from phone model phrases', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Samsung'],
      productSlugs: ['samsung-z-fold-5-12gb-ram-256gb'],
    });

    expect(identifiers).toEqual(['fold 5']);
  });

  it('keeps a tablet generation year after its leading display size', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productSlugs: ['11-ipad-air-6th-generation-2024-m2-wifi-only-256gb'],
    });

    expect(identifiers).toEqual(['air 6th generation 2024 m2']);
  });

  it('keeps a tablet generation year after a decimal display prefix', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productSlugs: ['10-9-ipad-air-5th-generation-2021-m1-wifi-64gb'],
    });

    expect(identifiers).toEqual(['air 5th generation 2021 m1']);
  });

  it('removes split capacity metadata from a tablet model phrase', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productSlugs: ['12-9-ipad-pro-2021-m1-1-tb-wifi-cellular'],
    });

    expect(identifiers).toEqual(['pro m1']);
  });

  it('removes multiple split capacity pairs from a tablet model phrase', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'tablets',
      brands: ['Apple'],
      productSlugs: ['12-9-ipad-pro-2021-m1-1-tb-512-gb-wifi'],
    });

    expect(identifiers).toEqual(['pro m1']);
  });

  it('preserves color words that are part of a game title', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'playstation-5',
      productSlugs: ['ps5-call-of-duty-black-ops-6'],
    });

    expect(identifiers).toEqual(['call of duty black ops 6']);
  });

  it('strips a terminal device color after model metadata', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartphones',
      brands: ['Apple'],
      productSlugs: ['iphone-13-blue-128gb'],
    });

    expect(identifiers).toEqual(['13']);
  });

  it('normalizes ordinal AirPods generation and Type-C metadata', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'audio',
      brands: ['Apple'],
      productSlugs: ['apple-airpods-pro-2nd-gen-type-c'],
    });

    expect(identifiers).toEqual(['airpods pro 2']);
  });

  it('removes GPS configuration metadata from watch identifiers', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'smartwatches',
      brands: ['Apple'],
      productSlugs: ['apple-watch-series-9-45mm-gps'],
    });

    expect(identifiers).toEqual(['watch series 9']);
  });

  it('preserves a terminal color that is part of a game title', () => {
    const identifiers = getProductModelIdentifiers({
      categorySlug: 'nintendo-switch',
      productSlugs: ['nintendo-switch-pokemon-violet'],
    });

    expect(identifiers).toEqual(['pokemon violet']);
  });
});
