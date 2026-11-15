// @vitest-environment jsdom

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

vi.mock('@/hooks/orders/refundEvidenceBlocksChoice', () => ({
  refundEvidenceBlocksChoice: vi.fn().mockResolvedValue(false),
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
} from './useOrderDetailsController.test-support';

describe('useOrderDetailsController', () => {
  beforeEach(resetControllerState);

  it('returns null orderId when route params are invalid', () => {
    orderState.current = undefined;
    routeParamsState.current = { id: 'not-a-uuid' };
    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.orderId).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isInvalidRoute).toBe(true);
  });

  it('uses NGN as fallback currency when merchant has no payout_currency', () => {
    orderState.current = undefined;
    routeParamsState.current = { id: '123e4567-e89b-42d3-a456-426614174000' };
    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.formatPrice(1000)).toContain('₦');
  });

  it('uses the delivered status config for legacy fulfilled orders', () => {
    routeParamsState.current = { id: '123e4567-e89b-42d3-a456-426614174000' };
    orderState.current = {
      amount_paid: 0,
      created_at: '2026-04-21T00:00:00.000Z',
      currency: 'NGN',
      customer_email: 'ada@example.com',
      customer_name: 'Ada',
      customer_phone: '08000000000',
      discount_amount: 0,
      id: 'order-1',
      merchant_id: 'merchant-1',
      notes: null,
      order_number: 'ORD-1',
      payment_method: null,
      payment_status: 'pending',
      shipping_fee: 0,
      shipping_status: 'fulfilled',
      source: 'website',
      subtotal: 1000,
      tax_amount: 0,
      total: 1000,
      updated_at: '2026-04-21T00:00:00.000Z',
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.shippingConfig.label).toBe('Delivered');
  });

  it("formats using the order's own stamped currency even when the merchant's current payout currency differs", () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'INR' };
    orderState.current = {
      amount_paid: 0,
      created_at: '2026-04-21T00:00:00.000Z',
      currency: 'GHS',
      customer_email: 'ada@example.com',
      customer_name: 'Ada',
      customer_phone: '08000000000',
      discount_amount: 0,
      id: 'order-1',
      merchant_id: 'merchant-1',
      notes: null,
      order_number: 'ORD-1',
      payment_method: null,
      payment_status: 'pending',
      shipping_fee: 0,
      shipping_status: 'processing',
      source: 'website',
      subtotal: 1000,
      tax_amount: 0,
      total: 1000,
      updated_at: '2026-04-21T00:00:00.000Z',
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.orderCurrency).toBe('GHS');
    expect(result.current.currencySymbol).toBe('GH₵');
    expect(result.current.formatPrice(1000)).toContain('GH₵');
    expect(result.current.formatPrice(1000)).not.toContain('₹');
  });

  it("falls back to the merchant's payout currency when the order has no stamped currency", () => {
    merchantState.current = { id: 'merchant-1', payout_currency: 'INR' };
    orderState.current = {
      amount_paid: 0,
      created_at: '2026-04-21T00:00:00.000Z',
      currency: null,
      customer_email: 'ada@example.com',
      customer_name: 'Ada',
      customer_phone: '08000000000',
      discount_amount: 0,
      id: 'order-1',
      merchant_id: 'merchant-1',
      notes: null,
      order_number: 'ORD-1',
      payment_method: null,
      payment_status: 'pending',
      shipping_fee: 0,
      shipping_status: 'processing',
      source: 'website',
      subtotal: 1000,
      tax_amount: 0,
      total: 1000,
      updated_at: '2026-04-21T00:00:00.000Z',
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.orderCurrency).toBe('INR');
    expect(result.current.formatPrice(1000)).toContain('₹');
  });

  it('returns audit events and loading state from the audit query', () => {
    auditEventsState.current = {
      data: [{ id: 'audit-1', changed_fields: ['items'] }],
      isError: false,
      isLoading: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.auditEvents).toEqual([
      { id: 'audit-1', changed_fields: ['items'] },
    ]);
    expect(result.current.isAuditEventsLoading).toBe(true);
    expect(result.current.isAuditEventsError).toBe(false);
  });

  it('returns audit event error state from the audit query', () => {
    auditEventsState.current = {
      data: [],
      isError: true,
      isLoading: false,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(result.current.isAuditEventsError).toBe(true);
    expect(result.current.auditEvents).toEqual([]);
  });

  it('does not start or expose GIGL for a merchant outside NG/NGN eligibility', () => {
    merchantState.current = {
      id: 'merchant-1',
      country: 'GH',
      payout_currency: 'NGN',
    };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({ enabled: false });
    expect(result.current.giglShipping).toBeUndefined();
  });

  it('starts and exposes GIGL for an eligible NG/NGN merchant with GIGL enabled', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'user-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'user-1' };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({ enabled: true });
    expect(result.current.giglShipping).toEqual({ quote: null, wallet: null });
  });

  it('hides wallet-backed GIGL shipping from staff accounts', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'owner-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'staff-1' };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({ enabled: false });
    expect(result.current.giglShipping).toBeUndefined();
  });

  it('keeps saved merchant-wallet GIGL orders bookable while funding remains available', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'owner-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'owner-1' };
    orderState.current = {
      id: 'order-1',
      merchant_id: 'merchant-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'merchant_wallet',
      selected_quote_id: 'quote-1',
    };
    shipmentUiState.current = {
      shipmentFlowStep: 'method',
      showShipmentFlow: true,
    };

    const { result } = renderHook(() => useOrderDetailsController());

    expect(giglShippingState.calls.at(-1)).toMatchObject({ enabled: true });
    expect(result.current.providerBookingAvailable).toBe(true);
    expect(result.current.giglShipping).toEqual({ quote: null, wallet: null });
  });

  it('starts the GIG price prefetch only once the owner opens the status sheet', () => {
    merchantState.current = {
      id: 'merchant-1',
      user_id: 'user-1',
      country: 'NG',
      payout_currency: 'NGN',
    };
    authState.user = { id: 'user-1' };

    const { rerender } = renderHook(() => useOrderDetailsController());
    expect(giglShippingState.prefetchCalls.at(-1)).toMatchObject({
      enabled: false,
    });

    shipmentUiState.current = {
      shipmentFlowStep: 'details',
      showShipmentFlow: false,
      showStatusModal: true,
    };
    rerender();

    expect(giglShippingState.prefetchCalls.at(-1)).toMatchObject({
      enabled: true,
    });
  });
});

// Controller wiring retains the explicit outcome consumed by ShipmentFlowSheet.
it('routes eligible checkout quote rejection through the controller without wallet requoting', async () => {
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
  authState.user = { id: 'owner' };
  renderHook(() => useOrderDetailsController());
  const { OrderStatusUpdateError } = await import(
    './orders/order-status-update-error'
  );
  await expect(
    shipmentParameters.current?.onProviderBookingError(
      new OrderStatusUpdateError(
        'Review quote',
        'SHIPPING_QUOTE_RECONFIRM_REQUIRED'
      )
    )
  ).resolves.toBe('review_checkout_quote');
  authState.user = { id: 'staff' };

  renderHook(() => useOrderDetailsController());
  await expect(
    shipmentParameters.current?.onProviderBookingError(
      new OrderStatusUpdateError(
        'Review quote',
        'SHIPPING_QUOTE_RECONFIRM_REQUIRED'
      )
    )
  ).resolves.toBeUndefined();
});
