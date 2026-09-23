import { describe, expect, it } from 'vitest';
import { orderGiglQuoteSchema } from './order-gigl-shipping';

describe('orderGiglQuoteSchema', () => {
  it('accepts a complete receiver override', () => {
    expect(
      orderGiglQuoteSchema.safeParse({
        receiver: {
          address: '1 Main',
          city: 'Lagos',
          state: 'Lagos',
          phone: '0800',
        },
      }).success
    ).toBe(true);
  });

  it('accepts Google-complete coordinates while city and state remain optional metadata', () => {
    const result = orderGiglQuoteSchema.safeParse({
      receiver: {
        address: 'Google formatted destination',
        phone: '08001234567',
        latitude: 6.6018,
        longitude: 3.3515,
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.receiver).toMatchObject({
      latitude: 6.6018,
      longitude: 3.3515,
    });
  });

  it('rejects partial or blank overrides', () => {
    expect(
      orderGiglQuoteSchema.safeParse({
        receiver: {
          address: '1 Main',
          city: '',
          state: 'Lagos',
          phone: '0800',
        },
      }).success
    ).toBe(false);
    expect(
      orderGiglQuoteSchema.safeParse({
        receiver: { address: '1 Main', city: 'Lagos' },
      }).success
    ).toBe(false);
  });

  it('rejects partial coordinate pairs and non-finite coordinates', () => {
    expect(
      orderGiglQuoteSchema.safeParse({
        receiver: {
          address: 'Google formatted destination',
          phone: '08001234567',
          latitude: 6.6018,
        },
      }).success
    ).toBe(false);
    expect(
      orderGiglQuoteSchema.safeParse({
        receiver: {
          address: 'Google formatted destination',
          phone: '08001234567',
          latitude: Number.POSITIVE_INFINITY,
          longitude: 3.3515,
        },
      }).success
    ).toBe(false);
  });

  it.each([
    ['latitude above maximum', { latitude: 90.0001, longitude: 3.3515 }],
    ['longitude above maximum', { latitude: 6.6018, longitude: 180.0001 }],
  ])('rejects %s', (_label, coordinates) => {
    const result = orderGiglQuoteSchema.safeParse({
      receiver: {
        address: 'Google formatted destination',
        phone: '08001234567',
        ...coordinates,
      },
    });

    expect(result.success).toBe(false);
  });
});
