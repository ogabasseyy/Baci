import { describe, expect, it } from 'vitest';
import { formatBrandAuthorityCopy } from './format-brand-authority-copy';

describe('formatBrandAuthorityCopy', () => {
  const baseInput = {
    merchantBusinessName: 'Ogabassey',
    productCount: 12,
    countrySuffix: ' in Nigeria',
  };

  it('formats smartphone copy matching legacy output', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'smartphones',
      brandKey: 'samsung',
      brandDisplayName: 'Samsung',
    });

    expect(result.heading).toBe('Samsung Phones and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 Samsung phones from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 Samsung phones from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('phones');
    expect(result.formatFamilyLinkLabel('Galaxy S')).toBe('Galaxy S phones');
  });

  it('formats laptops copy accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'laptops',
      brandKey: 'hp',
      brandDisplayName: 'HP',
    });

    expect(result.heading).toBe('HP Laptops and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 HP laptops from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 HP laptops from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('laptops');
    expect(result.formatFamilyLinkLabel('Pavilion')).toBe('Pavilion laptops');
  });

  it('formats gaming-laptops copy accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'gaming-laptops',
      brandKey: 'asus',
      brandDisplayName: 'ASUS',
    });

    expect(result.heading).toBe('ASUS Gaming Laptops and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 ASUS gaming laptops from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 ASUS gaming laptops from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('gaming laptops');
    expect(result.formatFamilyLinkLabel('ROG')).toBe('ROG gaming laptops');
  });

  it('formats tablets copy accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'tablets',
      brandKey: 'apple',
      brandDisplayName: 'Apple',
    });

    expect(result.heading).toBe('Apple Tablets and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 Apple tablets from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 Apple tablets from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('tablets');
    expect(result.formatFamilyLinkLabel('iPad Pro')).toBe('iPad Pro tablets');
  });

  it('formats audio copy accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'audio',
      brandKey: 'jbl',
      brandDisplayName: 'JBL',
    });

    expect(result.heading).toBe('JBL Audio & Speakers and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 JBL audio products from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 JBL audio products from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('audio products');
    expect(result.formatFamilyLinkLabel('PartyBox')).toBe(
      'PartyBox audio products'
    );
  });

  it('formats smartwatches copy accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'smartwatches',
      brandKey: 'samsung',
      brandDisplayName: 'Samsung',
    });

    expect(result.heading).toBe('Samsung Smartwatches and Prices in Nigeria');
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 Samsung smartwatches from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 Samsung smartwatches from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('smartwatches');
    expect(result.formatFamilyLinkLabel('Galaxy Watch')).toBe(
      'Galaxy Watch smartwatches'
    );
  });

  it('formats playstation-5 platform brand (playstation) without duplicate brand name', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'playstation-5',
      brandKey: 'playstation',
      brandDisplayName: 'PlayStation',
    });

    expect(result.heading).toBe(
      'PlayStation 5 Games, Consoles and Prices in Nigeria'
    );
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 PlayStation 5 products from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 PlayStation 5 products from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('products');
  });

  it('formats playstation-5 third-party brand accurately', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'playstation-5',
      brandKey: 'sony',
      brandDisplayName: 'Sony',
    });

    expect(result.heading).toBe(
      'Sony Products for PlayStation 5 and Prices in Nigeria'
    );
    expect(result.metaDescription).toBe(
      'Compare a selection of 12 Sony products for PlayStation 5 from Ogabassey, with current prices, key specs, condition, and availability in Nigeria.'
    );
    expect(result.intro).toBe(
      'Explore a selection of 12 Sony products for PlayStation 5 from Ogabassey. Compare current prices, specifications, condition, and availability before choosing a model.'
    );
    expect(result.familyNoun).toBe('products for PlayStation 5');
  });

  it('replaces {merchantName} when customIntro is provided', () => {
    const result = formatBrandAuthorityCopy({
      ...baseInput,
      categorySlug: 'smartphones',
      brandKey: 'apple',
      brandDisplayName: 'Apple',
      customIntro: 'Find the latest Apple devices at {merchantName} today.',
    });

    expect(result.intro).toBe(
      'Find the latest Apple devices at Ogabassey today.'
    );
  });

  it('handles empty countrySuffix cleanly', () => {
    const result = formatBrandAuthorityCopy({
      merchantBusinessName: 'Ogabassey',
      productCount: 5,
      categorySlug: 'laptops',
      brandKey: 'dell',
      brandDisplayName: 'Dell',
      countrySuffix: '',
    });

    expect(result.heading).toBe('Dell Laptops and Prices');
    expect(result.metaDescription).toBe(
      'Compare a selection of 5 Dell laptops from Ogabassey, with current prices, key specs, condition, and availability.'
    );
  });
});
