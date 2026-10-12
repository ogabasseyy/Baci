import { SavingsFirstCardCheckoutSchemas as schemas } from './savings-first-card-checkout';

const goalId = '00000000-0000-4000-8000-000000000001';
const intentId = '00000000-0000-4000-8000-000000000002';
const validState = {
  intentId,
  goalId,
  amountKobo: 12500,
  currency: 'NGN' as const,
  status: 'ready' as const,
  authorizationUrl: 'https://checkout.paystack.com/access123',
};

it('accepts the exact capability and public state contracts', () => {
  expect(
    schemas.capability.parse({
      goalId,
      enabled: false,
      maximumAmountKobo: 0,
      currency: 'NGN',
    }).enabled
  ).toBe(false);
  expect(schemas.publicState.parse(validState)).toEqual(validState);
  expect(
    schemas.publicState.parse({
      ...validState,
      status: 'retired_unconfirmed',
      authorizationUrl: undefined,
    }).status
  ).toBe('retired_unconfirmed');
});

it('rejects capability identity, unsafe amounts, and unexpected fields', () => {
  expect(
    schemas.capability.safeParse({
      goalId,
      enabled: true,
      maximumAmountKobo: Number.MAX_SAFE_INTEGER + 1,
      currency: 'NGN',
    }).success
  ).toBe(false);
  expect(
    schemas.capability.safeParse({
      goalId,
      enabled: true,
      maximumAmountKobo: 1,
      currency: 'NGN',
      customerId: 'not-allowed',
    }).success
  ).toBe(false);
});

it('requires a strictly shaped checkout URL exactly when status is ready', () => {
  for (const authorizationUrl of [
    'https://user:pass@checkout.paystack.com/access123',
    'https://checkout.paystack.com:8443/access123',
    'https://checkout.paystack.com/access123?redirect=evil',
  ]) {
    expect(
      schemas.publicState.safeParse({ ...validState, authorizationUrl }).success
    ).toBe(false);
  }
  expect(
    schemas.publicState.safeParse({
      ...validState,
      status: 'pending',
      authorizationUrl: undefined,
    }).success
  ).toBe(true);
  expect(
    schemas.publicState.safeParse({
      ...validState,
      status: 'pending',
    }).success
  ).toBe(false);
});

it('rejects customer identity fields in checkout requests', () => {
  expect(
    schemas.request.safeParse({
      goalId,
      amountKobo: 12500,
      idempotencyKey: intentId,
      consent: {
        version: 'prefunded-first-card-v1',
        oneTimeCharge: true,
        saveCard: true,
      },
      customerId: 'not-allowed',
    }).success
  ).toBe(false);
});
