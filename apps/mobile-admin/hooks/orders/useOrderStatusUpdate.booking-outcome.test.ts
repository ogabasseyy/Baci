import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getSession: vi.fn(),
  alert: vi.fn(),
  invalidateQueries: vi.fn(),
}));
vi.stubGlobal('fetch', mocks.fetch);
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
vi.mock('@/lib/api-client', () => ({ BASE_URL: 'https://example.test' }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));
vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));
vi.mock('@/lib/order-shipment', () => ({
  areFulfillmentDetailsComplete: vi.fn(() => true),
  getDispatchPhoneFromOrder: vi.fn(),
  getFirstIncompleteFulfillmentItemIndex: vi.fn(() => 0),
  getInitialFulfillmentDetails: vi.fn(),
  shouldPersistFulfillmentDetails: vi.fn(() => false),
  buildOrderFulfillmentDetailsForPersistence: vi.fn(),
}));
vi.mock('@tanstack/react-query', async () => ({
  ...(await vi.importActual('@tanstack/react-query')),
  useMutation: vi.fn((options) => options),
  useQueryClient: () => ({
    cancelQueries: vi.fn(),
    getQueriesData: vi.fn(() => []),
    invalidateQueries: mocks.invalidateQueries,
    setQueriesData: vi.fn(),
  }),
}));

import { createOrderDetailsShipmentActions } from '../createOrderDetailsShipmentActions';
import { useUpdateOrderStatus } from './useOrderStatusUpdate';

function useBookingActions() {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: 3, retryDelay: 0, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  const mutation = new MutationObserver(
    client,
    useUpdateOrderStatus() as unknown as ConstructorParameters<
      typeof MutationObserver
    >[1]
  );
  const setShowShipmentFlow = vi.fn();
  const actions = createOrderDetailsShipmentActions({
    fulfillmentDetails: { imei: '', serialNumber: '', items: [] },
    fulfillmentItemIndex: 0,
    fulfillmentItems: [],
    handleSaveRider: vi.fn(),
    merchantId: 'merchant-1',
    order: { id: 'order-1' } as Parameters<
      typeof createOrderDetailsShipmentActions
    >[0]['order'],
    pendingShipmentMode: 'provider',
    providerBookingAvailable: true,
    providerLabel: 'GIG Logistics',
    queryClient: client,
    requiresShipmentDetails: false,
    riderPhone: '',
    setFulfillmentDetails: vi.fn(),
    setFulfillmentItemIndex: vi.fn(),
    setIsShipmentSubmitting: vi.fn(),
    setPendingShipmentMode: vi.fn(),
    setRiderPhone: vi.fn(),
    setShipmentFlowStep: vi.fn(),
    setShowShipmentFlow,
    setShowStatusModal: vi.fn(),
    setSuccessModal: vi.fn(),
    shipmentFlowStep: 'method',
    showShipmentFlow: true,
    updateStatus: (input) => mutation.mutate(input),
  });
  return { actions, setShowShipmentFlow };
}

describe('provider booking result through the real status mutation and shipment flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: 'test-token' } },
    });
  });

  it.each([
    [500, 'SHIPMENT_SAVE_FAILED'],
    [500, 'INTERNAL_ERROR'],
    [502, 'BOOKING_FAILED'],
    [500, 'INVENTORY_CONFIRMATION_FAILED'],
  ])('closes the flow after an indeterminate typed HTTP %s/%s', async (status, code) => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Carrier booked but local shipment could not be saved',
          code,
        }),
        { status }
      )
    );
    const { actions, setShowShipmentFlow } = useBookingActions();

    await actions.proceedFromShipmentMethod();

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(setShowShipmentFlow).toHaveBeenCalledWith(false);
    expect(mocks.alert).toHaveBeenCalledWith(
      'Check shipment status',
      expect.stringContaining('before booking again')
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['order', 'order-1'],
    });
  });
  it.each([
    [400, 'SHIPPING_QUOTE_RECEIVER_MISMATCH'],
    [401, 'UNAUTHORIZED'],
    [504, 'GIGL_AUTHENTICATION_FAILED'],
    [502, 'GIGL_INTERNATIONAL_COUNTRY_LOOKUP_FAILED'],
    [500, 'SHIPMENT_BOOKING_LOCK_FAILED'],
    [500, 'MERCHANT_LOOKUP_FAILED'],
    [500, 'MERCHANT_SENDER_REQUIRED'],
    [500, 'QUOTE_ECONOMICS_LOOKUP_FAILED'],
    [500, 'QUOTE_METADATA_LOOKUP_FAILED'],
    [500, 'QUOTE_REFRESH_PERSIST_FAILED'],
    [500, 'QUOTE_REFRESH_ORDER_UPDATE_FAILED'],
    [400, 'UNKNOWN_INPUT_ERROR'],
  ])('keeps the definitive pre-booking HTTP %s/%s error in the flow', async (status, code) => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Explicit server rejection',
          code,
        }),
        { status }
      )
    );
    const { actions, setShowShipmentFlow } = useBookingActions();

    await actions.proceedFromShipmentMethod();

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(setShowShipmentFlow).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      'Error',
      'Explicit server rejection'
    );
  });
});
