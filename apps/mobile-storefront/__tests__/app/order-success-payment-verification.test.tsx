import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import {
  mockMaybeShowPostOrderInterstitial,
  mockOrderReconciliationView,
  mockOrderSuccessView,
  mockRequestPermission,
  mockScheduleLocalNotification,
  mockSearchParamsHolder,
} from './order-success.test-utils';
import {
  mockGuestInvoiceHolder,
  mockVerifyOrderPaymentForCompletion,
  OrderSuccessScreen,
  resetOrderSuccessScreenMocks,
} from './order-success-screen.test-utils';

describe('OrderSuccessScreen payment verification', () => {
  beforeEach(resetOrderSuccessScreenMocks);

  it('shows an invalid-link message without claiming Paystack rejected the payment', () => {
    mockSearchParamsHolder.current = {
      ...mockSearchParamsHolder.current,
      reference: 'bco-invalid',
    };
    const view = render(<OrderSuccessScreen />);
    expect(view.getByText('Invalid payment link')).toBeTruthy();
    expect(view.queryByLabelText('Retry verification')).toBeNull();
    fireEvent.press(view.getByRole('button', { name: 'View orders' }));
    expect(
      jest.requireMock<typeof import('expo-router')>('expo-router').router
        .replace
    ).toHaveBeenCalledWith('/orders');
    expect(mockOrderReconciliationView).not.toHaveBeenCalled();
    expect(mockVerifyOrderPaymentForCompletion).not.toHaveBeenCalled();
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
});
