import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from './customer-savings-draft.test-fixture';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { handleCustomerSavingsDraft } from './customer-savings-draft-handler';

describe('normal customer draft handler', () => {
  const fixture = savingsDraftFixture();
  const request = (body: unknown = fixture.create) =>
    new NextRequest('http://localhost/api/storefront/customer/savings/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55431');
    mocks.auth.mockResolvedValue({
      user: { id: 'actor' },
      supabase: { rpc: mocks.rpc },
      error: null,
    });
    mocks.csrf.mockResolvedValue({ valid: true });
    mocks.rpc.mockResolvedValue({
      data: { draft: fixture.record },
      error: null,
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('authenticates before validating or looking up anything', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'secret auth error' });
    expect(
      (await handleCustomerSavingsDraft(request({}), 'create')).status
    ).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    'https://remote.supabase.co',
    '',
    'http://127.0.0.1.example.org',
  ])('disables non-local runtime %s', async (url) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url);
    expect((await handleCustomerSavingsDraft(request(), 'create')).status).toBe(
      403
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('remains disabled in production with a loopback URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect((await handleCustomerSavingsDraft(request(), 'create')).status).toBe(
      403
    );
  });
  it('rejects CSRF before input or database processing', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await handleCustomerSavingsDraft(request(), 'create')).status).toBe(
      403
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { price: 1 },
    { actorId: 'forged' },
    { enabled: true },
  ])('rejects untrusted fields %j', async (extra) => {
    expect(
      (
        await handleCustomerSavingsDraft(
          request({ ...fixture.create, ...extra }),
          'create'
        )
      ).status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes identifiers only to the authenticated scoped command', async () => {
    const response = await handleCustomerSavingsDraft(request(), 'create');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('customer_savings_draft_command', {
      p_merchant_id: fixture.merchantId,
      p_action: 'create',
      p_input: {
        productId: fixture.record.productId,
        variantId: fixture.record.variantId,
        requestId: fixture.record.requestId,
      },
    });
    expect((await response.json()).draft).toMatchObject({
      status: 'draft',
      consent: 'required',
      device: { price: 125 },
    });
  });
  it.each([
    ['42501', 403],
    ['22023', 400],
    ['22P02', 400],
    ['P0002', 404],
    ['23505', 409],
    ['23514', 409],
    ['XX000', 503],
  ])('redacts database error %s', async (code, status) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code,
        message: 'private provider secret',
        details: 'sql detail',
      },
    });
    const response = await handleCustomerSavingsDraft(request(), 'create');
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Savings draft unavailable',
      code: expect.stringMatching(/^SAVINGS_DRAFT_/),
    });
  });
  it('redacts malformed persisted data and unexpected failures', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        draft: {
          ...fixture.record,
          terms: { ...fixture.record.terms, text: 'tampered' },
        },
      },
      error: null,
    });
    expect((await handleCustomerSavingsDraft(request(), 'create')).status).toBe(
      503
    );
    mocks.auth.mockRejectedValue(new Error('secret'));
    expect((await handleCustomerSavingsDraft(request(), 'create')).status).toBe(
      503
    );
  });
  it('rejects duplicate query keys, unknown parameters, and POST query strings', async () => {
    for (const suffix of ['&merchantId=other', '&customerId=other']) {
      const response = await handleCustomerSavingsDraft(
        new NextRequest(
          `http://localhost/drafts?merchantId=${fixture.merchantId}${suffix}`
        ),
        'list'
      );
      expect(response.status).toBe(400);
    }
    const post = new NextRequest('http://localhost/drafts?extra=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fixture.create),
    });
    expect((await handleCustomerSavingsDraft(post, 'create')).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects malformed and oversized JSON before database access', async () => {
    for (const body of ['{', JSON.stringify({ extra: 'x'.repeat(9000) })]) {
      const post = new NextRequest('http://localhost/drafts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      expect((await handleCustomerSavingsDraft(post, 'create')).status).toBe(
        400
      );
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
