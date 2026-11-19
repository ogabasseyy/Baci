import { describe, expect, it } from 'vitest';
import { isMonnifyAirtimeKudaFallbackEligible } from './vtu-monnify-kuda-fallback-eligibility';

describe('isMonnifyAirtimeKudaFallbackEligible', () => {
  const airtime = { amount: 500, type: 'airtime' };
  const refused = {
    amount: 500,
    message: 'Monnify business failure',
    providerDefiniteFailure: true,
    reference: 'VTU-1',
    status: 'failed' as const,
    success: false,
  };

  describe('bugfix: only one Monnify error text ever reached Kuda', () => {
    it.each([
      ['a business rejection', refused],
      [
        'a 4xx refusal such as low Monnify float',
        {
          ...refused,
          providerErrorDetail:
            'Monnify API error: 400 Bad Request - Insufficient wallet balance',
        },
      ],
    ])('falls back on %s', (_label, result) => {
      expect(isMonnifyAirtimeKudaFallbackEligible(airtime, result)).toBe(true);
    });
  });

  it('does not fall back on a failure Monnify did not explicitly refuse', () => {
    // An unrecognised vend status or a duplicate reference may still be
    // delivered by Monnify.
    expect(
      isMonnifyAirtimeKudaFallbackEligible(airtime, {
        ...refused,
        providerDefiniteFailure: undefined,
      })
    ).toBe(false);
    expect(
      isMonnifyAirtimeKudaFallbackEligible(airtime, {
        ...refused,
        providerDefiniteFailure: false,
      })
    ).toBe(false);
  });

  it('never falls back while Monnify may still deliver', () => {
    expect(
      isMonnifyAirtimeKudaFallbackEligible(airtime, {
        ...refused,
        status: 'pending',
        success: true,
      })
    ).toBe(false);
  });

  it('does not fall back after a Monnify success', () => {
    expect(
      isMonnifyAirtimeKudaFallbackEligible(airtime, {
        ...refused,
        status: 'successful',
        success: true,
      })
    ).toBe(false);
  });

  it('only covers airtime with a positive amount', () => {
    expect(
      isMonnifyAirtimeKudaFallbackEligible(
        { amount: 500, type: 'electricity' },
        refused
      )
    ).toBe(false);
    expect(
      isMonnifyAirtimeKudaFallbackEligible(
        { amount: 0, type: 'airtime' },
        refused
      )
    ).toBe(false);
  });
});
