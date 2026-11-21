import { beforeEach, describe, expect, it } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import {
  mockAuthCustomerHolder,
  mockOpenPreviewByOrderId,
  mockOrderReconciliationView,
  mockOrderSuccessView,
  mockReceiptPreviewModalHolder,
  mockScheduleLocalNotification,
  mockSearchParamsHolder,
} from './order-success.test-utils';
import {
  mockGuestInvoiceHolder,
  mockReceiptOrder,
  OrderSuccessScreen,
  resetOrderSuccessScreenMocks,
} from './order-success-screen.test-support';

describe('OrderSuccessScreen', () => {
  beforeEach(resetOrderSuccessScreenMocks);

  it('schedules the order received notification only after the success screen loads', async () => {
    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).toHaveBeenCalledWith(
        'Order Received! 📦',
        "Your order #BAC-001 is being processed. We'll notify you when it ships.",
        {
          orderId: 'order-1',
          orderNumber: 'BAC-001',
          type: 'order_update',
        },
        1
      );
    });
  });

  it('does not schedule an order notification when order identity is missing', async () => {
    mockSearchParamsHolder.current = {};

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
    });
  });

  it.each([
    'invoice',
    'payforme',
    'pay_on_delivery',
  ])('does not schedule a duplicate local order notification for server-confirmed %s success screens', async (paymentMethod) => {
    mockSearchParamsHolder.current = {
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      paymentMethod,
      trackingToken: 'tracking-token',
    };

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
    });
  });

  it('falls back to orderId when orderNumber is blank', async () => {
    mockSearchParamsHolder.current = {
      orderId: 'order-1',
      orderNumber: '   ',
      paymentMethod: 'paystack',
      reference: 'pay-ref',
      trackingToken: 'tracking-token',
    };

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).toHaveBeenCalledWith(
        'Order Received! 📦',
        "Your order #order-1 is being processed. We'll notify you when it ships.",
        {
          orderId: 'order-1',
          orderNumber: 'order-1',
          type: 'order_update',
        },
        1
      );
    });
  });

  it('does not schedule the order notification twice on rerender', async () => {
    const { rerender } = render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).toHaveBeenCalledTimes(1);
    });

    rerender(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockScheduleLocalNotification).toHaveBeenCalledTimes(1);
    });
  });

  it('passes a document preview handler when the order id is available', () => {
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { onViewDocument?: () => void }
      | undefined;

    latestProps?.onViewDocument?.();

    expect(mockOpenPreviewByOrderId).toHaveBeenCalledWith('order-1');
  });

  it('hides the document action for guests without a usable receipt lookup', () => {
    mockAuthCustomerHolder.current = null;
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { onViewDocument?: () => void }
      | undefined;

    // The authenticated receipt query is disabled without a signed-in
    // user, so no handler is offered instead of a button stuck on
    // "Preparing document...".
    expect(latestProps?.onViewDocument).toBeUndefined();
    expect(mockOpenPreviewByOrderId).not.toHaveBeenCalled();
  });

  it('renders commercial presentation for a partially paid guest invoice', () => {
    mockAuthCustomerHolder.current = null;
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockGuestInvoiceHolder.current = {
      status: 'partially_paid',
      isResolved: true,
    };
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { documentType?: string; isPaid?: boolean }
      | undefined;

    // Accepted money without settling: never proforma, never
    // reconciliation — the order stays active.
    expect(latestProps?.documentType).toBeUndefined();
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
  });

  it('renders commercial presentation for a wallet-credited invoice', () => {
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockReceiptOrder.current = { payment_status: 'unpaid', amount_paid: 400 };
    render(<OrderSuccessScreen />);

    // Credited balance with an unreconciled status: the preview modal
    // gets no proforma stamp.
    expect(mockReceiptPreviewModalHolder.current?.documentType).toBeUndefined();
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
    mockReceiptOrder.current = null;
  });

  it('renders commercial presentation for a wallet-credited guest invoice', () => {
    mockAuthCustomerHolder.current = null;
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockGuestInvoiceHolder.current = {
      status: 'credited',
      isResolved: true,
    };
    render(<OrderSuccessScreen />);

    expect(mockReceiptPreviewModalHolder.current?.documentType).toBeUndefined();
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
  });

  it('reports unpaid for invoice orders without a paid receipt', () => {
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockReceiptOrder.current = { payment_status: 'unpaid' };
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { isPaid?: boolean }
      | undefined;
    expect(latestProps?.isPaid).toBe(false);
    mockReceiptOrder.current = null;
  });

  it('reports paid for externally settled invoice orders', () => {
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockReceiptOrder.current = { payment_status: 'paid' };
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { isPaid?: boolean }
      | undefined;
    expect(latestProps?.isPaid).toBe(true);
    mockReceiptOrder.current = null;
  });
});
