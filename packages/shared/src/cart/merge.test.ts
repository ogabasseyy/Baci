import { describe, expect, it } from 'vitest';
import { planCartMerge } from './merge';
import type { CartLine, CartLineAttachments, CartSnapshot } from './types';

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
    const awardId = '66666666-6666-4666-8666-666666666666';
    const result = planCartMerge(
      snapshot([line(TECNO, 2)]),
      snapshot([
        line(TECNO, 1, { voucherToken: 'tok-A', voucherAwardId: awardId }),
      ]),
      [{ item: { productId: TECNO }, keep: 'incoming' }]
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines).toEqual([
        expect.objectContaining({ quantity: 1, voucherToken: 'tok-A' }),
      ]);
    }
  });

  it('keeps quantity for partial voucher pairs', () => {
    const awardId = '66666666-6666-4666-8666-666666666666';
    for (const attachments of [
      { voucherToken: 'tok-only' },
      { voucherAwardId: awardId },
    ]) {
      const result = planCartMerge(
        snapshot([line(TECNO, 3, attachments)]),
        snapshot([line(CHARGER, 1)])
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.lines).toContainEqual(
          expect.objectContaining({
            item: { productId: TECNO },
            quantity: 3,
          })
        );
      }
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
it('preserves attachment-distinct voucher identities already present in one cart', () => {
  const result = planCartMerge(
    snapshot([
      line(TECNO, 1, { voucherAwardId: 'award-a' }),
      line(TECNO, 1, { voucherAwardId: 'award-b' }),
    ]),
    snapshot([])
  );
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.lines.map((line) => line.voucherAwardId)).toEqual([
      'award-a',
      'award-b',
    ]);
});

it('preserves regular and voucher siblings across both carts with max quantities', () => {
  const result = planCartMerge(
    snapshot([line(TECNO, 2), line(TECNO, 1, { voucherAwardId: 'award-a' })]),
    snapshot([
      line(TECNO, 3),
      line(TECNO, 1, { voucherAwardId: 'award-a' }),
      line(TECNO, 1, { voucherAwardId: 'award-b' }),
    ])
  );
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.lines.map((line) => line.quantity)).toEqual([3, 1, 1]);
});
it('keeps sibling lanes intact when a base-item resolution is supplied', () => {
  const result = planCartMerge(
    snapshot([line(TECNO, 2), line(TECNO, 1, { voucherAwardId: 'award-a' })]),
    snapshot([
      line(TECNO, 3),
      line(TECNO, 1, { voucherAwardId: 'award-a' }),
      line(TECNO, 1, { voucherAwardId: 'award-b' }),
    ]),
    [{ item: { productId: TECNO }, keep: 'incoming' }]
  );
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.lines).toHaveLength(3);
    expect(result.lines.map((entry) => entry.quantity)).toEqual([3, 1, 1]);
    expect(result.lines.map((entry) => entry.voucherAwardId ?? null)).toEqual([
      null,
      'award-a',
      'award-b',
    ]);
  }
});
it('preserves assurance for a disjoint import and overlapping identical contexts', () => {
  const a = line(TECNO, 1);
  a.hasAssurance = true;
  const result = planCartMerge(snapshot([line(TECNO, 2)]), snapshot([a]));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.lines[0].hasAssurance).toBe(true);
});
it('preserves redacted handoff siblings as opaque references without leaking attachments', () => {
  const existing = snapshot([{ ...line(TECNO, 2), id: 'dest-ordinary' }]);
  const incoming = snapshot([
    { ...line(TECNO, 1), id: 'source-ordinary' },
    { ...line(TECNO, 1), id: 'source-voucher' },
  ]);
  const planned = planCartMerge(existing, incoming, [], {
    handoffReferences: true,
  });
  expect(planned).toEqual({
    ok: true,
    lines: [
      {
        sourceLineId: 'dest-ordinary',
        item: { productId: TECNO },
        quantity: 2,
      },
      {
        sourceLineId: 'source-ordinary',
        item: { productId: TECNO },
        quantity: 1,
      },
      {
        sourceLineId: 'source-voucher',
        item: { productId: TECNO },
        quantity: 1,
      },
    ],
  });
});
it('allows forty stored handoff references before server-side lane coalescing', () => {
  const make = (side: string) =>
    Array.from({ length: 20 }, (_, index) => ({
      ...line(TECNO, 1),
      id: `${side}-${index}`,
    }));
  const planned = planCartMerge(
    snapshot(make('dest')),
    snapshot(make('source')),
    [],
    { handoffReferences: true }
  );
  expect(planned.ok && planned.lines).toHaveLength(40);
  expect(
    planCartMerge(snapshot([line(TECNO, 1)]), snapshot([]))
  ).not.toHaveProperty('lines.0.sourceLineId');
});

it('rejects a handoff whose minimum distinct item count already exceeds twenty', () => {
  const make = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...line(
        `00000000-0000-4000-8000-${String(start + i).padStart(12, '0')}`,
        1
      ),
      id: `stored-${start + i}`,
    }));
  expect(
    planCartMerge(snapshot(make(0, 11)), snapshot(make(11, 10)), [], {
      handoffReferences: true,
    })
  ).toEqual({ ok: false, code: 'too_many_lines', lineCount: 21 });
});
it('allows forty handoff references with twenty normalized item identities', () => {
  const make = (side: string) =>
    Array.from({ length: 20 }, (_, i) => ({
      ...line(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 1),
      id: `${side}-${i}`,
    }));
  const planned = planCartMerge(
    snapshot(make('dest')),
    snapshot(make('source')),
    [],
    { handoffReferences: true }
  );
  expect(planned.ok && planned.lines).toHaveLength(40);
});
