import { expect, it } from 'vitest';
import { purchaseFixture } from '../test-fixtures/piggyvest-purchase';
import { piggyvestPurchaseSchemas as schemas } from './piggyvest-purchase';

it('accepts optional non-authoritative recovery only for the exact historical intent amounts', () => {
  const fixture = purchaseFixture();
  const paymentLegRecovery = {
    completion: 'metadata_only',
    financialEffects: 'UNKNOWN',
    dispatch: 'disabled',
    retry: 'not_authorized',
    compensation: 'not_authorized',
    reasonEvidence: 'reported_unresolved_only',
    historicalObservation: null,
    legs: [
      {
        operationId: fixture.status.operationId,
        leg: 'savings',
        amountKobo: fixture.status.savingsKobo,
      },
      {
        operationId: fixture.status.operationId,
        leg: 'other',
        amountKobo: fixture.status.otherPaymentKobo,
      },
    ].map((leg) => ({
      ...leg,
      referenceType: 'local_intent_leg',
      providerReference: null,
      outcome: leg.amountKobo ? 'unknown' : 'not_required',
      observationCount: 0,
      latestObservation: null,
    })),
  };
  expect(
    schemas.status.safeParse({ ...fixture.status, paymentLegRecovery }).success
  ).toBe(true);
  for (const patch of [
    { operationId: fixture.goalId },
    { savingsKobo: fixture.status.savingsKobo + 1 },
    { otherPaymentKobo: fixture.status.otherPaymentKobo + 1 },
  ])
    expect(
      schemas.status.safeParse({
        ...fixture.status,
        ...patch,
        paymentLegRecovery,
      }).success
    ).toBe(false);
});

it('validates exact quote, explicit choice, history and required current evidence', () => {
  const fixture = purchaseFixture();
  expect(schemas.published.parse(fixture.published)).toEqual(fixture.published);
  expect(schemas.confirmation.parse(fixture.command)).toEqual(fixture.command);
  expect(schemas.status.parse(fixture.status)).toEqual(fixture.status);
  expect(schemas.receipt.safeParse(fixture.status).success).toBe(false);
  expect(schemas.status.safeParse(fixture.receipt).success).toBe(false);
});
it.each([
  { pendingInterestKobo: 1 },
  { totalKobo: 1 },
  { principalKobo: 10000 },
  { currency: 'USD' },
  { quantity: 2 },
  { deliveryKobo: undefined },
  { expiresAt: 'tomorrow' },
])('rejects invented or inconsistent quote fields %j', (patch) => {
  expect(
    schemas.quote.safeParse({ ...purchaseFixture().published.quote, ...patch })
      .success
  ).toBe(false);
});
it('rejects caller authority, unknown mode and implicit consent', () => {
  const fixture = purchaseFixture();
  for (const patch of [
    { actorId: fixture.goalId },
    { accepted: false },
    { fulfilmentMode: 'ship' },
  ])
    expect(
      schemas.confirmation.safeParse({ ...fixture.command, ...patch }).success
    ).toBe(false);
});
it('keeps reconciliation evidence non-postable and pending separate', () => {
  const fixture = purchaseFixture();
  expect(
    schemas.status.safeParse({
      ...fixture.status,
      current: {
        ...fixture.status.current,
        status: 'requires_reconciliation',
        reservation: 'unknown',
        balances: null,
      },
    }).success
  ).toBe(true);
  expect(
    schemas.status.safeParse({
      ...fixture.status,
      current: { ...fixture.status.current, fundsUse: 'withdraw' },
    }).success
  ).toBe(false);
});
