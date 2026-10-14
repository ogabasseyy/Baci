import type {
  CartLine,
  CartLineAttachments,
  CartSnapshot,
} from '@baci/shared/cart';
import { describe, expect, it } from 'vitest';
import { planCartMerge } from './merge';

const TECNO = '33333333-3333-4333-8333-333333333333';
const CHARGER = '44444444-4444-4444-8444-444444444444';
const CAMERA = '55555555-5555-4555-8555-555555555555';

function line(
  productId: string,
  quantity: number,
  attachments: CartLineAttachments = {}
): CartLine {
  return {
    id: `${productId}:new:`,
    item: { productId },
    lineTotalMinor: 2500 * quantity,
    quantity,
    unitPriceMinor: 2500,
    ...attachments,
  };
}

function snapshot(lines: CartLine[], version = 1): CartSnapshot {
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
    version,
  };
}

describe('planCartMerge', () => {
  it('unions disjoint lines without touching quantities', () => {
    const result = planCartMerge(
      snapshot([line(TECNO, 1)]),
      snapshot([line(CHARGER, 1), line(CAMERA, 2)])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toHaveLength(3);
      expect(result.lines).toContainEqual(
        expect.objectContaining({
          item: { productId: CAMERA },
          quantity: 2,
        })
      );
    }
  });

  it('takes the max quantity for lines present on both sides', () => {
    const result = planCartMerge(
      snapshot([line(TECNO, 1)]),
      snapshot([line(TECNO, 3)])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toEqual([
        expect.objectContaining({
          item: { productId: TECNO },
          quantity: 3,
        }),
      ]);
    }
  });

  it('is idempotent under repeated import', () => {
    const first = planCartMerge(
      snapshot([line(TECNO, 1)]),
      snapshot([line(TECNO, 3), line(CHARGER, 1)])
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const merged = snapshot(
      first.lines.map((entry) => line(entry.item.productId, entry.quantity)),
      2
    );
    const second = planCartMerge(
      merged,
      snapshot([line(TECNO, 3), line(CHARGER, 1)])
    );

    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.lines).toHaveLength(2);
      expect(second.lines).toContainEqual(
        expect.objectContaining({
          item: { productId: TECNO },
          quantity: 3,
        })
      );
    }
  });

  it('carries one-sided attachments into the union', () => {
    const result = planCartMerge(
      snapshot([line(TECNO, 1)]),
      snapshot([
        line(CHARGER, 1, {
          negotiatedUnitPriceMinor: 1200,
          negotiationStatus: 'accepted',
        }),
      ])
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toContainEqual(
        expect.objectContaining({
          item: { productId: CHARGER },
          negotiatedUnitPriceMinor: 1200,
          negotiationStatus: 'accepted',
        })
      );
    }
  });

  it('requires a choice for conflicting negotiation contexts', () => {
    const existing = snapshot([
      line(TECNO, 1, {
        negotiatedUnitPriceMinor: 22000,
        negotiationStatus: 'accepted',
      }),
    ]);
    const incoming = snapshot([
      line(TECNO, 1, {
        negotiatedUnitPriceMinor: 20000,
        negotiationStatus: 'accepted',
      }),
    ]);

    const conflicted = planCartMerge(existing, incoming);
    expect(conflicted.ok).toBe(false);
    if (!conflicted.ok && conflicted.code === 'merge_conflict') {
      expect(conflicted.conflicts).toHaveLength(1);
      expect(conflicted.conflicts[0]?.existing.negotiatedUnitPriceMinor).toBe(
        22000
      );
      expect(conflicted.conflicts[0]?.incoming.negotiatedUnitPriceMinor).toBe(
        20000
      );
    } else {
      expect.unreachable('expected a merge conflict');
    }

    const resolved = planCartMerge(existing, incoming, [
      { item: { productId: TECNO }, keep: 'incoming' },
    ]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.lines).toEqual([
        expect.objectContaining({ negotiatedUnitPriceMinor: 20000 }),
      ]);
    }
  });

  it('requires a choice for conflicting voucher contexts', () => {
    const existing = snapshot([line(TECNO, 1, { voucherToken: 'tok-B' })]);
    const incoming = snapshot([line(TECNO, 1, { voucherToken: 'tok-A' })]);

    const conflicted = planCartMerge(existing, incoming);
    expect(conflicted.ok).toBe(false);
    expect(conflicted).toMatchObject({ code: 'merge_conflict' });

    const resolved = planCartMerge(existing, incoming, [
      { item: { productId: TECNO }, keep: 'existing' },
    ]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.lines).toEqual([
        expect.objectContaining({ quantity: 1, voucherToken: 'tok-B' }),
      ]);
    }
  });

  it('pins voucher merges to quantity one', () => {
    const result = planCartMerge(
      snapshot([line(TECNO, 2)]),
      snapshot([line(TECNO, 1, { voucherToken: 'tok-A' })]),
      [{ item: { productId: TECNO }, keep: 'incoming' }]
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toEqual([
        expect.objectContaining({ quantity: 1, voucherToken: 'tok-A' }),
      ]);
    }
  });

  it('rejects unions beyond the line cap', () => {
    const existingLines = Array.from({ length: 20 }, (_, index) =>
      line(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, 1)
    );
    const result = planCartMerge(
      snapshot(existingLines),
      snapshot([line(TECNO, 1)])
    );

    expect(result).toMatchObject({ code: 'too_many_lines', ok: false });
  });

  it('merges two empty carts to an empty union', () => {
    const result = planCartMerge(snapshot([]), snapshot([]));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toEqual([]);
    }
  });
});
it('never silently drops duplicate voucher identities already present in one cart', () => {
  const result = planCartMerge(
    snapshot([
      line(TECNO, 1, { voucherAwardId: 'award-a' }),
      line(TECNO, 1, { voucherAwardId: 'award-b' }),
    ]),
    snapshot([])
  );
  expect(result.ok).toBe(false);
});
