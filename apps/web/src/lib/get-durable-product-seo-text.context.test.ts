import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('durable SEO monetary context', () => {
  it('preserves matching localized gift-card identity but rejects its retail price', () => {
    const text = 'Use this EUR 50,00 Amazon gift card';
    const product = { name: 'Amazon Gift Card EUR 50,00' };
    expect(getDurableProductSeoText({ text, product, currency: 'NGN' })).toBe(
      text
    );
    expect(
      getDurableProductSeoText({
        text: `${text}. Buy for EUR 50,00.`,
        product,
        currency: 'NGN',
      })
    ).toBe('');
  });
  it('does not confuse a separate price observation with gift-card face value', () => {
    const text = 'The price varies and its face value is USD 50 credit.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Amazon Gift Card 50 USD' },
        currency: 'USD',
      })
    ).toBe(text);
  });
  it.each([
    'The price of iPhone 13 is 350,000.',
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
  ])('rejects explicit financial predicates and foreign aliases: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
        currency: 'USD',
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
        currency: 'NGN',
      })
    ).toBe('');
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
  ])('preserves numeric specifications despite nearby price vocabulary: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
        currency: 'USD',
      })
    ).toBe(text);
  });

  it.each([
    'ALL',
    'TRY',
    'TOP',
  ])('preserves ordinary code words on a %s storefront', (currency) => {
    const text = 'Buy all 3 colours; try 2 sizes and compare the top 3 models.';
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' }, currency })
    ).toBe(text);
  });
});
