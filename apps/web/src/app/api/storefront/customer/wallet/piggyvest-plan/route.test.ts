import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticateApiRequest = vi.fn();
const mockCheckCsrfProtection = vi.fn();
const mockResolveVtuCustomer = vi.fn();
const mockResolveWalletTopUpMerchant = vi.fn();
const mockGetSnapshot = vi.fn();
const mockEnsurePlanWallet = vi.fn();
const mockGetApiConfig = vi.fn();
const mockIsSyntheticKycEnabled = vi.fn();
const mockCreateAdminClient = vi.fn();
const authenticatedClient = { authScope: 'customer' };

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/resolve-wallet-top-up-merchant', () => ({
  resolveWalletTopUpMerchant: (...args: unknown[]) =>
    mockResolveWalletTopUpMerchant(...args),
}));

vi.mock('@/lib/vtu-pending-transaction', () => ({
  resolveVtuCustomer: (...args: unknown[]) => mockResolveVtuCustomer(...args),
}));

vi.mock('@/lib/piggyvest/plan-wallets', () => ({
  PlanWalletError: class PlanWalletError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.name = 'PlanWalletError';
      this.code = code;
    }
  },
  ensurePlanWallet: (...args: unknown[]) => mockEnsurePlanWallet(...args),
  getPlanWalletSnapshot: (...args: unknown[]) => mockGetSnapshot(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: (...args: unknown[]) => mockCreateAdminClient(...args),
}));

vi.mock('@/env', () => ({
  getPiggyvestApiConfig: (...args: unknown[]) => mockGetApiConfig(...args),
  isPiggyvestStagingSyntheticKycEnabled: (...args: unknown[]) =>
    mockIsSyntheticKycEnabled(...args),
}));

import { PlanWalletError } from '@/lib/piggyvest/plan-wallets';
import { GET, POST } from './route';

const merchant = {
  business_name: 'Ogabassey',
  id: '43e157b6-179c-432a-9392-e0827da96d82',
  slug: 'ogabassey',
};

const customer = {
  email: 'jane@example.com',
  id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
};

const readySnapshot = {
  status: 'ready',
  walletId: 'pvb-wallet-synthetic-001',
  accountNumber: '9000000001',
  accountName: 'SYNTHETIC PLAN WALLET',
  bankName: 'Synthetic Bank',
  balanceKobo: 5000000,
  paidInterestKobo: 0,
  pendingAccrualKobo: 0,
};

function getRequest() {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/piggyvest-plan?merchantSlug=ogabassey'
  );
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/piggyvest-plan',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

