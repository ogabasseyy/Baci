import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(),
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { PATCH } from './route';
import {
  createEditRouteSupabaseMock,
  editResult,
  updatedOrder,
  validPayload,
} from './route.test-support';

function createMockUser(): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

function createRequest(body: unknown): NextRequest {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

function createThrowingJsonRequest(): NextRequest {
  return {
    headers: new Headers(),
    json: vi.fn().mockRejectedValue(new Error('bad json')),
  } as unknown as NextRequest;
}

function callPatch(request: NextRequest) {
  return PATCH(request, {
    params: Promise.resolve({
      id: '11111111-1111-4111-8111-111111111111',
    }),
  });
}

function mockAuthenticated(supabase: SupabaseClient) {
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    error: null,
    supabase,
    user: createMockUser(),
  });
}

describe('PATCH /api/orders/[id]/edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
  });

  it('returns 401 before parsing JSON when authentication fails', async () => {
    const request = createRequest(validPayload);
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: 'Not authenticated',
      supabase: null,
      user: null,
    });

    const response = await callPatch(request);

    expect(response.status).toBe(401);
    expect(request.json).not.toHaveBeenCalled();
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF validation fails', async () => {
    const { supabase } = createEditRouteSupabaseMock();
    mockAuthenticated(supabase);
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: false,
      response: undefined,
    });

    const response = await callPatch(createRequest(validPayload));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({ error: 'CSRF validation failed' });
  });

  it('returns 400 for invalid JSON', async () => {
    const { supabase } = createEditRouteSupabaseMock();
    mockAuthenticated(supabase);
    const response = await callPatch(createThrowingJsonRequest());

    expect(response.status).toBe(400);
  });

  it('returns 400 for invalid schema payloads', async () => {
    const { supabase } = createEditRouteSupabaseMock();
    mockAuthenticated(supabase);
    const response = await callPatch(
      createRequest({ ...validPayload, customer: { name: '' } })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid request');
  });

  it('calls the checked RPC and returns the refreshed mobile order', async () => {
    const { rpc, select, supabase } = createEditRouteSupabaseMock();
    mockAuthenticated(supabase);
    const response = await callPatch(createRequest(validPayload));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'update_admin_order_with_transaction_discount_metadata',
      {
        p_order_id: '11111111-1111-4111-8111-111111111111',
        p_payload: validPayload,
      }
    );
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining('order_items(')
    );
    expect(payload).toEqual({
      edit: editResult,
      order: {
        id: updatedOrder.id,
        items: updatedOrder.order_items,
        merchant_id: updatedOrder.merchant_id,
        order_number: updatedOrder.order_number,
        total: updatedOrder.total,
      },
    });
  });

  it.each([
    ['order_not_found', 404, undefined],
    ['order_edit_forbidden', 403, undefined],
    ['order_financial_edit_has_payments', 409, undefined],
    ['order_financial_edit_after_fulfillment', 409, undefined],
    ['order_terminal_not_editable', 409, undefined],
    ['order_item_replacement_has_historical_state', 409, undefined],
    [
      'order_item_replacement_has_accounting_metadata',
      409,
      {
        code: 'order_not_editable',
        error:
          'This order contains protected line-item history. Existing items cannot be changed or removed.',
      },
    ],
    ['order_item_replacement_has_managed_stock', 409, undefined],
    ['order_item_replacement_has_serialized_reservations', 409, undefined],
    [
      'order_item_append_supports_one_new_line',
      409,
      {
        code: 'order_item_append_limit',
        error: 'Add only one new item per edit.',
      },
    ],
    [
      'active_shipping_charge_quote_input_edit_blocked',
      409,
      {
        code: 'active_shipping_charge_quote_input_edit_blocked',
        error:
          'Shipping quote inputs cannot change while a wallet shipping charge is active.',
      },
    ],
    [
      'active_shipping_charge_address_edit_blocked',
      409,
      {
        code: 'active_shipping_charge_address_edit_blocked',
        error:
          'Shipping address cannot change while a wallet shipping charge is active.',
      },
    ],
    ['order_total_negative', 400, undefined],
    ['order_notify_customer_invalid', 400, undefined],
    ['order_item_product_forbidden', 403, undefined],
    ['order_item_variant_forbidden', 403, undefined],
  ] as const)('maps RPC error %s to %i', async (message, status, body) => {
    const { supabase } = createEditRouteSupabaseMock({
      rpcError: { message },
    });
    mockAuthenticated(supabase);

    const response = await callPatch(createRequest(validPayload));

    expect(response.status).toBe(status);
    if (body) {
      expect(await response.json()).toEqual(body);
    }
  });

  it('returns degraded success when the updated order cannot be refreshed', async () => {
    const { supabase } = createEditRouteSupabaseMock({
      refreshError: { message: 'refresh failed' },
    });
    mockAuthenticated(supabase);

    const response = await callPatch(createRequest(validPayload));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      edit: editResult,
      order: { id: editResult.order_id },
      order_refresh_failed: true,
    });
  });
});
