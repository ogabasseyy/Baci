import { describe, expect, it } from 'vitest';
import { isExternalPaymentGateway } from './is-external-payment-gateway';

describe('isExternalPaymentGateway', () => {
  it('distinguishes external payment legs', () => {
    expect(isExternalPaymentGateway('wallet')).toBe(false);
    expect(isExternalPaymentGateway('paystack')).toBe(true);
    expect(isExternalPaymentGateway(null)).toBe(true);
  });

  it('normalizes legacy casing and padding before the internal lookup', () => {
    expect(isExternalPaymentGateway('Wallet')).toBe(false);
    expect(isExternalPaymentGateway(' wallet ')).toBe(false);
    expect(isExternalPaymentGateway('PAY_ON_DELIVERY')).toBe(false);
    expect(isExternalPaymentGateway(' Paystack ')).toBe(true);
    expect(isExternalPaymentGateway('')).toBe(true);
    expect(isExternalPaymentGateway('   ')).toBe(true);
  });
});
