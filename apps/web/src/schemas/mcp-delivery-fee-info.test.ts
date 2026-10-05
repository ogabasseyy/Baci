import { describe, expect, it } from 'vitest';
import { mcpDeliveryFeeInfoInputSchema } from './mcp-delivery-fee-info';

describe('mcpDeliveryFeeInfoInputSchema', () => {
  it('accepts a state with an optional city and enforces the documented bounds', () => {
    expect(mcpDeliveryFeeInfoInputSchema.parse({ state: 'Lagos' })).toEqual({
      state: 'Lagos',
    });
    expect(
      mcpDeliveryFeeInfoInputSchema.parse({ state: 'Lagos', city: 'Ikeja' })
    ).toEqual({ state: 'Lagos', city: 'Ikeja' });
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'L' }).success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'L'.repeat(51) }).success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'Lagos', city: 'I' })
        .success
    ).toBe(false);
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({
        state: 'Lagos',
        city: 'I'.repeat(101),
      }).success
    ).toBe(false);
  });
});

const product_id = 'bfab9f45-7c2e-4744-be8e-9540af062406';
const variant_id = 'c985e013-7c2b-4655-a560-4085f27cd168';
const validItem = { product_id, quantity: 1 };
const parseItem = (item: unknown) =>
  mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'Lagos', items: [item] })
    .success;

describe('live quote input boundaries', () => {
  it.each([1, 10])('accepts quantity %s', (quantity) =>
    expect(parseItem({ ...validItem, quantity })).toBe(true));
  it.each([
    0,
    -1,
    11,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1',
    null,
  ])('rejects quantity %s', (quantity) =>
    expect(parseItem({ ...validItem, quantity })).toBe(false));
  it('requires a valid product UUID and quantity', () => {
    expect(parseItem(validItem)).toBe(true);
    for (const product_id of ['', 'camera', null, undefined])
      expect(parseItem({ ...validItem, product_id })).toBe(false);
    expect(parseItem({ product_id })).toBe(false);
  });
  it('accepts an optional exact variant UUID and rejects malformed variants', () => {
    expect(parseItem({ ...validItem, variant_id })).toBe(true);
    for (const variant_id of ['', 'variant', null])
      expect(parseItem({ ...validItem, variant_id })).toBe(false);
  });
  it.each([0.001, 100])('accepts per-unit weight %s', (weight_kg) =>
    expect(parseItem({ ...validItem, weight_kg })).toBe(true));
  it.each([
    0,
    -1,
    100.001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1',
    null,
  ])('rejects weight %s', (weight_kg) =>
    expect(parseItem({ ...validItem, weight_kg })).toBe(false));
  it.each([1, 5])('accepts %s selections', (count) => {
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({
        state: 'Lagos',
        items: Array.from({ length: count }, () => validItem),
      }).success
    ).toBe(true);
  });
  it.each([0, 6])('rejects %s selections', (count) => {
    expect(
      mcpDeliveryFeeInfoInputSchema.safeParse({
        state: 'Lagos',
        items: Array.from({ length: count }, () => validItem),
      }).success
    ).toBe(false);
  });
  it('rejects non-array items and accepts only documented preferences', () => {
    for (const items of [null, {}, 'camera'])
      expect(
        mcpDeliveryFeeInfoInputSchema.safeParse({ state: 'Lagos', items })
          .success
      ).toBe(false);
    for (const delivery_preference of ['door', 'pickup_station', undefined])
      expect(
        mcpDeliveryFeeInfoInputSchema.safeParse({
          state: 'Lagos',
          delivery_preference,
        }).success
      ).toBe(true);
    for (const delivery_preference of ['', 'pickup', 'Door', null])
      expect(
        mcpDeliveryFeeInfoInputSchema.safeParse({
          state: 'Lagos',
          delivery_preference,
        }).success
      ).toBe(false);
  });
});
