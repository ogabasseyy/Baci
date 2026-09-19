import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { trackEvent } from './analytics-core';
import { trackCheckoutInvoiceGenerated } from './track-checkout-invoice-generated';

jest.mock('./analytics-core', () => ({
  trackEvent: jest.fn(),
}));

describe('trackCheckoutInvoiceGenerated', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('emits the funnel invoice_generated event', () => {
    trackCheckoutInvoiceGenerated({
      orderId: 'o1',
      orderNumber: 'N1',
      total: 100,
      itemCount: 1,
    });

    expect(trackEvent).toHaveBeenCalledWith(
      'invoice_generated',
      expect.objectContaining({ payment_status: 'unpaid' })
    );
  });
});
