import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  runtime: vi.fn(),
  onboardingRuntime: vi.fn(),
  identity: vi.fn(),
  onboard: vi.fn(),
  executor: vi.fn(),
  store: vi.fn(),
  provider: vi.fn(),
  wallet: vi.fn(),
  lookup: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
  readPrimaryWalletOnboardingRuntime: mocks.onboardingRuntime,
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
vi.mock('@/lib/piggyvest/wallets', () => ({
  retrievePiggyvestWallet: mocks.wallet,
}));
vi.mock('@/lib/piggyvest/customers', () => ({
  findPiggyvestCustomersByThirdPartyIdentifier: mocks.lookup,
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const payoutWalletId = '01JBZ8Q5W3X9R2K4M6N8P0T2V4';
const runtime = {
  onboarding: {
    merchantId,
    integrationId: 'test-integration',
    businessId: 'test-business',
    environment: 'staging',
  },
  providerToken: 'test-token',
};
function request() {
  return new NextRequest(
    'https://example.com/api/storefront/customer/wallet/piggyvest-primary',
    {
      method: 'POST',
      body: JSON.stringify({ merchantId, consent: true, bvn: '00000000000' }),
    }
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
  mocks.runtime.mockReturnValue(runtime);
  mocks.onboardingRuntime.mockReturnValue({
    runtime,
    interestPayoutWalletId: payoutWalletId,
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'test-customer',
    userId: 'test-user',
  });
  mocks.onboard.mockResolvedValue({ status: 'pending' });
});

describe('primary wallet onboarding interest routing API', () => {
  it('is not ready for setup, with a code clients must not treat as primary being off, while only the payout wallet is unconfigured', async () => {
    // The base runtime (reads, savings) stays up, so this is not the
    // merchant-wide PIGGYVEST_NOT_READY that sends mobile to legacy setup.
    mocks.onboardingRuntime.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Wallet setup is temporarily unavailable.',
      code: 'PIGGYVEST_ONBOARDING_NOT_READY',
    });
    expect(mocks.onboard).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.wallet).not.toHaveBeenCalled();
  });

  it('keeps the merchant-wide not-ready code when the primary runtime itself is off', async () => {
    mocks.runtime.mockReturnValue(null);
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe('PIGGYVEST_NOT_READY');
    expect(mocks.onboard).not.toHaveBeenCalled();
  });

  it('passes the server-configured payout wallet and a scoped provider readback', async () => {
    expect((await POST(request())).status).toBe(202);
    const command = mocks.onboard.mock.calls[0][0];
    expect(command.configuration).toEqual({
      ...runtime.onboarding,
      interestPayoutWalletId: payoutWalletId,
    });
    await command.retrieveWallet('created-wallet');
    expect(mocks.wallet).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl: 'https://staging.piggyvest.business' },
      'created-wallet'
    );
    await command.findCustomers('baci:test-integration:test-customer');
    expect(mocks.lookup).toHaveBeenCalledWith(
      { token: 'test-token', baseUrl: 'https://staging.piggyvest.business' },
      'baci:test-integration:test-customer'
    );
  });

  it('returns the stable review code when the readback disproves the routing', async () => {
    mocks.onboard.mockResolvedValue({
      status: 'conflict',
      code: 'INTEREST_ROUTING_REVIEW_REQUIRED',
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('INTEREST_ROUTING_REVIEW_REQUIRED');
    expect(JSON.stringify(body)).not.toContain(payoutWalletId);
  });

  it('keeps the ownership code for an ownership conflict', async () => {
    mocks.onboard.mockResolvedValue({ status: 'conflict' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('OWNERSHIP_REVIEW_REQUIRED');
  });
});
