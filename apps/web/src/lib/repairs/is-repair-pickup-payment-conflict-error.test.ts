import { describe, expect, it } from 'vitest';
import { isRepairPickupPaymentConflictError } from './is-repair-pickup-payment-conflict-error';

describe('isRepairPickupPaymentConflictError', () => {
  it('matches the confirm RPC conflict SQLSTATE and message', () => {
    expect(
      isRepairPickupPaymentConflictError({
        code: '23505',
        message: 'repair_pickup_payment_conflict',
      })
    ).toBe(true);
  });

  it('matches when PostgREST wraps the conflict message', () => {
    expect(
      isRepairPickupPaymentConflictError({
        code: '23505',
        message: 'ERROR: repair_pickup_payment_conflict (SQLSTATE 23505)',
      })
    ).toBe(true);
  });

  it('rejects unrelated unique violations', () => {
    expect(
      isRepairPickupPaymentConflictError({
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      })
    ).toBe(false);
  });

  it('rejects non-error values', () => {
    expect(isRepairPickupPaymentConflictError(null)).toBe(false);
    expect(isRepairPickupPaymentConflictError(undefined)).toBe(false);
  });
});
