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
    'iPhone 13 Price – NGN:350,000',
    '₦: 350,000',
    '350,000 naira',
    'iPhone 13 – 900 dollars',
    'Price: USD: 900',
    'iPhone 13 – 350 000',
    "iPhone 13 – 350'000",
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

  it('still rejects a retail price in copy that also mentions a bonus', () => {
    expect(
      getDurableProductSeoText({
        text: 'Includes a $25 gift-card bonus, but the phone costs $900.',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('strips separator-only prices when the slug adds a product disambiguator', () => {
    expect(
      getDurableProductSeoText({
        text: 'iPhone 13 – 350,000',
        product: { name: 'iPhone 13', slug: 'iphone-13-128gb' },
      })
    ).toBe('');
  });

  it('strips a separator-only price when the product identity casing differs', () => {
    expect(
      getDurableProductSeoText({
        text: 'iphone 13 – 350,000',
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
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

  it('does not exempt explicit retail prices followed by payment terms', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy this phone for USD 900 credit card only.',
        product: { name: 'Phone' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'This accessory is 900 dirhams.',
        product: { name: 'Accessory' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'This accessory is 900 shillings.',
        product: { name: 'Accessory' },
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
    'Rated for 10,000 charge cycles.',
    'Rated for 10,000 hours of use.',
    '4K display with HDR support.',
    'AMD 7900 XT graphics.',
    'Includes a $25 gift-card bonus.',
    '€50 trade-in credit available.',
    '$50 cashback is available on selected plans.',
    'Weighs 5 pounds with packaging.',
    'Buy this item; it weighs 5 pounds.',
    'The display is 1,000 nits.',
    'The camera is 1,000 pixels.',
    'The voltage is 12.5 volts.',
    'The brightness is 1,200 lumens.',
    'The bottle holds 1.5 liters.',
    'The temperature is 23.5 degrees.',
    'Maximum load capacity is 900 pounds.',
    'Payload capacity is 1,200 pounds.',
  ])('preserves specifications and non-price numeric context: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Device' },
      })
    ).toBe(text);
  });

  it('keeps a pound-denominated retail price after a physical weight', () => {
    expect(
      getDurableProductSeoText({
        text: 'Weighs 5 pounds and costs 900 pounds.',
        product: { name: 'Device' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'Weighs 5 pounds and sells for 900 pounds.',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it('does not treat a per-hour rental rate as a lifespan quantity', () => {
    expect(
      getDurableProductSeoText({
        text: 'Rental costs 900 per hour.',
        product: { name: 'Device' },
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
});
