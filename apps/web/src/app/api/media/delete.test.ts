import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    storage: { from: () => ({ remove: mocks.remove }) },
  }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: vi.fn() }) }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: () => true }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: async () => ({
    merchantId: '36690000-0000-4000-8000-000000000001',
  }),
  toUserAccess: () => ({}),
}));

import { DELETE } from './delete';

const merchant = '36690000-0000-4000-8000-000000000001';
const identity = '36690000-0000-4000-8000-000000000002';
const path = `${merchant}/actual-file.webp`;
const request = () =>
  new NextRequest(`http://localhost/api/media?id=${identity}`, {
    method: 'DELETE',
  });
describe('merchant media deletion safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'owner' } },
      error: null,
    });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'claim_merchant_media_deletion'
        ? {
            data: [{ path, state: 'pending', object_id: identity }],
            error: null,
          }
        : { data: true, error: null }
    );
  });
  it('keeps referenced media accessible and returns a safe conflict', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23514',
        message: 'media_in_use',
        details: 'private usage',
      },
    });
    const response = await DELETE(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 'media_in_use',
      error:
        'This file is still in use. Remove its saved references before deleting it.',
    });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('resolves the opaque object ID before calling Storage', async () => {
    const response = await DELETE(request());
    expect(response.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith([path]);
    expect(mocks.rpc).toHaveBeenCalledWith('complete_merchant_media_deletion', {
      p_merchant_id: merchant,
      p_path: path,
    });
  });
  it('fails closed when reference qualification is unavailable', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'sensitive database error' },
    });
    const response = await DELETE(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it('does not report completion for a no-op Storage response', async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === 'claim_merchant_media_deletion'
        ? {
            data: [{ path, state: 'pending', object_id: identity }],
            error: null,
          }
        : { data: false, error: null }
    );
    const response = await DELETE(request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('media_delete_pending');
  });
  it('preserves pending deletion after a Storage failure', async () => {
    mocks.remove.mockResolvedValue({ error: { message: 'provider detail' } });
    const response = await DELETE(request());
    expect(response.status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_merchant_media_deletion',
      expect.anything()
    );
  });
  it('rejects a malformed or foreign admission response before Storage', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          path: 'another-merchant/private.webp',
          state: 'pending',
          object_id: identity,
        },
      ],
      error: null,
    });
    const response = await DELETE(request());
    expect(response.status).toBe(503);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});
