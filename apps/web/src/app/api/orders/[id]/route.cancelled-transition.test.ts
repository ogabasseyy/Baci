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

vi.mock('@/lib/insurance/notify-activate-protection', () => ({
  maybeNotifyActivateProtection: vi.fn(),
}));

vi.mock('@/lib/order-queries', () => ({
  ORDER_COLUMNS: 'id, shipping_status, shipping_provider, tracking_number',
  ORDER_WITH_ITEMS_QUERY: 'id',
}));

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => ({
  ensurePaidOrderInventoryConfirmed: vi.fn(),
  isSerializedInventoryUnavailableError: () => false,
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
  SerializedInventoryUnavailableError: class extends Error {},
}));

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

vi.mock('@/lib/shipping/order-shipment-booking-utils', () => ({
  isShippingProviderCode: (value: string | null | undefined) =>
    value === 'TOPSHIP' || value === 'GIGL' || value === 'SHIIP',
  OrderShipmentBookingError: class extends Error {},
}));

import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from '@/lib/shipping/order-shipment-booking-lock';
import { PATCH } from './route';

type ExistingOrder = {
  id: string;
  order_number: string;
  shipping_status: string;
  payment_status: string;
  is_credit_order: boolean;
  customer_id: string | null;
  selected_quote_id: string | null;
  shipping_provider: string | null;
  tracking_number: string | null;
  shipment_id: string | null;
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
        return { select: ordersSelect, update: ordersUpdate };
      }
      if (table === 'customers') {
        return {
          select: vi.fn(() => createSelectBuilder({ data: null, error: null })),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return {
    supabase: supabase as unknown as SupabaseClient,
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

describe('PATCH /api/orders/[id] cancelled-order transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
    vi.mocked(getMerchantIdForApiUser).mockResolvedValue('merchant-1');
    vi.mocked(ensurePaidOrderInventoryConfirmed).mockResolvedValue(undefined);
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'claimed',
      lockToken: 'lock-1',
    });
    vi.mocked(clearOrderShipmentBookingLock).mockResolvedValue(undefined);
  });

  it('rejects marking a payment-cancelled order as paid', async () => {
    const { supabase, ordersUpdate } = createSupabaseMock(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'pending',
        payment_status: 'cancelled',
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
      createPatchRequest({ payment_status: 'paid' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('rejects moving a payment-cancelled order back to pending', async () => {
    const { supabase, ordersUpdate } = createSupabaseMock(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'pending',
        payment_status: 'cancelled',
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
      createPatchRequest({ payment_status: 'pending' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PAYMENT_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });

  it('rejects moving a shipping-cancelled order back to pending', async () => {
    const { supabase, ordersUpdate } = createSupabaseMock(
      {
        id: 'order-1',
        order_number: 'BACI-001',
        shipping_status: 'cancelled',
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
      createPatchRequest({ shipping_status: 'pending' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'SHIPPING_CANCELLED_TERMINAL',
    });
    expect(ordersUpdate).not.toHaveBeenCalled();
  });
});
