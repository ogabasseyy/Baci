import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  GOAL_CANCEL_MAX_AMOUNT_KOBO,
  piggyvestGoalCancelSchemas as schemas,
} from './piggyvest-goal-cancel';

const merchantId = '11111111-1111-4111-8111-111111111111';
const goalId = '22222222-2222-4222-8222-222222222222';
const operationId = '33333333-3333-4333-8333-333333333333';
const pinProof = createHash('sha256').update('s6-schema-proof').digest('hex');
const reservation = {
  operationId,
  goalId,
  sourceWalletId: 'goal-wallet',
  destinationWalletId: 'main-wallet',
  reference: `pvb-cancel-${goalId}`,
  businessId: 'business',
  providerCustomerId: 'customer',
};
const wallet = {
  id: 'wallet',
  api_customer_id: 'customer',
  business_id: 'business',
  currency: 'NGN',
  status: 'active',
  balance: 100,
};

it('accepts the two request steps and nothing else', () => {
  expect(
    schemas.httpRequest.safeParse({ step: 'issue', merchantId, goalId }).success
  ).toBe(true);
  expect(
    schemas.httpRequest.safeParse({
      step: 'submit',
      merchantId,
      goalId,
      operationId,
      pinProof,
    }).success
  ).toBe(true);
});

it.each([
  [{ step: 'issue', merchantId, goalId, extra: 1 }],
  [{ step: 'issue', merchantId }],
  [{ step: 'issue', merchantId, goalId: 'not-a-uuid' }],
  [{ step: 'submit', merchantId, goalId, operationId }],
  [{ step: 'submit', merchantId, goalId, operationId, pinProof: 'short' }],
  [
    {
      step: 'submit',
      merchantId,
      goalId,
      operationId,
      pinProof: pinProof.toUpperCase(),
    },
  ],
  [{ step: 'complete', merchantId, goalId }],
  [{ merchantId, goalId }],
])('rejects the malformed request %j', (body) => {
  expect(schemas.httpRequest.safeParse(body).success).toBe(false);
});

it('requires both ids in a status request and refuses extra fields', () => {
  expect(
    schemas.statusRequest.safeParse({ merchantId, operationId }).success
  ).toBe(true);
  expect(schemas.statusRequest.safeParse({ merchantId }).success).toBe(false);
  expect(
    schemas.statusRequest.safeParse({ merchantId, operationId, goalId }).success
  ).toBe(false);
});

it('bounds the dispatch amount to the shared ceiling', () => {
  expect(schemas.amountKobo.safeParse(1).success).toBe(true);
  expect(
    schemas.amountKobo.safeParse(GOAL_CANCEL_MAX_AMOUNT_KOBO).success
  ).toBe(true);
  for (const bad of [0, -1, 1.5, GOAL_CANCEL_MAX_AMOUNT_KOBO + 1, '5', null])
    expect(schemas.amountKobo.safeParse(bad).success).toBe(false);
});

it('treats a reservation as a strict object and a dispatched one as needing an amount', () => {
  expect(schemas.reservation.safeParse(reservation).success).toBe(true);
  expect(
    schemas.reservation.safeParse({ ...reservation, amountKobo: 5 }).success
  ).toBe(false);
  expect(schemas.dispatchedReservation.safeParse(reservation).success).toBe(
    false
  );
  expect(
    schemas.dispatchedReservation.safeParse({ ...reservation, amountKobo: 5 })
      .success
  ).toBe(true);
  expect(
    schemas.dispatchedReservation.safeParse({
      ...reservation,
      amountKobo: GOAL_CANCEL_MAX_AMOUNT_KOBO + 1,
    }).success
  ).toBe(false);
  const { businessId: _business, ...withoutBusiness } = reservation;
  expect(schemas.reservation.safeParse(withoutBusiness).success).toBe(false);
});

it('binds a provider wallet to an active NGN wallet with a whole non-negative balance', () => {
  expect(schemas.wallet.safeParse(wallet).success).toBe(true);
  expect(schemas.wallet.safeParse({ ...wallet, balance: 0 }).success).toBe(
    true
  );
  for (const bad of [
    { ...wallet, balance: -1 },
    { ...wallet, balance: 1.5 },
    { ...wallet, currency: 'USD' },
    { ...wallet, status: 'frozen' },
    { ...wallet, api_customer_id: undefined },
    { ...wallet, business_id: undefined },
  ])
    expect(schemas.wallet.safeParse(bad).success).toBe(false);
});

it('accepts only the documented database answers', () => {
  expect(
    schemas.issueRows.safeParse([
      { result: { status: 'issued', operationId, expiresAt: 'soon' } },
    ]).success
  ).toBe(true);
  expect(
    schemas.issueRows.safeParse([{ result: { status: 'busy' } }]).success
  ).toBe(true);
  expect(
    schemas.issueRows.safeParse([{ result: { status: 'issued', operationId } }])
      .success
  ).toBe(false);
  expect(
    schemas.issueRows.safeParse([{ result: { status: 'needs_review' } }])
      .success
  ).toBe(true);
  expect(
    schemas.reservationRows.safeParse([{ result: { status: 'needs_review' } }])
      .success
  ).toBe(true);
  expect(schemas.issueRows.safeParse([]).success).toBe(false);
  expect(
    schemas.reservationRows.safeParse([
      { result: { status: 'pin_refused', reason: 'used' } },
    ]).success
  ).toBe(true);
  expect(
    schemas.reservationRows.safeParse([
      { result: { status: 'pin_refused', reason: 'other' } },
    ]).success
  ).toBe(false);
  expect(
    schemas.reservationRows.safeParse([{ result: { status: 'released' } }])
      .success
  ).toBe(false);
  expect(schemas.statusRows.safeParse([{ result: 'dispatched' }]).success).toBe(
    true
  );
  expect(schemas.statusRows.safeParse([{ result: null }]).success).toBe(true);
  expect(schemas.statusRows.safeParse([{ result: 'cancelled' }]).success).toBe(
    false
  );
  expect(schemas.acknowledgement.safeParse([{ result: true }]).success).toBe(
    true
  );
  expect(schemas.acknowledgement.safeParse([{ result: 'yes' }]).success).toBe(
    false
  );
  expect(schemas.referenceMatch.safeParse({ operationId }).success).toBe(true);
  expect(
    schemas.referenceMatch.safeParse({ operationId, extra: 1 }).success
  ).toBe(false);
});

it('reads the review states the database records, and nothing else', () => {
  for (const result of ['needs_review', 'reviewed'])
    expect(schemas.statusRows.safeParse([{ result }]).success).toBe(true);
  expect(schemas.statusRows.safeParse([{ result: 'review' }]).success).toBe(
    false
  );
});
