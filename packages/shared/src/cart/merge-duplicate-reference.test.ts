import { describe, expect, it } from 'vitest';
import { planCartMerge } from './merge';
import type { CartLine, CartSnapshot } from './types';

const TECNO = '33333333-3333-4333-8333-333333333333';

function line(quantity: number): CartLine {
  return {
    id: 'stored-line-1',
    item: { productId: TECNO },
    lineTotalMinor: 2500 * quantity,
    quantity,
    unitPriceMinor: 2500,
  };
}

function snapshot(lines: CartLine[]): CartSnapshot {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    currency: 'NGN',
    estimatedTotals: false,
    expiresAt: '2026-10-19T04:00:00Z',
    lines,
    merchantId: '11111111-1111-4111-8111-111111111111',
    state: 'active',
    subtotalMinor: 0,
    totalMinor: 0,
    version: 1,
  };
}

describe('planCartMerge handoff references', () => {
  it('coalesces the same stored line presented on both sides', () => {
    const result = planCartMerge(snapshot([line(2)]), snapshot([line(2)]), [], {
      handoffReferences: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.lines).toHaveLength(1);
  });

  it('rejects a repeated line id differing only in attachments', () => {
    const withVoucher = {
      ...line(2),
      voucherToken: 'voucher-one',
      voucherAwardId: 'dddddddd-3000-4000-8000-000000000001',
    };
    const result = planCartMerge(
      snapshot([line(2)]),
      snapshot([withVoucher]),
      [],
      { handoffReferences: true }
    );
    expect(result).toMatchObject({
      code: 'merge_conflict',
      ok: false,
      reason: 'duplicate_identity',
    });
    const withNegotiation = {
      ...line(2),
      negotiatedUnitPriceMinor: 2000,
      negotiationStatus: 'accepted' as const,
    };
    const second = planCartMerge(
      snapshot([line(2)]),
      snapshot([withNegotiation]),
      [],
      { handoffReferences: true }
    );
    expect(second).toMatchObject({ ok: false, reason: 'duplicate_identity' });
  });

  it('rejects a repeated line id with different content', () => {
    const result = planCartMerge(snapshot([line(2)]), snapshot([line(5)]), [], {
      handoffReferences: true,
    });
    expect(result).toMatchObject({
      code: 'merge_conflict',
      ok: false,
      reason: 'duplicate_identity',
    });
  });
});
