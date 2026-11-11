// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openCreditDirectCheckout } from './credit-direct-client';

describe('bugfix: Credit Direct popup product allocation', () => {
  const baseOptions = {
    customerEmail: 'customer@example.com',
    customerName: 'Ada Customer',
    customerPhone: '08012345678',
    merchantSlug: 'test-store',
    orderId: 'order-123',
    trackingToken: 'order-tracking-token',
    onClose: vi.fn(),
    onError: vi.fn(),
    onPopup: vi.fn(),
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document
      .querySelectorAll(
        'script[src="https://checkout.creditdirect.ng/bnpl/checkout.min.js"]'
      )
      .forEach((script) => {
        script.remove();
      });
    delete window.Connect;
  });

  it.each([
    {
      amount: 16200,
      expectedAmounts: [10800, 5400],
      items: [
        { id: 'product-1', name: 'Phone', price: 10000, quantity: 1 },
        { id: 'product-2', name: 'Phone Case', price: 5000, quantity: 1 },
      ],
      label: 'shipping and tax increase the gateway amount',
    },
    {
      amount: 9000,
      expectedAmounts: [6000, 3000],
      items: [
        { id: 'product-1', name: 'Phone', price: 10000, quantity: 1 },
        { id: 'product-2', name: 'Phone Case', price: 5000, quantity: 1 },
      ],
      label: 'discounts or wallet credit reduce the gateway amount',
    },
    {
      amount: 10000,
      expectedAmounts: [6666.66, 3333.34],
      items: [
        { id: 'product-1', name: 'Phone', price: 10000, quantity: 1 },
        { id: 'product-2', name: 'Phone Case', price: 5000, quantity: 1 },
      ],
      label: 'proportional allocation leaves a minor-unit remainder',
    },
    {
      amount: 5000,
      expectedAmounts: [2500, 2500],
      items: [
        { id: 'product-1', name: 'Voucher phone', price: 0, quantity: 1 },
        { id: 'product-2', name: 'Voucher case', price: 0, quantity: 1 },
      ],
      label: 'shipping is the only payable amount',
    },
  ])('keeps the product sum equal to totalAmount when $label', async ({
    amount,
    expectedAmounts,
    items,
  }) => {
    let receivedTransaction:
      | {
          products: Array<{
            productAmount: number;
            productId: string;
            productName: string;
          }>;
          totalAmount: number;
        }
      | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          amount,
          isLive: true,
          publicKey: 'cd-public-key',
          sessionId: 'session-123',
          signature: 'signature-123',
        }),
        ok: true,
      })
    );
    window.Connect = function MockConnect(config: {
      transaction: NonNullable<typeof receivedTransaction>;
    }) {
      receivedTransaction = config.transaction;
      return { open: vi.fn(), setup: vi.fn() };
    } as never;

    await openCreditDirectCheckout({
      ...baseOptions,
      amount,
      items,
    });

    expect(receivedTransaction?.totalAmount).toBe(amount);
    expect(receivedTransaction?.products).toEqual([
      {
        productAmount: expectedAmounts[0],
        productId: items[0].id,
        productName: items[0].name,
      },
      {
        productAmount: expectedAmounts[1],
        productId: items[1].id,
        productName: items[1].name,
      },
    ]);
    expect(
      receivedTransaction?.products.reduce(
        (sum, product) => sum + product.productAmount,
        0
      )
    ).toBe(amount);
  });
});
