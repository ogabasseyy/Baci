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
  notifyOrderStatusChange: vi.fn().mockResolvedValue(undefined),
}));

import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
} from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { notifyOrderStatusChange } from '@/lib/expo-push';
import { PATCH, POST } from './route';

function createMockUser(): User {
  return {
    id: 'user-1',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  } as User;
}

function createRequest(
  body: Record<string, unknown>,
  method: 'PATCH' | 'POST' = 'POST'
): NextRequest {
  return {
    method,
    json: async () => body,
  } as NextRequest;
}

function createSupabaseMock() {
  const orderSingle = vi.fn().mockResolvedValue({
    data: {
      id: 'order-1',
      merchant_id: 'merchant-1',
      order_number: 'ORD-260411-TEST',
      shipping_status: 'processing',
      customer_id: 'customer-1',
      customer_name: 'Akinola Ogunniran',
      customer_phone: '+2348035962150',
      fulfillment_type: 'self',
      shipping_address: { address: 'Lekki Phase 1', city: 'Lekki' },
      self_fulfillment_data: {
        carrierName: 'Dispatch Rider',
        dispatchPhone: '+2348035962150',
        trackingNumber: 'TRACK-1',
      },
    },
    error: null,
  });
  const customerSingle = vi.fn().mockResolvedValue({
    data: { user_id: 'customer-user-1' },
    error: null,
  });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const updateBuilder = {
    eq: vi.fn(() => updateBuilder),
  };
  const updateOrder = vi.fn(() => updateBuilder);
  updateBuilder.eq
    .mockImplementationOnce(() => updateBuilder)
    .mockImplementationOnce(updateEq);

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'orders') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: orderSingle,
              })),
            })),
          })),
          update: updateOrder,
        };
      }

      if (table === 'customers') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: customerSingle,
            })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({ data: 0, error: null }),
  };

  return {
    supabase: supabase as unknown as SupabaseClient,
    updateOrder,
    updateEq,
    rpc: supabase.rpc,
  };
}

