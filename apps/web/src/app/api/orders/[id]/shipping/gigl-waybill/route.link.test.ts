import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: vi.fn() }));
vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  getMerchantForApiRequest: vi.fn(),
}));
vi.mock('@/lib/shipping/providers/gigl', () => ({
  giglProvider: { lookupExternalWaybill: vi.fn() },
}));
vi.mock('@/lib/shipping/providers/gigl.constants', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isGiglRuntimeConfigured: () => true,
}));

import { giglProvider } from '@/lib/shipping/providers/gigl';
import { POST } from './route';
import {
  createSupabase,
  gigFinds,
  linkableTables,
  MERCHANT_ID,
  ORDER_ID,
  request,
  SHIPMENT_ID,
  signIn,
  WAYBILL,
} from './route.test-support';

describe('POST /api/orders/[id]/shipping/gigl-waybill (link)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
