import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('getDurableProductSeoText', () => {
  it.each([
    undefined,
    null,
    '',
    '   ',
  ])('returns no override for empty copy: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it.each([
    'iPhone 13 Price – From ₦350,000',
    'Buy iPhone 13 from NGN 350,000.',
    'Buy iPhone 13 for 350,000 NGN.',
    'Buy iPhone 13 from <strong>₦350,000</strong>.',
    'Buy iPhone 13 for 350,000₦.',
    'Buy iPhone 13 for USD 900.',
    'Buy iPhone 13 for 900 USD.',
    'Buy iPhone 13 for CHF 900.',
    'iPhone 13 Price – From 350,000',
    'Buy iPhone 13 for 350,000 today',
    'iPhone 13 starts at 350,000.',
    'Buy iPhone 13 for NGN 350k.',
    'Buy iPhone 13 for 350000 today.',
    'iPhone 13 Price – N350,000',
    'iPhone 13 starts at 350k.',
    'iPhone 13 costs NGN 1.5m.',
    'Buy iPhone 13 for 350k NGN.',
    'Buy iPhone 13 from NGN350k.',
    'Pixel 10 Price – 999',
    'Buy Pixel 10 for 999.99 today',
    'Buy Laptop for R 9,000.',
    'The iPhone 13 price in Nigeria is 350,000.',
    'The iPhone 13 cost in Lagos: 350,000.',
    'iPhone 13 usd 900 in Lagos',
    'Phone ngn 350,000',
    '<p>Buy this phone for ₦&nbsp;350,000.</p>',
    '<p>Buy this phone for &#8358;&#160;350,000.</p>',
  ])('rejects an unbound monetary claim: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it('preserves useful price-free product information', () => {
    const text =
      'Compare iPhone 13 128GB and 256GB options, A15 Bionic and 5G support.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'iPhone 13' },
      })
    ).toBe(text);
  });

  it('rejects a foreign naira amount without confusing a compact model prefix', () => {
    expect(
      getDurableProductSeoText({
        text: 'iPhone 13 N350,000',
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'N16 processor',
        product: { name: 'Device' },
      })
    ).toBe('N16 processor');
  });

  it('rejects the imported generic shopping description', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy iPhone 13 in Nigeria from Ogabassey. Confirm specs, condition, variants and availability.',
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it.each([
    'Confirm specs, condition, variants and availability',
    'Confirm specs, condition, variants & availability.',
    'Confirm specs, condition, variants and availability. Shop now.',
  ])('rejects punctuation/CTA variants of the import template: %s', (suffix) => {
    expect(
      getDurableProductSeoText({
        text: `Buy iPhone 13 in Nigeria from Ogabassey. ${suffix}`,
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it.each([
    ['KES', 'KSh 50,000'],
    ['ZAR', 'R 9,000'],
    ['XAF', '50,000 FCFA'],
    ['TZS', 'TSh 50,000'],
    ['UGX', '50,000 USh'],
    ['RWF', 'FRw 50,000'],
  ])('rejects local display aliases for %s', (_currency, amount) => {
    expect(
      getDurableProductSeoText({
        text: `Laptop price: ${amount}`,
        product: { name: 'Laptop' },
      })
    ).toBe('');
  });

  it.each([
    [
      'PSN Gift Card £50 GBP',
      'PSN Gift Card £50 GBP: £50 value for a UK account',
    ],
    [
      'Amazon Gift Card 50 USD',
      'Use this 50 USD gift card for Amazon purchases',
    ],
    [
      'Amazon Gift Card 50 USD',
      'Use this USD 50 gift card for Amazon purchases',
    ],
    [
      'PSN Gift Card £50 GBP',
      '£50 PSN gift card for a UK PlayStation account.',
    ],
    [
      'Amazon Gift Card 50 USD',
      '50 USD Amazon gift card for an American account.',
    ],
    ['PSN Gift Card £50 GBP', 'Buy £50 PSN gift card for a UK account.'],
    ['Amazon Gift Card 50 USD', 'USD 50.00 Amazon gift card'],
    [
      'Amazon Gift Card 50 USD',
      'Use this $50 USD gift card for American purchases',
    ],
  ])('preserves face-value forms for %s', (name, text) => {
    const args = { product: { name } };
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text}. Buy for USD 80.` })
    ).toBe('');
    expect(
      getDurableProductSeoText({ ...args, text: `${text}. Buy for USD 50.` })
    ).toBe('');
  });

  it('does not exempt a same-value retail price merely because a gift-card label follows', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy for USD 50 Amazon gift card credit.',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it.each([
    'Laptop with RAM 16GB, SSD 512GB and DDR4 support.',
    'R16 processor and a 4,000 mAh battery; suitable for 5G networks.',
    'Compare iPhones from 2025 and choose storage for 4,000 photos.',
    'Choose from 64, 128 or 256GB storage options.',
    'Choose from all 3 storage options. Try 2 colours or the top 3 models.',
    'Buy iPhone 13 in Nigeria. Choose from all 3 storage options. Try 2 colours or the top 3 models.',
    'Buy a 2025 iPhone with storage for 4,000 photos.',
    'Buy all 3 colours with fast delivery',
    'RAM 16GB, R16 processor, 512GB SSD and 4,000mAh battery.',
  ])('preserves specifications and non-price numeric context: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
      })
    ).toBe(text);
  });

  it('does not confuse different dollar currencies with the same face value', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this 50 CAD gift card for Canadian purchases',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('uses an explicit ISO code rather than an ambiguous dollar symbol for gift-card identity', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this $50 CAD gift card for Canadian purchases',
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('rejects a mismatched explicit code when the product denomination also has a dollar qualifier', () => {
    expect(
      getDurableProductSeoText({
        text: 'Use this $50 USD gift card for purchases',
        product: { name: 'Amazon Gift Card $50 CAD' },
      })
    ).toBe('');
  });

  it.each([
    'Use this CAD $50 gift card for Canadian purchases',
    'Buy for just USD 50 Amazon gift card credit.',
    'Priced at just USD 50 Amazon gift card credit.',
  ])('keeps explicit currency/retail relations above denomination identity: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Amazon Gift Card 50 USD' },
      })
    ).toBe('');
  });

  it('rejects explicitly priced foreign rand aliases', () => {
    expect(
      getDurableProductSeoText({
        text: 'Laptop price: R 9,000',
        product: { name: 'Laptop' },
      })
    ).toBe('');
  });

  it('fails closed before normalization when the source is oversized', () => {
    expect(
      getDurableProductSeoText({
        text: `${'1,'.repeat(20_000)}Buy for USD 900.`,
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('does not accept a price-free prefix from an oversized source', () => {
    expect(
      getDurableProductSeoText({
        text: 'Useful product information. '.repeat(2_000),
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('preserves ordinary words that also spell currency codes', () => {
    const text = 'Try 2 colours before choosing your phone.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Phone' },
      })
    ).toBe(text);
  });

  it('preserves a denomination in the product name but rejects a separate retail price', () => {
    const text = 'PSN Gift Card £50 GBP Price in Nigeria';
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
    };
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} from ₦80,000` })
    ).toBe('');
  });

  it('distinguishes explicit currency codes from RAM specifications', () => {
    const text = 'Laptop with RAM 16GB and a 512GB SSD.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Laptop' },
      })
    ).toBe(text);
    expect(
      getDurableProductSeoText({
        text: 'Laptop from KES 50,000',
        product: { name: 'Laptop' },
      })
    ).toBe('');
  });

  it('preserves a repeated gift-card face value but not a quoted retail price', () => {
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
    };
    const text =
      'PSN Gift Card £50 GBP at Ogabassey: £50 GBP value for PlayStation Store.';
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} Buy from ₦80,000.` })
    ).toBe('');
  });
});
