import { expect, it } from 'vitest';
import { oxygenVerificationHeading } from './oxygen-verification-heading';

const initial = {
  selfie: false,
  ninPending: false,
  bankPending: false,
  review: false,
  checking: true,
  identityComplete: false,
  bvnDone: false,
  eligibilityFailed: false,
};
it('names each confirmed workflow phase rather than a generic loading message', () => {
  expect(oxygenVerificationHeading(initial)).toBe('Checking your BVN');
  expect(oxygenVerificationHeading({ ...initial, bvnDone: true })).toBe(
    'Opening face verification'
  );
  expect(
    oxygenVerificationHeading({ ...initial, identityComplete: true })
  ).toBe('Checking your payment options');
  expect(oxygenVerificationHeading({ ...initial, ninPending: true })).toBe(
    'Validating your NIN'
  );
  expect(oxygenVerificationHeading({ ...initial, bankPending: true })).toBe(
    'Confirming your bank details'
  );
  expect(
    oxygenVerificationHeading({ ...initial, ninPending: true, review: true })
  ).toBe('NIN confirmation is still pending');
});

it('keeps the confirmed selfie return in identity loading until the saved checks catch up', () => {
  expect(oxygenVerificationHeading({ ...initial, selfieConfirmed: true })).toBe(
    'Confirming your identity'
  );
  expect(
    oxygenVerificationHeading({
      ...initial,
      selfieConfirmed: true,
      identityComplete: true,
    })
  ).toBe('Checking your payment options');
});
