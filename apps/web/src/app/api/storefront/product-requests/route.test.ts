import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { POST } from './route';

const input = {
  query: 'iPhone 20',
  contact: 'shopper@example.com',
  merchantSlug: 'ogabassey',
  requestId: '11111111-1111-4111-8111-111111111111',
};
function request(body: unknown) {
  return new Request('http://localhost/api/storefront/product-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
});
describe('product request intake', () => {
  it('validates with Zod before calling the service-only RPC', async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'submit_storefront_product_request',
      {
        p_query: 'iPhone 20',
        p_contact: 'shopper@example.com',
        p_merchant_slug: 'ogabassey',
        p_request_id: input.requestId,
      }
    );
  });
  it('rejects invalid payloads without touching the database', async () => {
    expect((await POST(request({ ...input, contact: '---' }))).status).toBe(
      400
    );
    expect((await POST(request({ ...input, query: '!' }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps RPC outcomes to status codes without leaking details', async () => {
    mocks.rpc.mockResolvedValueOnce({
      error: { code: '54000', message: 'Request limit reached' },
    });
    expect((await POST(request(input))).status).toBe(429);
    mocks.rpc.mockResolvedValueOnce({
      error: { code: '22023', message: 'Store unavailable' },
    });
    expect((await POST(request(input))).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({
      error: { code: '22023', message: 'Invalid product request' },
    });
    expect((await POST(request(input))).status).toBe(400);
    mocks.rpc.mockResolvedValueOnce({
      error: { code: 'XX000', message: 'private database detail' },
    });
    const response = await POST(request(input));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private database detail');
  });
});
