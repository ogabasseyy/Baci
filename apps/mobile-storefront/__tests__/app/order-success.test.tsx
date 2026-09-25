import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  mockAuthCustomerHolder,
  mockAuthStoreModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockMaybeShowPostOrderInterstitial,
  mockOpenPreviewByOrderId,
  mockOrderReconciliationView,
  mockOrderReconciliationViewModule,
  mockOrderSuccessView,
  mockOrderSuccessViewModule,
  mockPermissionBoosterModule,
  mockPostOrderInterstitialModule,
  mockPushNotificationsModule,
  mockReceiptPreviewModalHolder,
  mockReceiptPreviewModalModule,
  mockReceiptPreviewModule,
  mockRequestPermission,
  mockScheduleLocalNotification,
  mockSearchParamsHolder,
  setupOrderSuccessMocks,
} from './order-success.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@/components/orders/OrderSuccessView', () =>
  mockOrderSuccessViewModule()
);
jest.mock('@/components/orders/OrderReconciliationView', () =>
  mockOrderReconciliationViewModule()
);
jest.mock('@/components/receipts/ReceiptPreviewModal', () =>
  mockReceiptPreviewModalModule()
);
jest.mock('@/components/useColorScheme', () => mockColorSchemeModule());
jest.mock('@/hooks/use-permission-booster', () =>
  mockPermissionBoosterModule()
);
jest.mock('@/hooks/use-receipt-preview', () => mockReceiptPreviewModule());
jest.mock('@/stores/auth-store', () => mockAuthStoreModule());
jest.mock('@/services/push-notifications', () => mockPushNotificationsModule());
jest.mock('@/lib/post-order-interstitial', () =>
  mockPostOrderInterstitialModule()
);

import OrderSuccessScreen from '@/app/order-success';

let mockPaidCheckOrder: {
  payment_status?: string;
  amount_paid?: number;
} | null = null;
jest.mock('@/hooks/use-receipts', () => ({
  useReceiptDetail: () => ({ data: mockPaidCheckOrder, isFetched: true }),
}));

const mockVerifyOrderPaymentForCompletion = jest.fn<
  (input: unknown) => Promise<unknown>
>(async () => ({ paid: false }));
jest.mock('@/components/payment-gateway/verify-order-payment', () => ({
  verifyOrderPaymentForCompletion: (input: unknown) =>
    mockVerifyOrderPaymentForCompletion(input),
}));

const mockGuestInvoiceHolder: {
  current: { status: string; isResolved: boolean };
} = { current: { status: 'unpaid', isResolved: true } };
jest.mock('@/components/orders/use-invoice-paid-state', () => ({
  useGuestInvoicePaidState: () => mockGuestInvoiceHolder.current,
}));

describe('OrderSuccessScreen', () => {
  beforeEach(() => {
    setupOrderSuccessMocks();
    mockPaidCheckOrder = null;
    mockVerifyOrderPaymentForCompletion.mockResolvedValue({ paid: false });
    mockGuestInvoiceHolder.current = { status: 'unpaid', isResolved: true };
  });

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

  it.each([
    { outcome: 'order_cancelled' },
    { outcome: 'order_skipped' },
  ])('renders reconciliation instead of confirmation for a $outcome arrival', async ({
    outcome,
  }) => {
    mockSearchParamsHolder.current = {
      ...mockSearchParamsHolder.current,
      reconciliation: outcome,
    };
    // The route parameter alone proves nothing: the screen verifies it
    // proof-bound before rendering the reconciliation state.
    mockVerifyOrderPaymentForCompletion.mockResolvedValue({
      paid: false,
      reconciliation: outcome,
    });

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockOrderReconciliationView).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: 'BAC-001' })
      );
    });
    expect(mockOrderSuccessView).not.toHaveBeenCalled();
    expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
  });

  it('rejects a spoofed reconciliation deep link without verification', async () => {
    mockSearchParamsHolder.current = {
      ...mockSearchParamsHolder.current,
      reconciliation: 'order_cancelled',
    };
    // A crafted link carries the parameter but no capture: verification
    // finds nothing to reconcile, so the ordinary success flow renders
    // instead of "Payment Received".
    mockVerifyOrderPaymentForCompletion.mockResolvedValue({ paid: false });

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockOrderSuccessView).toHaveBeenCalled();
    });
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
  });

  it('stays pending when reconciliation verification is inconclusive', async () => {
    mockSearchParamsHolder.current = {
      ...mockSearchParamsHolder.current,
      reconciliation: 'order_cancelled',
    };
    // A timeout or transient lookup failure is neither proof nor
    // disproof: the screen must not fall through to the ordinary
    // confirmation (or its purchase side effects) for an unverified
    // captured-but-cancelled arrival.
    mockVerifyOrderPaymentForCompletion.mockResolvedValue({
      paid: false,
      inconclusive: true,
    });

    render(<OrderSuccessScreen />);

    await waitFor(() => {
      expect(mockVerifyOrderPaymentForCompletion).toHaveBeenCalled();
    });
    expect(mockOrderSuccessView).not.toHaveBeenCalled();
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
    expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
    expect(mockMaybeShowPostOrderInterstitial).not.toHaveBeenCalled();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('withholds side effects until a slow refunded lookup resolves', async () => {
    jest.useFakeTimers();
    try {
      mockSearchParamsHolder.current = {
        orderId: 'order-1',
        orderNumber: 'BAC-001',
        paymentMethod: 'invoice',
        trackingToken: 'tracking-token',
      };
      // The token lookup is still in flight: the banner may show, but no
      // notification, interstitial, soft ask, or reconciliation may fire
      // for an order that is about to flip.
      mockGuestInvoiceHolder.current = { status: 'unpaid', isResolved: false };
      const { rerender } = render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(mockOrderSuccessView).toHaveBeenCalled();
      expect(mockOrderReconciliationView).not.toHaveBeenCalled();
      expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
      expect(mockMaybeShowPostOrderInterstitial).not.toHaveBeenCalled();
      expect(mockRequestPermission).not.toHaveBeenCalled();

      // The lookup resolves refunded: reconciliation renders, and the
      // purchase-success side effects stay suppressed.
      mockGuestInvoiceHolder.current = { status: 'refunded', isResolved: true };
      rerender(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });

      expect(mockOrderReconciliationView).toHaveBeenCalled();
      expect(mockScheduleLocalNotification).not.toHaveBeenCalled();
      expect(mockMaybeShowPostOrderInterstitial).not.toHaveBeenCalled();
      expect(mockRequestPermission).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
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
    mockPaidCheckOrder = { payment_status: 'unpaid', amount_paid: 400 };
    render(<OrderSuccessScreen />);

    // Credited balance with an unreconciled status: the preview modal
    // gets no proforma stamp.
    expect(mockReceiptPreviewModalHolder.current?.documentType).toBeUndefined();
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
    mockPaidCheckOrder = null;
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
    mockPaidCheckOrder = { payment_status: 'unpaid' };
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { isPaid?: boolean }
      | undefined;
    expect(latestProps?.isPaid).toBe(false);
    mockPaidCheckOrder = null;
  });

  it('reports paid for externally settled invoice orders', () => {
    mockSearchParamsHolder.current = {
      orderId: 'order-9',
      paymentMethod: 'invoice',
    };
    mockPaidCheckOrder = { payment_status: 'paid' };
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { isPaid?: boolean }
      | undefined;
    expect(latestProps?.isPaid).toBe(true);
    mockPaidCheckOrder = null;
  });
});
