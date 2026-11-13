import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { walletActivityCursor } from '@/lib/piggyvest/wallet-activity-cursor';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runtime: vi.fn(),
  drain: vi.fn(),
  killed: vi.fn(),
  identity: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
  readPrimaryWalletRuntimeDrain: mocks.drain,
}));
vi.mock('@/lib/piggyvest/piggyvest-kill-switch', () => ({
  isPiggyvestKilled: mocks.killed,
}));
vi.mock('@/lib/piggyvest/piggyvest-feature-on', () => ({
  isPiggyvestFeatureFlagSet: () => true,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const base =
  'https://example.com/api/storefront/customer/wallet/piggyvest-activity';
const request = (query: string) => new NextRequest(`${base}?${query}`);
const row = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  kind: 'savings_contribution',
  direction: 'out',
  amount_kobo: 1000000,
  label: 'Saved to iPhone fund',
  status: 'completed',
  occurred_at: `2026-11-1${n}T10:00:00+00:00`,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    user: { id: 'user-1' },
    supabase: { rpc: mocks.rpc },
    error: null,
  });
  mocks.runtime.mockReturnValue({ onboarding: { merchantId } });
  mocks.killed.mockReturnValue(false);
  mocks.identity.mockResolvedValue({ merchantId });
  mocks.rpc.mockResolvedValue({ data: [row(2), row(1)], error: null });
});

describe('GET piggyvest wallet activity', () => {
  it('returns 401 when the customer is not signed in', async () => {
    mocks.auth.mockResolvedValue({ user: null, supabase: null, error: 'x' });
    const response = await GET(request(`merchantId=${merchantId}`));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: 'Please sign in again.',
      code: 'UNAUTHORIZED',
    });
  });

  it.each([
    'merchantId=not-a-uuid',
    `merchantId=${merchantId}&merchantId=${merchantId}`,
    `merchantId=${merchantId}&limit=51`,
    `merchantId=${merchantId}&cursor=bad!cursor`,
    `merchantId=${merchantId}&cursor=${Buffer.from('["nope"]').toString('base64url')}`,
    `merchantId=${merchantId}&extra=1`,
  ])('returns 400 INVALID_INPUT for %s', async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_INPUT');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns 503 when PiggyVest is not configured for this store', async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await GET(request(`merchantId=${merchantId}`));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('PIGGYVEST_NOT_READY');
  });

  it('returns 409 when the profile is not verified', async () => {
    mocks.identity.mockResolvedValue(null);
    const response = await GET(request(`merchantId=${merchantId}`));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('PROFILE_VERIFICATION_REQUIRED');
  });

  it('reads through the customer session RPC and maps rows', async () => {
    const response = await GET(request(`merchantId=${merchantId}&limit=2`));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('list_piggyvest_wallet_activity', {
      p_merchant_id: merchantId,
      p_before_at: null,
      p_before_id: null,
      p_limit: 2,
    });
    const body = await response.json();
    expect(body.items[0]).toEqual({
      id: row(2).id,
      kind: 'savings_contribution',
      direction: 'out',
      amountKobo: 1000000,
      label: 'Saved to iPhone fund',
      status: 'completed',
      occurredAt: row(2).occurred_at,
    });
    // A full page carries a cursor for the last row.
    expect(walletActivityCursor.decode(body.nextCursor)).toEqual({
      beforeAt: row(1).occurred_at,
      beforeId: row(1).id,
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('passes a decoded cursor and ends paging on a short page', async () => {
    const cursor = walletActivityCursor.encode(row(3));
    mocks.rpc.mockResolvedValue({ data: [row(1)], error: null });
    const response = await GET(
      request(`merchantId=${merchantId}&cursor=${cursor}`)
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'list_piggyvest_wallet_activity',
      expect.objectContaining({
        p_before_at: row(3).occurred_at,
        p_before_id: row(3).id,
        p_limit: 20,
      })
    );
    expect((await response.json()).nextCursor).toBeNull();
  });

  it('returns 500 ACTIVITY_UNAVAILABLE when the read fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await GET(request(`merchantId=${merchantId}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'We couldn’t load your wallet activity.',
      code: 'ACTIVITY_UNAVAILABLE',
    });
  });

  it('returns 500 rather than passing through an unexpected row shape', async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ ...row(1), provider_transaction_id: 'secret' }],
      error: null,
    });
    const response = await GET(request(`merchantId=${merchantId}`));
    expect(response.status).toBe(500);
  });
});