describe('Self-fulfill API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
    vi.mocked(checkCsrfProtection).mockResolvedValue({
      valid: true,
      response: undefined,
    });
    vi.mocked(getMerchantIdForApiUser).mockResolvedValue('merchant-1');
  });

  it('supports bearer-authenticated mobile staff requests', async () => {
    const { supabase, rpc } = createSupabaseMock();

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        dispatchPhone: '+2348035962150',
        carrierName: 'Dispatch Rider',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'self_fulfill_order_with_wallet_release',
      expect.objectContaining({
        p_order_id: '11111111-1111-4111-8111-111111111111',
        p_carrier_name: 'Dispatch Rider',
        p_self_fulfillment_data: expect.objectContaining({
          carrierName: 'Dispatch Rider',
          dispatchPhone: '+2348035962150',
        }),
      })
    );
    await vi.waitFor(() => {
      expect(notifyOrderStatusChange).toHaveBeenCalledWith(
        'customer-user-1',
        '11111111-1111-4111-8111-111111111111',
        'ORD-260411-TEST',
        'shipped'
      );
    });
    expect(payload).toMatchObject({
      success: true,
      message: 'Order marked as self-fulfilled',
    });
  });

  it('marks an order self-fulfilled when dispatch phone is omitted', async () => {
    const { supabase, rpc } = createSupabaseMock();

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        carrierName: 'Dispatch Rider',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'self_fulfill_order_with_wallet_release',
      expect.objectContaining({
        p_carrier_name: 'Dispatch Rider',
        p_self_fulfillment_data: expect.objectContaining({
          carrierName: 'Dispatch Rider',
          dispatchPhone: null,
        }),
      })
    );
    expect(payload.fulfillment.dispatchPhone).toBeNull();
  });

  it('marks an order self-fulfilled when dispatch phone is null', async () => {
    const { supabase, rpc } = createSupabaseMock();

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        carrierName: 'Dispatch Rider',
        dispatchPhone: null,
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'self_fulfill_order_with_wallet_release',
      expect.objectContaining({
        p_self_fulfillment_data: expect.objectContaining({
          dispatchPhone: null,
        }),
      })
    );
  });

  it('clears an unbooked GIG wallet quote when the merchant switches to self fulfillment', async () => {
    const { supabase, rpc } = createSupabaseMock();

    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        carrierName: 'Dispatch Rider',
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      'self_fulfill_order_with_wallet_release',
      expect.objectContaining({
        p_order_id: '11111111-1111-4111-8111-111111111111',
      })
    );
  });

  it('returns 409 when self-fulfillment races an active wallet booking lock', async () => {
    const { supabase, rpc } = createSupabaseMock();
    vi.mocked(rpc).mockResolvedValue({
      data: null,
      error: {
        code: '55P03',
        message: 'active_shipment_booking_lock',
      },
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        carrierName: 'Dispatch Rider',
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Order has an active shipping booking',
      code: 'ACTIVE_SHIPPING_BOOKING',
    });
    expect(rpc).toHaveBeenCalledWith(
      'self_fulfill_order_with_wallet_release',
      expect.objectContaining({
        p_order_id: '11111111-1111-4111-8111-111111111111',
      })
    );
  });

  it('serializes concurrent self-fulfill attempts through the atomic wallet-release RPC', async () => {
    const { supabase, rpc } = createSupabaseMock();
    vi.mocked(rpc)
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'P0001',
          message: 'order_already_shipped',
        },
      });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const body = {
      orderId: '11111111-1111-4111-8111-111111111111',
      carrierName: 'Dispatch Rider',
    };
    const [first, second] = await Promise.all([
      POST(createRequest(body)),
      POST(createRequest(body)),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({
      error: 'Order has already been shipped',
      code: 'ORDER_ALREADY_SHIPPED',
    });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('bugfix: returns 409 when settled retention blocks self-fulfillment', async () => {
    const { supabase, rpc } = createSupabaseMock();
    vi.mocked(rpc).mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'settled_checkout_retention_blocks_self_fulfillment',
      },
    });
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        carrierName: 'Dispatch Rider',
      })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        'Shipping retention has already settled for this order, so self-fulfillment is unavailable.',
      code: 'SETTLED_CHECKOUT_RETENTION_BLOCKS_SELF_FULFILLMENT',
    });
  });

  it('returns 401 when api auth fails', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: 'Unauthorized',
      user: null,
      supabase: null,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        dispatchPhone: '+2348035962150',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: 'Unauthorized' });
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('returns 400 when post payload contains unexpected fields', async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await POST(
      createRequest({
        orderId: '11111111-1111-4111-8111-111111111111',
        dispatchPhone: '+2348035962150',
        unknownField: 'nope',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid request');
    expect(payload).toHaveProperty('details');
    expect(Array.isArray(payload.details.formErrors)).toBe(true);
    expect(payload.details.formErrors.join(' ')).toMatch(/unknownField/);
    expect(payload.details.formErrors.join(' ')).toMatch(/unrecognized key/i);
  });

  it('returns 400 when patch payload contains unexpected fields', async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createRequest(
        {
          orderId: '11111111-1111-4111-8111-111111111111',
          unknownField: 'nope',
        },
        'PATCH'
      )
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBe('Invalid request');
    expect(payload).toHaveProperty('details');
    expect(Array.isArray(payload.details.formErrors)).toBe(true);
    expect(payload.details.formErrors.join(' ')).toMatch(/unknownField/);
    expect(payload.details.formErrors.join(' ')).toMatch(/unrecognized key/i);
  });

  it.each([
    null,
    '',
  ])('clears dispatch phone on PATCH when dispatchPhone is %s', async (dispatchPhone) => {
    const { supabase, updateOrder } = createSupabaseMock();
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      user: createMockUser(),
      supabase,
    });

    const response = await PATCH(
      createRequest(
        {
          orderId: '11111111-1111-4111-8111-111111111111',
          dispatchPhone,
        },
        'PATCH'
      )
    );

    expect(response.status).toBe(200);
    expect(updateOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        self_fulfillment_data: expect.objectContaining({
          dispatchPhone: null,
        }),
      })
    );
  });
});
