import { SavingsFirstCardCheckoutSnapshotSchema } from './savings-first-card-checkout';

const request = {
  goalId: '00000000-0000-4000-8000-000000000001',
  amountKobo: 12500,
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
  intentId: '00000000-0000-4000-8000-000000000003',
};

it('accepts persisted requests and a ready intent with its checkout URL', () => {
  expect(SavingsFirstCardCheckoutSnapshotSchema.parse(request).intentId).toBe(
    request.intentId
  );
  expect(
    SavingsFirstCardCheckoutSnapshotSchema.safeParse({
      ...request,
      status: 'ready',
      authorizationUrl: 'https://checkout.paystack.com/token123',
    }).success
  ).toBe(true);
});

it('rejects stale URLs on pending states and ready states without a URL', () => {
  expect(
    SavingsFirstCardCheckoutSnapshotSchema.safeParse({
      ...request,
      status: 'pending',
      authorizationUrl: 'https://checkout.paystack.com/token123',
    }).success
  ).toBe(false);
  expect(
    SavingsFirstCardCheckoutSnapshotSchema.safeParse({
      ...request,
      status: 'ready',
    }).success
  ).toBe(false);
});
