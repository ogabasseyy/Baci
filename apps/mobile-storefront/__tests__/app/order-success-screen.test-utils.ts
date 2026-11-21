import { jest } from '@jest/globals';
import {
  mockAuthStoreModule,
  mockColorSchemeModule,
  mockExpoRouterModule,
  mockOrderReconciliationViewModule,
  mockOrderSuccessViewModule,
  mockPermissionBoosterModule,
  mockPostOrderInterstitialModule,
  mockPushNotificationsModule,
  mockReceiptPreviewModalModule,
  mockReceiptPreviewModule,
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

export const mockReceiptOrder: {
  current: {
    payment_status?: string;
    amount_paid?: number;
  } | null;
} = { current: null };
jest.mock('@/hooks/use-receipts', () => ({
  useReceiptDetail: () => ({ data: mockReceiptOrder.current, isFetched: true }),
}));

export const mockVerifyOrderPaymentForCompletion = jest.fn<
  (input: unknown) => Promise<unknown>
>(async () => ({ paid: false }));
jest.mock('@/components/payment-gateway/verify-order-payment', () => ({
  verifyOrderPaymentForCompletion: (input: unknown) =>
    mockVerifyOrderPaymentForCompletion(input),
}));

export const mockGuestInvoiceHolder: {
  current: { status: string; isResolved: boolean };
} = { current: { status: 'unpaid', isResolved: true } };
jest.mock('@/components/orders/use-invoice-paid-state', () => ({
  useGuestInvoicePaidState: () => mockGuestInvoiceHolder.current,
}));

export { OrderSuccessScreen };

export function resetOrderSuccessScreenMocks() {
  setupOrderSuccessMocks();
  mockReceiptOrder.current = null;
  mockVerifyOrderPaymentForCompletion.mockResolvedValue({ paid: false });
  mockGuestInvoiceHolder.current = { status: 'unpaid', isResolved: true };
}
