import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ResumedOrder } from '../types';
import { useCheckoutFinancialSession } from './use-checkout-financial-session';

function createOptions(
  overrides: Partial<Parameters<typeof useCheckoutFinancialSession>[0]> = {}
) {
  return {
    merchant: { vat_registration_status: 'registered', vat_rate: 10 },
    effectiveItemSubtotal: 1_000,
    effectiveCheckoutCartTotal: 1_000,
    deliveryCost: 50,
    deliveryMethod: 'door' as const,
    giftWrappingCost: 25,
    hasCheckoutCartItems: true,
    resumedOrder: null,
    clearPendingCheckoutOrder: vi.fn(),
    currencyCode: 'NGN',
    discountSubtotal: 1_000,
    hasAuthenticatedUser: false,
    isOrderInFlightRef: { current: false },
    merchantSlug: 'ogabassey',
    pendingCheckoutOrder: null,
    walletSessionUserId: undefined,
    resumeOrderId: null,
    preferredGateway: null,
    ...overrides,
  };
}

function resumedOrder(overrides: Partial<ResumedOrder> = {}): ResumedOrder {
  return {
    id: 'order-1',
    short_id: 'BACI-1',
    subtotal: 1_000,
    shipping_cost: 100,
    total: 1_075,
    customer_name: 'Ada Lovelace',
    customer_email: 'ada@example.com',
    customer_phone: '08000000000',
    shipping_address: {
      address: '12 Broad Street',
      city: 'Lagos Island',
      state: 'Lagos',
      phone: '08000000000',
    },
    items: [],
    tax_amount: 50,
    gift_wrapping_fee: 25,
    discount_amount: 0,
    ...overrides,
  };
}

describe('useCheckoutFinancialSession', () => {
  it('uses merchant VAT and fresh checkout additions for payment and summary totals', () => {
    const { result } = renderHook(() =>
      useCheckoutFinancialSession(createOptions())
    );

    expect(result.current.orderTotals).toEqual({
      total: 1_150,
      taxAmount: 100,
    });
    expect(result.current.paymentSession.total).toBe(1_175);
    expect(result.current.summaryAmounts).toMatchObject({
      summaryOrder: null,
      summaryTaxAmount: 100,
      summaryDeliveryCost: 50,
      summaryGiftWrappingCost: 25,
      summaryOrderTotals: { total: 1_150, taxAmount: 100 },
    });
  });

  it('keeps a resumed order total and persisted adjustments authoritative', () => {
    const order = resumedOrder();
    const { result } = renderHook(() =>
      useCheckoutFinancialSession(
        createOptions({
          effectiveItemSubtotal: 9_000,
          effectiveCheckoutCartTotal: 9_000,
          deliveryCost: 800,
          giftWrappingCost: 500,
          hasCheckoutCartItems: false,
          resumedOrder: order,
          resumeOrderId: order.id,
        })
      )
    );

    expect(result.current.paymentSession.total).toBe(order.total);
    expect(result.current.summaryAmounts).toMatchObject({
      summaryOrder: order,
      summaryTaxAmount: 50,
      summaryDeliveryCost: 100,
      summaryGiftWrappingCost: 25,
      summaryOrderTotals: { total: order.total, taxAmount: 50 },
      summaryTaxLabel: 'Tax',
    });
  });
});
