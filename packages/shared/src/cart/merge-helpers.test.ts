import { describe, expect, it } from 'vitest';
import {
  attachmentsEqual,
  attachmentsOf,
  conflictAttachmentsOf,
  hasVoucher,
  planHandoffReferenceMerge,
} from './merge-helpers';
import type { CartLine, CartSnapshot } from './types';

function makeLine(overrides: Partial<CartLine> = {}): CartLine {
  return {
    id: 'line-1',
    item: { productId: 'prod-1' },
    quantity: 2,
    unitPriceMinor: 5000,
    lineTotalMinor: 10000,
    ...overrides,
  };
}

function makeSnapshot(lines: CartLine[]): CartSnapshot {
  return {
    cartId: 'cart-1',
    merchantId: 'merchant-1',
    state: 'active',
    version: 1,
    lines,
    currency: 'NGN',
    subtotalMinor: 10000,
    totalMinor: 10000,
    estimatedTotals: false,
    expiresAt: '2026-10-19T00:00:00.000Z',
  };
}

describe('merge-helpers', () => {
  it('extracts and redacts voucher tokens in conflict attachments', () => {
    const line = makeLine({
      voucherAwardId: 'award-1',
      voucherToken: 'secret-token',
      negotiatedUnitPriceMinor: 4000,
      negotiationStatus: 'accepted',
    });

    const full = attachmentsOf(line);
    expect(full.voucherToken).toBe('secret-token');
    expect(hasVoucher(full)).toBe(true);

    const redacted = conflictAttachmentsOf(line);
    expect(redacted.voucherToken).toBeUndefined();
    expect(redacted.voucherAwardId).toBe('award-1');
    expect(hasVoucher(redacted)).toBe(false);
    expect(attachmentsEqual(full, { ...full })).toBe(true);
    expect(attachmentsEqual(full, redacted)).toBe(false);
  });

  it('plans handoff reference merges and rejects duplicate conflicting line IDs', () => {
    const lineA = makeLine({ id: 'line-1', quantity: 1 });
    const lineAConflict = makeLine({ id: 'line-1', quantity: 3 });
    const lineB = makeLine({
      id: 'line-2',
      item: { productId: 'prod-2' },
      hasAssurance: true,
    });

    expect(
      planHandoffReferenceMerge(makeSnapshot([lineA]), makeSnapshot([lineB]))
    ).toEqual({
      ok: true,
      lines: [
        { sourceLineId: 'line-1', item: { productId: 'prod-1' }, quantity: 1 },
        {
          sourceLineId: 'line-2',
          item: { productId: 'prod-2' },
          quantity: 2,
          hasAssurance: true,
        },
      ],
    });

    expect(
      planHandoffReferenceMerge(
        makeSnapshot([lineA]),
        makeSnapshot([lineAConflict])
      )
    ).toEqual({
      ok: false,
      code: 'merge_conflict',
      reason: 'duplicate_identity',
      conflicts: [
        {
          item: { productId: 'prod-1' },
          existing: { quantity: 1 },
          incoming: { quantity: 3 },
        },
      ],
    });
  });
});
