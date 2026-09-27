import { describe, expect, it } from 'vitest';
import {
  isAbortError,
  isVerificationResponse,
  normalizeCurrencyCode,
} from './verify-checkout-payment-response';

describe('verifyCheckoutPaymentByLookup helpers', () => {
  it('normalizes currency codes', () => {
    expect(normalizeCurrencyCode(' ngn ')).toBe('NGN');
    expect(normalizeCurrencyCode('')).toBeUndefined();
    expect(normalizeCurrencyCode(42)).toBeUndefined();
  });

  it('validates verification response shapes', () => {
    expect(isVerificationResponse({ status: 'success' })).toBe(true);
    expect(isVerificationResponse({ status: 'abandoned' })).toBe(true);
    expect(isVerificationResponse({ status: 'bogus' })).toBe(false);
    expect(isVerificationResponse(null)).toBe(false);
    expect(isVerificationResponse([])).toBe(false);
    expect(isVerificationResponse({ orderNumber: 42 })).toBe(false);
  });

  it('detects abort errors only', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});
