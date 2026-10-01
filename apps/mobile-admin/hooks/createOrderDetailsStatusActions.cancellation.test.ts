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
      (button) => button.text === 'Cancel Order'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
    expect(updateStatus).toHaveBeenCalledWith({
      orderId: 'order-paid',
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
      (button) => button.text === 'Cancel Order'
    );
    cancelOrder?.onPress?.();
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
      (button) => button.text === 'Cancel Order'
    );
    cancelOrder?.onPress?.();
    await vi.waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Error', message);
    });
  });
});
