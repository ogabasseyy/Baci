import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  issue: vi.fn(),
  binding: vi.fn(),
  merchantResult: vi.fn(),
  customerResult: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/chatwoot/chat-customer-link-token', () => ({
  issueChatCustomerLinkToken: mocks.issue,
}));
vi.mock('@/lib/chatwoot/commerce-context-config', () => ({
  getChatwootTenantBinding: mocks.binding,
}));

import { POST } from './route';

const MERCHANT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';

function supabase() {
  const filters: Record<string, unknown> = {};
  const chain = (result: () => unknown) => {
    const builder: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'is']) {
      builder[name] = (...args: unknown[]) => {
        if (name === 'eq') filters[String(args[0])] = args[1];
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(result());
    return builder;
  };
  return {
    filters,
    client: {
      from: (table: string) =>
        chain(() =>
          table === 'merchants'
            ? mocks.merchantResult()
            : mocks.customerResult()
        ),
    },
  };
}

function call(body: unknown) {
  return POST(
    new NextRequest(
      'https://store.example.test/api/storefront/chatwoot/customer-link',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  );
}

let sb: ReturnType<typeof supabase>;

beforeEach(() => {
  vi.clearAllMocks();
  sb = supabase();
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.auth.mockResolvedValue({
    user: { id: 'auth-user-1' },
    supabase: sb.client,
    error: null,
  });
  mocks.merchantResult.mockReturnValue({ data: { id: MERCHANT }, error: null });
  mocks.customerResult.mockReturnValue({ data: { id: CUSTOMER }, error: null });
  mocks.binding.mockReturnValue({});
  mocks.issue.mockResolvedValue('signed.token.value');
});

describe('POST /api/storefront/chatwoot/customer-link', () => {
  it('gives a signed-in shopper a token for their own customer record', async () => {
    const response = await call({ storeSlug: 'ogabassey' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: 'signed.token.value',
    });
    expect(mocks.issue).toHaveBeenCalledWith({
      merchantId: MERCHANT,
      customerId: CUSTOMER,
    });
    expect(sb.filters).toMatchObject({
      slug: 'ogabassey',
      user_id: 'auth-user-1',
      merchant_id: MERCHANT,
    });
  });

  it('answers a guest 401 without reading the body', async () => {
    mocks.auth.mockResolvedValue({ user: null, supabase: null, error: 'x' });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(401);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('refuses a forged request before any auth', async () => {
    mocks.csrf.mockResolvedValue({
      valid: false,
      response: NextResponse.json({ code: 'csrf' }, { status: 403 }),
    });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    ['an unknown key', { storeSlug: 'a', customerId: CUSTOMER }],
    ['an over-long slug', { storeSlug: 'x'.repeat(121) }],
    ['an oversized body', { storeSlug: 'a', pad: 'x'.repeat(2048) }],
  ])('rejects %s', async (_name, body) => {
    expect((await call(body)).status).toBe(400);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  // The widget treats 401/404 as final and 503 as worth one more try, so a
  // passing database or sign-in failure must never look like either.
  it('answers 503, not "no such store", when the store lookup fails', async () => {
    mocks.merchantResult.mockReturnValue({
      data: null,
      error: { message: 'connection reset' },
    });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(503);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('answers 404 for a store that does not exist', async () => {
    mocks.merchantResult.mockReturnValue({ data: null, error: null });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(404);
  });

  it('answers 503, not "signed out", when the sign-in check itself fails', async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Authentication failed',
    });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(503);
    // Only this option tells a failed check apart from a missing session.
    expect(mocks.auth).toHaveBeenCalledWith(expect.anything(), {
      requireVerifiedGuest: true,
    });
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('does not link a shopper who is not a customer of that store', async () => {
    mocks.customerResult.mockReturnValue({ data: null, error: null });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(404);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('does nothing for a store whose chat is not set up', async () => {
    mocks.binding.mockImplementation(() => {
      throw new Error('binding_unavailable');
    });
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(404);
    expect(mocks.issue).not.toHaveBeenCalled();
  });

  it('answers 503 when signing is not configured', async () => {
    mocks.issue.mockResolvedValue(null);
    expect((await call({ storeSlug: 'ogabassey' })).status).toBe(503);
  });
});
