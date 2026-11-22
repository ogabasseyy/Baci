import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { GET, PATCH } from './route';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174001';

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn() }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn(() => ({ role: 'owner' })),
}));
vi.mock('@/lib/agentic/agentic-merchant-slug', () => ({
  getConfiguredAgenticMerchantSlug: () => 'ogabassey',
}));

const rpc = vi.fn();
let user: { id: string } | null;

const SELECTED_MERCHANT = '223e4567-e89b-12d3-a456-426614174002';

const get = (headers?: Record<string, string>) =>
  new NextRequest('http://localhost/api/merchant/chat-notifications', {
    headers,
  });

const patch = (body: unknown, raw?: string, headers?: Record<string, string>) =>
  new NextRequest('http://localhost/api/merchant/chat-notifications', {
    method: 'PATCH',
    body: raw ?? JSON.stringify(body),
    headers,
  });

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: 'user-1' };
  rpc.mockResolvedValue({ data: 'all', error: null });
  vi.mocked(createClient).mockReturnValue({
    auth: { getUser: vi.fn(async () => ({ data: { user } })) },
    rpc,
  } as never);
  vi.mocked(getMerchantForApiRequest).mockResolvedValue({
    merchantId: MERCHANT_ID,
    merchantSlug: 'ogabassey',
    staffAccess: {},
  } as never);
  vi.mocked(hasPermission).mockReturnValue(true);
  vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
});

describe('GET /api/merchant/chat-notifications', () => {
  it.each([
    'all',
    'handover',
    'off',
  ])('returns the stored level %s for the chat tenant', async (stored) => {
    rpc.mockResolvedValue({ data: stored, error: null });
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ level: stored });
    expect(rpc).toHaveBeenCalledWith('get_chat_message_alert_level', {
      p_merchant_id: MERCHANT_ID,
    });
  });

  it('returns 401 when signed out', async () => {
    user = null;
    expect((await GET(get())).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 404 for a store that is not the chat tenant', async () => {
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: MERCHANT_ID,
      merchantSlug: 'someone-else',
      staffAccess: {},
    } as never);
    const response = await GET(get());
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_available');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 without dashboard view permission', async () => {
    vi.mocked(hasPermission).mockReturnValue(false);
    expect((await GET(get())).status).toBe(403);
  });

  it('returns 500 when the read fails or is not a known level', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } });
    expect((await GET(get())).status).toBe(500);
    rpc.mockResolvedValue({ data: 'yes', error: null });
    expect((await GET(get())).status).toBe(500);
    rpc.mockResolvedValue({ data: true, error: null });
    expect((await GET(get())).status).toBe(500);
  });
});

describe('bugfix: the route acts on the store the dashboard selected', () => {
  it.each([
    ['GET', () => GET(get({ 'x-baci-merchant-id': SELECTED_MERCHANT }))],
    [
      'PATCH',
      () =>
        PATCH(
          patch({ level: 'all' }, undefined, {
            'x-baci-merchant-id': SELECTED_MERCHANT,
          })
        ),
    ],
  ])('%s passes the selected store to the merchant lookup', async (_m, call) => {
    await call();
    expect(getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: SELECTED_MERCHANT }
    );
  });

  it('falls back to the account default only when no store is selected', async () => {
    await GET(get());
    expect(getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: null }
    );
  });

  it.each([
    ['GET', () => GET(get({ 'x-baci-merchant-id': 'not-a-uuid' }))],
    [
      'PATCH',
      () =>
        PATCH(
          patch({ level: 'all' }, undefined, {
            'x-baci-merchant-id': 'not-a-uuid',
          })
        ),
    ],
  ])('%s refuses a malformed store header before any lookup', async (_m, call) => {
    const response = await call();
    expect(response.status).toBe(400);
    expect(getMerchantForApiRequest).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/merchant/chat-notifications', () => {
  it.each([
    'all',
    'handover',
    'off',
  ])('saves the level %s through the permission-checked function', async (level) => {
    rpc.mockResolvedValue({ data: level, error: null });
    const response = await PATCH(patch({ level }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ level });
    expect(rpc).toHaveBeenCalledWith('set_chat_message_alert_level', {
      p_merchant_id: MERCHANT_ID,
      p_level: level,
    });
  });

  it('returns 401 when signed out', async () => {
    user = null;
    expect((await PATCH(patch({ level: 'all' }))).status).toBe(401);
  });

  it('returns 404 for a store that is not the chat tenant', async () => {
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: MERCHANT_ID,
      merchantSlug: null,
      staffAccess: {},
    } as never);
    expect((await PATCH(patch({ level: 'all' }))).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 without settings edit permission', async () => {
    vi.mocked(hasPermission).mockReturnValue(false);
    expect((await PATCH(patch({ level: 'all' }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF validation fails', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: false });
    expect((await PATCH(patch({ level: 'all' }))).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['empty body', {}],
    ['unknown level', { level: 'sometimes' }],
    ['the old push switch', { push_enabled: true }],
    ['unknown key', { level: 'all', merchant_id: 'other' }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await PATCH(patch(body))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not JSON', async () => {
    expect((await PATCH(patch(null, '{nope'))).status).toBe(400);
  });

  it('never takes the store from the request body', async () => {
    await PATCH(patch({ level: 'all' }));
    expect(rpc).toHaveBeenCalledWith(
      'set_chat_message_alert_level',
      expect.objectContaining({ p_merchant_id: MERCHANT_ID })
    );
  });

  it('returns 500 when the database answers with an unknown level', async () => {
    rpc.mockResolvedValue({ data: 'nonsense', error: null });
    const response = await PATCH(patch({ level: 'all' }));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('save_failed');
  });

  it('returns 500 when the save fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    const response = await PATCH(patch({ level: 'all' }));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('save_failed');
  });
});
