import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  claimCheckoutPurchaseTracking,
  markCheckoutPurchaseEmitted,
} from '@/lib/claim-checkout-purchase-tracking';
import { trackCheckoutInvoiceGenerated } from '@/services/analytics';
import { maybeCaptureCheckoutInvoiceGenerated } from './checkout-invoice-claim';

jest.mock('@/lib/claim-checkout-purchase-tracking', () => ({
  claimCheckoutPurchaseTracking: jest.fn(),
  markCheckoutPurchaseEmitted: jest.fn(),
}));
jest.mock('@/services/analytics', () => ({
  trackCheckoutInvoiceGenerated: jest.fn(),
}));

const mockedClaim = jest.mocked(claimCheckoutPurchaseTracking);
const mockedMark = jest.mocked(markCheckoutPurchaseEmitted);
const mockedTrack = jest.mocked(trackCheckoutInvoiceGenerated);

const baseOrder = {
  id: 'order-invoice-1',
  payment_status: 'unpaid',
  total: 5750,
  notificationDelivered: true as const,
};

describe('maybeCaptureCheckoutInvoiceGenerated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedClaim.mockResolvedValue(true);
  });

  it('claims and emits invoice_generated for a delivered unpaid invoice order', async () => {
    await maybeCaptureCheckoutInvoiceGenerated({
      selectedPayment: 'invoice',
      order: baseOrder,
      orderNumber: 'INV-1',
      itemsSnapshot: [{ quantity: 2 }],
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
    // Emission proof so a post-restart recovery reads recorded, not orphaned.
    expect(mockedMark).toHaveBeenCalledWith(
      'order-invoice-1',
      'invoice_generated'
    );
  });

  it('forwards the stamped order currency on the invoice stage', async () => {
    await maybeCaptureCheckoutInvoiceGenerated({
      selectedPayment: 'invoice',
      order: { ...baseOrder, currency: 'KES' },
      orderNumber: 'INV-1',
      itemsSnapshot: [],
    });

    expect(mockedTrack).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'order-invoice-1',
        currency: 'KES',
      })
    );
  });

  it('withholds the event until terminal delivery is confirmed', async () => {
    await maybeCaptureCheckoutInvoiceGenerated({
      selectedPayment: 'invoice',
      order: { ...baseOrder, notificationDelivered: false },
      orderNumber: 'INV-1',
      itemsSnapshot: [],
    });

    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('withholds the event when the flag is absent', async () => {
    const { notificationDelivered: _dropped, ...order } = baseOrder;
    await maybeCaptureCheckoutInvoiceGenerated({
      selectedPayment: 'invoice',
      order,
      orderNumber: 'INV-1',
      itemsSnapshot: [],
    });

    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('skips a paid invoice order that routes straight to completion', async () => {
    await maybeCaptureCheckoutInvoiceGenerated({
      selectedPayment: 'invoice',
      order: { ...baseOrder, payment_status: 'paid' },
      orderNumber: 'INV-2',
      itemsSnapshot: [],
    });

    expect(mockedClaim).not.toHaveBeenCalled();
    expect(mockedTrack).not.toHaveBeenCalled();
  });

  it('skips non-invoice payment methods', async () => {
    await maybeCaptureCheckoutInvoiceGenerated({
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

    await maybeCaptureCheckoutInvoiceGenerated({
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
