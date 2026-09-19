import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react-native';
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

jest.mock('@/components/receipts/ReceiptPreviewModal', () => ({
  ReceiptPreviewModal: ({ visible }: { visible: boolean }) => {
    const { View } =
      jest.requireActual<typeof import('react-native')>('react-native');
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

jest.mock('@/hooks/use-receipt-preview', () => ({
  useReceiptPreview: () => ({
    closePreview: mockClosePreview,
    html: '',
    isLoading: false,
    isOpen: false,
    isPaid: false,
    openPreviewByOrderId: mockOpenPreviewByOrderId,
  }),
}));

let mockPaidCheckOrder: { payment_status?: string } | null = null;
jest.mock('@/hooks/use-receipts', () => ({
  useReceiptDetail: () => ({ data: mockPaidCheckOrder }),
}));

jest.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: { customer: null }) => unknown) =>
    selector({ customer: null }),
}));

jest.mock('@/services/push-notifications', () => ({
  scheduleLocalNotification: (...args: unknown[]) =>
    mockScheduleLocalNotification(...args),
}));

describe('OrderSuccessScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockScheduleLocalNotification.mockResolvedValue(undefined);
    mockOrderSuccessView.mockClear();
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

  it('passes a document preview handler when the order id is available', () => {
    render(<OrderSuccessScreen />);

    const latestProps = mockOrderSuccessView.mock.calls.at(-1)?.[0] as
      | { onViewDocument?: () => void }
      | undefined;

    latestProps?.onViewDocument?.();

    expect(mockOpenPreviewByOrderId).toHaveBeenCalledWith('order-1');
  });

  it('reports unpaid for invoice orders without a paid receipt', () => {
    mockSearchParams = {
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
    mockSearchParams = {
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
