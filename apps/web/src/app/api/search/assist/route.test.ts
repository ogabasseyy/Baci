import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenant: vi.fn(),
  limit: vi.fn(),
  generate: vi.fn(),
}));
vi.mock('@/lib/agentic/agentic-chat-tenant', () => ({
  resolveAgenticChatTenant: mocks.tenant,
}));
vi.mock('@/lib/tenant-rate-limit', () => ({
  checkTenantRateLimit: mocks.limit,
}));
vi.mock('@/ai/generate-text-with-chain', () => ({
  generateTextWithChain: mocks.generate,
}));

import { POST } from './route';

function request(body: unknown, host = 'ogabassey.com') {
  return new Request('http://localhost/api/search/assist', {
    method: 'POST',
    headers: { host, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const input = {
  requestId: '019c6e27-e55b-73d1-87d8-4e01f1f75043',
  query: 'used iphone under 500k',
};
beforeEach(() => {
  vi.stubEnv('STOREFRONT_SEARCH_ASSIST_ENABLED', 'true');
  mocks.tenant.mockReset().mockResolvedValue({
    merchantId: 'm1',
    merchantSlug: 'ogabassey',
    businessName: 'Ogabassey',
    currencyCode: 'NGN',
  });
  mocks.limit.mockReset().mockResolvedValue('allowed');
  mocks.generate.mockReset().mockResolvedValue({
    text: JSON.stringify({
      query: 'iphone',
      explanation: 'Used within your budget.',
      filters: { condition: 'used', maxPrice: 500000 },
    }),
  });
});
describe('assisted search', () => {
  it('streams a bounded proposal without commerce actions', async () => {
    const response = await POST(request(input));
    expect(response.status).toBe(200);
    const frames = (await response.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(frames.map((f) => f.event.kind)).toEqual([
      'status',
      'proposal',
      'done',
    ]);
    expect(frames[1].event.proposal.filters).toEqual({
      condition: 'used',
      maxPrice: 500000,
    });
    expect(mocks.generate.mock.calls[0][0].tools).toBeUndefined();
  });
  it('rejects invalid and unknown tenants before any model call', async () => {
    expect((await POST(request({ ...input, action: 'checkout' }))).status).toBe(
      400
    );
    mocks.tenant.mockResolvedValue(null);
    expect((await POST(request(input))).status).toBe(503);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('bounds rate and fails invalid model output safely', async () => {
    mocks.limit.mockResolvedValueOnce('denied');
    expect((await POST(request(input))).status).toBe(429);
    expect(mocks.limit).toHaveBeenCalledWith('search_assist', 'm1', {
      maxRequests: 60,
      windowMs: 60_000,
    });
    mocks.generate.mockResolvedValue({ text: '{"action":"pay"}' });
    const frames = (await (await POST(request(input))).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(frames.at(-1).event.kind).toBe('error');
    expect(frames.some((f) => f.event.kind === 'proposal')).toBe(false);
  });
  it('scopes the prompt to the resolved merchant currency and store', async () => {
    mocks.tenant.mockResolvedValue({
      merchantId: 'm2',
      merchantSlug: 'konga',
      businessName: 'Konga Furniture',
      currencyCode: 'GHS',
    });
    await POST(request(input));
    const system = mocks.generate.mock.calls[0][0].system as string;
    expect(system).toContain('Konga Furniture');
    expect(system).toContain('(GHS numbers)');
    expect(system).not.toContain('NGN');
    expect(system).not.toContain('electronics store');
  });
  it('reports a limiter outage as unavailable, never as throttling', async () => {
    mocks.limit.mockResolvedValueOnce('unavailable');
    const response = await POST(request(input));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Assistance unavailable',
    });
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  it('does not reinterpret a production LAN Host', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    await POST(request(input, '192.168.100.84:3001'));
    expect(mocks.tenant.mock.calls[0][0].headers.get('host')).toBe(
      '192.168.100.84:3001'
    );
  });
  it('uses only the configured tenant for LAN development', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await POST(request(input, '192.168.100.84:3001'));
    expect(mocks.tenant.mock.calls[0][0].headers.get('host')).toBe('localhost');
  });
  it.each([
    '172.16.5.4:3000',
    '172.31.255.1',
    '127.0.0.1:3000',
  ])('rewrites %s to the configured dev tenant', async (host) => {
    vi.stubEnv('NODE_ENV', 'development');
    await POST(request(input, host));
    expect(mocks.tenant.mock.calls[0][0].headers.get('host')).toBe('localhost');
  });
  it.each([
    '172.32.0.1',
    '203.0.113.9',
    'shop.localhost',
  ])('leaves %s untouched in development', async (host) => {
    vi.stubEnv('NODE_ENV', 'development');
    await POST(request(input, host));
    expect(mocks.tenant.mock.calls[0][0].headers.get('host')).toBe(host);
  });
});
it('accepts provider JSON fences while rejecting any extra action', async () => {
  mocks.generate.mockResolvedValue({
    text:
      '```json\n' +
      JSON.stringify({
        query: 'iphone',
        explanation: 'Budget',
        filters: { maxPrice: 500000 },
      }) +
      '\n```',
  });
  const frames = (await (await POST(request(input))).text())
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  expect(frames[1].event.kind).toBe('proposal');
});
