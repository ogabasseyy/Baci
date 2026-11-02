import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: vi.fn() }));
vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/get-merchant-for-api-request')
  >()),
  getMerchantForApiRequest: vi.fn(),
}));
vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { lookupExternalWaybill: vi.fn() },
}));
vi.mock('@/lib/shipping/providers/gigl.constants', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/lib/shipping/providers/gigl.constants')
  >()),
  isGiglRuntimeConfigured: () => true,
}));

import { authenticateApiRequest } from '@/lib/api-auth';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { giglProvider } from '@/lib/shipping/providers/gigl';
import { giglPreShipment } from '@/lib/shipping/providers/gigl.test-helpers';
import { POST } from './route';

const ORDER_ID = '40000000-0000-4000-8000-000000000001';
const MERCHANT_ID = '10000000-0000-4000-8000-000000000001';
const SHIPMENT_ID = '50000000-0000-4000-8000-000000000001';
const WAYBILL = '1349639588';
const ACCOUNT = { userChannelCode: 'IND405919', userId: 'gig-user-1' };

const order = {
  id: ORDER_ID,
  order_number: 'ORD-291026-TEST',
  customer_name: 'Audu Emmanuel',
  customer_phone: '08037608805',
  shipping_address: { city: 'Abakaliki', state: 'Ebonyi' },
  shipping_status: 'processing',
};

const preShipment = {
  Waybill: WAYBILL,
  UserId: 'gig-user-1',
  CustomerCode: 'IND405919',
  SenderName: 'Store',
  ReceiverName: 'Audu Emmanuel',
  ReceiverPhoneNumber: '+2348037608805',
  ReceiverAddress: 'ABAKALIKI => ABAKALIKI (CENTRAL PARK)',
  ReceiverState: 'EBONYI',
  IsHomeDelivery: false,
  IsCancelled: false,
  GrandTotal: 45852.2,
};

type QueryResult = { data: unknown; error: unknown };

function createSupabase(
  tables: Record<string, QueryResult[]>,
  rpcResult: QueryResult = { data: SHIPMENT_ID, error: null }
) {
  const queues = new Map(
    Object.entries(tables).map(([table, results]) => [table, [...results]])
  );
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const supabase = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'not', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.maybeSingle = vi.fn(() => {
        const next = queues.get(table)?.shift();
        if (!next) throw new Error(`Unexpected query on ${table}`);
        return Promise.resolve(next);
      });
      return builder;
    }),
    rpc,
  };
  return { rpc, supabase: supabase as unknown as SupabaseClient };
}

function linkableTables(overrides: Record<string, QueryResult[]> = {}) {
  return {
    orders: [
      { data: order, error: null },
      { data: null, error: null },
    ],
    merchant_feature_settings: [
      { data: { shipping_providers: ['gigl'] }, error: null },
    ],
    shipments: [
      { data: null, error: null },
      { data: null, error: null },
    ],
    ...overrides,
  };
}

function request(
  body: unknown,
  orderId = ORDER_ID
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(
      `http://localhost/api/orders/${orderId}/shipping/gigl-waybill`,
      {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { Authorization: 'Bearer token' },
      }
    ),
    { params: Promise.resolve({ id: orderId }) },
  ];
}

function signIn(
  supabase: SupabaseClient,
  permissions = { full_access: { all: true } },
  isOwner = true
) {
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: { id: 'user-1' },
    error: null,
    supabase,
  } as never);
  vi.mocked(getMerchantForApiRequest).mockResolvedValue({
    merchantId: MERCHANT_ID,
    staffAccess: {
      isOwner,
      isStaff: !isOwner,
      role: isOwner ? null : 'sales',
      permissions,
    },
  } as never);
}

function gigFinds(
  overrides: Partial<typeof preShipment> = {},
  account = ACCOUNT
) {
  vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
    status: 'found',
    account,
    preShipment: giglPreShipment({ ...preShipment, ...overrides }),
    tracking: null,
  });
}

