import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('getDurableProductSeoText price classification', () => {
  it.each([
    'Price: 900, next day delivery',
    'Buy for 350000, free shipping',
  ])('rejects a bare price before a clause comma: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe('');
  });

  it('rejects a price predicate after removing the product identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'The price of Phone is 999.',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('preserves percentage composition specifications', () => {
    expect(
      getDurableProductSeoText({
        text: 'Only 100% cotton',
        product: { name: 'Shirt' },
      })
    ).toBe('Only 100% cotton');
  });

  it('rejects a currency-tagged fractional price without a leading zero', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy for $.99 today',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it('rejects a bare price before a non-price now clause', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy for 900, now available',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it('rejects low-value prices introduced by starts from', () => {
    expect(
      getDurableProductSeoText({
        text: 'Price starts from 900',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it.each([
    'Rated for 10,000-hour use.',
    'Only 6.1-inch display.',
    'Only 12 months warranty.',
    'Only 2 weeks of battery life.',
    'Only 1 month warranty.',
    'Only 1 week of battery life.',
    'Only 6 mos warranty.',
    'Only 3 wks of battery life.',
    'Only 1 mo warranty.',
    'Only 1 wk of battery life.',
    'Only 30 minutes to charge.',
    'Only 10 seconds to boot.',
    'Only 30 mins to charge.',
    'Only 10 secs to boot.',
    'Only 1 minute to setup.',
    'Only 1 second to unlock.',
    'Only 2-in-1 design.',
    'Only 3-in-1 charger.',
    'Only 4-in-1 hub.',
    'Only 2 in 1 design.',
  ])('preserves nonmonetary specifications with retail cues: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe(text);
  });

  it.each([
    'Price: 900, 128GB storage',
    'Buy for 350000, 2-year warranty',
    'Rental costs 900 a month.',
    'Buy for 900 with two years warranty.',
  ])('rejects stale prices preceding comma-separated specifications: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe('');
  });

  it.each([
    'Was 999.99, now 799.99',
    'Was 999.99, now 799.99 per unit',
    'Was 999.99, now 799.99 per month',
    'Was 999.99, now 799.99 per week',
    'Sale: Was 999.99, now 799.99 on new models',
  ])('rejects paired-sale prices with decimal points: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Device' } })
    ).toBe('');
  });

  it.each([
    'Phone – 999.',
    'Phone: 999!',
    'Phone – 999?',
    'Phone: 999...',
    '(Phone: 999).',
  ])('recognizes sentence punctuation after separator-only prices: %s', (text) => {
    expect(getDurableProductSeoText({ text, product: { name: 'Phone' } })).toBe(
      ''
    );
  });

  it.each([
    { name: 'Rice', text: 'Rice price is 900' },
    { name: 'Ice', text: 'Ice price is 900' },
  ])('bounds product-identity removal to complete tokens: $text', ({
    name,
    text,
  }) => {
    expect(getDurableProductSeoText({ text, product: { name } })).toBe('');
  });

  it('preserves nonmonetary copy for products with substring-sensitive names', () => {
    expect(
      getDurableProductSeoText({
        text: 'Rice is an aromatic basmati variety.',
        product: { name: 'Rice' },
      })
    ).toBe('Rice is an aromatic basmati variety.');
  });

  it.each([
    'Only 500 ml capacity.',
    'Only 2 meters long.',
    'Only 500 mL capacity.',
    'Only 2 metres long.',
  ])('preserves volume and length specifications: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Bottle' } })
    ).toBe(text);
  });

  it.each([
    'Available from 1 January 2026.',
    'Available from 2026-01-01.',
    'Available from 2026/01/01.',
  ])('preserves price-free availability dates: %s', (text) => {
    expect(
      getDurableProductSeoText({ text, product: { name: 'Gadget' } })
    ).toBe(text);
  });

  it('rejects actual prices alongside calendar dates', () => {
    expect(
      getDurableProductSeoText({
        text: 'Available from 1 January 2026 for 999.',
        product: { name: 'Gadget' },
      })
    ).toBe('');
  });

  it.each([
    '900 is the current price.',
    '999 is the retail price.',
  ])('rejects amounts followed by explicit price predicates: %s', (text) => {
    expect(getDurableProductSeoText({ text, product: { name: 'Phone' } })).toBe(
      ''
    );
  });

  it('preserves amounts followed by non-price specifications', () => {
    expect(
      getDurableProductSeoText({
        text: '900 is the model number.',
        product: { name: 'Phone' },
      })
    ).toBe('900 is the model number.');
  });

  it('rejects explicit price predicates with temporal modifiers', () => {
    expect(
      getDurableProductSeoText({
        text: 'The price is now 999.',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it.each([
    'Phone – 999 | Acme',
    'Phone – 999 • Acme',
    'Phone – 999 - Acme',
  ])('rejects separator prices before branded title suffixes: %s', (text) => {
    expect(getDurableProductSeoText({ text, product: { name: 'Phone' } })).toBe(
      ''
    );
  });
});
