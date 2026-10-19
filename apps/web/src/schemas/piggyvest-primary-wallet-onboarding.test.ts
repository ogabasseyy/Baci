import { describe, expect, it } from 'vitest';
import { piggyvestPrimaryWalletOnboardingSchema } from './piggyvest-primary-wallet-onboarding';

describe('primary wallet onboarding input', () => {
  it('accepts explicit consent and a valid BVN shape', () => {
    expect(
      piggyvestPrimaryWalletOnboardingSchema.safeParse({
        consent: true,
        bvn: '00000000000',
      }).success
    ).toBe(true);
  });
  it.each([
    { consent: false, bvn: '00000000000' },
    { consent: true, bvn: '123' },
    { consent: true, bvn: 'abcdefghijk' },
    { consent: true, bvn: '00000000000', customerId: 'injected' },
  ])('rejects missing consent, invalid BVN or caller-selected identity', (input) => {
    expect(
      piggyvestPrimaryWalletOnboardingSchema.safeParse(input).success
    ).toBe(false);
  });
});
