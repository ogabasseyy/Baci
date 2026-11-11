import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  csrf: true,
  user: true,
  owner: true,
  merchant: '11111111-1111-4111-8111-111111111111',
  rpc: vi.fn(),
  getMerchant: vi.fn(),
  client: vi.fn(),
  performance: vi.fn(),
}));
vi.mock('@/lib/experience/publication-performance', () => ({
  requirePublicationPerformance: f.performance,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: f.csrf }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => f.client() }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => f.getMerchant(...args),
}));

import { POST } from './route';

const id = f.merchant;
beforeEach(() => {
  vi.clearAllMocks();
  f.csrf = true;
  f.user = true;
  f.owner = true;
  f.merchant = id;
  f.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'experience_require_owner' ||
      name === 'experience_authorize_publish' ||
      name === 'experience_authorize_read'
        ? true
        : {
            status: 'confirmation-required',
            approvalId: id,
            effectDigest: 'a'.repeat(64),
            expiresAt: '2099-01-01T00:00:00Z',
          },
    error: null,
  }));
  f.client.mockImplementation(async () => ({
    auth: {
      getUser: async () => ({
        data: { user: f.user ? { id } : null },
        error: null,
      }),
    },
    rpc: f.rpc,
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    })),
  }));
  f.getMerchant.mockImplementation(async () => ({
    merchantId: f.merchant,
    staffAccess: { isOwner: f.owner },
  }));
});
const req = (body: unknown) =>
  new NextRequest('http://127.0.0.1/api/builder-experience/request', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
const apply = {
  action: 'apply',
  merchantId: id,
  input: {
    buildId: id,
    evidenceId: id,
    expectedVersion: 0,
    idempotencyKey: id,
  },
};
it('rejects CSRF before authentication and authenticates before parsing', async () => {
  f.csrf = false;
  expect((await POST(req(apply))).status).toBe(403);
  expect(f.client).not.toHaveBeenCalled();
  f.csrf = true;
  f.user = false;
  const anonymous = req('{');
  expect((await POST(anonymous)).status).toBe(403);
  expect(anonymous.bodyUsed).toBe(false);
  expect(f.getMerchant).not.toHaveBeenCalled();
  f.user = true;
  expect((await POST(req('{'))).status).toBe(400);
  expect(f.getMerchant).not.toHaveBeenCalled();
});
it('anonymous, staff and mismatched merchant cannot request private effects', async () => {
  for (const state of [
    { user: false },
    { owner: false },
    { merchant: '22222222-2222-4222-8222-222222222222' },
  ]) {
    Object.assign(f, { user: true, owner: true, merchant: id }, state);
    f.rpc.mockClear();
    expect((await POST(req(apply))).status).toBe(403);
    expect(f.rpc).not.toHaveBeenCalled();
  }
});
it('normal-owner actions create intents only, never confirm or publish a pointer', async () => {
  const lifecycle = {
    storefrontId: id,
    buildId: id,
    expectedDraftVersion: 0,
    expectedPublishedVersion: 0,
    idempotencyKey: id,
  };
  for (const body of [
    apply,
    { action: 'publish', merchantId: id, input: lifecycle },
    { action: 'rollback', merchantId: id, input: lifecycle },
    {
      action: 'mode-exit',
      merchantId: id,
      input: {
        expectedDraftVersion: 0,
        expectedPublishedVersion: 0,
        targetLegacyRevision: id,
        effect: 'draft-only',
        idempotencyKey: id,
      },
    },
  ]) {
    const r = await POST(req(body));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
  }
  expect(
    f.rpc.mock.calls.some(([name]) => String(name).includes('confirm'))
  ).toBe(false);
  expect(f.getMerchant).toHaveBeenCalledWith(expect.anything(), id, {
    requestedMerchantId: id,
  });
});
it('body-selected other storefront and model approval flags are rejected', async () => {
  const input = {
    storefrontId: '22222222-2222-4222-8222-222222222222',
    buildId: id,
    expectedDraftVersion: 0,
    expectedPublishedVersion: 0,
    idempotencyKey: id,
  };
  expect(
    (await POST(req({ action: 'publish', merchantId: id, input }))).status
  ).toBe(403);
  expect((await POST(req({ ...apply, approved: true }))).status).toBe(400);
  expect(
    f.rpc.mock.calls.some(
      ([name]) => String(name) === 'experience_request_lifecycle'
    )
  ).toBe(false);
});

it('keeps publication closed when current performance qualification rejects', async () => {
  f.performance.mockRejectedValueOnce(Error('PERFORMANCE_UNQUALIFIED'));
  const r = await POST(
    req({
      action: 'publish',
      merchantId: id,
      input: {
        storefrontId: id,
        buildId: id,
        expectedDraftVersion: 0,
        expectedPublishedVersion: 0,
        idempotencyKey: id,
      },
    })
  );
  expect(r.status).toBe(403);
  expect(
    f.rpc.mock.calls.some(([name]) => name === 'experience_request_lifecycle')
  ).toBe(false);
});
