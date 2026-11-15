import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({
  useLocalSearchParams: () => routeParamsState.current,
}));

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ colors: {}, shadows: {} }),
}));

vi.mock('@/hooks/useMerchant', () => ({
  useMerchant: () => ({ merchant: merchantState.current }),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: authState.user }),
}));

vi.mock('@/hooks/useOrderFulfillAccess', () => ({
  useOrderFulfillAccess: () => fulfillAccessMock(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
}));

vi.mock('@/hooks/useGiglAdminShippingEligibility', () => ({
  useGiglAdminShippingEligibility: (
    merchant: {
      country?: string | null;
      payout_currency?: string | null;
    } | null
  ) => ({
    isEligible:
      merchant?.country?.toUpperCase() === 'NG' &&
      merchant?.payout_currency?.toUpperCase() === 'NGN',
  }),
}));

vi.mock('@/hooks/useOrders', () => ({
  useOrder: () => ({
    data: orderState.current as never,
    error: null,
    isLoading: false,
  }),
  useUpdateOrderStatus: () => ({ mutateAsync: vi.fn() }),
  useShipOnCredit: () => ({ mutateAsync: vi.fn() }),
  useSendReminder: () => ({ mutateAsync: vi.fn() }),
  useRecordPayment: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/hooks/orders/useOrderAuditEvents', () => ({
  useOrderAuditEvents: () => auditEventsState.current,
}));

vi.mock('@/hooks/orders/useOrderGiglPreviewPrefetch', () => ({
  useOrderGiglPreviewPrefetch: (params: unknown) => {
    giglShippingState.prefetchCalls.push(params);
    return 'preview-scope';
  },
}));

vi.mock('@/hooks/orders/useOrderGiglShipping', () => ({
  useOrderGiglShipping: (params: unknown) => {
    giglShippingState.calls.push(params);
    return giglShippingState.result;
  },
}));

vi.mock('@/lib/order-shipment', async () =>
  (await import('./useOrderDetailsController.test-support')).orderShipmentMock()
);

vi.mock('@/hooks/createOrderDetailsContactActions', () => ({
  createOrderDetailsContactActions: () => ({
    handleCall: vi.fn(),
    handleEmail: vi.fn(),
    handleSaveRider: vi.fn(),
    handleSendOrderDetailsToRider: vi.fn(),
    handleSendRiderToCustomer: vi.fn(),
    handleShare: vi.fn(),
    handleWhatsApp: vi.fn(),
  }),
}));

vi.mock('@/hooks/createOrderDetailsPaymentActions', () => ({
  createOrderDetailsPaymentActions: () => ({
    handlePaymentAmountChange: vi.fn(),
    handleRecordPayment: vi.fn(),
    handleSendReminder: vi.fn(),
    handleShipOnCredit: vi.fn(),
  }),
}));

vi.mock('@/hooks/createOrderDetailsReceiptActions', () => ({
  createOrderDetailsReceiptActions: () => ({
    handleSendReceipt: vi.fn(),
    handleShareReceiptPdf: vi.fn(),
  }),
}));

vi.mock('@/hooks/createOrderDetailsShipmentActions', () => ({
  createOrderDetailsShipmentActions: (
    params: NonNullable<typeof shipmentParameters.current>
  ) => {
    shipmentParameters.current = params;
    return {
      closeShipmentFlow: vi.fn(),
      handleShipmentFlowBack: vi.fn(),
      handleSubmitSelfFulfillment: vi.fn(),
      openShipmentFlow: vi.fn(),
      proceedFromFulfillmentDetails: vi.fn(),
      proceedFromShipmentMethod: vi.fn(),
    };
  },
}));

vi.mock('@/hooks/createOrderDetailsStatusActions', () => ({
  createOrderDetailsStatusActions: () => ({
    handleStatusUpdate: vi.fn(),
  }),
}));

vi.mock('@/hooks/useOrderDetailsStartupEffects', () => ({
  useOrderDetailsStartupEffects: vi.fn(),
}));

vi.mock('@/hooks/useOrderDetailsBackHandler', () => ({
  useOrderDetailsBackHandler: vi.fn(),
}));

vi.mock('@/hooks/useOrderDetailsUiState', () => ({
  useOrderDetailsUiState: () => orderDetailsUiStateMock(),
}));

import { useOrderDetailsController } from './useOrderDetailsController';
import {
  auditEventsState,
  authState,
  fulfillAccessMock,
  giglShippingState,
  merchantState,
  orderDetailsUiStateMock,
  orderState,
  resetControllerState,
  routeParamsState,
  shipmentParameters,
  shipmentUiState,
  staffAccessState,
} from './useOrderDetailsController.test-support';

describe('useOrderDetailsController staff access', () => {
  beforeEach(resetControllerState);

  it('shows the GIG price to staff with only orders.fulfill but never offers wallet booking', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'owner-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'staff-1' };
    staffAccessState.current = { canFulfill: true, canEdit: false };
    giglShippingState.result = { quote: null, wallet: { canBook: true } };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({
      enabled: true,
      preview: true,
    });
    expect(result.current.giglShipping).toBeDefined();
    expect(result.current.canBookGigl).toBe(false);
    // A funded preview must not open Ship Order on "Book with GIG".
    expect(shipmentParameters.current).toMatchObject({
      providerBookingAvailable: false,
    });
  });

  it('lets staff with orders.fulfill and orders.edit book GIG from the wallet', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'owner-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'staff-1' };
    staffAccessState.current = { canFulfill: true, canEdit: true };
    giglShippingState.result = { quote: null, wallet: { canBook: true } };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({
      enabled: true,
      preview: false,
    });
    expect(result.current.canBookGigl).toBe(true);
    expect(shipmentParameters.current).toMatchObject({
      providerBookingAvailable: true,
    });
  });

  it('lets only staff with orders.edit route a rejected checkout quote to review', async () => {
    orderState.current = {
      id: 'order',
      merchant_id: 'merchant',
      payment_status: 'paid',
      shipping_status: 'processing',
      shipping_funding_source: 'customer_checkout',
      shipping_provider: 'GIGL',
      selected_quote_id: 'quote',
    };
    merchantState.current = {
      id: 'merchant',
      user_id: 'owner',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'staff' };
    const { OrderStatusUpdateError } = await import(
      './orders/order-status-update-error'
    );
    const rejection = () =>
      new OrderStatusUpdateError(
        'Review quote',
        'SHIPPING_QUOTE_RECONFIRM_REQUIRED'
      );

    staffAccessState.current = { canFulfill: true, canEdit: false };
    renderHook(() => useOrderDetailsController());
    await expect(
      shipmentParameters.current?.onProviderBookingError(rejection())
    ).resolves.toBeUndefined();

    staffAccessState.current = { canFulfill: true, canEdit: true };
    renderHook(() => useOrderDetailsController());
    await expect(
      shipmentParameters.current?.onProviderBookingError(rejection())
    ).resolves.toBe('review_checkout_quote');
  });
});
