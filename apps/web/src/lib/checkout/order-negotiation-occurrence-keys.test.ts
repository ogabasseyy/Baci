import { describe, expect, it } from 'vitest';
import type { EligibleLineDiscountResult } from './eligible-line-discount';
import { applyPersistedLineOccurrenceKeys } from './order-negotiation-occurrence-keys';

const result = (
  lineDiscounts: EligibleLineDiscountResult['lineDiscounts']
): EligibleLineDiscountResult => ({
  totalDiscount: 0,
  rejectionCode: null,
  lineDiscounts,
});

describe('order-negotiation-occurrence-keys', () => {
  it('returns the result untouched without line discounts', () => {
    const input = result(undefined);
    expect(applyPersistedLineOccurrenceKeys(input, [], new Map())).toBe(input);
  });

  it('leaves unique lines unstamped', () => {
    const allocation = { lineId: 1, merchandiseDiscount: 5, vatRelief: 0 };
    const next = applyPersistedLineOccurrenceKeys(
      result([allocation]),
      [{ item: { product_id: 'prod-1' }, lineId: 1 }],
      new Map([['prod-1', { condition: null }]])
    );
    expect(next.lineDiscounts?.[0]).toBe(allocation);
  });

  it('stamps distinct occurrence keys on duplicate lines', () => {
    const next = applyPersistedLineOccurrenceKeys(
      result([
        { lineId: 1, merchandiseDiscount: 5, vatRelief: 0 },
        { lineId: 2, merchandiseDiscount: 5, vatRelief: 0 },
      ]),
      [
        { item: { product_id: 'prod-1' }, lineId: 1 },
        { item: { product_id: 'prod-1' }, lineId: 2 },
      ],
      new Map([['prod-1', { condition: null }]])
    );
    const first = next.lineDiscounts?.[0]?.lineKey;
    const second = next.lineDiscounts?.[1]?.lineKey;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });
});
