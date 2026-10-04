import {
  SavingsCardContributionOperationSchema,
  SavingsCardContributionOptionsSchema,
  SavingsCardContributionRequestSchema,
} from './savings-card-contributions';

const goalId = '00000000-0000-4000-8000-000000000001';
const operationId = '00000000-0000-4000-8000-000000000002';
const methodId = '00000000-0000-4000-8000-000000000003';

it('rejects unexpected options fields and any enabled new-card flow', () => {
  const base = {
    goalId,
    enabled: true,
    newCardEnabled: false,
    currency: 'NGN',
    maximumAmountKobo: Number.MAX_SAFE_INTEGER,
    savedMethods: [{ id: methodId, brand: 'Visa', last4: '4242' }],
  };
  expect(SavingsCardContributionOptionsSchema.safeParse(base).success).toBe(true);
  expect(SavingsCardContributionOptionsSchema.safeParse({ ...base, savedMethods: [{ id: methodId, brand: 'B'.repeat(65), last4: '4242' }] }).success).toBe(false);
  expect(SavingsCardContributionOptionsSchema.safeParse({ ...base, savedMethods: Array.from({ length: 21 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, brand: 'Visa', last4: '4242' })) }).success).toBe(false);
  expect(SavingsCardContributionOptionsSchema.safeParse({ ...base, addCardUrl: 'https://example.test' }).success).toBe(false);
  expect(SavingsCardContributionOptionsSchema.safeParse({ ...base, newCardEnabled: true }).success).toBe(false);
});

it('requires positive safe kobo and the exact one-time consent contract', () => {
  const operation = { operationId, goalId, amountKobo: 100, currency: 'NGN', status: 'pending' };
  expect(SavingsCardContributionOperationSchema.safeParse(operation).success).toBe(true);
  expect(SavingsCardContributionOperationSchema.safeParse({ ...operation, amountKobo: Number.MAX_SAFE_INTEGER + 1 }).success).toBe(false);
  expect(SavingsCardContributionRequestSchema.safeParse({
    goalId,
    savedMethodId: methodId,
    amountKobo: 100,
    idempotencyKey: operationId,
    consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
    merchantId: 'must-not-be-sent',
  }).success).toBe(false);
});
