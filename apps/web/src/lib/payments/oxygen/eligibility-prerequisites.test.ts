import { expect, it } from 'vitest';
import { oxygenEligibilityPrerequisites } from './eligibility-prerequisites';

it('requires validation plus phone, BVN and selfie completion before eligibility', () => {
  const kyc = {
    phone_status: 'DONE',
    bvn_status: 'DONE',
    selfie_status: 'DONE',
    nin_status: 'NOT_DONE',
    bank_status: 'NOT_DONE',
    address_status: 'NOT_DONE',
  } as const;
  expect(oxygenEligibilityPrerequisites({ validated: true, kyc })).toBe(true);
  expect(oxygenEligibilityPrerequisites({ validated: false, kyc })).toBe(false);
  expect(oxygenEligibilityPrerequisites({ validated: true })).toBe(false);
  expect(
    oxygenEligibilityPrerequisites({
      validated: true,
      kyc: { ...kyc, selfie_status: 'PROCESSING' },
    })
  ).toBe(false);
  expect(
    oxygenEligibilityPrerequisites({
      validated: true,
      kyc: { ...kyc, phone_status: 'NOT_DONE' },
    })
  ).toBe(false);
});
