import { describe, expect, it } from 'vitest';
import { buildChatwootInlineReview } from './chatwoot-inline-review';

const canonical = {
  cartVersion: 7,
  currency: 'NGN',
  estimatedTotals: false,
  items: [
    {
      lineId: 'server-line-1',
      name: 'Canonical Server Phone',
      productId: 'server-product-1',
      variantId: null,
      condition: null,
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
    },
  ],
  itemsSubtotalMinor: 250000,
};

describe('buildChatwootInlineReview', () => {
  it('renders only canonical server values, regardless of forged local cart fields', () => {
    const result = buildChatwootInlineReview({
      ...canonical,
      localCart: [{ name: 'Forged phone', quantity: 99, price: 1 }],
    });

    // Strict response parsing rejects unexpected data rather than silently
    // allowing a mixed local/server review to be presented as canonical.
    expect(result).toBeNull();
    expect(buildChatwootInlineReview(canonical)?.items[0]).toMatchObject({
      productId: 'server-product-1',
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
    });
  });

  it('labels estimated values and never describes the subtotal as payable', () => {
    const result = buildChatwootInlineReview({
      ...canonical,
      estimatedTotals: true,
    });
    expect(result?.amountLabel).toBe('Estimated items subtotal');
    expect(result?.disclaimer).toContain('Delivery and tax are not included');
    expect(result?.disclaimer).toContain('No order or payment has been placed');
  });

  it('rejects inconsistent server line totals and subtotal', () => {
    expect(
      buildChatwootInlineReview({
        ...canonical,
        itemsSubtotalMinor: 1,
      })
    ).toBeNull();
    expect(
      buildChatwootInlineReview({
        ...canonical,
        items: [{ ...canonical.items[0], lineTotalMinor: 249999 }],
      })
    ).toBeNull();
  });

  it('fails closed for currencies whose minor-unit scale differs from the widget formatter', () => {
    expect(
      buildChatwootInlineReview({ ...canonical, currency: 'JPY' })
    ).toBeNull();
  });
});
