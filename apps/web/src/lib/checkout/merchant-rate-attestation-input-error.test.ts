import { describe, expect, it } from 'vitest';
import { MerchantRateAttestationInputError } from './merchant-rate-attestation-input-error';

describe('MerchantRateAttestationInputError', () => {
  it('preserves Error identity, name, and message', () => {
    const error = new MerchantRateAttestationInputError(
      'invalid checkout claim'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('MerchantRateAttestationInputError');
    expect(error.message).toBe('invalid checkout claim');
  });
});
