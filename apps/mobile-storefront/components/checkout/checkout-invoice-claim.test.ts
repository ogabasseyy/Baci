import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { claimCheckoutPurchaseTracking } from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutInvoiceGenerated } from '@/services/analytics';
import type { CartItem } from '@/stores/cart-store';
import { maybeClaimCheckoutInvoice } from './checkout-invoice-claim';

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: jest.fn(),
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutInvoiceGenerated: jest.fn(),
}));

const mockedClaim = jest.mocked(claimCheckoutPurchaseTracking);
const mockedTrack = jest.mocked(trackCheckoutInvoiceGenerated);

const baseOrder = {
  id: 'order-invoice-1',
  payment_status: 'unpaid',
  total: 5750,
};

describe('maybeClaimCheckoutInvoice', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClaim.mockResolvedValue(true);
  });

  it('claims and emits invoice_generated for an unpaid invoice order', async () => {
    await maybeClaimCheckoutInvoice({
      selectedPayment: 'invoice',
      order: baseOrder,
      orderNumber: 'INV-1',
      itemsSnapshot: [
        {
          id: 'p1',
          product_id: 'p1',
          slug: 's',
          name: 'Item',
          price: 2875,
          quantity: 2,
        } satisfies CartItem,
      ],
    });

    expect(mockedClaim).toHaveBeenCalledWith(
      'order-invoice-1',
      'invoice_generated'
    );
    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-invoice-1',
        orderNumber: 'INV-1',
        paymentMethod: 'invoice',
        total: 5750,
        itemCount: 2,
      })
    );
  });

  it('skips a paid invoice order that routes straight to completion', async () => {
    await maybeClaimCheckoutInvoice({
      selectedPayment: 'invoice',
      order: { ...baseOrder, payment_status: 'paid' },
      orderNumber: 'INV-2',
      itemsSnapshot: [],
    });

    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('skips non-invoice payment methods', async () => {
    await maybeClaimCheckoutInvoice({
      selectedPayment: 'paystack',
      order: baseOrder,
      orderNumber: 'INV-3',
      itemsSnapshot: [],
    });

    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('does not emit when an existing claim denies the duplicate', async () => {
    mockedClaim.mockResolvedValue(false);

    await maybeClaimCheckoutInvoice({
      selectedPayment: 'invoice',
      order: baseOrder,
      orderNumber: 'INV-4',
      itemsSnapshot: [],
    });

    expect(mockedClaim).toHaveBeenCalledWith(
      'order-invoice-1',
      'invoice_generated'
    );
    expect(mockedTrack).not.toHaveBeenCalled();
  });
});