describe('/api/storefront/customer/wallet/piggyvest-plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VERCEL_ENV', 'preview');
    mockAuthenticateApiRequest.mockResolvedValue({
      error: null,
      supabase: authenticatedClient,
      user: { id: 'user-1' },
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true, response: null });
    mockResolveWalletTopUpMerchant.mockResolvedValue(merchant);
    mockResolveVtuCustomer.mockResolvedValue(customer);
    mockGetApiConfig.mockReturnValue({
      baseUrl: 'https://staging.piggyvest.business',
      token: 'synthetic',
    });
    mockIsSyntheticKycEnabled.mockReturnValue(true);
    mockGetSnapshot.mockResolvedValue(readySnapshot);
    mockEnsurePlanWallet.mockResolvedValue(readySnapshot);
  });

  afterEach(() => {
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockEnsurePlanWallet).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('GET reads the scoped customer snapshot using the authenticated client', async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(readySnapshot);
    expect(mockGetSnapshot).toHaveBeenCalledWith(
      authenticatedClient,
      { baseUrl: 'https://staging.piggyvest.business', token: 'synthetic' },
      { customerId: customer.id, merchantId: merchant.id }
    );
    expect(mockGetSnapshot.mock.calls[0][0]).toBe(authenticatedClient);
    expect(mockResolveWalletTopUpMerchant).toHaveBeenCalledWith(
      authenticatedClient,
      { merchantSlug: 'ogabassey' },
      'id, slug, business_name'
    );
    expect(mockResolveVtuCustomer).toHaveBeenCalledWith({
      merchantId: merchant.id,
      supabase: authenticatedClient,
      user: { id: 'user-1' },
    });
  });

  it.each([
    ['https://api.piggyvest.business', 'preview'],
    ['https://staging.piggyvest.business/', 'preview'],
    ['https://staging.piggyvest.business', 'production'],
  ])('GET blocks provider access for %s in %s', async (baseUrl, environment) => {
    vi.stubEnv('VERCEL_ENV', environment);
    mockGetApiConfig.mockReturnValue({ baseUrl, token: 'synthetic' });
    const response = await GET(getRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Integration unavailable',
      code: 'PIGGYVEST_NOT_READY',
    });
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  it('GET rejects unauthenticated callers', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({
      error: 'Unauthorized',
      supabase: null,
      user: null,
    });

    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  it('GET maps provider outages to 502 without leaking detail', async () => {
    mockGetSnapshot.mockRejectedValue(
      new PlanWalletError('PLAN_WALLET_PROVIDER_ERROR', 'synthetic outage')
    );

    const response = await GET(getRequest());

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Wallet provider unavailable',
      code: 'PIGGYVEST_PROVIDER_ERROR',
    });
  });

  it('POST fails closed before provider calls even when synthetic KYC is enabled', async () => {
    const response = await POST(postRequest({ merchantSlug: 'ogabassey' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Wallet provisioning is unavailable',
      code: 'PLAN_WALLET_PROVISIONING_UNAVAILABLE',
    });
    expect(mockGetApiConfig).not.toHaveBeenCalled();
    expect(mockGetSnapshot).not.toHaveBeenCalled();
    expect(mockResolveVtuCustomer).toHaveBeenCalledWith({
      merchantId: merchant.id,
      supabase: authenticatedClient,
      user: { id: 'user-1' },
    });
  });

  it('POST enforces CSRF before provisioning', async () => {
    mockCheckCsrfProtection.mockResolvedValue({
      valid: false,
      response: null,
    });

    const response = await POST(postRequest({ merchantSlug: 'ogabassey' }));

    expect(response.status).toBe(403);
    expect(mockEnsurePlanWallet).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('%s rejects missing merchants before wallet access', async (_method, handler) => {
    mockResolveWalletTopUpMerchant.mockResolvedValue(null);
    const response = await handler(
      handler === GET
        ? getRequest()
        : postRequest({ merchantSlug: 'ogabassey' })
    );
    expect(response.status).toBe(404);
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('%s rejects missing customers before wallet access', async (_method, handler) => {
    mockResolveVtuCustomer.mockResolvedValue(null);
    const response = await handler(
      handler === GET
        ? getRequest()
        : postRequest({ merchantSlug: 'ogabassey' })
    );
    expect(response.status).toBe(404);
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  it('POST authenticates before CSRF and scope resolution', async () => {
    mockAuthenticateApiRequest.mockResolvedValue({ error: 'Unauthorized' });
    const response = await POST(postRequest({ merchantSlug: 'ogabassey' }));
    expect(response.status).toBe(401);
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it('POST validates identifiers before scope resolution', async () => {
    const response = await POST(postRequest({ merchantId: 'invalid' }));
    expect(response.status).toBe(400);
    expect(mockResolveWalletTopUpMerchant).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', GET],
    ['POST', POST],
  ] as const)('%s does not log raw errors or expose their details', async (_method, handler) => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('secret provider body');
    mockResolveVtuCustomer.mockRejectedValueOnce(error);
    const response = await handler(
      handler === GET
        ? getRequest()
        : postRequest({ merchantSlug: 'ogabassey' })
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(error.message);
    for (const args of logger.mock.calls) {
      expect(args).not.toContain(error);
      expect(JSON.stringify(args)).not.toContain(error.message);
    }
  });
});
