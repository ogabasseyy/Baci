import { describe, expect, it } from 'vitest';
import { generateMetaDescription } from './meta-description';

describe('generateMetaDescription', () => {
  it('returns plain text for HTML content', () => {
    expect(
      generateMetaDescription(
        '<p>Shop <strong>phones</strong>, laptops and consoles.</p>'
      )
    ).toBe('Shop phones, laptops and consoles.');
  });

  it('removes stale absolute listed-price sentences', () => {
    expect(
      generateMetaDescription(
        'Premium foldable phone. Current listed price is NGN 2,500,000. Confirm selected variant price before checkout.'
      )
    ).toBe(
      'Premium foldable phone. Confirm selected variant price before checkout.'
    );
  });

  it('extends short descriptions when minLength fallback options are provided', () => {
    expect(
      generateMetaDescription('2-in-1', 160, {
        minLength: 110,
        fallback:
          'Buy premium laptops in Nigeria with nationwide delivery and flexible payment options.',
      })
    ).toContain('Buy premium laptops in Nigeria');
  });

  it('uses the fallback description when the source description is empty', () => {
    expect(
      generateMetaDescription('', 160, {
        minLength: 110,
        fallback:
          'Compare smartphones, laptops, and accessories with trusted quality and fast delivery across Nigeria.',
      })
    ).toBe(
      'Compare smartphones, laptops, and accessories with trusted quality and fast delivery across Nigeria.'
    );
  });

  it('does not split an emoji when truncating a long description', () => {
    const description = `${'a'.repeat(156)}🧩 trailing text`;

    const result = generateMetaDescription(description, 160);

    expect(result).toBe(`${'a'.repeat(156)}...`);
    expect(result).not.toContain(String.fromCharCode(0xd83e));
  });
});
