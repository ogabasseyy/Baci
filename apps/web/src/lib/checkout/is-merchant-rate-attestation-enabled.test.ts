import { describe, expect, it } from 'vitest';
import { isMerchantRateAttestationEnabled } from './is-merchant-rate-attestation-enabled';

describe('isMerchantRateAttestationEnabled', () => {
  it('is off unless the value is case-insensitive true', () => {
    expect(isMerchantRateAttestationEnabled(undefined)).toBe(false);
    expect(isMerchantRateAttestationEnabled('false')).toBe(false);
    expect(isMerchantRateAttestationEnabled('1')).toBe(false);
    expect(isMerchantRateAttestationEnabled(' TRUE ')).toBe(true);
  });
});
