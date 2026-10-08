import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCookies = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetUser = vi.fn();
const mockAuthenticate = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticate,
}));

vi.mock('next/headers', () => ({
  cookies: () => mockCookies(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  })),
}));

import { GET } from './route';

function request(path = '?merchant=ogabassey') {
  return new Request(
    `http://localhost:3000/api/storefront/customer/wallet${path}`
  );
}

function singleQuery(data: unknown, error: unknown = null) {
  const query: Record<string, unknown> = {};
  const select = vi.fn(() => query);
  const eq = vi.fn(() => query);
  const single = vi.fn().mockResolvedValue({ data, error });
  Object.assign(query, { eq, select, single });
  return query;
}

function maybeSingleQuery(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

function savingsQuery(data: unknown[], error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

function transactionsQuery(data: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data, error: null }),
        }),
      }),
    }),
  };
}

function currencyAccountQuery(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

describe('GET /api/storefront/customer/wallet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookies.mockResolvedValue(new Map());
    mockGetUser.mockResolvedValue({
      data: { user: { email: 'jane@example.com', id: 'user-1' } },
      error: null,
    });
    mockAuthenticate.mockResolvedValue({
      error: null,
      supabase: { from: mockFrom, rpc: mockRpc },
      user: { email: 'jane@example.com', id: 'user-1' },
    });
    // get_storefront_payment_settings RPC — SECURITY DEFINER, returns the
    // merchant's wallet DVA flag for storefront customers.
    mockRpc.mockResolvedValue({
      data: [{ wallet_paystack_dva_enabled: true }],
      error: null,
    });
  });

  it('returns 400 when merchant slug is missing', async () => {
    const response = await GET(request(''));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: 'Merchant slug is required' });
    expect(mockAuthenticate).toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 401 when the customer is not authenticated', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      error: 'not authenticated',
      supabase: null,
      user: null,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({
      balance: 0,
      error: 'Unauthorized',
      transactions: [],
    });
  });

  it('uses bearer-aware authentication for native wallet reads', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') return singleQuery(null);
      throw new Error(`Unexpected table ${table}`);
    });
    const bearerRequest = new Request(
      'http://localhost:3000/api/storefront/customer/wallet?merchant=ogabassey',
      { headers: { Authorization: 'Bearer mobile-token' } }
    );

    const response = await GET(bearerRequest);

    expect(response.status).toBe(200);
    expect(mockAuthenticate).toHaveBeenCalledWith(bearerRequest);
  });

  it('returns 500 when an unexpected database error escapes the wallet fetch', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('database unavailable');
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      balance: 0,
      error: 'Failed to fetch wallet',
      transactions: [],
    });
  });

  it('returns 404 when the merchant lookup does not find a store', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return singleQuery(null, { code: 'PGRST116' });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Merchant not found' });
  });

  it('returns the expanded empty wallet contract when the customer is not linked yet', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') return singleQuery(null);
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      balance: 0,
      balances: { NGN: 0, USDT: 0 },
      earningsAvailable: false,
      earningsBalance: null,
      fundingAccount: null,
      hasWallet: false,
      loyaltyPoints: 0,
      // No customer row -> creation would 404, so never advertise consent.
      requiresFundingAccountConsent: false,
      savingsBalance: 0,
      totalEarned: 0,
      totalRedeemed: 0,
      transactions: [],
      walletDvaEnabled: true,
    });
  });

  it('keeps the core wallet response available when optional wallet helpers fail', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') {
        return singleQuery({
          id: 'customer-1',
          loyalty_points: 1200,
        });
      }
      if (table === 'customer_wallets') {
        return singleQuery({
          available_balance: '5000',
          id: 'wallet-1',
          total_earned: '8000',
          total_redeemed: '3000',
        });
      }
      if (table === 'customer_wallet_transactions') {
        return transactionsQuery([]);
      }
      if (table === 'customer_savings_goals') {
        return savingsQuery([], { message: 'savings timeout' });
      }
      if (table === 'customer_wallet_payment_accounts') {
        return maybeSingleQuery(null, { message: 'funding account timeout' });
      }
      if (table === 'customer_wallet_accounts') {
        return currencyAccountQuery({ available_balance: '25.5' });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      balance: 5000,
      balances: { NGN: 5000, USDT: 25.5 },
      fundingAccount: null,
      requiresFundingAccountConsent: true,
      savingsBalance: 0,
      walletDvaEnabled: true,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Customer wallet optional fetch failed',
      {
        error: { message: 'savings timeout' },
        label: 'savings balance',
      }
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Customer wallet optional fetch failed',
      {
        error: { message: 'funding account timeout' },
        label: 'funding account',
      }
    );
    consoleErrorSpy.mockRestore();
  });

  it('returns wallet, savings, loyalty, transactions, and funding account summary', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') {
        return singleQuery({
          id: 'customer-1',
          loyalty_points: 1200,
        });
      }
      if (table === 'customer_wallets') {
        return singleQuery({
          available_balance: '5000',
          id: 'wallet-1',
          total_earned: '8000',
          total_redeemed: '3000',
        });
      }
      if (table === 'customer_wallet_transactions') {
        return transactionsQuery([
          {
            amount: '5000',
            balance_after: '5000',
            created_at: '2026-05-21T10:00:00.000Z',
            description: 'Wallet top-up via paystack',
            id: 'wallet-txn-1',
            source_type: 'wallet_topup',
            type: 'credit',
          },
        ]);
      }
      if (table === 'customer_savings_goals') {
        return savingsQuery([
          { current_amount: '20000' },
          { current_amount: '15000.5' },
        ]);
      }
      if (table === 'customer_wallet_payment_accounts') {
        return maybeSingleQuery({
          account_name: 'Ogabassey/Jane Doe',
          account_number: '1234567890',
          bank_name: 'Titan Paystack',
          provider: 'paystack',
        });
      }
      if (table === 'customer_wallet_accounts') {
        return currencyAccountQuery({ available_balance: '25.5' });
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      balance: 5000,
      balances: { NGN: 5000, USDT: 25.5 },
      earningsAvailable: false,
      earningsBalance: null,
      fundingAccount: {
        accountName: 'Ogabassey/Jane Doe',
        accountNumber: '1234567890',
        bankName: 'Titan Paystack',
        provider: 'paystack',
      },
      hasWallet: true,
      loyaltyPoints: 1200,
      requiresFundingAccountConsent: false,
      savingsBalance: 35000.5,
      totalEarned: 8000,
      totalRedeemed: 3000,
      walletDvaEnabled: true,
    });
    expect(body.transactions).toHaveLength(1);
    // The client funding check loop settles on source_type, never on a balance
    // delta — `type` is 'credit' for cashback and refunds too.
    expect(body.transactions[0]).toMatchObject({
      id: 'wallet-txn-1',
      source_type: 'wallet_topup',
    });
  });

  it('returns only settled interest earnings in naira and does not add them to wallet funding balance', async () => {
    mockRpc.mockImplementation((rpcName: string) => {
      if (rpcName === 'get_customer_savings_earnings') {
        return Promise.resolve({
          data: { credited_interest_kobo: 12_550 },
          error: null,
        });
      }
      return Promise.resolve({
        data: [{ wallet_paystack_dva_enabled: true }],
        error: null,
      });
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') {
        return singleQuery({ id: 'customer-1', loyalty_points: 0 });
      }
      if (table === 'customer_wallets') {
        return singleQuery({
          available_balance: '5000',
          id: 'wallet-1',
          total_earned: '5000',
          total_redeemed: '0',
        });
      }
      if (table === 'customer_wallet_transactions')
        return transactionsQuery([]);
      if (table === 'customer_savings_goals') return savingsQuery([]);
      if (table === 'customer_wallet_payment_accounts')
        return maybeSingleQuery(null);
      if (table === 'customer_wallet_accounts')
        return currencyAccountQuery(null);
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(body).toMatchObject({
      balance: 5000,
      earningsAvailable: true,
      earningsBalance: 125.5,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_customer_savings_earnings', {
      p_merchant_id: 'merchant-1',
    });
  });

  it('marks earnings unavailable when the savings-interest RPC cannot be read', async () => {
    mockRpc.mockImplementation((rpcName: string) =>
      Promise.resolve(
        rpcName === 'get_customer_savings_earnings'
          ? { data: null, error: { code: 'PGRST202' } }
          : { data: [{ wallet_paystack_dva_enabled: true }], error: null }
      )
    );
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') {
        return singleQuery({ id: 'customer-1', loyalty_points: 0 });
      }
      if (table === 'customer_wallets') {
        return singleQuery({
          available_balance: '5000',
          id: 'wallet-1',
          total_earned: '5000',
          total_redeemed: '0',
        });
      }
      if (table === 'customer_wallet_transactions')
        return transactionsQuery([]);
      if (table === 'customer_savings_goals') return savingsQuery([]);
      if (table === 'customer_wallet_payment_accounts')
        return maybeSingleQuery(null);
      if (table === 'customer_wallet_accounts')
        return currencyAccountQuery(null);
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(body).toMatchObject({
      balance: 5000,
      earningsAvailable: false,
      earningsBalance: null,
    });
  });

  it('selects source_type so a bank-transfer top-up is distinguishable from cashback', async () => {
    const transactionsSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') {
        return singleQuery({ id: 'customer-1', loyalty_points: 0 });
      }
      if (table === 'customer_wallets') {
        return singleQuery({
          available_balance: '0',
          id: 'wallet-1',
          total_earned: '0',
          total_redeemed: '0',
        });
      }
      if (table === 'customer_wallet_transactions') {
        return { select: transactionsSelect };
      }
      if (table === 'customer_savings_goals') return savingsQuery([]);
      if (table === 'customer_wallet_payment_accounts') {
        return maybeSingleQuery(null);
      }
      if (table === 'customer_wallet_accounts') {
        return currencyAccountQuery(null);
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await GET(request());

    expect(transactionsSelect).toHaveBeenCalledWith(
      expect.stringContaining('source_type')
    );
    // select('*') is banned — the column list stays explicit.
    expect(transactionsSelect).not.toHaveBeenCalledWith('*');
  });

  it('reports walletDvaEnabled false when the merchant has DVA funding disabled', async () => {
    mockRpc.mockResolvedValue({
      data: [{ wallet_paystack_dva_enabled: false }],
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'merchants') return singleQuery({ id: 'merchant-1' });
      if (table === 'customers') return singleQuery(null);
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.walletDvaEnabled).toBe(false);
  });
});
