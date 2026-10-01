import { describe, expect, it } from 'vitest';
import {
  getDvaReservationFailureResponse,
  getDvaReservationProofFailureResponse,
} from './generate-dva-reservation-response';

describe('getDvaReservationProofFailureResponse', () => {
  it('returns a stable persistence failure response', async () => {
    const response = getDvaReservationProofFailureResponse();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      code: 'PAYMENT_ACCOUNT_PERSIST_FAILED',
      error: 'Failed to save automatic confirmation account',
    });
  });
});

describe('getDvaReservationFailureResponse', () => {
  it.each([
    ['conflict', null],
    ['wallet_conflict', null],
    [null, { message: 'PAYSTACK_DVA_ALIAS_CONFLICT' }],
  ] as const)('returns an alias conflict for %s', async (reservation, error) => {
    const response = getDvaReservationFailureResponse(reservation, error);

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({
      code: 'PAYSTACK_DVA_IN_USE',
    });
  });

  it.each([
    ['ineligible', 'ORDER_NOT_ELIGIBLE_FOR_DVA'],
    ['customer_changed', 'ORDER_CUSTOMER_CHANGED'],
  ] as const)('maps %s to %s', async (reservation, code) => {
    const response = getDvaReservationFailureResponse(reservation, null);

    expect(response?.status).toBe(409);
    await expect(response?.json()).resolves.toMatchObject({ code });
  });

  it('returns null when reservation can continue', () => {
    expect(getDvaReservationFailureResponse('inserted', null)).toBeNull();
  });
});
