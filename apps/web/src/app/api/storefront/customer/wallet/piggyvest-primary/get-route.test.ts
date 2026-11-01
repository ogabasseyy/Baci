import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRIMARY_WALLET_STATEMENTS } from '@/lib/piggyvest/primary-wallet-statements';
import { PRIMARY_WALLET_VERIFICATION_STATEMENT } from '@/lib/piggyvest/primary-wallet-verification';
import { GET } from './get-route';

// Real recovery, mapping, snapshot and verification code; only the
// session, the database and PiggyVest are faked.
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  runtime: vi.fn(),
  identity: vi.fn(),
  wallet: vi.fn(),
  accounts: vi.fn(),
  provider: vi.fn(),
  state: { value: 'routing_pending' as 'routing_pending' | 'accepted' },
  statements: [] as string[],
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
  createPrimaryWalletExecutor: () => async (statement: string) => {
    mocks.statements.push(statement);
    const ids = {
      providerCustomerId: 'customer-fixture',
      providerWalletId: 'wallet-fixture',
    };
    const pending = mocks.state.value === 'routing_pending';
    if (statement === PRIMARY_WALLET_STATEMENTS.readRouting)
      return {
        rows: [
          {
            result: pending
              ? {
                  intentId: '00000000-0000-4000-8000-0000000000aa',
                  ...ids,
                  payoutWalletId: PAYOUT,
                }
              : null,
          },
        ],
      };
    if (statement === PRIMARY_WALLET_STATEMENTS.read)
      return { rows: [{ result: pending ? null : ids }] };
    if (statement === PRIMARY_WALLET_STATEMENTS.resolveRouting) {
      mocks.state.value = 'accepted';
      return { rows: [{ result: true }] };
    }
    return { rows: [{ result: true }] };
  },
}));
vi.mock('@/lib/piggyvest/primary-wallet-review', () => ({
  readPrimaryWalletReview: async () => null,
}));

const PAYOUT = '01JBZ8Q5W3X9R2K4M6N8P0T2V4';
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const url = `https://example.com/api/storefront/customer/wallet/piggyvest-primary?merchantId=${merchantId}`;
const wallet = (payout: string | null) => ({
  id: 'wallet-fixture',
  api_customer_id: 'customer-fixture',
  business_id: 'test-business',
  currency: 'NGN',
  status: 'active',
  balance: 0,
  interest_enabled: true,
  interest_payout_wallet: payout,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.value = 'routing_pending';
  mocks.statements.length = 0;
  mocks.auth.mockResolvedValue({
    user: { id: 'f4f01e61-691f-494a-a895-872f17f8e55e' },
    supabase: {},
    error: null,
  });
  mocks.runtime.mockReturnValue({
    onboarding: {
      merchantId,
      integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
      businessId: 'test-business',
      environment: 'staging',
    },
    providerToken: 'test-token',
  });
  mocks.identity.mockResolvedValue({
    merchantId,
    customerId: 'e648eb14-928a-427b-9719-b105f6d4b8b4',
    userId: 'f4f01e61-691f-494a-a895-872f17f8e55e',
  });
  mocks.accounts.mockResolvedValue([
    {
      account_number: '0123456789',
      account_name: 'Test Customer',
      bank_name: 'Provider Bank',
    },
  ]);
});

describe('primary wallet GET with a routing-pending wallet (real recovery and snapshot)', () => {
  it('never exposes the account, nor promotes or verifies, while the routing is not readable', async () => {
    mocks.wallet.mockResolvedValue(wallet(null));
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'pending', account: null });
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.statements).not.toContain(
      PRIMARY_WALLET_STATEMENTS.resolveRouting
    );
    expect(mocks.statements).not.toContain(
      PRIMARY_WALLET_VERIFICATION_STATEMENT
    );
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it('finishes setup on a later refresh once the routing reads back, without creating a customer', async () => {
    mocks.wallet.mockResolvedValue(wallet(null));
    await GET(new NextRequest(url));
    mocks.wallet.mockResolvedValue(wallet(PAYOUT));
    const response = await GET(new NextRequest(url));
    expect(await response.json()).toEqual(
      expect.objectContaining({
        status: 'ready',
        account: expect.objectContaining({ accountNumber: '0123456789' }),
      })
    );
    expect(mocks.statements).toContain(
      PRIMARY_WALLET_STATEMENTS.resolveRouting
    );
    expect(mocks.statements).toContain(PRIMARY_WALLET_VERIFICATION_STATEMENT);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
});
