import { expect, it } from 'vitest';
import { partialRefundSnapshotSchema } from './bank-offer-partial-refund-snapshot';

const snapshot = {
  capture: {
    reference: 'BCO-reference',
    id: '9007199254740993',
    domain: 'test',
    amountKobo: 200,
  },
  merchandiseNetKobo: 100,
  allocations: [
    {
      itemId: 'a0000000-0000-4000-8000-000000000001',
      unitNetAmountsKobo: [100, 0],
    },
  ],
};

it('accepts zero-valued units and preserves exact provider IDs', () => {
  expect(partialRefundSnapshotSchema.parse(snapshot)).toEqual(snapshot);
});

it.each([
  null,
  -1,
  1.5,
  Number.MAX_SAFE_INTEGER + 1,
])('rejects an unresolved or invalid capture amount (%s)', (amountKobo) => {
  expect(
    partialRefundSnapshotSchema.safeParse({
      ...snapshot,
      capture: { ...snapshot.capture, amountKobo },
    }).success
  ).toBe(false);
});
