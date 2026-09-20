import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import OrderSuccessScreen from '@/app/order-success';

const mockScheduleLocalNotification =
  jest.fn<(...args: unknown[]) => Promise<void>>();
const mockRequestPermission = jest.fn(async () => 'granted');
const mockTriggerSystemPrompt = jest.fn();
const mockMarkDenied = jest.fn();
const mockOpenPreviewByOrderId = jest.fn();
const mockClosePreview = jest.fn();
const mockOrderSuccessView = jest.fn();
let mockSearchParams: Record<string, string> = {
  orderId: 'order-1',
  orderNumber: 'BAC-001',
  paymentMethod: 'paystack',
  reference: 'pay-ref',
  trackingToken: 'tracking-token',
};

jest.mock('expo-router', () => ({
  router: {
    replace: jest.fn(),
  },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@/components/orders/OrderSuccessView', () => ({
  OrderSuccessView: (props: { onViewDocument?: () => void }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    mockOrderSuccessView(props);
    return <View testID="order-success-view" />;
  },
}));

let capturedReceiptOnDismissed: (() => void) | undefined;
jest.mock('@/components/receipts/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: ({
    onDismissed,
    visible,
  }: {
    onDismissed?: () => void;
    visible: boolean;
  }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
    capturedReceiptOnDismissed = onDismissed;
    return visible ? <View testID="receipt-preview-modal" /> : null;
  },
}));

jest.mock('@/components/useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

jest.mock('@/hooks/use-permission-booster', () => ({
  usePermissionBooster: () => ({
    markDenied: mockMarkDenied,
    requestPermission: mockRequestPermission,
    triggerSystemPrompt: mockTriggerSystemPrompt,
  }),
}));

const mockReceiptState = { isLoading: false, isOpen: false };
jest.mock('@/hooks/use-receipt-preview', () => ({
  useReceiptPreview: () => ({
    closePreview: mockClosePreview,
    html: '',
    isLoading: mockReceiptState.isLoading,
    isOpen: mockReceiptState.isOpen,
    isPaid: false,
    openPreviewByOrderId: mockOpenPreviewByOrderId,
  }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { customer: null }) => unknown) =>
    selector({ customer: null }),
}));

jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: (...args: unknown[]) =>
    mockScheduleLocalNotification(...args),
}));

const mockMaybeShowPostOrderInterstitial = jest.fn<
  (options?: { isCancelled?: () => boolean }) => Promise<'shown' | 'skipped'>
>(async () => 'skipped');

jest.mock('@/lib/post-order-interstitial', () => {
  const actual = jest.requireActual<
    typeof import('@/lib/post-order-interstitial')
  >('@/lib/post-order-interstitial');
  return {
    ...actual,
    maybeShowPostOrderInterstitial: (options?: {
      isCancelled?: () => boolean;
    }) => mockMaybeShowPostOrderInterstitial(options),
  };
});

describe('OrderSuccessScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleLocalNotification.mockResolvedValue(undefined);
    mockOrderSuccessView.mockClear();
    mockReceiptState.isLoading = false;
    mockReceiptState.isOpen = false;
    capturedReceiptOnDismissed = undefined;
    mockSearchParams = {
      orderId: 'order-1',
      orderNumber: 'BAC-001',
      paymentMethod: 'paystack',
      reference: 'pay-ref',
      trackingToken: 'tracking-token',
    };
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
    mockSearchParams = {};

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
    mockSearchParams = {
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
    mockSearchParams = {
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

  it('cancels the post-order interstitial while the app is backgrounded', async () => {
    // Regression: a LOADED event firing after backgrounding would present
    // the purchase ad on resume, outside the post-order moment.
    jest.useFakeTimers();
    try {
      render(<OrderSuccessScreen />);
      // Flush the permission lookup too: until it resolves the permission
      // flow flag stays set and would mask the AppState assertion below.
      await act(async () => {
        jest.advanceTimersByTime(2600);
      });

      expect(mockMaybeShowPostOrderInterstitial).toHaveBeenCalledTimes(1);
      const isCancelled =
        mockMaybeShowPostOrderInterstitial.mock.calls[0]?.[0]?.isCancelled;
      expect(isCancelled).toBeDefined();
      AppState.currentState = 'active';
      expect(isCancelled?.()).toBe(false);
      AppState.currentState = 'background';
      expect(isCancelled?.()).toBe(true);
      AppState.currentState = 'active';
    } finally {
      jest.useRealTimers();
    }
  });

  it('withholds the banner until the native permission prompt resolves', async () => {
    // Regression: clearing the soft-ask modal on grant must not remount
    // the banner underneath the native system prompt still in flight.
    mockRequestPermission.mockResolvedValueOnce('soft-ask-needed');
    let resolvePrompt!: () => void;
    mockTriggerSystemPrompt.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      })
    );
    const latestProps = () =>
      mockOrderSuccessView.mock.calls.at(-1)?.[0] as
        | {
            isPermissionFlowActive?: boolean;
            onPermissionGrant: () => void;
            showPermissionModal?: boolean;
          }
        | undefined;

    jest.useFakeTimers();
    try {
      render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });

      expect(latestProps()?.showPermissionModal).toBe(true);
      expect(latestProps()?.isPermissionFlowActive).toBe(true);

      act(() => {
        void latestProps()?.onPermissionGrant();
      });
      expect(latestProps()?.showPermissionModal).toBe(false);
      expect(latestProps()?.isPermissionFlowActive).toBe(true);

      await act(async () => {
        resolvePrompt();
      });
      expect(latestProps()?.isPermissionFlowActive).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes a document preview handler when the order id is available', () => {
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { onViewDocument?: () => void }
      | undefined;

    latestProps?.onViewDocument?.();

    expect(mockOpenPreviewByOrderId).toHaveBeenCalledWith('order-1');
  });

  it('holds receipt ownership until the sheet dismissal completes', async () => {
    // Regression: closePreview clears the open state synchronously while
    // the iOS slide dismissal still covers the screen — a late LOADED event
    // must not present over the departing sheet and the banner must not
    // remount underneath it.
    const latestProps = () =>
      mockOrderSuccessView.mock.calls.at(-1)?.[0] as
        | { isReceiptPreviewActive?: boolean }
        | undefined;

    jest.useFakeTimers();
    try {
      mockReceiptState.isOpen = true;
      const { rerender } = render(<OrderSuccessScreen />);
      await act(async () => {
        jest.advanceTimersByTime(2600);
      });

      expect(mockMaybeShowPostOrderInterstitial).toHaveBeenCalledTimes(1);
      const isCancelled =
        mockMaybeShowPostOrderInterstitial.mock.calls[0]?.[0]?.isCancelled;
      expect(isCancelled?.()).toBe(true);
      expect(latestProps()?.isReceiptPreviewActive).toBe(true);

      mockReceiptState.isOpen = false;
      rerender(<OrderSuccessScreen />);
      expect(isCancelled?.()).toBe(true);
      expect(latestProps()?.isReceiptPreviewActive).toBe(true);

      await act(async () => {
        capturedReceiptOnDismissed?.();
      });
      expect(isCancelled?.()).toBe(false);
      expect(latestProps()?.isReceiptPreviewActive).toBe(false);
    } finally {
      jest.useRealTimers();
      mockReceiptState.isOpen = false;
      mockReceiptState.isLoading = false;
    }
  });
});
