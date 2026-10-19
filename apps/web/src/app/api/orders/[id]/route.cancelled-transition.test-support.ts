// Shared harness for the cancelled-transition route tests: order
// fixtures, the Supabase mock, default mock wiring, and PATCH
// invocation helpers live here so the focused test file (which owns
// the vi.mock factories) stays below the 300-line limit.

import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { vi } from 'vitest';

import { getMerchantIdForApiUser } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { ensurePaidOrderInventoryConfirmed } from '@/lib/payments/ensure-paid-order-inventory-confirmed';
import {
  claimOrderShipmentBooking,
  clearOrderShipmentBookingLock,
} from '@/lib/shipping/order-shipment-booking-lock';

export interface ExistingOrderFixture {
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
}

export interface UpdatedOrderFixture {
  id: string;
  shipping_status: string;
  shipping_provider: string | null;
  tracking_number: string | null;
}

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
    neq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
  };
  return builder;
}

export function createCancelledTransitionHarness(
  existingOrder: ExistingOrderFixture,
  updatedOrder: UpdatedOrderFixture,
  options?: { failMainUpdateWithPgrst116?: boolean }
) {
  const orderSelectBuilder = createSelectBuilder({
    data: existingOrder,
    error: null,
  });
  const orderUpdateBuilder = options?.failMainUpdateWithPgrst116
    ? createUpdateBuilder({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      })
    : createUpdateBuilder({
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

export function createPatchRequest(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
  } as NextRequest;
}

export function createMockUser(): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

export function setupCancelledTransitionMocks(): void {
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
}
