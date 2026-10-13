import { describe, expect, it, vi } from 'vitest';
import {
  getVerifiedAmount,
  verifyGatewayPayment,
} from './verify-gateway-payment';

vi.mock('@/lib/paystack', () => ({
  verifyTransaction: vi.fn(),
}));

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

describe('getVerifiedAmount', () => {
  it('converts paystack kobo to the major unit', () => {
    expect(
      getVerifiedAmount('paystack', { amount: 500000, currency: 'NGN' })
    ).toEqual({ amount: 5000, currency: 'NGN' });
  });

  it('passes non-paystack amounts through untouched', () => {
    expect(
      getVerifiedAmount('korapay', { amount: 5000, currency: 'KES' })
    ).toEqual({ amount: 5000, currency: 'KES' });
    expect(getVerifiedAmount('korapay', { amount: 5000 })).toEqual({
      amount: 5000,
      currency: undefined,
    });
  });

  it('rejects missing, non-finite, or non-positive amounts', () => {
    expect(getVerifiedAmount('paystack', {})).toBeNull();
    expect(getVerifiedAmount('paystack', { amount: '5000' })).toBeNull();
    expect(getVerifiedAmount('paystack', { amount: 0 })).toBeNull();
    expect(getVerifiedAmount('paystack', { amount: -100 })).toBeNull();
  });
});

describe('verifyGatewayPayment', () => {
  it('rejects unsupported gateways without calling providers', async () => {
    const result = await verifyGatewayPayment('unknown', 'ref-1');

    expect(result).toEqual({
      success: false,
      error: 'Unsupported gateway: unknown',
      code: 'UNSUPPORTED_GATEWAY',
    });
  });
});
