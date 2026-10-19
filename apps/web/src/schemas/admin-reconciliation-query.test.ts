import { describe, expect, it } from 'vitest';
import { adminReconciliationQuerySchema } from './admin-reconciliation-query';

describe('adminReconciliationQuerySchema', () => {
  it('applies bounded, safe defaults', () => {
    expect(
      adminReconciliationQuerySchema.parse({ currency: 'NGN' })
    ).toMatchObject({
      currency: 'NGN',
      format: 'json',
      lane: 'all',
      limit: 50,
      period: '30d',
      status: 'all',
    });
    expect(adminReconciliationQuerySchema.safeParse({}).success).toBe(false);
  });

  it('rejects a partial keyset cursor', () => {
    expect(
      adminReconciliationQuerySchema.safeParse({
        currency: 'NGN',
        cursorAt: '2026-08-05T10:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('rejects an unallowlisted lane and excessive page size', () => {
    expect(
      adminReconciliationQuerySchema.safeParse({
        currency: 'NGN',
        lane: 'payouts',
      }).success
    ).toBe(false);
    expect(
      adminReconciliationQuerySchema.safeParse({
        currency: 'NGN',
        limit: 101,
      }).success
    ).toBe(false);
    expect(
      adminReconciliationQuerySchema.safeParse({ currency: 'ngn' }).success
    ).toBe(false);
    expect(
      adminReconciliationQuerySchema.safeParse({ currency: 'UNK' }).success
    ).toBe(false);
  });
});
