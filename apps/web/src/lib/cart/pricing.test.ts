import { describe, expect, it } from 'vitest';
import { buildCartSnapshot } from './pricing';
import type { RawCartLine, RawCartState } from './repository';

function line(overrides: Partial<RawCartLine> = {}): RawCartLine {
  return {
    assuranceRate: null,
    available: true,
    condition: null,
    hasAssurance: false,
    id: 'line-1',
    manageStock: true,
    negotiatedUnitPriceMinor: null,
    negotiationInvalidated: false,
    negotiationStatus: null,
    options: {},
    productId: '33333333-3333-4333-8333-333333333333',
    quantity: 2,
    stockQty: 10,
    unitPriceMinor: 2500,
    variantId: null,
    voucherAwardId: null,
    voucherToken: null,
    ...overrides,
  };
}

function raw(lines: RawCartLine[] = [line()]): RawCartState {
  return {
    cartId: '22222222-2222-4222-8222-222222222222',
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines,
    merchantId: '11111111-1111-4111-8111-111111111111',
    replayed: false,
    state: 'active',
    version: 3,
  };
}

describe('buildCartSnapshot', () => {
  it('computes integer minor-unit totals from committed lines', () => {
    const { snapshot, warnings } = buildCartSnapshot(
      raw([line({ quantity: 2, unitPriceMinor: 2500 })])
    );

    expect(snapshot.cartId).toBe('22222222-2222-4222-8222-222222222222');
    expect(snapshot.version).toBe(3);
    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.lines[0].lineTotalMinor).toBe(5000);
    expect(snapshot.subtotalMinor).toBe(5000);
    expect(snapshot.totalMinor).toBe(5000);
    expect(snapshot.estimatedTotals).toBe(false);
    expect(warnings).toEqual([]);
  });

  it('excludes access credentials and buyer records from the snapshot', () => {
    const { snapshot } = buildCartSnapshot(raw());

    expect(JSON.stringify(snapshot)).not.toContain('guest-a1');
    expect('principalId' in snapshot).toBe(false);
  });

  it('uses a valid negotiated unit price over the catalog price', () => {
    const { snapshot } = buildCartSnapshot(
      raw([
        line({
          negotiatedUnitPriceMinor: 2000,
          negotiationStatus: 'accepted',
          quantity: 1,
          unitPriceMinor: 2500,
        }),
      ])
    );

    expect(snapshot.lines[0].lineTotalMinor).toBe(2000);
    expect(snapshot.totalMinor).toBe(2000);
  });

  it('warns and reprices when the service invalidated a negotiation', () => {
    const { snapshot, warnings } = buildCartSnapshot(
      raw([
        line({
          negotiatedUnitPriceMinor: null,
          negotiationInvalidated: true,
          quantity: 1,
          unitPriceMinor: 2500,
        }),
      ])
    );

    expect(snapshot.lines[0].lineTotalMinor).toBe(2500);
    expect(snapshot.estimatedTotals).toBe(true);
    expect(warnings).toContainEqual({
      code: 'negotiation_invalidated',
      lineId: 'line-1',
      message: expect.any(String),
    });
  });

  it('prices voucher lines at zero while keeping their identity', () => {
    const { snapshot } = buildCartSnapshot(
      raw([
        line({
          quantity: 1,
          unitPriceMinor: 2500,
          voucherAwardId: 'award-1',
          voucherToken: 'token-1',
        }),
      ])
    );

    expect(snapshot.lines[0].lineTotalMinor).toBe(0);
    expect(snapshot.lines[0].voucherAwardId).toBe('award-1');
    expect(snapshot.totalMinor).toBe(0);
  });

  it('flags unavailable lines with stale totals instead of dropping them', () => {
    const { snapshot, warnings } = buildCartSnapshot(
      raw([line({ available: false, quantity: 1, unitPriceMinor: 2500 })])
    );

    expect(snapshot.lines).toHaveLength(1);
    expect(snapshot.estimatedTotals).toBe(true);
    expect(warnings).toContainEqual({
      code: 'unavailable_line',
      lineId: 'line-1',
      message: expect.any(String),
    });
  });

  it('warns on out-of-stock lines without blocking the snapshot', () => {
    const { snapshot, warnings } = buildCartSnapshot(
      raw([line({ manageStock: true, quantity: 1, stockQty: 0 })])
    );

    expect(snapshot.lines[0].lineTotalMinor).toBe(2500);
    expect(warnings).toContainEqual({
      code: 'out_of_stock',
      lineId: 'line-1',
      message: expect.any(String),
    });
  });

  it('sums multiple lines and keeps an empty cart active with zero totals', () => {
    const multi = buildCartSnapshot(
      raw([
        line({ id: 'line-1', quantity: 1, unitPriceMinor: 1000 }),
        line({ id: 'line-2', quantity: 3, unitPriceMinor: 500 }),
      ])
    );
    expect(multi.snapshot.totalMinor).toBe(2500);

    const empty = buildCartSnapshot(raw([]));
    expect(empty.snapshot.state).toBe('active');
    expect(empty.snapshot.totalMinor).toBe(0);
    expect(empty.warnings).toEqual([]);
  });
});

describe('pending and rejected negotiations', () => {
  it('prices pending and rejected proposals at catalog, never at the proposal', () => {
    for (const negotiationStatus of ['pending', 'rejected'] as const) {
      const { snapshot } = buildCartSnapshot(
        raw([
          line({
            negotiatedUnitPriceMinor: 2000,
            negotiationStatus,
            quantity: 2,
            unitPriceMinor: 2500,
          }),
        ])
      );

      expect(snapshot.lines[0].lineTotalMinor).toBe(5000);
      expect(snapshot.totalMinor).toBe(5000);
    }
  });
});

it('drops an accepted negotiation invalidated by a catalog change', () => {
  const result = buildCartSnapshot(
    raw([
      line({
        negotiationStatus: 'accepted',
        negotiatedUnitPriceMinor: 2000,
        negotiationInvalidated: true,
        unitPriceMinor: 3000,
        quantity: 2,
      }),
    ])
  );
  expect(result.snapshot.totalMinor).toBe(6000);
  expect(result.snapshot.lines[0].negotiatedUnitPriceMinor).toBeUndefined();
});
