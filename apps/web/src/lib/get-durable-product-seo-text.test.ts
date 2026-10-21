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
        currency: 'NGN',
      })
    ).toBe('');
  });

  it.each([
    'iPhone 13 Price – From ₦350,000',
    'Buy iPhone 13 from NGN 350,000.',
    'Buy iPhone 13 for 350,000 NGN.',
    'Buy iPhone 13 from <strong>₦350,000</strong>.',
    'Buy iPhone 13 for 350,000₦.',
  ])('rejects an unbound monetary claim: %s', (text) => {
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'iPhone 13' },
        currency: 'NGN',
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
        currency: 'NGN',
      })
    ).toBe(text);
  });

  it('rejects the imported generic shopping description', () => {
    expect(
      getDurableProductSeoText({
        text: 'Buy iPhone 13 in Nigeria from Ogabassey. Confirm specs, condition, variants and availability.',
        product: { name: 'iPhone 13' },
        currency: 'NGN',
      })
    ).toBe('');
  });

  it('preserves a denomination in the product name but rejects a separate retail price', () => {
    const text = 'PSN Gift Card £50 GBP Price in Nigeria';
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
      currency: 'NGN',
    };
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} from ₦80,000` })
    ).toBe('');
  });

  it('uses the merchant currency code rather than treating RAM specifications as money', () => {
    const text = 'Laptop with RAM 16GB and a 512GB SSD.';
    expect(
      getDurableProductSeoText({
        text,
        product: { name: 'Laptop' },
        currency: 'NGN',
      })
    ).toBe(text);
    expect(
      getDurableProductSeoText({
        text: 'Laptop from KES 50,000',
        product: { name: 'Laptop' },
        currency: 'KES',
      })
    ).toBe('');
  });

  it('preserves a repeated gift-card face value but not a quoted retail price', () => {
    const args = {
      product: { name: 'PSN Gift Card £50 GBP' },
      currency: 'NGN',
    };
    const text =
      'PSN Gift Card £50 GBP at Ogabassey: £50 GBP value for PlayStation Store.';
    expect(getDurableProductSeoText({ ...args, text })).toBe(text);
    expect(
      getDurableProductSeoText({ ...args, text: `${text} Buy from ₦80,000.` })
    ).toBe('');
  });
});
