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
