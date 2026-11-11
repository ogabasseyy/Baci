import { describe, expect, it } from 'vitest';
import { getDurableProductSeoText } from './get-durable-product-seo-text';

describe('durable SEO amount ranges and localized prices', () => {
  it('rejects a title reduced to a product name and delimiter after price removal', () => {
    expect(
      getDurableProductSeoText({
        text: 'iPhone 13 — Current listed price is NGN 350,000',
        product: { name: 'iPhone 13' },
      })
    ).toBe('');
  });

  it('rejects a low unlabelled price range after product-name removal', () => {
    expect(
      getDurableProductSeoText({
        text: 'Device – 999–1299',
        product: { name: 'Device' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'Device – 1,200–1,500',
        product: { name: 'Device' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: 'Device – 1200–2000',
        product: { name: 'Device' },
      })
    ).toBe('');
  });

  it('preserves a known display-resolution range in product copy', () => {
    expect(
      getDurableProductSeoText({
        text: 'Device – 1366–768',
        product: { name: 'Device' },
      })
    ).toContain('1366–768');
    expect(
      getDurableProductSeoText({
        text: 'Device – 3000–2000',
        product: { name: 'Device' },
      })
    ).toContain('3000–2000');
  });

  it('preserves an unlabelled product-year range', () => {
    expect(
      getDurableProductSeoText({
        text: '2020–2024',
        product: { name: 'Device' },
      })
    ).toBe('2020–2024');
  });

  it('rejects tagged and unmarked Arabic-Indic prices', () => {
    expect(
      getDurableProductSeoText({
        text: 'Price: د.إ ٩٠٠',
        product: { name: 'Phone' },
      })
    ).toBe('');
    expect(
      getDurableProductSeoText({
        text: '٣٥٠٠٠٠',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });

  it('recognizes Arabic decimal punctuation without turning it into a thousands separator', () => {
    expect(
      getDurableProductSeoText({
        text: 'Price: KWD ٩٫٥٠٠',
        product: { name: 'Phone' },
      })
    ).toBe('');
  });
});
