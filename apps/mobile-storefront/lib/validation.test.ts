import { isValidIMEI, ProductRowSchema } from './validation';

describe('isValidIMEI', () => {
  it('accepts a valid IMEI (Luhn check passes)', () => {
    // Known valid IMEI: 490154203237518
    expect(isValidIMEI('490154203237518')).toBe(true);
  });

  it('accepts another valid IMEI', () => {
    expect(isValidIMEI('356938035643809')).toBe(true);
  });

  it('rejects an IMEI with invalid checksum', () => {
    // Change the last digit of a valid IMEI
    expect(isValidIMEI('490154203237519')).toBe(false);
  });

  it('rejects a string that is too short', () => {
    expect(isValidIMEI('49015420323')).toBe(false);
  });

  it('rejects a string that is too long', () => {
    expect(isValidIMEI('4901542032375180')).toBe(false);
  });

  it('rejects a string with non-digit characters', () => {
    expect(isValidIMEI('49015420323751a')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidIMEI('')).toBe(false);
  });

  it('rejects a string with spaces', () => {
    expect(isValidIMEI('490 154 203 237')).toBe(false);
  });
});

describe('ProductRowSchema', () => {
  it('accepts legacy object-map variant attributes', () => {
    const result = ProductRowSchema.safeParse({
      id: '4bfca2e0-5d93-4cdf-b9fc-0b0fd3753e0f',
      name: 'Iphone 13 Pro 128gb Premium Used',
      slug: 'iphone-13-pro-128gb-premium-used',
      price: 552000,
      images: null,
      has_variants: false,
      variant_attributes: {},
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('keeps hydrated base inventory policy and units on simple rows', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Xiaomi 18 Ultra',
      slug: 'xiaomi-18-ultra',
      price: 1200000,
      status: 'active',
      has_variants: false,
      base_effective_policy: 'serialized_strict',
      base_available_units: 4,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected schema parse to succeed');
    }
    expect(result.data.base_effective_policy).toBe('serialized_strict');
    expect(result.data.base_available_units).toBe(4);
  });

  it('keeps optional created_at timestamps from product list rows', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Xiaomi 18 Ultra',
      slug: 'xiaomi-18-ultra',
      price: 1200000,
      created_at: '2026-06-24T08:00:00.000Z',
      images: ['https://cdn.example.com/xiaomi-18-ultra.avif'],
      status: 'active',
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected schema parse to succeed');
    }
    expect(result.data.created_at).toBe('2026-06-24T08:00:00.000Z');
  });

  it('accepts array-based variant attributes', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'iPhone 13 Pro',
      slug: 'iphone-13-pro',
      price: 825000,
      images: ['https://cdn.example.com/iphone-13-pro-gold.avif'],
      has_variants: true,
      variant_attributes: [
        {
          param: 'storage',
          options: ['128GB', '256GB', '512GB'],
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('accepts string-array variant attributes from legacy live rows', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Samsung Galaxy S26+',
      slug: 'samsung-galaxy-s26-plus',
      price: 1403535,
      images: ['https://cdn.example.com/s26-plus.jpg'],
      has_variants: true,
      variant_attributes: ['storage'],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('accepts object-based image arrays from live product rows', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Redmi Pad SE',
      slug: 'redmi-pad-se',
      price: 191814,
      images: [
        { url: 'https://cdn.example.com/redmi-pad-se-front.jpg' },
        { src: 'https://cdn.example.com/redmi-pad-se-back.jpg' },
      ],
      has_variants: true,
      variant_attributes: [
        {
          param: 'storage',
          options: ['128GB', '256GB'],
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('accepts section-array specifications from live product rows', () => {
    const result = ProductRowSchema.safeParse({
      id: '900bbe6f-9312-4b01-a183-df7c3f36b259',
      name: 'HP OMEN MAX 16T-AH000 Gaming Laptop',
      slug: 'hp-omen-max-16t-ah000-gaming-laptop',
      price: 2500000,
      images: ['https://cdn.example.com/hp-omen.jpg'],
      specifications: [
        {
          category: 'Specs',
          items: [
            { label: 'Brand', value: 'HP' },
            { label: 'RAM', value: '16GB' },
          ],
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('accepts malformed array-based variant attributes for later normalization', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'iPhone 13 Pro',
      slug: 'iphone-13-pro',
      price: 825000,
      images: ['https://cdn.example.com/iphone-13-pro-gold.avif'],
      has_variants: true,
      variant_attributes: [
        {
          param: 123,
          options: '128GB',
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('accepts numeric-string values inside nested variant rows from Supabase joins', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
      price: 600000,
      images: ['https://cdn.example.com/s24.jpg'],
      has_variants: true,
      manage_stock: false,
      available_conditions: ['open_box', 'used'],
      variant_attributes: [{ param: 'storage', options: ['128GB', '256GB'] }],
      variants: [
        {
          id: 'variant-blue-128',
          condition: 'open_box',
          price_override: '600000.00',
          stock_quantity: '0',
          attributes: {
            color: 'Sapphire Blue',
            color_hex: '#5A7B97',
            storage: '128GB',
          },
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected schema parse to succeed');
    }

    expect(result.data.variants?.[0]?.price_override).toBe(600000);
    expect(result.data.variants?.[0]?.stock_quantity).toBe(0);
  });

  it('accepts non-selector metadata values inside nested variant attributes', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Samsung Galaxy A27 5G Preorder',
      slug: 'samsung-galaxy-a27-5g',
      price: 50000,
      images: [],
      has_variants: true,
      manage_stock: false,
      available_conditions: ['new'],
      variant_attributes: [
        { param: 'color', options: ['Blue'] },
        { param: 'storage', options: ['128GB'] },
      ],
      variants: [
        {
          id: 'variant-blue-128',
          condition: 'new',
          price_override: 50000,
          stock_quantity: 0,
          attributes: {
            color: 'Blue',
            storage: '128GB',
            preorder: true,
          },
        },
      ],
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('rejects negative inventory counts and out-of-range ratings', () => {
    const result = ProductRowSchema.safeParse({
      id: '953ba6ff-3e83-403a-a07c-8c5ff54ede98',
      name: 'Samsung Galaxy S24',
      slug: 'samsung-galaxy-s24',
      price: 600000,
      images: ['https://cdn.example.com/s24.jpg'],
      average_rating: 6,
      review_count: -1,
      stock_quantity: -3,
      status: 'active',
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error('Expected schema parse to fail');
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['average_rating'] }),
        expect.objectContaining({ path: ['review_count'] }),
        expect.objectContaining({ path: ['stock_quantity'] }),
      ])
    );
  });
});