describe('POST /api/orders/[id]/shipping/gigl-waybill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    } as never);
    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(401);
    expect(giglProvider.lookupExternalWaybill).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an invalid order id',
      { action: 'preview', waybill: WAYBILL },
      'ORD-1',
      'INVALID_ORDER_ID',
    ],
    ['malformed JSON', '{', ORDER_ID, 'INVALID_JSON'],
    [
      'an invalid waybill',
      { action: 'preview', waybill: '12' },
      ORDER_ID,
      'INVALID_REQUEST',
    ],
  ])('rejects %s', async (_label, body, orderId, code) => {
    signIn(createSupabase({}).supabase);
    const response = await POST(...request(body, orderId));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it('forbids staff without order fulfilment rights', async () => {
    signIn(
      createSupabase({}).supabase,
      { orders: { view: true } } as never,
      false
    );
    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(403);
    expect(giglProvider.lookupExternalWaybill).not.toHaveBeenCalled();
  });

  it('previews a matching waybill without writing anything', async () => {
    const { rpc, supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds();

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );

    expect(response.status).toBe(200);
    const { preview } = await response.json();
    expect(preview).toMatchObject({
      waybill: WAYBILL,
      linkable: true,
      match: { name: 'match', phone: 'match', destination: 'match' },
      gig: {
        receiverName: 'Audu Emmanuel',
        receiverPhoneLast4: '8805',
        destinationState: 'EBONYI',
        deliveryType: 'station',
      },
    });
    expect(giglProvider.lookupExternalWaybill).toHaveBeenCalledWith(WAYBILL);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('hides GIG receiver details when the parcel is for someone else', async () => {
    const { supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds({
      ReceiverName: 'Chidi Okafor',
      ReceiverPhoneNumber: '+2348111111111',
    });

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    const { preview } = await response.json();
    expect(preview).toMatchObject({ linkable: false, gig: null });
  });

  it('links a matching waybill through the proof-gated RPC', async () => {
    const { rpc, supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds();

    const response = await POST(
      ...request({ action: 'link', waybill: WAYBILL })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      shipmentId: SHIPMENT_ID,
      trackingNumber: WAYBILL,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [name, args] = rpc.mock.calls[0] ?? [];
    expect(name).toBe('link_external_gigl_waybill');
    expect(args.p_order_id).toBe(ORDER_ID);
    expect(args.p_route_proof).toMatchObject({
      action: 'link_external_gigl_waybill',
      merchant_id: MERCHANT_ID,
      subject_id: ORDER_ID,
    });
    expect(JSON.parse(args.p_route_proof.payload_text)).toMatchObject({
      waybill: WAYBILL,
      account_verified: true,
      receiver_match: true,
      is_station_pickup: true,
      price: 45852.2,
    });
  });

  it('refuses to link a waybill whose receiver does not match', async () => {
    const { rpc, supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds({ ReceiverState: 'LAGOS' });

    const response = await POST(
      ...request({ action: 'link', waybill: WAYBILL })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'RECEIVER_MISMATCH',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a waybill already attached to another order before asking GIG', async () => {
    const { rpc, supabase } = createSupabase(
      linkableTables({
        shipments: [
          { data: null, error: null },
          { data: { id: 'other-shipment' }, error: null },
        ],
      })
    );
    signIn(supabase);

    const response = await POST(
      ...request({ action: 'link', waybill: WAYBILL })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WAYBILL_ALREADY_LINKED',
    });
    expect(giglProvider.lookupExternalWaybill).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps the database duplicate guard for another merchant or a race', async () => {
    const { supabase } = createSupabase(linkableTables(), {
      data: null,
      error: { message: 'waybill_already_linked' },
    });
    signIn(supabase);
    gigFinds();

    const response = await POST(
      ...request({ action: 'link', waybill: WAYBILL })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WAYBILL_ALREADY_LINKED',
    });
  });

  it('refuses a waybill booked on another GIG account', async () => {
    const { rpc, supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds({ CustomerCode: 'IND000001', UserId: 'someone-else' });

    const response = await POST(
      ...request({ action: 'link', waybill: WAYBILL })
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WAYBILL_NOT_IN_ACCOUNT',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reports a waybill GIG does not know', async () => {
    const { supabase } = createSupabase(linkableTables());
    signIn(supabase);
    vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
      status: 'not_found',
    });

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: 'WAYBILL_NOT_FOUND',
    });
  });

  it('reports GIG outages without leaking provider errors', async () => {
    const { supabase } = createSupabase(linkableTables());
    signIn(supabase);
    vi.mocked(giglProvider.lookupExternalWaybill).mockRejectedValue(
      new Error('secret upstream detail')
    );

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('GIGL_LOOKUP_FAILED');
    expect(JSON.stringify(body)).not.toContain('secret upstream detail');
  });

  it('requires GIG Logistics to be enabled for the merchant', async () => {
    const { supabase } = createSupabase(
      linkableTables({
        merchant_feature_settings: [
          { data: { shipping_providers: ['topship'] }, error: null },
        ],
      })
    );
    signIn(supabase);

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GIGL_NOT_ENABLED',
    });
  });

  it('refuses delivered orders', async () => {
    const { supabase } = createSupabase({
      orders: [
        { data: { ...order, shipping_status: 'delivered' }, error: null },
      ],
    });
    signIn(supabase);

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: 'ORDER_NOT_LINKABLE',
    });
  });

  it('returns 404 for an order outside the merchant', async () => {
    const { supabase } = createSupabase({
      orders: [{ data: null, error: null }],
    });
    signIn(supabase);

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    expect(response.status).toBe(404);
  });
});
