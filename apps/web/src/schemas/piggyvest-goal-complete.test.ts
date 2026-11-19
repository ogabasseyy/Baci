import { describe, expect, it } from 'vitest';
import {
  GOAL_COMPLETE_MAX_AMOUNT_KOBO,
  piggyvestGoalCompleteSchemas as schemas,
} from './piggyvest-goal-complete';

const id = (n: number) =>
  `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;

describe('goal complete http request', () => {
  it('accepts the issue step and the submit step with a PIN proof', () => {
    expect(
      schemas.httpRequest.safeParse({
        step: 'issue',
        merchantId: id(1),
        goalId: id(2),
      }).success
    ).toBe(true);
    expect(
      schemas.httpRequest.safeParse({
        step: 'submit',
        merchantId: id(1),
        goalId: id(2),
        operationId: id(3),
        pinProof: 'a'.repeat(64),
      }).success
    ).toBe(true);
  });

  it.each([
    { step: 'submit', merchantId: id(1), goalId: id(2), operationId: id(3) },
    {
      step: 'submit',
      merchantId: id(1),
      goalId: id(2),
      pinProof: 'a'.repeat(64),
    },
    { step: 'issue', merchantId: id(1), goalId: id(2), amountKobo: 5 },
    { step: 'issue', merchantId: id(1) },
    {
      step: 'submit',
      merchantId: id(1),
      goalId: id(2),
      operationId: id(3),
      pinProof: 'short',
    },
  ])('refuses a malformed request %#', (body) => {
    expect(schemas.httpRequest.safeParse(body).success).toBe(false);
  });
});

describe('goal complete database answers', () => {
  it('knows the eligibility and settled answers at issue', () => {
    for (const result of [
      { status: 'issued', operationId: id(3), expiresAt: 'soon' },
      { status: 'pending', operationId: id(3) },
      { status: 'confirmed', operationId: id(3) },
      { status: 'busy' },
      { status: 'needs_review' },
      { status: 'not_eligible' },
    ])
      expect(schemas.issueRows.safeParse([{ result }]).success).toBe(true);
    expect(
      schemas.issueRows.safeParse([{ result: { status: 'released' } }]).success
    ).toBe(false);
    expect(schemas.issueRows.safeParse([]).success).toBe(false);
  });

  it('knows not_eligible at reservation and still refuses unknown answers', () => {
    expect(
      schemas.reservationRows.safeParse([
        { result: { status: 'not_eligible' } },
      ]).success
    ).toBe(true);
    expect(
      schemas.reservationRows.safeParse([{ result: { status: 'maybe' } }])
        .success
    ).toBe(false);
  });

  it('parses the purchase request alert row strictly', () => {
    expect(
      schemas.purchaseAlert.safeParse({ requestId: id(4), operationId: id(3) })
        .success
    ).toBe(true);
    expect(
      schemas.purchaseAlert.safeParse({
        requestId: id(4),
        operationId: id(3),
        customer: 'x',
      }).success
    ).toBe(false);
  });
});

describe('goal complete limits', () => {
  it('shares the ledger ceiling with cancel', () => {
    expect(GOAL_COMPLETE_MAX_AMOUNT_KOBO).toBe(9999999999);
    expect(schemas.amountKobo.safeParse(9999999999).success).toBe(true);
    expect(schemas.amountKobo.safeParse(10000000000).success).toBe(false);
    expect(schemas.amountKobo.safeParse(0).success).toBe(false);
  });
});
