import { describe, expect, it } from 'vitest';
import {
  parseShippingSettings,
  shippingSettingsSchema,
} from './shipping-types';

describe('shipping-types', () => {
  it('parses valid shipping settings', () => {
    expect(
      parseShippingSettings({
        merchant_id: 'merchant-1',
        shipping_providers: ['gigl', 'topship'],
        free_shipping_threshold: 15000,
      })
    ).toEqual({
      merchant_id: 'merchant-1',
      shipping_providers: ['gigl', 'topship'],
      free_shipping_threshold: 15000,
    });
  });

  it('keeps the settings schema strict for invalid provider identifiers', () => {
    expect(
      shippingSettingsSchema.safeParse({
        merchant_id: 'merchant-1',
        shipping_providers: ['dhl'],
        free_shipping_threshold: null,
      }).success
    ).toBe(false);
  });

  it('accepts an empty provider list for merchants using their own rates', () => {
    expect(
      shippingSettingsSchema.safeParse({
        merchant_id: 'merchant-1',
        shipping_providers: [],
        free_shipping_threshold: null,
      }).success
    ).toBe(true);
  });

  it('recovers a non-array legacy provider value as no enabled carriers', () => {
    expect(
      parseShippingSettings({
        merchant_id: 'merchant-1',
        shipping_providers: 'gigl',
        free_shipping_threshold: null,
      }).shipping_providers
    ).toEqual([]);
  });

  it('normalizes stored legacy provider values through the carrier catalog', () => {
    expect(
      parseShippingSettings({
        merchant_id: 'merchant-1',
        shipping_providers: [' GIGL ', 'shiip', 'topship', 'gigl', 'dhl', null],
        free_shipping_threshold: null,
      }).shipping_providers
    ).toEqual(['gigl', 'topship']);
  });

  it('rejects Shiip because it has no live carrier integration', () => {
    expect(
      shippingSettingsSchema.safeParse({
        merchant_id: 'merchant-1',
        shipping_providers: ['shiip'],
        free_shipping_threshold: null,
      }).success
    ).toBe(false);
  });

  it('rejects duplicate shipping providers', () => {
    expect(
      shippingSettingsSchema.safeParse({
        merchant_id: 'merchant-1',
        shipping_providers: ['gigl', 'gigl'],
        free_shipping_threshold: null,
      }).success
    ).toBe(false);
  });

  it.each([
    'shiip',
    'SHIIP',
    ' shiip ',
  ])('drops retired provider id %s from stored legacy settings', (retiredProviderId) => {
    expect(
      parseShippingSettings({
        merchant_id: 'merchant-1',
        shipping_providers: ['gigl', retiredProviderId, 'topship'],
        free_shipping_threshold: null,
      }).shipping_providers
    ).toEqual(['gigl', 'topship']);
  });
});
