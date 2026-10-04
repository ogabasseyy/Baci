import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFundingScreenFixture } from '@/lib/piggyvest/customer-funding-screen.test-fixture';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://staging-auth.ogabassey.com',
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/prefunded-card-public-runtime', () => ({
  readPrefundedCardPublicRuntime: mocks.runtime,
}));

const origin = 'https://staging.ogabassey.com';
const path = '/api/storefront/customer/savings/card-contributions';
const input = {
  goalId: '30000000-0000-4000-8000-000000000001',
  savedMethodId: '50000000-0000-4000-8000-000000000001',
  idempotencyKey: '60000000-0000-4000-8000-000000000001',
  amountKobo: 10000,
  consent: { version: 'prefunded-card-v1', oneTimeCharge: true },
};
const result = {
  operationId: '70000000-0000-4000-8000-000000000001',
  goalId: input.goalId,
  amountKobo: input.amountKobo,
  currency: 'NGN',
  status: 'pending',
};

function post(body: unknown = input, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      host: 'staging.ogabassey.com',
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function get(
  query = `goalId=${input.goalId}&idempotencyKey=${input.idempotencyKey}`
) {
  return new NextRequest(`${origin}${path}?${query}`, {
    headers: { host: 'staging.ogabassey.com' },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  const fixture = createFundingScreenFixture();
  mocks.auth.mockResolvedValue({
    user: { id: '90000000-0000-4000-8000-000000000001' },
    error: null,
    supabase: fixture.options.supabase,
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({
    publicOrigin: origin,
    configuration: { ...fixture.options.configuration, transport: 'tls' },
    card: {
      enabled: true,
      expectedSystemId: '7685292944002592802',
      execute: mocks.execute,
    },
  });
  mocks.execute.mockResolvedValue({ rows: [{ result }] });
});

describe('public staging saved-card contributions', () => {
  it('authenticates before reading configuration, checking CSRF or reserving', async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      error: 'expired',
      supabase: null,
    });
    expect((await POST(post())).status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('requires CSRF before loading a mutation runtime', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(post())).status).toBe(403);
    expect(mocks.runtime).not.toHaveBeenCalled();
  });

  it.each([
    { ...input, consent: undefined },
    {
      ...input,
      consent: { version: 'prefunded-card-v1', oneTimeCharge: false },
    },
    { ...input, merchantId: input.goalId },
    { ...input, amountKobo: 0.1 },
  ])('refuses malformed or authority-bearing body before configuration', async (body) => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.runtime).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('returns unavailable with no SQL when the staging switch is off', async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    { host: 'ogabassey.com' },
    { host: 'localhost:4795', 'x-forwarded-host': 'staging.ogabassey.com' },
    { origin: 'https://other.example.test' },
  ])('does not accept forwarded or foreign host authority %j', async (headers) => {
    expect((await POST(post(input, headers))).status).toBe(403);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('queues a scoped explicit one-time charge but never reports pending as completed', async () => {
    const response = await POST(post());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual(result);
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.execute.mock.calls[0][1][7])).toEqual(input);
  });

  it('reads status without executing a mutation', async () => {
    expect((await GET(get())).status).toBe(200);
    expect(mocks.execute.mock.calls[0][0]).toContain('customer_status(');
  });

  it('reads masked capabilities with goal only and no card charge', async () => {
    const capability = {
      goalId: input.goalId,
      enabled: false,
      newCardEnabled: false,
      currency: 'NGN',
      maximumAmountKobo: 25000000,
      savedMethods: [],
    };
    mocks.execute.mockResolvedValue({ rows: [{ result: capability }] });
    const response = await GET(get(`goalId=${input.goalId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(capability);
    expect(mocks.execute.mock.calls[0][0]).toContain('customer_capabilities(');
  });

  it('rejects duplicate query identity and unknown query fields', async () => {
    expect(
      (await GET(get(`goalId=${input.goalId}&goalId=${input.goalId}`))).status
    ).toBe(400);
    expect(
      (await GET(get(`goalId=${input.goalId}&customerId=${input.goalId}`)))
        .status
    ).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('redacts runtime failures rather than leaking configuration', async () => {
    mocks.runtime.mockImplementation(() => {
      throw new Error('private database password');
    });
    const response = await GET(get());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database password');
  });
});
