import { Alert } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaidOrderStatusActions } from './createOrderDetailsStatusActions.test-support';
import { OrderStatusUpdateError } from './orders/order-status-update-error';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock('react-native', () => ({
  StatusBar: () => null,
  Alert: { alert: vi.fn() },
}));

vi.mock('@/lib/api-client', () => ({
  BASE_URL: 'https://example.com',
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
    },
  },
}));

describe('createOrderDetailsStatusActions paid cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mocks.fetch);
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'token' } },
    });
    mocks.fetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the actionable cancellation error after confirmation', async () => {
    const message =
      'A payment attempt needs to be checked before this order can be cancelled. Please contact support.';
    const { actions, updateStatus } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockRejectedValue(
          new OrderStatusUpdateError(message, 'PAYMENT_RECONCILIATION_REQUIRED')
        ),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOrder = confirmation?.find(
      (button) => button.text === 'Cancel and refund to original payment method'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
    expect(updateStatus).toHaveBeenCalledWith({
      orderId: 'order-paid',
      refund: 'automatic',
      status: 'cancelled',
    });
  });

  it('shows the server reason when the order can no longer be cancelled', async () => {
    const message = 'This order can no longer be cancelled.';
    const { actions } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockRejectedValue(
          new OrderStatusUpdateError(message, 'ORDER_NOT_CANCELLABLE')
        ),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOrder = confirmation?.find(
      (button) => button.text === 'Cancel and refund to original payment method'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
  });

  it('explains the refund-permission refusal for a cancel-only attempt', async () => {
    const message =
      'Only the store owner or staff with refund permission can cancel an order without an automatic refund.';
    const { actions } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockRejectedValue(
          new OrderStatusUpdateError(message, 'CANCEL_REFUND_FORBIDDEN')
        ),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOnly = confirmation?.find(
      (button) => button.text === 'Cancel only (I will refund them)'
    );
    cancelOnly?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
  });

  it('shows the server reason when the error is rewrapped without the class', async () => {
    const message =
      'A payment attempt needs to be checked before this order can be cancelled. Please contact support.';
    const { actions } = createPaidOrderStatusActions({
      // A serialized copy across a bundle boundary: no instanceof,
      // but the server code survives.
      updateStatus: vi.fn().mockRejectedValue({
        code: 'PAYMENT_RECONCILIATION_REQUIRED',
        message,
      }),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOrder = confirmation?.find(
      (button) => button.text === 'Cancel and refund to original payment method'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
  });

  it.each([
    null,
    undefined,
    42,
    'boom',
  ])('falls back to the generic message on a %s rejection', async (rejection) => {
    const { actions } = createPaidOrderStatusActions({
      updateStatus: vi.fn().mockRejectedValue(rejection),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOrder = confirmation?.find(
      (button) => button.text === 'Cancel and refund to original payment method'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Failed to update status'
      );
    });
  });

  it('falls back to the generic message when the code matches but the message is missing', async () => {
    const { actions } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockRejectedValue({ code: 'PAYMENT_RECONCILIATION_REQUIRED' }),
    });

    await actions.handleStatusUpdate('cancelled');
    const confirmation = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    const cancelOrder = confirmation?.find(
      (button) => button.text === 'Cancel and refund to original payment method'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Error',
        'Failed to update status'
      );
    });
  });
});

describe('cancellation refund plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers a refund-review action instead of an automatic refund when a leg is unsupported', async () => {
    const { actions, updateStatus } = createPaidOrderStatusActions({
      order: {
        cancel_refund_plan: { amount: 5000, automaticSupported: false },
      },
    });
    await actions.handleStatusUpdate('cancelled');
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    expect(buttons?.map((button) => button.text)).toEqual([
      'Keep Order',
      'Cancel and send the refund to review',
      'Cancel only (I will refund them)',
    ]);
    buttons?.[1]?.onPress?.();
    await vi.waitFor(() => {
      expect(updateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ refund: 'automatic' })
      );
    });
  });

  it('uses the plain confirmation when nothing external is refundable', async () => {
    const { actions } = createPaidOrderStatusActions({
      order: { cancel_refund_plan: { amount: 0, automaticSupported: true } },
    });
    await actions.handleStatusUpdate('cancelled');
    expect(vi.mocked(Alert.alert).mock.calls[0]?.[0]).toBe('Cancel order?');
  });

  it('words the success message from the server refund outcome', async () => {
    const { actions, setSuccessModal } = createPaidOrderStatusActions({
      updateStatus: vi
        .fn()
        .mockResolvedValue({ refund_outcome: 'queued_if_required' }),
    });
    await actions.handleStatusUpdate('cancelled');
    const buttons = vi.mocked(Alert.alert).mock.calls[0]?.[2];
    buttons
      ?.find((button) => button.text === 'Cancel only (I will refund them)')
      ?.onPress?.();
    await vi.waitFor(() => {
      expect(setSuccessModal).toHaveBeenCalledWith(
        expect.objectContaining({
          subMessage: expect.stringContaining('Check the refund status'),
        })
      );
    });
  });
});
