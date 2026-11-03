import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER } from '@/lib/piggyvest/primary-wallet-snapshot-contract';
import { PRIMARY_WALLET_STATEMENTS } from '@/lib/piggyvest/primary-wallet-statements';
import { GET } from './get-route';

// Real presence, mapping, snapshot, review and recovery code; only the
// session, the restricted database and PiggyVest are faked.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  wallet: vi.fn(),
  accounts: vi.fn(),
  provider: vi.fn(),
  presence: vi.fn(),
  calls: [] as Array<{ statement: string; parameters: unknown[] }>,
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/piggyvest/primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: mocks.runtime,
  readPrimaryWalletOnboardingRuntime: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-identity', () => ({
  resolvePrimaryWalletIdentity: mocks.identity,
}));
vi.mock('@/lib/piggyvest/primary-wallet-provider', () => ({
  createPrimaryWalletProviderCustomer: mocks.provider,
}));
vi.mock('@/lib/piggyvest/wallets', () => ({
  retrievePiggyvestWallet: mocks.wallet,
}));
vi.mock('@/lib/piggyvest/wallet-funding', () => ({
  retrievePiggyvestFundingAccounts: mocks.accounts,
}));
vi.mock('@/lib/piggyvest/primary-wallet-executor', () => ({
  createPrimaryWalletExecutor:
    () => async (statement: string, parameters: unknown[]) => {
      mocks.calls.push({ statement, parameters });
      if (statement === PRIMARY_WALLET_STATEMENTS.presence)
        return mocks.presence();
      if (statement === PRIMARY_WALLET_STATEMENTS.read)
        return { rows: [{ result: ids }] };
      return { rows: [{ result: true }] };
    },
}));

const ids = {
  providerCustomerId: 'customer-fixture',
  providerWalletId: 'wallet-fixture',
};
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const scope = {
  merchantId,
  customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
  userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  businessId: 'test-business',
  environment: 'staging',
};
const url = `https://example.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=${merchantId}`;
const statements = () => mocks.calls.map((call) => call.statement);
// A client that understands the not_started status says so explicitly.
const notStartedClient = () =>
  new NextRequest(url, {
    headers: { [PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER]: '2' },
  });

function expectNoProviderOrReviewRead() {
  expect(mocks.wallet).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(statements()).toEqual([PRIMARY_WALLET_STATEMENTS.presence]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.calls.length = 0;
  mocks.presence.mockResolvedValue({ rows: [{ result: false }] });
  mocks.auth.mockResolvedValue({
    user: { id: scope.userId },
    supabase: {},
    error: null,
  });
  mocks.runtime.mockReturnValue({
    onboarding: {
      merchantId,
      integrationId: scope.integrationId,
      businessId: scope.businessId,
      environment: scope.environment,
    },
    providerToken: 'test-token',
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: scope.customerId,
    userId: scope.userId,
  });
  mocks.wallet.mockResolvedValue({
    id: ids.providerWalletId,
    api_customer_id: ids.providerCustomerId,
    business_id: scope.businessId,
    currency: 'NGN',
    status: 'active',
    balance: 2500,
  });
  mocks.accounts.mockResolvedValue([
    {
      account_number: '0123456789',
      account_name: 'Test Customer',
      bank_name: 'Provider Bank',
    },
  ]);
});

describe('primary wallet GET onboarding presence', () => {
  it('reports not started with no intent before any provider, mapping or review read', async () => {
    const response = await GET(notStartedClient());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain(
      PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER
    );
    expect(await response.json()).toEqual({
      status: 'not_started',
      account: null,
    });
    expectNoProviderOrReviewRead();
    expect(mocks.calls[0]?.parameters).toEqual([JSON.stringify(scope)]);
  });

  // Installed mobile builds parse the snapshot with a strict union that only
  // knows pending and ready; they must keep the reply they already accept.
  it.each([
    ['sends no snapshot version', undefined],
    ['sends the original snapshot version', '1'],
    ['sends an unknown snapshot version', 'not_started'],
  ])('keeps the legacy pending reply when a client %s', async (_label, version) => {
    const headers: Record<string, string> = version
      ? { [PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER]: version }
      : {};

    const response = await GET(new NextRequest(url, { headers }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toContain(
      PRIMARY_WALLET_SNAPSHOT_VERSION_HEADER
    );
    expect(await response.json()).toEqual({ status: 'pending', account: null });
    expectNoProviderOrReviewRead();
  });

  it.each([
    ['the lookup fails', () => Promise.reject(new Error('private detail'))],
    ['the lookup returns no row', () => Promise.resolve({ rows: [] })],
    [
      'the lookup returns a non-boolean',
      () => Promise.resolve({ rows: [{ result: 'false' }] }),
    ],
  ])('fails closed when %s', async (_label, outcome) => {
    mocks.presence.mockImplementation(outcome);

    const response = await GET(notStartedClient());

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({ code: 'PIGGYVEST_UNAVAILABLE' })
    );
    expect(JSON.stringify(body)).not.toContain('not_started');
    expect(JSON.stringify(body)).not.toContain('private detail');
    expectNoProviderOrReviewRead();
  });

  it('keeps the existing wallet read once a durable intent exists', async () => {
    mocks.presence.mockResolvedValue({ rows: [{ result: true }] });

    const response = await GET(notStartedClient());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      expect.objectContaining({ status: 'ready', balanceKobo: 2500 })
    );
    expect(statements()[0]).toBe(PRIMARY_WALLET_STATEMENTS.presence);
    expect(statements()).toContain(PRIMARY_WALLET_STATEMENTS.read);
    expect(mocks.wallet).toHaveBeenCalledOnce();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('stays switched off without the primary wallet runtime', async () => {
    mocks.runtime.mockReturnValue(null);

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(
      expect.objectContaining({ code: 'PIGGYVEST_NOT_READY' })
    );
    expect(mocks.calls).toEqual([]);
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it('never checks presence for an unverified profile', async () => {
    mocks.identity.mockResolvedValue(null);

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(409);
    expect(mocks.calls).toEqual([]);
  });
});
