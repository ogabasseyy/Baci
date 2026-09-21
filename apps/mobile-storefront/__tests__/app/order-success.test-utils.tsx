import { jest } from '@jest/globals';

// Shared mocks, builders, and module factories for the order-success suites
// (core + interstitial). Pure module on purpose: jest.mock hoisting is
// per-file, so each suite registers its own mocks by calling these
// factories. Factories are mock-prefixed because factory bodies may only
// reference mock-prefixed imports. Mutable snapshots live in holder objects
// (imports cannot be reassigned); each suite resets them.

export const mockScheduleLocalNotification =
  jest.fn<(...args: unknown[]) => Promise<void>>();
export const mockRequestPermission = jest.fn(async () => 'granted');
export const mockTriggerSystemPrompt = jest.fn();
export const mockMarkDenied = jest.fn();
export const mockOpenPreviewByOrderId = jest.fn();
export const mockClosePreview = jest.fn();
export const mockOrderSuccessView = jest.fn();
export const mockReceiptState = { isLoading: false, isOpen: false };
export const mockSearchParamsHolder: { current: Record<string, string> } = {
  current: {
    orderId: 'order-1',
    orderNumber: 'BAC-001',
    paymentMethod: 'paystack',
    reference: 'pay-ref',
    trackingToken: 'tracking-token',
  },
};
export const mockReceiptDismissalHolder: {
  current: (() => void) | undefined;
} = { current: undefined };
export const mockPaidCheckOrderHolder: {
  current: { payment_status?: string } | null;
} = { current: null };
export const mockMaybeShowPostOrderInterstitial = jest.fn<
  (options?: {
    isCancelled?: () => boolean;
    onClosed?: () => void;
    onPresenting?: () => void;
  }) => Promise<'shown' | 'skipped'>
>(async () => 'skipped');

export function mockExpoRouterModule(): unknown {
  return {
    router: {
      replace: jest.fn(),
    },
    useLocalSearchParams: () => mockSearchParamsHolder.current,
  };
}

export function mockOrderSuccessViewModule(): unknown {
  return {
    OrderSuccessView: (props: { onViewDocument?: () => void }) => {
      const { View } =
        jest.requireActual<typeof import('react-native')>('react-native');
      mockOrderSuccessView(props);
      return <View testID="order-success-view" />;
    },
  };
}

export const mockOrderReconciliationView = jest.fn();

export function mockOrderReconciliationViewModule(): unknown {
  return {
    OrderReconciliationView: (props: unknown) => {
      const { View } =
        jest.requireActual<typeof import('react-native')>('react-native');
      mockOrderReconciliationView(props);
      return <View testID="order-reconciliation-view" />;
    },
  };
}

export function mockReceiptPreviewModalModule(): unknown {
  return {
    ReceiptPreviewModal: ({
      onDismissed,
      visible,
    }: {
      onDismissed?: () => void;
      visible: boolean;
    }) => {
      const { View } =
        jest.requireActual<typeof import('react-native')>('react-native');
      mockReceiptDismissalHolder.current = onDismissed;
      return visible ? <View testID="receipt-preview-modal" /> : null;
    },
  };
}

export function mockColorSchemeModule(): unknown {
  return { useColorScheme: () => 'light' };
}

export function mockPermissionBoosterModule(): unknown {
  return {
    usePermissionBooster: () => ({
      markDenied: mockMarkDenied,
      requestPermission: mockRequestPermission,
      triggerSystemPrompt: mockTriggerSystemPrompt,
    }),
  };
}

export function mockReceiptPreviewModule(): unknown {
  return {
    useReceiptPreview: () => ({
      closePreview: mockClosePreview,
      html: '',
      isLoading: mockReceiptState.isLoading,
      isOpen: mockReceiptState.isOpen,
      isPaid: false,
      openPreviewByOrderId: mockOpenPreviewByOrderId,
    }),
  };
}

export function mockAuthStoreModule(): unknown {
  return {
    useAuthStore: (selector: (state: { customer: null }) => unknown) =>
      selector({ customer: null }),
  };
}

export function mockPushNotificationsModule(): unknown {
  return {
    scheduleLocalNotification: (...args: unknown[]) =>
      mockScheduleLocalNotification(...args),
  };
}

export function mockPostOrderInterstitialModule(): unknown {
  const actual = jest.requireActual<
    typeof import('@/lib/post-order-interstitial')
  >('@/lib/post-order-interstitial');
  return {
    ...actual,
    maybeShowPostOrderInterstitial: (options?: {
      isCancelled?: () => boolean;
      onClosed?: () => void;
      onPresenting?: () => void;
    }) => mockMaybeShowPostOrderInterstitial(options),
  };
}

export function mockUseReceiptsModule(): unknown {
  return {
    useReceiptDetail: () => ({ data: mockPaidCheckOrderHolder.current }),
  };
}

export function setupOrderSuccessMocks(): void {
  jest.clearAllMocks();
  mockScheduleLocalNotification.mockResolvedValue(undefined);
  mockOrderSuccessView.mockClear();
  mockOrderReconciliationView.mockClear();
  mockReceiptState.isLoading = false;
  mockReceiptState.isOpen = false;
  mockReceiptDismissalHolder.current = undefined;
  mockPaidCheckOrderHolder.current = null;
  mockSearchParamsHolder.current = {
    orderId: 'order-1',
    orderNumber: 'BAC-001',
    paymentMethod: 'paystack',
    reference: 'pay-ref',
    trackingToken: 'tracking-token',
  };
}
