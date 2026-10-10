import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savingsDraftFixture } from '@/lib/customer-savings-draft.test-fixture';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  rpc: vi.fn(),
  csrf: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));

import { GET, POST } from './route';

describe('normal savings draft policy route', () => {
  const fixture = savingsDraftFixture();
  const endpoint =
    'http://localhost/api/storefront/customer/savings/drafts/policy';
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55431');
    mocks.auth.mockResolvedValue({
      user: { id: 'actor' },
      error: null,
      supabase: { rpc: mocks.rpc },
    });
    mocks.csrf.mockResolvedValue({ valid: true });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('reads the persisted disclosure through authenticated GET', async () => {
    mocks.rpc.mockResolvedValue({
      data: { draft: fixture.record },
      error: null,
    });
    const response = await GET(
      new NextRequest(
        `${endpoint}?merchantId=${fixture.merchantId}&draftId=${fixture.record.draftId}`
      )
    );
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('customer_savings_draft_command', {
      p_merchant_id: fixture.merchantId,
      p_action: 'policy',
      p_input: { draftId: fixture.record.draftId },
    });
    expect((await response.json()).draft.terms).toEqual(fixture.record.terms);
    expect(mocks.csrf).not.toHaveBeenCalled();
  });
  it('routes POST to accept without monetary fields or activation', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        draft: { ...fixture.record, acceptedAt: '2026-09-13T12:01:00Z' },
      },
      error: null,
    });
    const response = await POST(
      new NextRequest(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer local-token',
        },
        body: JSON.stringify(fixture.accept),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST' })
    );
    expect(mocks.csrf).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls[0][1].p_action).toBe('accept');
    expect((await response.json()).draft).toMatchObject({
      status: 'draft',
      consent: 'accepted',
    });
  });
  it('returns 401 without a customer session', async () => {
    mocks.auth.mockResolvedValue({ user: null, error: 'unauthorized' });
    expect(
      (
        await GET(
          new NextRequest(`${endpoint}?merchantId=${fixture.merchantId}`)
        )
      ).status
    ).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires exact revision acceptance', async () => {
    const response = await POST(
      new NextRequest(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fixture.accept, accepted: false }),
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
