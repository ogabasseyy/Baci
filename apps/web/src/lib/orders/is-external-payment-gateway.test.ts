import { describe, expect, it } from 'vitest';
import { isExternalPaymentGateway } from './is-external-payment-gateway';

describe('isExternalPaymentGateway', () => {
  it('distinguishes external payment legs', () => {
    expect(isExternalPaymentGateway('wallet')).toBe(false);
    expect(isExternalPaymentGateway('paystack')).toBe(true);
    expect(isExternalPaymentGateway(null)).toBe(true);
  });
});
