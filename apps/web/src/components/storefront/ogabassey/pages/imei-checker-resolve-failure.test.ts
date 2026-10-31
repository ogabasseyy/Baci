import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMEI_CHECK_ERROR_MESSAGE,
  resolveImeiCheckFailure,
} from './imei-checker-resolve-failure';

const baseInput = {
  currentTierPrice: 1500,
  walletBalance: 500,
};

describe('resolveImeiCheckFailure', () => {
  it('signals a login redirect on 401 with no error message', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { error: 'Unauthorized' },
      responseStatus: 401,
    });

    expect(outcome.shouldRedirectToLogin).toBe(true);
    expect(outcome.errorMessage).toBeNull();
    expect(outcome.shouldClearIdempotencyKey).toBe(false);
  });

  it('computes the top-up shortfall on 402 with no error message', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { balance: 500, required: 1500 },
      responseStatus: 402,
    });

    expect(outcome.errorMessage).toBeNull();
    expect(outcome.topUpAmount).toBe(1000);
  });

  it('falls back to currentTierPrice/walletBalance when the payload omits balance/required', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: {},
      responseStatus: 402,
    });

    expect(outcome.topUpAmount).toBe(1000);
  });

  it('surfaces a sign-in message on 404 CUSTOMER_NOT_FOUND', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { code: 'CUSTOMER_NOT_FOUND', error: 'not found' },
      responseStatus: 404,
    });

    expect(outcome.errorMessage).toContain('sign in');
  });

  it('surfaces a refund-pending message and marks the wallet for refetch on 502 REFUND_PENDING', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { code: 'REFUND_PENDING' },
      responseStatus: 502,
    });

    expect(outcome.errorMessage).toContain('refund is pending');
    expect(outcome.shouldRefetchWallet).toBe(true);
    expect(outcome.shouldPreserveIdempotencyKey).toBe(true);
  });

  it('surfaces a refunded message for SICKW_NOT_FOUND (404) and SICKW_UNAVAILABLE (502)', () => {
    const notFound = resolveImeiCheckFailure({
      ...baseInput,
      payload: { code: 'SICKW_NOT_FOUND' },
      responseStatus: 404,
    });
    const unavailable = resolveImeiCheckFailure({
      ...baseInput,
      payload: { code: 'SICKW_UNAVAILABLE' },
      responseStatus: 502,
    });

    expect(notFound.errorMessage).toContain('refunded');
    expect(unavailable.errorMessage).toContain('refunded');
    expect(notFound.shouldRefetchWallet).toBe(true);
  });

  it('preserves the idempotency key for unresolved state-save-failed codes', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { code: 'DEBIT_FAILURE_STATE_SAVE_FAILED' },
      responseStatus: 500,
    });

    expect(outcome.shouldPreserveIdempotencyKey).toBe(true);
    expect(outcome.shouldClearIdempotencyKey).toBe(false);
  });

  it('falls back to the default message for an unrecognized terminal failure', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: {},
      responseStatus: 500,
    });

    expect(outcome.errorMessage).toBe(DEFAULT_IMEI_CHECK_ERROR_MESSAGE);
  });

  it('uses the payload error message when present for an unrecognized failure', () => {
    const outcome = resolveImeiCheckFailure({
      ...baseInput,
      payload: { error: 'Custom upstream error' },
      responseStatus: 500,
    });

    expect(outcome.errorMessage).toBe('Custom upstream error');
  });
});

it('retains the retry key after an unexpected server error', () => {
  const outcome = resolveImeiCheckFailure({
    currentTierPrice: 500,
    walletBalance: 1000,
    payload: { code: 'INTERNAL_ERROR' },
    responseStatus: 500,
  });
  expect(outcome.shouldPreserveIdempotencyKey).toBe(true);
  expect(outcome.shouldClearIdempotencyKey).toBe(false);
});

it('keeps an earlier uncertain key when authentication expires', () => {
  const outcome = resolveImeiCheckFailure({ currentTierPrice: 500, walletBalance: 0, payload: { code: 'AUTH_REQUIRED' }, responseStatus: 401 });
  expect(outcome.shouldPreserveIdempotencyKey).toBe(true);
  expect(outcome.shouldClearIdempotencyKey).toBe(false);
});

it.each([[404, 'PETROCK_REJECTED'], [502, 'PETROCK_REJECTED'], [502, 'PETROCK_UNAVAILABLE']])('retires keys after confirmed Petrock refund %s %s', (responseStatus, code) => {
  const outcome = resolveImeiCheckFailure({ ...baseInput, responseStatus, payload: { code } });
  expect(outcome.shouldClearIdempotencyKey).toBe(true);
  expect(outcome.shouldPreserveIdempotencyKey).toBe(false);
});
