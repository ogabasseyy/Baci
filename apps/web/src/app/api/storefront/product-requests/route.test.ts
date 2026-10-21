import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  hashNet: vi.fn((identifier: string) => `net-hash:${identifier}`),
  warn: vi.fn(),
}));
vi.mock('@/lib/storefront/server-intake-client', () => ({
  submitStorefrontProductRequest: mocks.submit,
}));
vi.mock('@/lib/storefront/hash-intake-caller-net', () => ({
  hashIntakeCallerNet: mocks.hashNet,
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mocks.warn(...args),
  },
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

import { POST } from './route';

const input = {
  query: 'iPhone 20',
  contact: 'shopper@example.com',
  merchantSlug: 'ogabassey',
  requestId: '11111111-1111-4111-8111-111111111111',
};
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/storefront/product-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  mocks.submit.mockReset().mockResolvedValue({ error: null });
  mocks.hashNet
    .mockReset()
    .mockImplementation((identifier: string) => `net-hash:${identifier}`);
  mocks.warn.mockReset();
  vi.mocked(checkCsrfProtection).mockReset().mockResolvedValue({ valid: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
describe('product request intake', () => {
  it('rejects cookie-bearing posts without a valid CSRF token', async () => {
    vi.mocked(checkCsrfProtection).mockResolvedValueOnce({ valid: false });

    const response = await POST(request(input, { cookie: 'csrf-token=stale' }));

    expect(response.status).toBe(403);
    expect(checkCsrfProtection).toHaveBeenCalledTimes(1);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('accepts cookie-less callers without a CSRF token (native shape)', async () => {
    const response = await POST(request(input));

    expect(response.status).toBe(200);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
  it('validates with Zod before calling the intake helper', async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.submit).toHaveBeenCalledWith({
      p_query: 'iPhone 20',
      p_contact: 'shopper@example.com',
      p_merchant_slug: 'ogabassey',
      p_request_id: input.requestId,
      p_caller_net_hash: 'net-hash:unknown',
    });
  });
  it('binds the durable network budget to the trusted network signal', async () => {
    // On Vercel the edge overwrites x-real-ip, so the trusted identifier
    // is the edge-verified IP and both budget layers measure one caller.
    vi.stubEnv('VERCEL', '1');
    const response = await POST(request(input, { 'x-real-ip': '192.0.2.10' }));

    expect(response.status).toBe(200);
    // The route must hash the trusted identifier, never the lenient proxy
    // one: mintable header values would mint fresh DB buckets per request.
    // (That the hash leaks no raw IP is covered by the HMAC tests with the
    // real implementation.)
    expect(mocks.hashNet).toHaveBeenCalledWith('192.0.2.10');
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        p_caller_net_hash: 'net-hash:192.0.2.10',
      })
    );
  });
  it('keys the budget on x-vercel-forwarded-for when it alone carries the client IP', async () => {
    // Stacked proxy on Vercel: the Vercel header survives while other
    // headers carry the intermediate proxy, and the durable key must
    // measure the same caller as the proxy layer.
    vi.stubEnv('VERCEL', '1');
    const response = await POST(
      request(input, {
        'x-forwarded-for': '198.51.100.9',
        'x-real-ip': '192.0.2.1',
        'x-vercel-forwarded-for': '203.0.113.7',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.hashNet).toHaveBeenCalledWith('203.0.113.7');
  });
  it('collapses mintable header signals into the unknown bucket off Vercel', async () => {
    // Without the edge guarantee x-real-ip is caller-supplied, so the
    // durable key must fail closed into the shared bucket, not rotate.
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('CART_TRUST_PROXY_HEADERS', '');
    const response = await POST(request(input, { 'x-real-ip': '192.0.2.10' }));

    expect(response.status).toBe(200);
    expect(mocks.hashNet).toHaveBeenCalledWith('unknown');
  });
  it('derives the same network key for CSRF-verified web callers', async () => {
    vi.stubEnv('VERCEL', '1');
    const response = await POST(
      request(input, {
        cookie: 'csrf-token=ok',
        'x-real-ip': '192.0.2.44',
      })
    );

    expect(response.status).toBe(200);
    expect(checkCsrfProtection).toHaveBeenCalledTimes(1);
    expect(mocks.hashNet).toHaveBeenCalledWith('192.0.2.44');
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({
        p_caller_net_hash: 'net-hash:192.0.2.44',
      })
    );
  });
  it('accepts API-host posts with a body slug regardless of Host (native shape)', async () => {
    // Native clients POST to the API host with a body slug and no cookies.
    // There is deliberately no host binding (it cannot stop direct POSTs
    // to the victim host), so a mismatched Host must not reject.
    const req = new NextRequest(
      'https://api.ogabassey.com/api/storefront/product-requests',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          host: 'api.ogabassey.com',
        },
        body: JSON.stringify(input),
      }
    );

    const response = await POST(req);

    expect(response.status).toBe(200);
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ p_merchant_slug: 'ogabassey' })
    );
  });
  it('fails closed with 503 when the network-hash helper throws', async () => {
    mocks.hashNet.mockImplementationOnce(() => {
      throw new Error('intake key missing');
    });

    const response = await POST(request(input));

    expect(response.status).toBe(503);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('intake key missing');
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
    // The outage is still visible server-side, without credential detail.
    expect(mocks.warn).toHaveBeenCalledWith({
      message: 'Product request intake unavailable',
    });
  });
});
