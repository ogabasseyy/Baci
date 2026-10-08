import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('@/lib/storefront/server-intake-client', () => ({
  submitStorefrontProductRequest: mocks.submit,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mocks.warn(...args),
  },
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
  mocks.submit.mockReset().mockResolvedValue({ error: null });
  mocks.warn.mockReset();
});
describe('product request intake', () => {
  it('validates with Zod before calling the intake helper', async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.submit).toHaveBeenCalledWith({
      p_query: 'iPhone 20',
      p_contact: 'shopper@example.com',
      p_merchant_slug: 'ogabassey',
      p_request_id: input.requestId,
    });
  });
  it('rejects invalid payloads without touching the database', async () => {
    expect((await POST(request({ ...input, contact: '---' }))).status).toBe(
      400
    );
    expect((await POST(request({ ...input, query: '!' }))).status).toBe(400);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('maps RPC outcomes to status codes without leaking details', async () => {
    mocks.submit.mockResolvedValueOnce({
      error: { code: '54000', message: 'Request limit reached' },
    });
    expect((await POST(request(input))).status).toBe(429);
    expect(mocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({ merchantSlug: 'ogabassey' })
    );
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      'shopper@example.com'
    );
    mocks.submit.mockResolvedValueOnce({
      error: { code: 'P0001', message: 'Store unavailable' },
    });
    expect((await POST(request(input))).status).toBe(404);
    mocks.submit.mockResolvedValueOnce({
      error: { code: '22023', message: 'Invalid product request' },
    });
    expect((await POST(request(input))).status).toBe(400);
    mocks.submit.mockResolvedValueOnce({
      error: { code: 'XX000', message: 'private database detail' },
    });
    const response = await POST(request(input));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private database detail');
  });
  it('maps idempotency conflicts to 409 instead of a validation error', async () => {
    mocks.submit.mockResolvedValueOnce({
      error: { code: '23505', message: 'Request conflict' },
    });
    const response = await POST(request(input));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Request conflict' });
    mocks.submit.mockResolvedValueOnce({
      error: { code: '22023', message: 'Invalid product request' },
    });
    expect((await POST(request(input))).status).toBe(400);
  });
  it('fails closed with 503 when the intake helper throws', async () => {
    mocks.submit.mockRejectedValueOnce(new Error('intake key missing'));
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('intake key missing');
  });
});
