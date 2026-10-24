import { waitFor } from '@testing-library/react';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JumiaApiError } from '@/lib/jumia/helpers';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), attributes: vi.fn() }));
vi.mock('@/lib/jumia/metadata-request', () => ({
  authorizeJumiaMetadata: mocks.authorize,
}));
vi.mock('@/lib/jumia/catalog', () => ({ getAttributeSet: mocks.attributes }));

import { GET } from './route';

const sid = '11111111-1111-4111-8111-111111111111';
const request = new NextRequest(
  'http://localhost/api?merchantId=a&integrationId=b'
);
const params = (attributeSetId = sid) => ({
  params: Promise.resolve({ attributeSetId }),
});
describe('attribute set GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      client: { shopId: 'exact' },
      attributeSetId: sid,
    });
    mocks.attributes.mockResolvedValue({ attributes: [] });
  });
  it('loads the validated SID only through exact integration authorization', async () => {
    const response = await GET(request, params());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ attributes: [] });
    expect(mocks.authorize).toHaveBeenCalledWith(
      request,
      true,
      expect.any(Promise)
    );
    expect(mocks.attributes).toHaveBeenCalledWith({ shopId: 'exact' }, sid);
  });
  it('authenticates before reporting an invalid UUID path', async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response('{}', { status: 401 }),
    });
    expect((await GET(request, params('not-uuid'))).status).toBe(401);
    expect(mocks.attributes).not.toHaveBeenCalled();
  });
  it('checks auth without waiting for route parameters to resolve', async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response('{}', { status: 401 }),
    });
    const pending = new Promise<{ attributeSetId: string }>(() => undefined);
    const response = GET(request, { params: pending });
    await waitFor(() =>
      expect(mocks.authorize).toHaveBeenCalledWith(request, true, pending)
    );
    expect((await response).status).toBe(401);
    expect(mocks.attributes).not.toHaveBeenCalled();
  });
  it('preserves authorization errors without reading metadata', async () => {
    mocks.authorize.mockResolvedValue({
      response: new Response('{}', { status: 403 }),
    });
    expect((await GET(request, params())).status).toBe(403);
    expect(mocks.attributes).not.toHaveBeenCalled();
  });
  it('rejects malformed attribute types', async () => {
    mocks.attributes.mockResolvedValue({
      attributes: [{ type: 99, mandatory: true }],
    });
    expect((await GET(request, params())).status).toBe(502);
  });
  it.each([
    new Error('secret'),
    new JumiaApiError(404, 'secret'),
  ])('does not expose provider/integration errors', async (error) => {
    mocks.authorize.mockRejectedValue(error);
    const response = await GET(request, params());
    expect(response.status).toBe(error instanceof JumiaApiError ? 404 : 502);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
