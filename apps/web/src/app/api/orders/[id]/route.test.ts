import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  getMerchantIdForApiUser: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

vi.mock('@/lib/expo-push', () => ({
  notifyOrderStatusChange: vi.fn(),
}));

const mockNotifyActivateProtection = vi.fn();
vi.mock('@/lib/insurance/notify-activate-protection', () => ({
  maybeNotifyActivateProtection: (...args: unknown[]) =>
    mockNotifyActivateProtection(...args),
}));

vi.mock('@/lib/order-queries', () => ({
  ORDER_COLUMNS: 'id, shipping_status, shipping_provider, tracking_number',
  ORDER_WITH_ITEMS_QUERY: 'id',
}));

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => {
  class MockSerializedInventoryUnavailableError extends Error {
    constructor() {
      super('serialized_inventory_unavailable');
      this.name = 'SerializedInventoryUnavailableError';
    }
  }

  return {
    ensurePaidOrderInventoryConfirmed: vi.fn(),
    isSerializedInventoryUnavailableError: (error: unknown) =>
      error instanceof MockSerializedInventoryUnavailableError,
    rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
    SerializedInventoryUnavailableError:
      MockSerializedInventoryUnavailableError,
  };
});

vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview: vi.fn(),
}));

vi.mock('@/lib/shipping/run-claimed-order-wallet-or-checkout-booking', () => ({
  runClaimedOrderWalletOrCheckoutBooking: vi.fn(),
}));

vi.mock('@/lib/shipping/load-order-gigl-settled-retained-amount', () => ({
  loadOrderGiglSettledRetainedAmount: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  claimOrderShipmentBooking: vi.fn(),
  clearOrderShipmentBookingLock: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-utils', () => {
  class MockOrderShipmentBookingError extends Error {
    readonly code: string;
    readonly status: number;
    readonly details?: {
      availableBalance: number;
      chargedAmount: number;
      shortfall: number;
    };

    constructor(
      message: string,
      status: number,
      code: string,
      _providerReference?: string,
      details?: {
        availableBalance: number;
        chargedAmount: number;
        shortfall: number;
      }
    ) {
      super(message);
      this.name = 'OrderShipmentBookingError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  return {
    isShippingProviderCode: vi.fn(
      (value: string | null | undefined) =>
        value === 'TOPSHIP' || value === 'GIGL' || value === 'SHIIP'
    ),
    OrderShipmentBookingError: MockOrderShipmentBookingError,
  };
});

import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  ensurePaidOrderInventoryConfirmed,
  rollbackOrderStatusAfterInventoryConfirmationFailure,
  SerializedInventoryUnavailableError,
} from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
import { loadOrderGiglSettledRetainedAmount } from '@/lib/shipping/load-order-gigl-settled-retained-amount';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from '@/lib/shipping/order-shipment-booking-lock';
import { OrderShipmentBookingError } from '@/lib/shipping/order-shipment-booking-utils';
import { runClaimedOrderWalletOrCheckoutBooking } from '@/lib/shipping/run-claimed-order-wallet-or-checkout-booking';
import { PATCH } from './route';

type ExistingOrder = {
  id: string;
  order_number: string;
  shipping_status: string;
  payment_status: string;
  payment_method?: string | null;
  is_credit_order: boolean;
  customer_id: string | null;
  selected_quote_id: string | null;
  shipping_provider: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  tracking_number: string | null;
  shipment_id: string | null;
  shipping_address?: Record<string, unknown> | null;
};

type UpdatedOrder = {
  id: string;
  shipping_status: string;
  shipping_provider: string | null;
  tracking_number: string | null;
};

function createSelectBuilder<T>(result: { data: T | null; error: unknown }) {
  const builder = {
    eq: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
  };

  return builder;
}

function createUpdateBuilder<T>(result: { data: T | null; error: unknown }) {
  const builder = {
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
  };

  return builder;
}

function createSupabaseMock(
  existingOrder: ExistingOrder,
  updatedOrder: UpdatedOrder
) {
  const orderSelectBuilder = createSelectBuilder({
    data: existingOrder,
    error: null,
  });
  const orderUpdateBuilder = createUpdateBuilder({
    data: updatedOrder,
    error: null,
  });

  const ordersSelect = vi.fn(() => orderSelectBuilder);
  const ordersUpdate = vi.fn(() => orderUpdateBuilder);

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: ordersSelect,
          update: ordersUpdate,
        };
      }

      if (table === 'customers') {
        return {
          select: vi.fn(() =>
            createSelectBuilder({
              data: null,
              error: null,
            })
          ),
        };
      }

      if (table === 'merchant_settlements') {
        const retained = Number(
          existingOrder.shipping_platform_retained_amount ??
            (existingOrder.shipping_funding_source === 'customer_checkout'
              ? 1500
              : 0)
        );
        const eqSourceId = vi.fn().mockResolvedValue({
          data:
            retained > 0
              ? [
                  {
                    metadata: { retained_shipping_amount: retained },
                    status: 'completed',
                  },
                ]
              : [],
          error: null,
        });
        const eqSourceType = vi.fn(() => ({ eq: eqSourceId }));
        const eqMerchant = vi.fn(() => ({ eq: eqSourceType }));
        return {
          select: vi.fn(() => ({ eq: eqMerchant })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase: supabase as unknown as SupabaseClient,
    orderUpdateBuilder,
    ordersUpdate,
  };
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
  } as NextRequest;
}

