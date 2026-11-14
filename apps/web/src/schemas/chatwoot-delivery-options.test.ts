import { describe, expect, it } from 'vitest';
import {
  chatwootDeliveryOptionsRequestSchema,
  chatwootDeliveryOptionsResponseSchema,
} from './chatwoot-delivery-options';

describe('Chatwoot delivery options contracts', () => {
  it('requires a bound conversation, session, cart version, and typed state', () => {
    const request = {
      sessionToken: 'session-proof',
      conversationId: 905,
      expectedCartVersion: 8,
      state: 'Lagos',
    };

    expect(
      chatwootDeliveryOptionsRequestSchema.safeParse(request).success
    ).toBe(true);
    expect(
      chatwootDeliveryOptionsRequestSchema.safeParse({
        ...request,
        address: '12 Private Street',
      }).success
    ).toBe(false);
    expect(
      chatwootDeliveryOptionsRequestSchema.safeParse({
        ...request,
        conversationId: '905',
      }).success
    ).toBe(false);
  });

  it('accepts only the bounded customer estimate projection', () => {
    const response = {
      state: 'Lagos',
      cartVersion: 8,
      currency: 'NGN',
      subtotalMinor: 250000,
      options: [
        {
          displayName: 'Merchant delivery',
          priceMajor: 2500,
          currency: 'NGN',
          pickup: false,
          estimatedDays: 2,
        },
      ],
    };

    expect(
      chatwootDeliveryOptionsResponseSchema.safeParse(response).success
    ).toBe(true);
    expect(
      chatwootDeliveryOptionsResponseSchema.safeParse({
        ...response,
        options: [
          {
            ...response.options[0],
            providerRateId: 'internal-rate-id',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('rejects response prices with precision below the currency minor unit', () => {
    const response = {
      state: 'Lagos',
      cartVersion: 8,
      currency: 'NGN',
      subtotalMinor: 250000,
      options: [
        {
          displayName: 'Merchant delivery',
          priceMajor: 2500.001,
          currency: 'NGN',
          pickup: false,
        },
      ],
    };

    expect(
      chatwootDeliveryOptionsResponseSchema.safeParse(response).success
    ).toBe(false);
    expect(
      chatwootDeliveryOptionsResponseSchema.safeParse({
        ...response,
        options: [
          { ...response.options[0], priceMajor: 1.001, currency: 'KWD' },
        ],
      }).success
    ).toBe(false);
    expect(
      chatwootDeliveryOptionsResponseSchema.safeParse({
        ...response,
        options: [{ ...response.options[0], priceMajor: 1.5, currency: 'JPY' }],
      }).success
    ).toBe(false);
  });
});
