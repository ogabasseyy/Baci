import { expect, it } from 'vitest';
import { bankCardOfferContextFixture } from './bank-card-offer-payment-context.test-support';
import { bankCardOfferVerificationContextSchema } from './bank-card-offer-verification-context';

it('retains replayable gateway evidence and requires the saved policy hash', () => {
  const verification = {
    ...bankCardOfferContextFixture,
    reference: `BCO-${'a'.repeat(32)}`,
    domain: 'test',
    acceptedFilterPolicyHash: 'b'.repeat(64),
    completedGatewayResponse: { status: 'success' },
  };
  expect(bankCardOfferVerificationContextSchema.parse(verification)).toEqual(
    verification
  );
  expect(
    bankCardOfferVerificationContextSchema.safeParse({
      ...verification,
      acceptedFilterPolicyHash: '',
    }).success
  ).toBe(false);
});
