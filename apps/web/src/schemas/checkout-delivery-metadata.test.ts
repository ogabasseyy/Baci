import { describe, expect, it } from 'vitest';
import { orderDeliveryMetadataSchema } from './checkout-delivery-metadata';

describe('orderDeliveryMetadataSchema', () => {
  it('accepts ordinary orders without delivery metadata', () => {
    expect(orderDeliveryMetadataSchema.safeParse({}).success).toBe(true);
  });

  it('requires airport_type for a local airport order', () => {
    expect(
      orderDeliveryMetadataSchema.safeParse({ delivery_method: 'airport' })
        .success
    ).toBe(false);
  });

  it('allows provider-backed airport orders without airport_type', () => {
    expect(
      orderDeliveryMetadataSchema.safeParse({
        delivery_method: 'airport',
        selected_quote_id: '123e4567-e89b-12d3-a456-426614174777',
      }).success
    ).toBe(true);
  });

  it('rejects airport pickup metadata for provider-backed airport orders', () => {
    expect(
      orderDeliveryMetadataSchema.safeParse({
        delivery_method: 'airport',
        selected_quote_id: '123e4567-e89b-12d3-a456-426614174777',
        airport_type: 'pickup',
      }).success
    ).toBe(false);
  });

  it('rejects airport_type on a non-airport order', () => {
    expect(
      orderDeliveryMetadataSchema.safeParse({
        delivery_method: 'door',
        airport_type: 'delivery',
      }).success
    ).toBe(false);
  });
});
