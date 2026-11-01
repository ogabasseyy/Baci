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

  it('sends no payout wallet for a goal sub-wallet unless one is given', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          status: true,
          message: 'Queued',
          data: { id: 'goal' },
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    await createPiggyvestWallet(
      { token: 'synthetic-token' },
      {
        subaccountName: 'SYNTHETIC GOAL',
        customerId: 'customer-synthetic-001',
        reserveVirtualAccount: true,
        enableInterestAccrual: true,
      }
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty('enable_interest_accrual', true);
    expect(body).not.toHaveProperty('interest_payout_wallet');
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

  it('keeps the creation-time interest settings for routing checks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          status: true,
          message: 'Wallet details fetched',
          data: {
            id: '01JBZ8Q5W3X9R2K4M6N8P0T2V6',
            api_customer_id: 'customer-synthetic-001',
            business_id: 'business-synthetic-001',
            currency: 'NGN',
            name: 'Synthetic Main',
            status: 'active',
            type: 'api',
            balance: 0,
            withdrawal_count: 0,
            creation_interest_rate: 0,
            current_interest_rate: 0,
            interest_enabled: true,
            interest_payout_wallet: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
          },
        })
      )
    );
    const wallet = await retrievePiggyvestWallet(
      { token: 'synthetic-token' },
      '01JBZ8Q5W3X9R2K4M6N8P0T2V6'
    );
    expect(wallet.interest_enabled).toBe(true);
    expect(wallet.interest_payout_wallet).toBe('01JBZ8Q5W3X9R2K4M6N8P0T2V4');
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
