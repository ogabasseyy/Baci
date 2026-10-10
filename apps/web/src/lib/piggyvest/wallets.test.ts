import { describe, expect, it, vi } from 'vitest';
import {
  createPiggyvestWallet,
  listPiggyvestWallets,
  retrievePiggyvestWallet,
} from './wallets';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
}

describe('createPiggyvestWallet', () => {
  it('keeps wallet interest off unless explicitly opted in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Your wallet creation is being processed',
        data: { id: '023f843a-be7e-494a-bc5d-9f49f4cc640f' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createPiggyvestWallet(
      { token: 'synthetic-token' },
      {
        subaccountName: 'SYNTHETIC PLAN 1',
        customerId: '905f18f2-858a-4522-9e38-1f5d18bad423',
        reserveVirtualAccount: true,
      }
    );

    expect(result).toEqual({ id: '023f843a-be7e-494a-bc5d-9f49f4cc640f' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      reserve_virtual_account: true,
      enable_interest_accrual: false,
    });
    vi.unstubAllGlobals();
  });
});

describe('retrievePiggyvestWallet', () => {
  it('returns balance and rates in kobo for reconciliation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'Wallet details fetched',
        data: {
          id: 'f3ac0937-1d03-4843-b3d3-a09210967e49',
          api_customer_id: 'customer-synthetic-001',
          business_id: '43e157b6-179c-432a-9392-e0827da96d82',
          virtual_account_id: null,
          currency: 'NGN',
          name: 'Synthetic Savings',
          status: 'active',
          type: 'api',
          balance: 5000000,
          withdrawal_count: 2,
          creation_interest_rate: 8,
          current_interest_rate: 8,
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const wallet = await retrievePiggyvestWallet(
      { token: 'synthetic-token' },
      'f3ac0937-1d03-4843-b3d3-a09210967e49'
    );

    expect(wallet.balance).toBe(5000000);
    expect(wallet.status).toBe('active');
    expect(wallet.api_customer_id).toBe('customer-synthetic-001');
    vi.unstubAllGlobals();
  });
});

describe('listPiggyvestWallets', () => {
  it('returns id/name/status edges for create-time reconciliation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: true,
        message: 'API wallets fetched successfully',
        data: {
          total_balance: 0,
          paginatedPayload: {
            edges: [
              {
                id: 'wallet-synthetic-001',
                business_id: 'business-synthetic-001',
                currency: 'NGN',
                name: 'BACI PLAN SYNTHETIC 001',
                status: 'active',
                type: 'api',
                balance: 0,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const edges = await listPiggyvestWallets(
      { token: 'synthetic-token' },
      { customerId: 'customer-synthetic-001' }
    );

    expect(edges).toEqual([
      {
        id: 'wallet-synthetic-001',
        business_id: 'business-synthetic-001',
        currency: 'NGN',
        name: 'BACI PLAN SYNTHETIC 001',
        status: 'active',
        type: 'api',
        balance: 0,
      },
    ]);
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/wallet/api/wallet-type');
    expect(url).toContain('customer_id=customer-synthetic-001');
    vi.unstubAllGlobals();
  });
});
