import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  merchant: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: mocks.merchant,
}));
vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));

import { POST } from './route';

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
function request(
  body: unknown = { query: ' iphone ', pathPrefix: '', source: 'navbar' },
  headers: Record<string, string> = {},
  url = 'https://ogabassey.com/api/search/submissions'
) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      origin: new URL(url).origin,
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('explicit search submissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.merchant.mockResolvedValue({ id: merchantId, slug: 'ogabassey' });
    mocks.rpc.mockResolvedValue({
      data: [{ product_id: 'phone-1', total_count: 27 }],
      error: null,
    });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.from.mockReturnValue({ insert: mocks.insert });
  });

  it.each([
    'navbar',
    'results-form',
    'see-all',
    'did-you-mean',
  ])('records %s with a server-derived count and host-derived merchant', async (source) => {
    const response = await POST(
      request({ query: ' iphone ', pathPrefix: '/other-merchant', source })
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey.com');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'search_products_v2',
      expect.objectContaining({
        merchant_id_param: merchantId,
        search_query: 'iphone',
        result_limit: 1,
      })
    );
    expect(mocks.from).toHaveBeenCalledWith('search_analytics');
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith({
      merchant_id: merchantId,
      search_query: 'iphone',
      results_count: 27,
      search_method: 'client',
    });
  });

  it('resolves path-based stores on the platform domain', async () => {
    await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        'https://usebaci.com/api/search/submissions'
      )
    );
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey');
  });

  it.each([
    ['https://ogabassey.usebaci.com', 'ogabassey'],
    ['http://ogabassey.localhost:3000', 'ogabassey'],
    ['https://www.ogabassey.com', 'ogabassey.com'],
  ])('resolves the storefront identity from %s', async (origin, identifier) => {
    await POST(
      request(
        { query: 'phone', pathPrefix: '/other-store', source: 'navbar' },
        {},
        `${origin}/api/search/submissions`
      )
    );
    expect(mocks.merchant).toHaveBeenCalledWith(identifier);
  });

  it.each([
    'https://www.usebaci.com',
    'https://baci-preview.vercel.app',
    'http://localhost:3000',
  ])('resolves path-based stores on %s', async (origin) => {
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        `${origin}/api/search/submissions`
      )
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('ogabassey');
  });

  it('falls back to the exact www hostname when only it is registered', async () => {
    mocks.merchant.mockImplementation(async (identifier: string) =>
      identifier === 'www.shop.example.com'
        ? { id: merchantId, slug: 'shop' }
        : null
    );
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '', source: 'navbar' },
        {},
        'https://www.shop.example.com/api/search/submissions'
      )
    );
    expect(response.status).toBe(204);
    expect(mocks.merchant).toHaveBeenCalledWith('shop.example.com');
    expect(mocks.merchant).toHaveBeenCalledWith('www.shop.example.com');
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ merchant_id: merchantId })
    );
  });

  it('does not accept a merchant supplied from a reserved platform subdomain', async () => {
    const response = await POST(
      request(
        { query: 'phone', pathPrefix: '/ogabassey', source: 'navbar' },
        {},
        'https://app.usebaci.com/api/search/submissions'
      )
    );
    expect(response.status).toBe(404);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('records zero-result submissions without a spelling lookup', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await POST(request())).status).toBe(204);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ results_count: 0 })
    );
  });

  it.each([{}, { origin: 'https://evil.test' }, { origin: 'null' }] as Record<
    string,
    string
  >[])('rejects absent or untrusted origin before data access: %j', async (headers) => {
    const req = request(undefined, headers);
    if (!('origin' in headers)) req.headers.delete('origin');
    expect((await POST(req)).status).toBe(403);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    'Googlebot',
    'bingbot',
    'Slackbot',
    'curl/8.0',
  ])('ignores known automated submissions from %s', async (userAgent) => {
    expect(
      (await POST(request(undefined, { 'user-agent': userAgent }))).status
    ).toBe(204);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    '{',
    { query: ' ', pathPrefix: '', source: 'navbar' },
    { query: 'x'.repeat(101), pathPrefix: '', source: 'navbar' },
    { query: 'phone', pathPrefix: '//evil.test', source: 'navbar' },
    { query: 'phone', pathPrefix: '', source: 'render' },
    { query: 'phone', pathPrefix: '', source: 'navbar', resultsCount: 999 },
  ])('rejects invalid input: %j', async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it.each([
    'Application/JSON',
    'application/json; charset=utf-8',
    ' Application/JSON ; charset=UTF-8 ',
  ])('accepts equivalent JSON media types: %s', async (contentType) => {
    expect(
      (await POST(request(undefined, { 'content-type': contentType }))).status
    ).toBe(204);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects lookalike media types at the content gate', async () => {
    expect(
      (
        await POST(
          request(undefined, { 'content-type': 'application/json-malicious' })
        )
      ).status
    ).toBe(415);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('rejects an oversized body before parsing or data access', async () => {
    expect((await POST(request(' '.repeat(2049)))).status).toBe(413);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('rejects a declared oversized body without consuming it', async () => {
    const req = request('{}', { 'content-length': '2049' });
    const read = vi.spyOn(req, 'text');
    expect((await POST(req)).status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('cancels a chunked oversized body as soon as the byte budget is exceeded', async () => {
    const req = request();
    const cancel = vi.fn();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array(2049));
      }
    );
    Object.defineProperty(req, 'body', {
      value: new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
    });
    expect((await POST(req)).status).toBe(413);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });

  it('does not write for an unknown storefront', async () => {
    mocks.merchant.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    'search',
    'insert',
    'throw',
  ])('returns a safe failure when %s fails', async (failure) => {
    if (failure === 'search')
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { message: 'secret database detail' },
      });
    if (failure === 'insert')
      mocks.insert.mockResolvedValue({
        error: { message: 'secret database detail' },
      });
    if (failure === 'throw')
      mocks.insert.mockRejectedValue(new Error('secret database detail'));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Search tracking unavailable',
    });
    if (failure === 'search') expect(mocks.insert).not.toHaveBeenCalled();
  });
});
