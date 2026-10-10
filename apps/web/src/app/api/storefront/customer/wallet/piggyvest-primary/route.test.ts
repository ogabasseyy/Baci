import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  onboard: vi.fn(),
  executor: vi.fn(),
  store: vi.fn(),
  provider: vi.fn(),
  snapshot: vi.fn(),
  mapping: vi.fn(),
  wallet: vi.fn(),
  accounts: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/piggyvest/primary-wallet-verification', () => ({
  verifyPrimaryWalletMapping: mocks.verify,
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/primary-wallet-onboarding', () => ({
  onboardPiggyvestPrimaryWallet: mocks.onboard,
}));
vi.mock('@/lib/piggyvest/primary-wallet-executor', () => ({
  createPrimaryWalletExecutor: mocks.executor,
}));
vi.mock('@/lib/piggyvest/primary-wallet-store', () => ({
  createPrimaryWalletStore: mocks.store,
}));
vi.mock('@/lib/piggyvest/primary-wallet-provider', () => ({
  createPrimaryWalletProviderCustomer: mocks.provider,
}));
vi.mock('@/lib/piggyvest/primary-wallet-snapshot', () => ({
  readPrimaryWalletSnapshot: mocks.snapshot,
}));
vi.mock('@/lib/piggyvest/primary-wallet-mapping', () => ({
  readPrimaryWalletMapping: mocks.mapping,
}));
vi.mock('@/lib/piggyvest/wallets', () => ({
  retrievePiggyvestWallet: mocks.wallet,
}));
vi.mock('@/lib/piggyvest/wallet-funding', () => ({
  retrievePiggyvestFundingAccounts: mocks.accounts,
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
function request(
  body: unknown = { merchantId, consent: true, bvn: '00000000000' }
) {
  return new NextRequest(
    'https://example.com/api/storefront/customer/wallet/piggyvest-primary',
    { method: 'POST', body: JSON.stringify(body) }
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.executor.mockReturnValue(vi.fn());
  mocks.auth.mockResolvedValue({
    user: { id: 'test-user' },
    supabase: {},
    error: null,
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.runtime.mockReturnValue({
    onboarding: {
      merchantId,
      integrationId: 'test-integration',
      businessId: 'test-business',
      environment: 'production',
    },
    providerToken: 'test-token',
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'test-customer',
    userId: 'test-user',
  });
  mocks.onboard.mockResolvedValue({ status: 'pending' });
  mocks.snapshot.mockResolvedValue({
    status: 'ready',
    balanceKobo: 100,
    account: {
      accountNumber: '0123456789',
      bankName: 'Provider Bank',
      accountName: 'Test Customer',
      provider: 'piggyvest',
    },
  });
});
describe('primary wallet funding account GET', () => {
  const url = `https://example.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=${merchantId}`;
  it('requires authentication before resolving a wallet', async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'Unauthorized',
    });
    expect((await GET(new NextRequest(url))).status).toBe(401);
    expect(mocks.mapping).not.toHaveBeenCalled();
  });
  it('does not accept a client-selected provider wallet ID', async () => {
    expect(
      (await GET(new NextRequest(`${url}&walletId=other-wallet`))).status
    ).toBe(400);
    expect(mocks.snapshot).not.toHaveBeenCalled();
  });
  it('loads scoped account details with caching disabled', async () => {
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(
      expect.objectContaining({
        balanceKobo: 100,
        account: expect.objectContaining({ provider: 'piggyvest' }),
      })
    );
    const command = mocks.snapshot.mock.calls[0][0];
    const proof = {
      mapping: { providerWalletId: 'stored-wallet' },
      wallet: { id: 'stored-wallet' },
      accounts: [],
    };
    await command.verifyMapping(proof);
    expect(mocks.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        proof,
        scope: expect.objectContaining({
          customerId: 'test-customer',
          userId: 'test-user',
          businessId: 'test-business',
        }),
        execute: expect.any(Function),
      })
    );
    await command.loadMapping();
    expect(mocks.mapping).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'test-customer',
        userId: 'test-user',
      }),
      expect.anything()
    );
    await command.retrieveWallet('stored-wallet');
    expect(mocks.wallet).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl: 'https://api.piggyvest.business' },
      'stored-wallet'
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it('returns 503 rather than an invented account on provider failure', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'unavailable', account: null });
    expect((await GET(new NextRequest(url))).status).toBe(503);
  });
  it.each([
    ['staging', 'https://staging.piggyvest.business'],
    ['production', 'https://api.piggyvest.business'],
  ])('uses the exact %s origin for wallet and account reads', async (environment, baseUrl) => {
    const configuration = mocks.runtime();
    mocks.runtime.mockReturnValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, environment },
    });
    expect((await GET(new NextRequest(url))).status).toBe(200);
    const command = mocks.snapshot.mock.calls[0][0];
    await command.retrieveWallet('stored-wallet');
    await command.retrieveAccounts('stored-wallet');
    const provider = { token: 'test-token', baseUrl };
    expect(mocks.wallet).toHaveBeenCalledWith(provider, 'stored-wallet');
    expect(mocks.accounts).toHaveBeenCalledWith(provider, 'stored-wallet');
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
describe('primary wallet onboarding API', () => {
  it('returns 401 before reading input or constructing storage when signed out', async () => {
    mocks.auth.mockResolvedValue({
      user: null,
      supabase: null,
      error: 'private auth detail',
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(mocks.executor).not.toHaveBeenCalled();
  });
  it('rejects failed CSRF before onboarding', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.onboard).not.toHaveBeenCalled();
  });
  it('rejects caller-selected customer identity or invalid BVN without echoing input', async () => {
    const response = await POST(
      request({
        merchantId,
        consent: true,
        bvn: 'sensitive-invalid-bvn',
        customerId: 'injected',
      })
    );
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain(
      'sensitive-invalid-bvn'
    );
    expect(mocks.identity).not.toHaveBeenCalled();
  });
  it('requires the configured merchant and authenticated customer', async () => {
    mocks.identity.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    expect(mocks.executor).not.toHaveBeenCalled();
  });
  it('returns 422 with a correctable BVN message on definitive provider rejection', async () => {
    mocks.onboard.mockResolvedValue({
      status: 'rejected',
      code: 'INVALID_BVN',
    });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: 'That BVN was rejected. Check the number and try again.',
      code: 'INVALID_BVN',
    });
  });
  it('connects authenticated identity, scoped storage and provider creation', async () => {
    expect((await POST(request())).status).toBe(202);
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({
          merchantId,
          customerId: 'test-customer',
          userId: 'test-user',
        }),
      })
    );
    const command = mocks.onboard.mock.calls[0][0];
    await command.createCustomer({ bvn: 'test' });
    expect(mocks.provider).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl: 'https://api.piggyvest.business' },
      { bvn: 'test' }
    );
  });
  it('returns a safe unavailable response when runtime is not activated', async () => {
    mocks.runtime.mockReturnValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.onboard).not.toHaveBeenCalled();
  });
  it.each([
    ['staging', 'https://staging.piggyvest.business'],
    ['production', 'https://api.piggyvest.business'],
  ])('uses the exact %s origin for customer creation', async (environment, baseUrl) => {
    const configuration = mocks.runtime();
    mocks.runtime.mockReturnValue({
      ...configuration,
      onboarding: { ...configuration.onboarding, environment },
    });
    expect((await POST(request())).status).toBe(202);
    const command = mocks.onboard.mock.calls[0][0];
    await command.createCustomer({ bvn: 'test' });
    expect(mocks.provider).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl },
      { bvn: 'test' }
    );
  });
});
