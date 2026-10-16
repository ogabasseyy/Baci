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

  it('closes the flow after SHIPMENT_SAVE_FAILED even though the response is a typed HTTP 500', async () => {
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Carrier booked but local shipment could not be saved',
          code: 'SHIPMENT_SAVE_FAILED',
        }),
        { status: 500 }
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
});
