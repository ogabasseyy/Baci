import { NextRequest, NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  csrf: vi.fn(),
  getUser: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    from: () => ({
      update: mocks.update,
    }),
  }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (value: unknown) => value,
}));
vi.mock('@/lib/api-permissions', () => ({ hasPermission: mocks.permission }));

import { PUT } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';
const validBody = {
  productId,
  expectedMetadata: null,
  metadata: {
    product_type: 'Laptop',
    attributes: { ram_gb: 16 },
  },
};
const request = (body: string) =>
  new NextRequest('https://usebaci.com/api/products/discovery-metadata', {
    method: 'PUT',
    body,
    headers: { 'Content-Type': 'application/json' },
  });

describe('product discovery metadata API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.merchant.mockResolvedValue({ merchantId, role: 'owner' });
    mocks.permission.mockReturnValue(true);
    mocks.rpc.mockReturnValue({
      returns: () => ({ maybeSingle: mocks.maybeSingle }),
    });
    mocks.update.mockReturnValue({ eq: mocks.eq });
    mocks.eq.mockReturnValue({
      eq: mocks.eq,
      is: mocks.is,
      select: vi.fn().mockReturnValue({ maybeSingle: mocks.maybeSingle }),
    });
    mocks.is.mockReturnValue({
      select: vi.fn().mockReturnValue({ maybeSingle: mocks.maybeSingle }),
    });
    mocks.maybeSingle.mockResolvedValue({
      data: { id: productId },
      error: null,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('guards a reviewed empty snapshot and reports stale writes without overwriting', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const result = await PUT(
      request(JSON.stringify({ ...validBody, expectedMetadata: null }))
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      expect.objectContaining({ p_expected_metadata: null })
    );
    expect(result.status).toBe(409);
  });

  it('compares the full previous facts document atomically', async () => {
    const previous = { model: 'Known', attributes: { color: 'Black' } };
    expect(
      (
        await PUT(
          request(JSON.stringify({ ...validBody, expectedMetadata: previous }))
        )
      ).status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      expect.objectContaining({
        p_expected_metadata: previous,
        p_merchant_id: merchantId,
      })
    );
    expect(mocks.eq).not.toHaveBeenCalled();
  });

  it('authorizes explicit merchant scope for guarded writes', async () => {
    const body = { ...validBody, merchantId, expectedMetadata: null };
    expect((await PUT(request(JSON.stringify(body)))).status).toBe(200);
    expect(mocks.merchant).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      requestedMerchantId: merchantId,
    });
    mocks.merchant.mockResolvedValueOnce(null);
    mocks.rpc.mockClear();
    expect((await PUT(request(JSON.stringify(body)))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('authenticates before CSRF validation and rejects invalid CSRF before input processing', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();

    mocks.csrf.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'CSRF validation failed' },
        { status: 403 }
      ),
    });
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(403);
    expect(mocks.getUser).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid JSON, schema-invalid input, and invalid merchant identifiers', async () => {
    expect((await PUT(request('{'))).status).toBe(400);
    expect(
      (await PUT(request(JSON.stringify({ ...validBody, unexpected: true }))))
        .status
    ).toBe(400);
    expect(
      (
        await PUT(
          request(JSON.stringify({ ...validBody, merchantId: 'invalid' }))
        )
      ).status
    ).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('requires an authorized merchant and product edit permission', async () => {
    mocks.merchant.mockResolvedValueOnce(null);
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(404);
    mocks.permission.mockReturnValueOnce(false);
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(403);
    expect(mocks.permission).toHaveBeenCalledWith(
      { merchantId, role: 'owner' },
      'products',
      'edit'
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('uses exact merchant and product RPC guards and returns safe errors', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: new Error('private db detail'),
    });
    const failed = await PUT(request(JSON.stringify(validBody)));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: 'Could not update discovery facts',
    });
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      {
        p_product_id: productId,
        p_merchant_id: merchantId,
        p_metadata: { ...validBody.metadata, product_type: 'laptop' },
        p_expected_metadata: null,
      }
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('rejects omitted snapshots before merchant lookup or database writes', async () => {
    expect(
      (
        await PUT(
          request(JSON.stringify({ productId, metadata: validBody.metadata }))
        )
      ).status
    ).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('maps only the metadata storage constraint to a safe client error', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23514',
        message:
          'violates check constraint "products_discovery_metadata_object"; private row detail',
      },
    });
    const response = await PUT(request(JSON.stringify(validBody)));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Discovery facts exceed the supported storage limit',
    });
    mocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: '23514', message: 'unrelated constraint' },
    });
    expect((await PUT(request(JSON.stringify(validBody)))).status).toBe(500);
  });

  it('returns the updated product ID with no-store caching', async () => {
    const response = await PUT(request(JSON.stringify(validBody)));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, productId });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('replaces the whole metadata document on PUT rather than merging omitted facts', async () => {
    const body = {
      productId: validBody.productId,
      expectedMetadata: { model: 'old model' },
      metadata: { product_type: 'phone' },
    };
    const response = await PUT(request(JSON.stringify(body)));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      expect.objectContaining({
        p_metadata: { product_type: 'phone' },
        p_expected_metadata: { model: 'old model' },
      })
    );
  });

  it('rejects oversized streamed JSON without Content-Length before merchant lookup', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.merchant.mockClear();
    const response = await PUT(
      request(JSON.stringify({ padding: 'x'.repeat(96 * 1024) }))
    );
    expect(response.status).toBe(413);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  it('sends large valid snapshots through the RPC body, not query filters', async () => {
    mocks.merchant.mockResolvedValue({ merchantId, role: 'owner' });
    mocks.permission.mockReturnValue(true);
    mocks.rpc.mockReturnValue({
      returns: () => ({
        maybeSingle: async () => ({ data: { id: productId }, error: null }),
      }),
    });
    mocks.eq.mockClear();
    const previous = { source: 'x'.repeat(12000) };
    expect(
      (
        await PUT(
          request(JSON.stringify({ ...validBody, expectedMetadata: previous }))
        )
      ).status
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_product_discovery_metadata_guarded',
      expect.objectContaining({ p_expected_metadata: previous })
    );
    expect(mocks.eq).not.toHaveBeenCalled();
  });
});
