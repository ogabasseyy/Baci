import { describe, expect, it } from 'vitest';
import { planCartMerge } from './merge';
import type { CartLine, CartLineAttachments, CartSnapshot } from './types';

const TECNO = '33333333-3333-4333-8333-333333333333';

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

describe('planCartMerge chosen quantity', () => {
  it("keeps the chosen side's quantity on conflict resolution", () => {
    const existing = snapshot([
      line(TECNO, 5, {
        negotiatedUnitPriceMinor: 22000,
        negotiationStatus: 'accepted',
      }),
    ]);
    const incoming = snapshot([
      line(TECNO, 2, {
        negotiatedUnitPriceMinor: 20000,
        negotiationStatus: 'accepted',
      }),
    ]);
    const keepIncoming = planCartMerge(existing, incoming, [
      { item: { productId: TECNO }, keep: 'incoming' },
    ]);
    expect(keepIncoming.ok).toBe(true);
    if (keepIncoming.ok) {
      expect(keepIncoming.lines).toEqual([
        expect.objectContaining({
          negotiatedUnitPriceMinor: 20000,
          quantity: 2,
        }),
      ]);
    }
    const keepExisting = planCartMerge(existing, incoming, [
      { item: { productId: TECNO }, keep: 'existing' },
    ]);
    expect(keepExisting.ok).toBe(true);
    if (keepExisting.ok) {
      expect(keepExisting.lines).toEqual([
        expect.objectContaining({
          negotiatedUnitPriceMinor: 22000,
          quantity: 5,
        }),
      ]);
    }
  });
});