function createMockUser(): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

describe('PATCH /api/orders/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
    vi.mocked(getMerchantIdForApiUser).mockResolvedValue('merchant-1');
    vi.mocked(ensurePaidOrderInventoryConfirmed).mockResolvedValue(undefined);
    vi.mocked(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).mockResolvedValue(undefined);
    vi.mocked(fileInventoryConfirmationFailureReview).mockResolvedValue(
      undefined
    );
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'claimed',
      lockToken: 'lock-1',
    });
  });

  it('rejects an invalid status before reading or updating the order', async () => {
    const { supabase } = createSupabaseMock(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'pending',
        payment_status: 'paid',
        is_credit_order: false,
        customer_id: null,
        selected_quote_id: null,
        shipping_provider: null,
        tracking_number: null,
        shipment_id: null,
      },
      {
        id: 'order-1',
        shipping_status: 'pending',
        shipping_provider: null,
        tracking_number: null,
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'teleported' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST_BODY',
    });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
  });

  it('rejects cancellation through the generic status update route', async () => {
    const { supabase, ordersUpdate } = createSupabaseMock(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'processing',
        payment_status: 'paid',
        is_credit_order: false,
        customer_id: null,
        selected_quote_id: null,
        shipping_provider: null,
        tracking_number: null,
        shipment_id: null,
      },
      {
        id: 'order-1',
        shipping_status: 'cancelled',
        shipping_provider: null,
        tracking_number: null,
      }
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'cancelled' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'USE_CANCELLATION_ENDPOINT',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('queues the activation reminder when an order is marked completed', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'shipped',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: 'cust-1',
      selected_quote_id: null,
      shipping_provider: null,
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'completed',
      shipping_provider: null,
      tracking_number: null,
    };
    const { supabase } = createSupabaseMock(existingOrder, updatedOrder);
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'completed' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(200);
    // `completed` (not just `delivered`) must queue the one-time reminder.
    await vi.waitFor(() =>
      expect(mockNotifyActivateProtection).toHaveBeenCalledWith('order-1')
    );
  });

  it('rejects shipping an order that has not reached processing', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'pending',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'Order must be processing before it can be marked as shipped.',
      code: 'ORDER_NOT_READY_TO_SHIP',
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
  });

  it('rejects provider shipping when the order has no saved quote', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: null,
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error:
        'This provider order does not have a saved shipping quote. Please re-quote before marking it as shipped.',
      code: 'MISSING_SHIPPING_QUOTE',
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
  });

  it('books a provider shipment when the order is marked as shipped', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockResolvedValue({
      shipmentId: 'shipment-1',
      provider: 'TOPSHIP',
      quoteId: 'quote-2',
      trackingNumber: 'TRACK-1',
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(claimOrderShipmentBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
      }),
      expect.any(Object)
    );
    expect(ordersUpdate).toHaveBeenCalledWith({
      selected_quote_id: 'quote-2',
      shipment_id: 'shipment-1',
      shipment_booking_lock_token: null,
      shipment_booking_started_at: null,
      shipping_provider: 'TOPSHIP',
      shipping_status: 'shipped',
      tracking_number: 'TRACK-1',
    });
    expect(payload).toEqual({ order: updatedOrder });
  });

  it('invalidates a bound quote when the shipping address is edited', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
      shipping_address: {
        address: '1 Old Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'processing',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(200);
    expect(ordersUpdate).toHaveBeenCalledWith({
      selected_quote_id: null,
      shipping_address: {
        address: '2 New Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
  });

  it('clears merchant-wallet funding when invalidating a bound GIGL quote', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'merchant_wallet',
      tracking_number: null,
      shipment_id: null,
      shipping_address: {
        address: '1 Old Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'processing',
      shipping_provider: 'GIGL',
      tracking_number: null,
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(200);
    expect(ordersUpdate).toHaveBeenCalledWith({
      selected_quote_id: null,
      shipping_funding_source: null,
      shipping_address: {
        address: '2 New Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
  });

  it('bugfix: rejects funded checkout address edits before clearing the quote', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      payment_method: 'paystack',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'customer_checkout',
      shipping_platform_retained_amount: 2500,
      tracking_number: null,
      shipment_id: null,
      shipping_address: {
        address: '1 Old Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'processing',
      shipping_provider: 'GIGL',
      tracking_number: null,
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(2500);

    const response = await PATCH(
      createPatchRequest({
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: 'FUNDED_CHECKOUT_ADDRESS_LOCKED',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
    expect(loadOrderGiglSettledRetainedAmount).toHaveBeenCalledWith(
      expect.anything(),
      'merchant-1',
      'order-1'
    );
  });

  it('bugfix: locks partially_paid checkout address edits when retention exists', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'partially_paid',
      payment_method: 'paystack',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'customer_checkout',
      shipping_platform_retained_amount: 2500,
      tracking_number: null,
      shipment_id: null,
      shipping_address: {
        address: '1 Old Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'processing',
      shipping_provider: 'GIGL',
      tracking_number: null,
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(loadOrderGiglSettledRetainedAmount).mockResolvedValue(2500);

    const response = await PATCH(
      createPatchRequest({
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'FUNDED_CHECKOUT_ADDRESS_LOCKED',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('bugfix: returns 409 when an active wallet charge blocks address edits', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'merchant_wallet',
      tracking_number: null,
      shipment_id: null,
      shipping_address: {
        address: '1 Old Street',
        city: 'Lagos',
        state: 'Lagos',
      },
    };
    const orderSelectBuilder = createSelectBuilder({
      data: existingOrder,
      error: null,
    });
    const orderUpdateBuilder = createUpdateBuilder({
      data: null,
      error: {
        message: 'active_shipping_charge_address_edit_blocked',
        code: 'P0001',
      },
    });
    const ordersUpdate = vi.fn(() => orderUpdateBuilder);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'orders') {
          return {
            select: vi.fn(() => orderSelectBuilder),
            update: ordersUpdate,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'active_shipping_charge_address_edit_blocked',
    });
    expect(ordersUpdate).toHaveBeenCalled();
  });

  it('requires re-quoting instead of shipping after editing a bound address', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({
        shipping_status: 'shipped',
        shipping_address: {
          address: '2 New Street',
          city: 'Lagos',
          state: 'Lagos',
        },
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SHIPPING_QUOTE_INVALIDATED',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
  });

  it('persists paid provider shipment status before inventory confirmation and booking', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'pending',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockResolvedValue({
      shipmentId: 'shipment-1',
      provider: 'TOPSHIP',
      quoteId: 'quote-2',
      trackingNumber: 'TRACK-1',
    });

    const response = await PATCH(
      createPatchRequest({
        payment_status: 'paid',
        shipping_status: 'shipped',
      }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );

    expect(response.status).toBe(200);
    expect(ensurePaidOrderInventoryConfirmed).toHaveBeenCalledTimes(1);
    expect(ensurePaidOrderInventoryConfirmed).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(ordersUpdate).toHaveBeenNthCalledWith(1, {
      payment_status: 'paid',
    });
    expect(
      vi.mocked(ensurePaidOrderInventoryConfirmed).mock.invocationCallOrder[0]
    ).toBeGreaterThan(ordersUpdate.mock.invocationCallOrder[0]);
    expect(
      vi.mocked(ensurePaidOrderInventoryConfirmed).mock.invocationCallOrder[0]
    ).toBeLessThan(
      vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mock
        .invocationCallOrder[0]
    );
    expect(ordersUpdate).toHaveBeenNthCalledWith(2, {
      selected_quote_id: 'quote-2',
      shipment_id: 'shipment-1',
      shipment_booking_lock_token: null,
      shipment_booking_started_at: null,
      shipping_provider: 'TOPSHIP',
      shipping_status: 'shipped',
      tracking_number: 'TRACK-1',
    });
  });

  it('books prepaid GIGL checkout shipments using the requested paid status', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'pending',
      payment_method: 'card',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'GIGL',
      shipping_funding_source: 'customer_checkout',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'GIGL',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockResolvedValue({
      shipmentId: 'shipment-1',
      provider: 'GIGL',
      quoteId: 'quote-1',
      trackingNumber: 'TRACK-1',
    });

    const response = await PATCH(
      createPatchRequest({
        payment_status: 'paid',
        shipping_status: 'shipped',
      }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );

    expect(response.status).toBe(200);
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
        shipping_provider: 'GIGL',
      }),
      expect.objectContaining({
        paymentStatus: 'paid',
      })
    );
    expect(ordersUpdate).toHaveBeenNthCalledWith(1, {
      payment_status: 'paid',
    });
  });

  it('confirms paid non-provider status changes before committing fulfillment', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'pending',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: null,
      shipping_provider: null,
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: null,
      tracking_number: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createPatchRequest({
        payment_status: 'paid',
        shipping_status: 'shipped',
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(200);
    expect(ordersUpdate).toHaveBeenNthCalledWith(1, {
      payment_status: 'paid',
    });
    expect(
      vi.mocked(ensurePaidOrderInventoryConfirmed).mock.invocationCallOrder[0]
    ).toBeLessThan(ordersUpdate.mock.invocationCallOrder[1] ?? 0);
    expect(ordersUpdate).toHaveBeenNthCalledWith(2, {
      shipping_status: 'shipped',
    });
  });

  it('files reconciliation review when the paid pre-update rollback also fails', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'pending',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: null,
      shipping_provider: null,
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase, orderUpdateBuilder } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: null,
      tracking_number: null,
    });
    orderUpdateBuilder.single
      .mockResolvedValueOnce({ data: { id: 'order-1' }, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'fulfillment update failed' },
      });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).mockRejectedValueOnce(new Error('rollback failed'));

    const response = await PATCH(
      createPatchRequest({
        payment_status: 'paid',
        shipping_status: 'shipped',
      }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(500);
    expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).toHaveBeenCalledWith(supabase, 'merchant-1', 'order-1', {
      payment_status: 'pending',
      shipping_status: 'processing',
    });
    expect(fileInventoryConfirmationFailureReview).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId: 'merchant-1',
        metadata: expect.objectContaining({
          rollbackError: 'rollback failed',
          source: 'merchant_fulfillment_update_after_inventory_confirmation',
        }),
        orderId: 'order-1',
      })
    );
  });

  it('does not book a paid provider shipment when serialized inventory is unavailable', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'pending',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(ensurePaidOrderInventoryConfirmed).mockRejectedValue(
      new SerializedInventoryUnavailableError()
    );

    const response = await PATCH(
      createPatchRequest({
        payment_status: 'paid',
        shipping_status: 'shipped',
      }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      code: 'serialized_inventory_unavailable',
      error: 'serialized_inventory_unavailable',
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
    expect(claimOrderShipmentBooking).not.toHaveBeenCalled();
    expect(ordersUpdate).toHaveBeenCalledWith({ payment_status: 'paid' });
    expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).toHaveBeenCalledWith(supabase, 'merchant-1', 'order-1', {
      payment_status: 'pending',
      shipping_status: 'processing',
    });
  });

  it('files reconciliation review when paid-status inventory confirmation and rollback both fail', async () => {
    const inventoryError = new Error('Serialized inventory missing');
    const rollbackError = new Error('Rollback lost update');
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'pending',
      payment_status: 'pending',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: null,
      shipping_provider: null,
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'pending',
      shipping_provider: null,
      tracking_number: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(ensurePaidOrderInventoryConfirmed).mockRejectedValue(
      inventoryError
    );
    vi.mocked(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).mockRejectedValue(rollbackError);

    const response = await PATCH(
      createPatchRequest({ payment_status: 'paid' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({
      code: 'INVENTORY_CONFIRMATION_FAILED',
      error: 'Inventory confirmation failed',
    });
    expect(ordersUpdate).toHaveBeenCalledWith({ payment_status: 'paid' });
    expect(ensurePaidOrderInventoryConfirmed).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(
      rollbackOrderStatusAfterInventoryConfirmationFailure
    ).toHaveBeenCalledWith(supabase, 'merchant-1', 'order-1', {
      payment_status: 'pending',
      shipping_status: 'pending',
    });
    expect(fileInventoryConfirmationFailureReview).toHaveBeenCalledWith({
      gatewayReference: null,
      merchantId: 'merchant-1',
      metadata: {
        inventoryError: 'Serialized inventory missing',
        rollbackError: 'Rollback lost update',
        source: 'merchant_order_status_update',
      },
      orderId: 'order-1',
      reason:
        'Order status update reached paid state, but serialized inventory confirmation and status rollback both failed.',
      transactionId: null,
    });
  });

  it('books provider shipment without lock fields when the database lock is unavailable', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'claimed',
      lockToken: null,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockResolvedValue({
      shipmentId: 'shipment-1',
      provider: 'TOPSHIP',
      quoteId: 'quote-2',
      trackingNumber: 'TRACK-1',
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(ordersUpdate).toHaveBeenCalledWith({
      selected_quote_id: 'quote-2',
      shipment_id: 'shipment-1',
      shipping_provider: 'TOPSHIP',
      shipping_status: 'shipped',
      tracking_number: 'TRACK-1',
    });
    expect(payload).toEqual({ order: updatedOrder });
  });

  it('returns booking errors without updating the order', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockRejectedValue(
      new OrderShipmentBookingError(
        'Quote is already being used for shipping.',
        409,
        'QUOTE_ALREADY_USED'
      )
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(claimOrderShipmentBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
      }),
      expect.any(Object)
    );
    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: 'Quote is already being used for shipping.',
      code: 'QUOTE_ALREADY_USED',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();
  });

  it('returns the wallet snapshot when a merchant-wallet booking is short', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockRejectedValue(
      new OrderShipmentBookingError(
        'Insufficient merchant wallet balance.',
        409,
        'MERCHANT_WALLET_INSUFFICIENT',
        undefined,
        {
          availableBalance: 1200,
          chargedAmount: 4500,
          shortfall: 3300,
        }
      )
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Insufficient merchant wallet balance.',
      code: 'MERCHANT_WALLET_INSUFFICIENT',
      availableBalance: 1200,
      chargedAmount: 4500,
      shortfall: 3300,
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 when shipment booking fails unexpectedly', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {
        // Silence expected error logging for this assertion.
      });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(runClaimedOrderWalletOrCheckoutBooking).mockRejectedValue(
      new Error('Topship wallet unavailable')
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(claimOrderShipmentBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1'
    );
    expect(runClaimedOrderWalletOrCheckoutBooking).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      expect.objectContaining({
        selected_quote_id: 'quote-1',
      }),
      expect.any(Object)
    );
    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: 'Internal server error' });
    expect(ordersUpdate).not.toHaveBeenCalled();
    expect(clearOrderShipmentBookingLock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('returns 409 when another request already owns the shipment booking lock', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const { supabase, ordersUpdate } = createSupabaseMock(existingOrder, {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    });

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'in_progress',
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({
      error: 'Shipment booking is already in progress for this order.',
      code: 'SHIPMENT_BOOKING_IN_PROGRESS',
    });
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('skips provider booking when another request already attached the shipment', async () => {
    const existingOrder: ExistingOrder = {
      id: 'order-1',
      order_number: 'BACI-001',
      shipping_status: 'processing',
      payment_status: 'paid',
      is_credit_order: false,
      customer_id: null,
      selected_quote_id: 'quote-1',
      shipping_provider: 'TOPSHIP',
      tracking_number: null,
      shipment_id: null,
    };
    const updatedOrder: UpdatedOrder = {
      id: 'order-1',
      shipping_status: 'shipped',
      shipping_provider: 'TOPSHIP',
      tracking_number: 'TRACK-1',
    };
    const { supabase, ordersUpdate } = createSupabaseMock(
      existingOrder,
      updatedOrder
    );

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'already_booked',
    });

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      {
        params: Promise.resolve({ id: 'order-1' }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(runClaimedOrderWalletOrCheckoutBooking).not.toHaveBeenCalled();
    expect(ordersUpdate).toHaveBeenCalledWith({
      shipping_status: 'shipped',
    });
    expect(payload).toEqual({ order: updatedOrder });
  });
});
