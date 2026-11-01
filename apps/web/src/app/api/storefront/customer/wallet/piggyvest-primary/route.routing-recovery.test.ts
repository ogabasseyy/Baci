import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runtime: vi.fn(),
  onboardingRuntime: vi.fn(),
  identity: vi.fn(),
  executor: vi.fn(),
  execute: vi.fn(),
  snapshot: vi.fn(),
  recover: vi.fn(),
  wallet: vi.fn(),
  provider: vi.fn(),
  order: [] as string[],
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
  readPrimaryWalletOnboardingRuntime: mocks.onboardingRuntime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/primary-wallet-executor', () => ({
  createPrimaryWalletExecutor: mocks.executor,
}));
vi.mock('@/lib/piggyvest/primary-wallet-statements', () => ({
  PRIMARY_WALLET_STATEMENTS: { readReview: 'READ_REVIEW' },
}));
vi.mock('@/lib/piggyvest/primary-wallet-snapshot', () => ({
  readPrimaryWalletSnapshot: mocks.snapshot,
}));
vi.mock('@/lib/piggyvest/primary-wallet-routing-recovery', () => ({
  recoverPrimaryWalletRouting: mocks.recover,
}));
vi.mock('@/lib/piggyvest/primary-wallet-provider', () => ({
  createPrimaryWalletProviderCustomer: mocks.provider,
}));
vi.mock('@/lib/piggyvest/wallets', () => ({
  retrievePiggyvestWallet: mocks.wallet,
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const userId = 'f4f01e61-691f-494a-a895-872f17f8e55e';
const customerId = 'e648eb14-928a-427b-9719-b105f6d4b8b4';
const integrationId = 'd91d9e87-8e0d-44de-9b84-1e1d709633d2';
const runtime = {
  onboarding: {
    merchantId,
    integrationId,
    businessId: 'test-business',
    environment: 'staging',
  },
  providerToken: 'test-token',
};
const url = `https://example.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=${merchantId}`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.executor.mockReturnValue(mocks.execute);
  mocks.auth.mockResolvedValue({
    user: { id: userId },
    supabase: {},
    error: null,
  });
  mocks.runtime.mockReturnValue(runtime);
  mocks.onboardingRuntime.mockReturnValue({
    runtime,
    interestPayoutWalletId: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId,
    userId,
  });
  mocks.recover.mockImplementation(async () => {
    mocks.order.push('recover');
    return 'promoted';
  });
  mocks.execute.mockResolvedValue({ rows: [{ result: null }] });
  mocks.snapshot.mockImplementation(async () => {
    mocks.order.push('snapshot');
    return { status: 'pending', account: null };
  });
});

describe('primary wallet GET: routing-pending recovery', () => {
  it('never runs recovery for a wallet that is already ready', async () => {
    mocks.snapshot.mockResolvedValue({
      status: 'ready',
      balanceKobo: 0,
      account: {
        accountNumber: '0123456789',
        accountName: 'Test Customer',
        bankName: 'Provider Bank',
        provider: 'piggyvest',
      },
    });
    expect((await GET(new NextRequest(url))).status).toBe(200);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('re-reads the snapshot only after recovery has finished promoting', async () => {
    let finish: (value: string) => void = () => {};
    mocks.recover.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        })
    );
    const pending = GET(new NextRequest(url));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.snapshot).toHaveBeenCalledOnce();
    finish('promoted');
    expect((await pending).status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledTimes(2);
  });

  it('does not re-read the snapshot when recovery leaves the wallet pending', async () => {
    mocks.recover.mockResolvedValue('pending');
    expect((await GET(new NextRequest(url))).status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledOnce();
  });

  it('re-reads a routing-pending wallet read-only and scoped, with no customer creation', async () => {
    expect((await GET(new NextRequest(url))).status).toBe(200);
    expect(mocks.order).toEqual(['snapshot', 'recover', 'snapshot']);
    const command = mocks.recover.mock.calls[0][0];
    expect(command).toEqual(
      expect.objectContaining({
        scope: expect.objectContaining({
          merchantId,
          customerId,
          userId,
          businessId: 'test-business',
        }),
        execute: mocks.execute,
      })
    );
    expect(command).not.toHaveProperty('payoutWalletId');
    await command.retrieveWallet('pending-wallet');
    expect(mocks.wallet).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl: 'https://staging.piggyvest.business' },
      'pending-wallet'
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('still recovers when the payout wallet setting is gone: it checks the payout stored at creation', async () => {
    mocks.onboardingRuntime.mockReturnValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(200);
    expect(mocks.recover).toHaveBeenCalledOnce();
  });

  it('still answers from the snapshot when recovery is unavailable', async () => {
    mocks.recover.mockRejectedValue(new Error('private database detail'));
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private database detail'
    );
  });

  it('returns the routing review immediately after a rejected recovery and on later refreshes', async () => {
    mocks.recover.mockResolvedValue('rejected');
    mocks.execute
      .mockResolvedValueOnce({ rows: [{ result: null }] })
      .mockResolvedValueOnce({ rows: [{ result: 'routing' }] });

    const first = await GET(new NextRequest(url));
    expect(first.status).toBe(409);
    expect(first.headers.get('cache-control')).toBe('no-store');
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      error:
        'Your wallet interest routing needs review. Please contact support.',
      code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
    });
    expect(mocks.snapshot).toHaveBeenCalledOnce();

    const refresh = await GET(new NextRequest(url));
    expect(refresh.status).toBe(409);
    expect(refresh.headers.get('cache-control')).toBe('no-store');
    const refreshBody = await refresh.json();
    expect(refreshBody).toEqual(firstBody);
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.execute.mock.calls[0][1][0])).toEqual({
      merchantId,
      customerId,
      userId,
      integrationId,
      businessId: 'test-business',
      environment: 'staging',
    });
    expect(JSON.stringify(refreshBody)).not.toMatch(
      /provider(Customer|Wallet)Id|customer-fixture|wallet-fixture|test-token/
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('maps durable ownership review without exposing provider identifiers', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ result: 'ownership' }] });
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error:
        'Your wallet identity needs verification. Please contact support; no duplicate wallet will be created.',
      code: 'OWNERSHIP_REVIEW_REQUIRED',
    });
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('fails closed when the durable review read is unavailable', async () => {
    mocks.execute.mockRejectedValue(new Error('private database detail'));
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private database detail'
    );
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it('fails closed when the durable review row is malformed', async () => {
    mocks.execute.mockResolvedValue({
      rows: [{ result: { reason: 'routing' } }],
    });
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(503);
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain('reason');
  });
});
