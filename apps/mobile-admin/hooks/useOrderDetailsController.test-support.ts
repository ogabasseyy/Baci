import { vi } from 'vitest';

export const routeParamsState = {
  current: { id: '123e4567-e89b-42d3-a456-426614174000' } as { id: string },
};

export const orderState = {
  current: undefined as unknown,
};

export const auditEventsState = {
  current: {
    data: [] as unknown[],
    isError: false,
    isLoading: false,
  },
};

export const merchantState = {
  current: null as unknown,
};

export const authState = {
  user: null as { id: string } | null,
};

export const shipmentParameters = {
  current: null as null | {
    onProviderBookingError: (error: unknown) => Promise<unknown>;
  },
};

export const giglShippingState = {
  calls: [] as unknown[],
  prefetchCalls: [] as unknown[],
  result: { quote: null, wallet: null } as {
    quote: null;
    wallet: null | { canBook: boolean };
  },
};

// Staff grants; the owner (merchant.user_id === user.id) always passes, as in
// useOrderFulfillAccess.
export const staffAccessState = {
  current: { canFulfill: false, canEdit: false },
};

export const shipmentUiState = {
  current: { shipmentFlowStep: 'details', showShipmentFlow: false } as {
    shipmentFlowStep: string;
    showShipmentFlow: boolean;
    showStatusModal?: boolean;
  },
};

export function resetControllerState() {
  auditEventsState.current = { data: [], isError: false, isLoading: false };
  orderState.current = undefined;
  merchantState.current = null;
  authState.user = null;
  giglShippingState.calls = [];
  giglShippingState.prefetchCalls = [];
  giglShippingState.result = { quote: null, wallet: null };
  staffAccessState.current = { canFulfill: false, canEdit: false };
  shipmentUiState.current = {
    shipmentFlowStep: 'details',
    showShipmentFlow: false,
    showStatusModal: false,
  };
  routeParamsState.current = { id: '123e4567-e89b-42d3-a456-426614174000' };
}

// Mirrors useOrderFulfillAccess: the owner always passes, staff use grants.
export function fulfillAccessMock() {
  const merchant = merchantState.current as { user_id?: string } | null;
  const isOwner = Boolean(
    authState.user && merchant?.user_id === authState.user.id
  );
  return isOwner
    ? { canFulfill: true, canEdit: true }
    : staffAccessState.current;
}

export function orderShipmentMock() {
  return {
    orderRequiresFulfillment: vi.fn(() => false),
    getOrderFulfillmentIdentifierItems: vi.fn(() => []),
    getOrderGiglInitialAddress: vi.fn(() => ({})),
    updateShipmentFulfillmentDetails: vi.fn((previous) => previous),
    formatShippingProviderName: vi.fn(() => null),
    canUseSelectedShippingProvider: vi.fn(
      (order: {
        selected_quote_id?: string | null;
        shipment_id?: string | null;
        shipping_provider?: string | null;
        tracking_number?: string | null;
      }) =>
        Boolean(
          order.shipping_provider &&
            order.selected_quote_id &&
            !order.tracking_number &&
            !order.shipment_id
        )
    ),
  };
}

export function orderDetailsUiStateMock() {
  return {
    creditNotes: '',
    fulfillmentDetails: { imei: '', items: [], serialNumber: '' },
    fulfillmentItemIndex: 0,
    isGeneratingReceipt: false,
    isShipmentSubmitting: false,
    paymentAmount: '',
    paymentMethod: '',
    paymentNotes: '',
    pendingShipmentMode: 'provider',
    receiptHtml: '',
    riderPhone: '',
    savedRiders: [],
    selectedOrderItem: null,
    setCreditNotes: vi.fn(),
    setFulfillmentDetails: vi.fn(),
    setFulfillmentItemIndex: vi.fn(),
    setIsGeneratingReceipt: vi.fn(),
    setIsShipmentSubmitting: vi.fn(),
    setPaymentAmount: vi.fn(),
    setPaymentMethod: vi.fn(),
    setPaymentNotes: vi.fn(),
    setPendingShipmentMode: vi.fn(),
    setReceiptHtml: vi.fn(),
    setRiderPhone: vi.fn(),
    setSavedRiders: vi.fn(),
    setSelectedOrderItem: vi.fn(),
    setShipmentFlowStep: vi.fn(),
    setShowCreditModal: vi.fn(),
    setShowPaymentOptionModal: vi.fn(),
    setShowReceiptPreview: vi.fn(),
    setShowRecordPaymentModal: vi.fn(),
    setShowShipmentFlow: vi.fn(),
    setShowStatusModal: vi.fn(),
    setSuccessModal: vi.fn(),
    shipmentFlowStep: shipmentUiState.current.shipmentFlowStep,
    showCreditModal: false,
    showPaymentOptionModal: false,
    showReceiptPreview: false,
    showRecordPaymentModal: false,
    showShipmentFlow: shipmentUiState.current.showShipmentFlow,
    showStatusModal: shipmentUiState.current.showStatusModal ?? false,
    successModal: {
      actionLabel: '',
      actionVariant: 'default',
      message: '',
      showAction: false,
      subMessage: '',
      title: 'Success!',
      visible: false,
    },
  };
}
