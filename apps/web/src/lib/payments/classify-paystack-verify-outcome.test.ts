import { describe, expect, it } from 'vitest';
import {
  isDefinitiveProviderRejection,
  isVerificationUnavailable,
} from './classify-paystack-verify-outcome';

describe('classify-paystack-verify-outcome', () => {
  it('treats outages as unavailable for a later sweep', () => {
    expect(isVerificationUnavailable('NETWORK_ERROR')).toBe(true);
    expect(isVerificationUnavailable('CONFIG_ERROR')).toBe(true);
    expect(isVerificationUnavailable('HTTP_401')).toBe(true);
    expect(isVerificationUnavailable('HTTP_408')).toBe(true);
    expect(isVerificationUnavailable('HTTP_429')).toBe(true);
    expect(isVerificationUnavailable('HTTP_503')).toBe(true);
    expect(isVerificationUnavailable('HTTP_400')).toBe(false);
    expect(isVerificationUnavailable('VALIDATION_ERROR')).toBe(false);
    expect(isVerificationUnavailable(undefined)).toBe(false);
  });

  it('treats deterministic client rejections as final', () => {
    expect(isDefinitiveProviderRejection('HTTP_400')).toBe(true);
    expect(isDefinitiveProviderRejection('HTTP_422')).toBe(true);
    expect(isDefinitiveProviderRejection('HTTP_401')).toBe(false);
    expect(isDefinitiveProviderRejection('HTTP_404')).toBe(false);
    expect(isDefinitiveProviderRejection('HTTP_408')).toBe(false);
    expect(isDefinitiveProviderRejection('HTTP_429')).toBe(false);
    expect(isDefinitiveProviderRejection('HTTP_500')).toBe(false);
    expect(isDefinitiveProviderRejection(undefined)).toBe(false);
  });
});
