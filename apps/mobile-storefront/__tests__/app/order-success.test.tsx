import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
import {
  mockAuthStoreModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockOpenPreviewByOrderId,
  mockOrderSuccessView,
  mockOrderSuccessViewModule,
  mockPermissionBoosterModule,
  mockPostOrderInterstitialModule,
  mockPushNotificationsModule,
  mockReceiptPreviewModalModule,
  mockReceiptPreviewModule,
  mockScheduleLocalNotification,
  mockSearchParamsHolder,
  setupOrderSuccessMocks,
} from './order-success.test-utils';

jest.mock('expo-router', () => mockExpoRouterModule());
jest.mock('@/components/orders/OrderSuccessView', () =>
  mockOrderSuccessViewModule()
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

describe('OrderSuccessScreen', () => {
  beforeEach(() => {
    setupOrderSuccessMocks();
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
});
