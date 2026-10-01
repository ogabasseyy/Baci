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
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi.fn(),
  SerializedInventoryUnavailableError: class extends Error {},
}));

vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview: vi.fn(),
}));

vi.mock('@/lib/shipping/run-claimed-order-wallet-or-checkout-booking', () => ({
  runClaimedOrderWalletOrCheckoutBooking: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-lock', () => ({
  claimOrderShipmentBooking: vi.fn(),
  clearOrderShipmentBookingLock: vi.fn(),
}));

vi.mock('@/lib/shipping/order-shipment-booking-utils', () => {
  class MockOrderShipmentBookingError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(message: string, status: number, code: string) {
      super(message);
      this.name = 'OrderShipmentBookingError';
      this.status = status;
      this.code = code;
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
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import { fileInventoryConfirmationFailureReview } from '@/lib/payments/file-inventory-confirmation-review';
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
    orderUpdateBuilder,
    ordersUpdate,
  };
}

function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as NextRequest;
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

describe('PATCH /api/orders/[id] booking validation failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
    vi.mocked(getMerchantIdForApiUser).mockResolvedValue('merchant-1');
    vi.mocked(ensurePaidOrderInventoryConfirmed).mockResolvedValue(undefined);
    vi.mocked(fileInventoryConfirmationFailureReview).mockResolvedValue(
      undefined
    );
    vi.mocked(claimOrderShipmentBooking).mockResolvedValue({
      status: 'claimed',
      lockToken: 'lock-1',
    });
  });

  it.each([
    [
      'INCOMPLETE_SHIPPING_ADDRESS',
      'Complete shipping address is required before booking shipment',
    ],
    [
      'INTERNATIONAL_QUOTE_REQUEST_MISSING',
      'Saved international quote request not found',
    ],
    [
      'INTERNATIONAL_QUOTE_ORDER_MISMATCH',
      'The saved international shipping quote no longer matches this order.',
    ],
    [
      'INTERNATIONAL_QUOTE_ITEM_METADATA_MISMATCH',
      'The saved international shipping quote no longer matches the current product shipping details.',
    ],
    [
      'SHIPPING_PROVIDER_DISABLED',
      'Provider TOPSHIP is disabled for new shipments',
    ],
    [
      'GIGL_INTERNATIONAL_COUNTRY_LOOKUP_FAILED',
      'GIGL international destination country lookup failed',
    ],
    [
      'GIGL_INTERNATIONAL_DESTINATION_COUNTRY_NOT_FOUND',
      'GIGL international destination country not found',
    ],
    [
      'GIGL_INTERNATIONAL_ITEM_HS_CODE_MISSING',
      'HS code is required for international item',
    ],
    [
      'GIGL_INTERNATIONAL_ITEM_PACKAGE_LIMIT',
      'Too many packages for one GIGL international item',
    ],
    [
      'GIGL_INTERNATIONAL_SHIPMENT_PACKAGE_LIMIT',
      'Too many packages for GIGL international shipment',
    ],
    [
      'GIGL_INTERNATIONAL_RATE_INVALID',
      'Selected GIGL international rate is invalid',
    ],
    [
      'GIGL_BOOKING_VALIDATION_FAILED',
      'GIGL rejected the shipment booking request. Please correct the order details and try again.',
    ],
  ])('releases the booking lock for %s', async (code, message) => {
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
      new OrderShipmentBookingError(message, 400, code)
    );

    const response = await PATCH(
      createPatchRequest({ shipping_status: 'shipped' }),
      { params: Promise.resolve({ id: 'order-1' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({ error: message, code });
    expect(clearOrderShipmentBookingLock).toHaveBeenCalledWith(
      supabase,
      'merchant-1',
      'order-1',
      'lock-1'
    );
    expect(ordersUpdate).not.toHaveBeenCalled();
  });
});
