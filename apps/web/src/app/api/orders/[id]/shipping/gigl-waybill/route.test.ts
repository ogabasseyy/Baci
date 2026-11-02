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

import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { giglProvider } from '@/lib/shipping/providers/gigl';
import { POST } from './route';
import {
  createSupabase,
  gigFinds,
  linkableTables,
  ORDER_ID,
  order,
  request,
  signIn,
  WAYBILL,
} from './route.test-support';

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
    expect(checkCsrfProtection).not.toHaveBeenCalled();
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

  it('hides GIG receiver details on a name-only match', async () => {
    const { supabase } = createSupabase(linkableTables());
    signIn(supabase);
    gigFinds({ ReceiverPhoneNumber: '+2348111111111', ReceiverState: 'LAGOS' });

    const response = await POST(
      ...request({ action: 'preview', waybill: WAYBILL })
    );
    const { preview } = await response.json();
    expect(preview).toMatchObject({
      linkable: false,
      match: { name: 'unknown', phone: 'unknown', destination: 'unknown' },
      gig: null,
    });
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
