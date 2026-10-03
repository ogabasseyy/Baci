import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectedRevision } from '@/schemas/update-product-discovery-metadata.test-support';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  csrf: vi.fn(),
  user: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  result: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (v: unknown) => v,
}));
vi.mock('@/lib/api-permissions', () => ({ hasPermission: mocks.permission }));

import { PUT } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const valid = {
  productId,
  expectedRevision,
  metadata: { product_type: 'Laptop', attributes: { ram_gb: 16 } },
};
const request = (body: string) =>
  new NextRequest('https://ogabassey.com/api/products/discovery-metadata', {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.user.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mocks.merchant.mockResolvedValue({ merchantId, role: 'owner' });
  mocks.permission.mockReturnValue(true);
  mocks.rpc.mockReturnValue({ returns: () => ({ maybeSingle: mocks.result }) });
  mocks.result.mockResolvedValue({ data: { id: productId }, error: null });
});
describe('guarded discovery facts writes', () => {
  it('passes the opaque revision to the atomic RLS update and returns no-store success', async () => {
    const response = await PUT(request(JSON.stringify(valid)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, productId });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      {
        p_product_id: productId,
        p_merchant_id: merchantId,
        p_metadata: { ...valid.metadata, product_type: 'laptop' },
        p_expected_revision: expectedRevision,
      }
    );
  });
  it('reports changed facts/source or unavailable rows as safe409 without another write', async () => {
    mocks.result.mockResolvedValueOnce({ data: null, error: null });
    const response = await PUT(request(JSON.stringify(valid)));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Facts changed or product unavailable. Reload before saving.',
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('authenticates before CSRF and stops denied mutations before parsing', async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await PUT(request('{'))).status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    mocks.csrf.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'CSRF validation failed' },
        { status: 403 }
      ),
    });
    expect((await PUT(request('{'))).status).toBe(403);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    'short',
    '\u0000',
    '\ud800',
  ])('rejects invalid revisions %j before merchant lookup', async (expectedRevision) => {
    expect(
      (await PUT(request(JSON.stringify({ ...valid, expectedRevision }))))
        .status
    ).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON, invalid facts, identity and legacy snapshot fields', async () => {
    expect((await PUT(request('{'))).status).toBe(400);
    for (const body of [
      { ...valid, merchantId: 'invalid' },
      { ...valid, metadata: { attributes: { ram_gb: '16' } } },
      { ...valid, expectedSource: {} },
      { ...valid, expectedMetadata: null },
    ])
      expect((await PUT(request(JSON.stringify(body)))).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('independently authorizes requested merchant and edit permission', async () => {
    expect(
      (await PUT(request(JSON.stringify({ ...valid, merchantId })))).status
    ).toBe(200);
    expect(mocks.merchant).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      requestedMerchantId: merchantId,
    });
    mocks.rpc.mockClear();
    mocks.merchant.mockResolvedValueOnce(null);
    expect((await PUT(request(JSON.stringify(valid)))).status).toBe(404);
    mocks.permission.mockReturnValueOnce(false);
    expect((await PUT(request(JSON.stringify(valid)))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    'message',
    'details',
    'hint',
  ])('maps only storage constraint in %s without exposing details', async (field) => {
    mocks.result.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23514',
        [field]: 'products_discovery_metadata_object private row',
      },
    });
    const response = await PUT(request(JSON.stringify(valid)));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private row');
    mocks.result.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'unrelated private constraint' },
    });
    const failed = await PUT(request(JSON.stringify(valid)));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: 'Could not update discovery facts',
    });
  });
  it('rejects oversized streamed bodies before merchant lookup', async () => {
    expect(
      (await PUT(request(JSON.stringify({ padding: 'x'.repeat(96 * 1024) }))))
        .status
    ).toBe(413);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('replaces the complete facts document, preserving the original database revision', async () => {
    expect(
      (
        await PUT(
          request(
            JSON.stringify({ ...valid, metadata: { product_type: 'phone' } })
          )
        )
      ).status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      expect.objectContaining({
        p_metadata: { product_type: 'phone' },
        p_expected_revision: expectedRevision,
      })
    );
  });
});
