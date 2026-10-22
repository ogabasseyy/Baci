import { describe, expect, it, vi } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('durable SEO monetary context', () => {
  it.each([
    'missing',
    'throws',
  ] as const)('rejects explicit unmapped ISO currency prices when Intl.supportedValuesOf %s', async (mode) => {
    vi.resetModules();
    vi.stubGlobal('Intl', {
      supportedValuesOf:
        mode === 'missing'
          ? undefined
          : () => {
              throw new Error('unsupported currency key');
            },
    });
    try {
      const { getDurableProductSeoText: classify } = await import(
        './get-durable-product-seo-text'
      );
      expect(
        classify({
          text: 'Buy this phone for CHF 900.',
          product: { name: 'Phone' },
        })
      ).toBe('');
      expect(
        classify({
          text: 'Buy iPhone 13 for 350,000 today',
          product: { name: 'Phone' },
        })
      ).toBe('');
      expect(
        classify({
          text: 'Buy Pixel 10 for 999.99 today',
          product: { name: 'Phone' },
        })
      ).toBe('');
      expect(
        classify({ text: 'RAM 16GB storage.', product: { name: 'Phone' } })
      ).toBe('RAM 16GB storage.');
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
  it('preserves matching localized gift-card identity but rejects its retail price', () => {
    const text = 'Use this EUR 50,00 Amazon gift card';
    const product = { name: 'Amazon Gift Card EUR 50,00' };
    expect(getDurableProductSeoText({ text, product })).toBe(text);
    expect(
      getDurableProductSeoText({
        text: `${text}. Buy for EUR 50,00.`,
        product,
      })
    ).toBe('');
  });

  it('matches equivalent gift-card denominations with localized separators', () => {
    const product = { name: 'Amazon Gift Card EUR 50,00' };
    const text = 'Use this EUR 50.00 Amazon gift card';
    expect(getDurableProductSeoText({ text, product })).toBe(text);
    expect(
      getDurableProductSeoText({
        text: 'Use this EUR 50 Amazon gift card',
        product,
      })
    ).toBe('Use this EUR 50 Amazon gift card');
  });
  it('does not confuse a separate price observation with gift-card face value', () => {
    const text = 'The price varies and its face value is USD 50 credit.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe(text);
  });
  it.each([
    'The price of iPhone 13 is 350,000.',
    'This phone is 350,000.',
    'Price in Lagos: 350,000.',
    'Price: all 350,000',
    'Device ALL 350,000',
    'Device TRY 350k',
    'Leather bag TRY 999',
    'Price: TRY 2',
    'Prices for phones: 3,000',
    'iPhone 13 N350k',
    'Get Pixel 10 for 999 today',
    'Shop Pixel 10 for 999',
    'Price: 1.299,99',
    'Price: 1,00,000',
    'Device: 999',
    'Phone selling at 999',
    'MSRP: 999',
    'RRP: 1,299',
    'MSRP is 999',
    'The price is 12,345.',
    'The price for SKU is 999.',
    'SAR 1,200 is the listed retail price.',
    'Price: 4k',
  ])('rejects explicit financial predicates and foreign aliases: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it.each([
    'iPhone 13 – 350,000',
    'iPhone 13 350000. Great camera.',
    'iPhone 13: 350000. Shop today.',
  ])('rejects separator-only prices after product identity: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it('rejects a short separator-only amount after the product identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'iPhone 13 – 999',
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it('rejects a parenthesized short price after the product identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'Phone (999)',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('preserves parenthesized product years after identity removal', () => {
    const text = 'Phone (2025)';
    expect(getDurableProductSeoText({ text, product: { name: 'Phone' } })).toBe(
      text
    );
  });

  it('preserves CAD software versions without preserving CAD retail prices', () => {
    const text = 'Supports CAD 2025 software';
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe(text);
    expect(
      getDurableProductSeoText({
        text: 'Price: CAD 2025',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it.each([
    'Record video at 4K.',
    'Perfect for 4K streaming.',
    'Shoot at 8K/30fps.',
    'Upscales from 4K to 8K.',
  ])('preserves short resolution values in editorial copy: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe(text);
  });

  it.each([
    'The display is 6.1 inches.',
    'The screen size is 6.7 inches.',
    'The weight is 1.5 kg.',
    'Battery life is 1.5 days.',
    'The weight is 1,200 g.',
    'Screen size is 6,1 inches.',
    'The version is 2.5.',
    'The rating is 4.8.',
  ])('preserves unit-bearing dimensions and quantities: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe(text);
  });

  it.each([
    'Compare the price and store 350,000 messages on your phone.',
    '350,000 units sold worldwide',
    'Phone price comparison: store 350,000 messages offline.',
    'Our price guide for 2025 includes storage advice.',
    'An amd 7900 processor with 16GB RAM.',
    'Powered by amd 7900 with 16GB RAM.',
    'Choose from ALL 3 colours',
    'TRY 2 sizes',
    'TOP 3 picks',
    'Get ready for 2025',
    'Get prepared for 2025',
    'TOP 100 picks',
    'Prices for phones: 3 affordable options',
    'The price guide edition is 2025.',
    'Compare the price of models whose release year is 2025.',
    'Compare an N350 processor with an R16 processor.',
    'The display resolution is 1,920 × 1,080 pixels.',
    'The display resolution is 1,920 by 1,080 pixels.',
    'The model number is 12,345.',
    'The SKU is 12,345.',
    'SKU is 999.',
    'Model 999 with 5G.',
    'SAR 1.2 W/kg with compliant exposure limits.',
  ])('preserves numeric specifications despite nearby price vocabulary: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
      })
    ).toBe(text);
  });

  it.each([
    'ALL',
    'TRY',
    'TOP',
  ])('preserves ordinary code words spelled %s', (word) => {
    const text = `Buy phones; ${word.toLowerCase()} 3 models.`;
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe(text);
  });
});
