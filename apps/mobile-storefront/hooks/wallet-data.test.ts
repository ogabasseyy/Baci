import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fetchWalletData } from './wallet-data';

type QueryResult = {
  data: unknown;
  error: unknown;
};

const mockFrom = jest.fn<(table: string) => unknown>();
const mockRpc = jest.fn<(...args: unknown[]) => unknown>();
const mockVariantRange = jest.fn<() => Promise<unknown>>();
const mockTrackEvent = jest.fn();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

function createResult(data: unknown, error: unknown = null): QueryResult {
  return { data, error };
}

function setupSupabaseTables(
  overrides: Partial<Record<string, QueryResult>> = {}
) {
  const tableResults: Record<string, QueryResult> = {
    customers: createResult([{ id: 'customer-1', loyalty_points: 1200 }]),
    customer_wallet_payment_accounts: createResult(null),
    customer_wallet_transactions: createResult([]),
    customer_wallets: createResult({
      available_balance: '5000',
      id: 'wallet-1',
    }),
    customer_savings_goals: createResult([]),
    products: createResult(null),
    ...overrides,
  };
  const tableCalls: string[] = [];
  const selectCalls: Record<string, string[]> = {};

  // Interest RPC fails by default so tests pin the explicit unavailable
  // marker; success-path tests override per case.
  const interestFailure = {
    data: null,
    error: { code: 'XX000', message: 'synthetic interest outage' },
  };
  mockVariantRange.mockResolvedValue({
    count: 1,
    error: null,
    data: [
      {
        id: 'variant-1',
        product_id: 'product-1',
        condition: 'uk_used',
        sku: 'IPH15P-256',
        attributes: { color: 'Black', storage: '256GB' },
      },
    ],
  });
  mockRpc.mockImplementation((name) => {
    if (name !== 'get_storefront_product_variants')
      return Promise.resolve(interestFailure);
    const query = {
      order: jest.fn(() => query),
      range: () => mockVariantRange(),
    };
    return query;
  });

  mockFrom.mockImplementation((table: string) => {
    tableCalls.push(table);
    selectCalls[table] = [];
    const query = {
      eq: jest.fn(() => query),
      in: jest.fn(() => query),
      limit: jest.fn(async () => tableResults[table]),
      maybeSingle: jest.fn(async () => tableResults[table]),
      order: jest.fn(() =>
        table === 'customer_savings_goals'
          ? Promise.resolve(tableResults[table])
          : query
      ),
      select: jest.fn((columns?: string) => {
        if (typeof columns === 'string') {
          selectCalls[table].push(columns);
        }
        return query;
      }),
    };
    return query;
  });

  return { selectCalls, tableCalls };
}

describe('fetchWalletData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hydrates customer-hidden variants for every owned goal before mapping', async () => {
    const goals = ['active', 'paused', 'completed'].map((status) => ({
      id: `goal-${status}`,
      product_id: 'product-1',
      variant_id: null,
      title: 'Phone',
      contribution_amount: 10,
      contribution_frequency: 'weekly',
      current_amount: 100,
      target_amount: 100,
      status,
      source_mode: 'manual',
      maturity_date: '2026-10-04',
      products: { id: 'product-1', name: 'Phone', price: 100, variants: [] },
    }));
    setupSupabaseTables({ customer_savings_goals: createResult(goals) });
    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');
    expect(result.wallet.active_savings_goal?.selection_unresolved).toBe(true);
    expect(
      result.wallet.savings_goals?.map((goal) => goal.selection_unresolved)
    ).toEqual([true, true, true]);
    expect(
      result.wallet.savings_goals?.find((goal) => goal.status === 'completed')
        ?.variant_resolution_options
    ).toEqual([
      { id: 'variant-1', label: 'Used · Color: Black · Storage: 256GB' },
    ]);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: ['product-1'] },
      { count: 'exact' }
    );
  });

  it('throws variant RPC errors rather than treating the goal as resolved', async () => {
    setupSupabaseTables({
      customer_savings_goals: createResult([
        {
          id: 'goal-1',
          product_id: 'product-1',
          variant_id: null,
          title: 'Phone',
          contribution_amount: 10,
          contribution_frequency: 'weekly',
          current_amount: 100,
          target_amount: 100,
          status: 'completed',
          source_mode: 'manual',
          maturity_date: '2026-10-04',
          products: { id: 'product-1', name: 'Phone', price: 100 },
        },
      ]),
    });
    mockVariantRange.mockResolvedValue({
      count: null,
      data: null,
      error: { message: 'synthetic variant outage' },
    });
    await expect(
      fetchWalletData('customer-1', 'merchant-1', 'user-1')
    ).rejects.toThrow('Unable to load savings product variants');
  });

  it('returns an empty wallet without querying when no owner identifier exists', async () => {
    const result = await fetchWalletData(null, 'merchant-1', null);

    expect(result).toEqual({
      wallet: {
        active_savings_goal: null,
        balance: 0,
        earnings_available: false,
        earnings_balance: 0,
        funding_account: null,
        loyalty_points: 0,
        requires_funding_account_consent: true,
        savings_balance: 0,
        savings_goals: [],
        total_balance: 0,
      },
      transactions: [],
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('coerces loyalty points when a resolved customer id is unavailable', async () => {
    setupSupabaseTables({
      customers: createResult([{ loyalty_points: '1200.5' }]),
    });

    const result = await fetchWalletData(null, 'merchant-1', 'user-1');

    expect(result.wallet.loyalty_points).toBe(1200.5);
    expect(result.wallet.balance).toBe(0);
    expect(result.transactions).toEqual([]);
  });

  it('selects and preserves the ledger source_type that identifies wallet top-ups', async () => {
    const { selectCalls } = setupSupabaseTables({
      customer_wallet_transactions: createResult([
        {
          amount: '2500',
          created_at: '2026-07-13T10:00:00.000Z',
          description: 'Wallet top-up via paystack',
          id: 'tx-topup',
          source_type: 'wallet_topup',
          type: 'credit',
        },
        {
          amount: '50',
          created_at: '2026-07-13T09:00:00.000Z',
          description: 'Airtime cashback',
          id: 'tx-cashback',
          source_type: 'vtu_transaction',
          type: 'cashback',
        },
      ]),
    });

    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');

    expect(selectCalls.customer_wallet_transactions[0]).toContain(
      'source_type'
    );
    expect(result.transactions).toEqual([
      {
        amount: 2500,
        created_at: '2026-07-13T10:00:00.000Z',
        description: 'Wallet top-up via paystack',
        id: 'tx-topup',
        source_type: 'wallet_topup',
        type: 'credit',
      },
      {
        amount: 50,
        created_at: '2026-07-13T09:00:00.000Z',
        description: 'Airtime cashback',
        id: 'tx-cashback',
        source_type: 'vtu_transaction',
        type: 'cashback',
      },
    ]);
  });

  it('combines wallet, funding account, savings balance, and valid transactions', async () => {
    const { selectCalls, tableCalls } = setupSupabaseTables({
      customer_wallet_payment_accounts: createResult({
        account_name: 'Ogabassey/Jane Doe',
        account_number: '1234567890',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      }),
      customer_savings_goals: createResult([
        {
          contribution_amount: '10000',
          contribution_frequency: 'weekly',
          current_amount: '20000',
          id: 'goal-1',
          maturity_date: '2026-09-30',
          product_id: 'product-1',
          product_snapshot: {},
          products: {
            condition: 'uk_used',
            id: 'product-1',
            images: ['https://cdn.example.com/iphone.jpg'],
            name: 'iPhone 15 Pro',
            variants: [
              {
                attributes: {
                  color: 'Black',
                  storage: '256GB',
                },
                condition: 'uk_used',
                id: 'variant-1',
                price: '120000',
                sku: 'IPH15P-256',
              },
            ],
          },
          source_mode: 'manual',
          status: 'active',
          target_amount: '120000',
          title: 'iPhone 15 Pro',
          variant_id: 'variant-1',
        },
        {
          contribution_amount: '5000',
          contribution_frequency: 'weekly',
          current_amount: 15000.5,
          id: 'goal-2',
          maturity_date: '2026-10-30',
          product_id: 'product-2',
          product_snapshot: {},
          source_mode: 'manual',
          status: 'paused',
          target_amount: '90000',
          title: 'Savings goal',
          variant_id: null,
        },
        { current_amount: 'bad-number' },
      ]),
      customer_wallet_transactions: createResult([
        {
          amount: '2500',
          created_at: '2026-05-21T10:00:00.000Z',
          description: null,
          id: 'tx-1',
          type: 'credit',
        },
        {
          amount: 'not-a-number',
          created_at: '2026-05-21T10:00:00.000Z',
          id: 'tx-invalid',
          type: 'credit',
        },
      ]),
    });

    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');

    expect(result.wallet).toEqual({
      active_savings_goal: {
        contribution_amount: 10000,
        contribution_frequency: 'weekly',
        current_amount: 20000,
        id: 'goal-1',
        maturity_date: '2026-09-30',
        product_condition: 'Used',
        product_image: 'https://cdn.example.com/iphone.jpg',
        product_variant_label: 'Color: Black · Storage: 256GB',
        selection_unresolved: false,
        source_mode: 'manual',
        status: 'active',
        target_amount: 120000,
        title: 'iPhone 15 Pro',
      },
      balance: 5000,
      earnings_available: false,
      earnings_balance: null,
      funding_account: {
        account_name: 'Ogabassey/Jane Doe',
        account_number: '1234567890',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      },
      loyalty_points: 1200,
      requires_funding_account_consent: false,
      savings_balance: 35000.5,
      savings_goals: [
        {
          contribution_amount: 10000,
          contribution_frequency: 'weekly',
          current_amount: 20000,
          id: 'goal-1',
          maturity_date: '2026-09-30',
          product_condition: 'Used',
          product_image: 'https://cdn.example.com/iphone.jpg',
          product_variant_label: 'Color: Black · Storage: 256GB',
          selection_unresolved: false,
          source_mode: 'manual',
          status: 'active',
          target_amount: 120000,
          title: 'iPhone 15 Pro',
        },
        {
          contribution_amount: 5000,
          contribution_frequency: 'weekly',
          current_amount: 15000.5,
          id: 'goal-2',
          maturity_date: '2026-10-30',
          product_condition: null,
          product_image: null,
          product_variant_label: null,
          selection_unresolved: false,
          source_mode: 'manual',
          status: 'paused',
          target_amount: 90000,
          title: 'Savings goal',
        },
      ],
      total_balance: 40000.5,
    });
    expect(tableCalls).not.toContain('products');
    expect(selectCalls.customer_savings_goals[0]).not.toContain(
      'product_variants'
    );
    expect(selectCalls.customer_savings_goals[0]).toContain('price');
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      { p_product_ids: ['product-1'] },
      { count: 'exact' }
    );
    expect(result.transactions).toEqual([
      {
        amount: 2500,
        created_at: '2026-05-21T10:00:00.000Z',
        description: '',
        id: 'tx-1',
        type: 'credit',
      },
    ]);
  });

  it('exposes accrued interest earnings when the interest lookup succeeds', async () => {
    setupSupabaseTables();
    mockRpc.mockImplementation(async () => ({
      data: { credited_interest_kobo: 125000, goal_interest_kobo: [] },
      error: null,
    }));
    const merchantId = '10000000-0000-4000-8000-000000000001';

    const result = await fetchWalletData('customer-1', merchantId, 'user-1');

    expect(mockRpc).toHaveBeenCalledWith('get_customer_savings_earnings', {
      p_merchant_id: merchantId,
      p_include_goals: true,
    });
    expect(result.wallet).toMatchObject({
      earnings_available: true,
      earnings_balance: 1250,
    });
  });

  it('applies confirmed per-goal interest to goal progress and balances', async () => {
    const goalId = '30000000-0000-4000-8000-000000000001';
    setupSupabaseTables({
      customer_savings_goals: createResult([
        {
          contribution_amount: '10000',
          contribution_frequency: 'weekly',
          current_amount: '20000',
          id: goalId,
          maturity_date: '2026-09-30',
          product_id: null,
          product_snapshot: {},
          source_mode: 'manual',
          status: 'active',
          target_amount: '120000',
          title: 'General savings',
          variant_id: null,
        },
      ]),
    });
    mockRpc.mockImplementation(async () => ({
      data: {
        credited_interest_kobo: 50000,
        goal_interest_kobo: [
          { goal_id: goalId, credited_interest_kobo: 50000 },
        ],
      },
      error: null,
    }));

    const result = await fetchWalletData(
      'customer-1',
      '10000000-0000-4000-8000-000000000001',
      'user-1'
    );

    expect(result.wallet.active_savings_goal).toEqual(
      expect.objectContaining({ current_amount: 20500 })
    );
    expect(result.wallet.savings_balance).toBe(20500);
    expect(result.wallet.total_balance).toBe(25500);
    expect(result.wallet.earnings_balance).toBe(500);
  });

  it('marks earnings unavailable when the interest lookup fails', async () => {
    setupSupabaseTables();

    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');

    expect(result.wallet).toMatchObject({
      earnings_available: false,
      earnings_balance: null,
    });
  });

  it('skips product metadata lookup for general savings goals without product ids', async () => {
    const { tableCalls } = setupSupabaseTables({
      customer_savings_goals: createResult([
        {
          contribution_amount: '10000',
          contribution_frequency: 'weekly',
          current_amount: '20000',
          id: 'goal-1',
          maturity_date: '2026-09-30',
          product_id: null,
          product_snapshot: {
            image_url: 'https://cdn.example.com/general.jpg',
            variant_label: 'Manual goal',
          },
          source_mode: 'manual',
          status: 'active',
          target_amount: '120000',
          title: 'General savings',
          variant_id: null,
        },
      ]),
    });

    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');

    expect(tableCalls).not.toContain('products');
    expect(result.wallet.active_savings_goal).toEqual(
      expect.objectContaining({
        product_image: 'https://cdn.example.com/general.jpg',
        product_variant_label: 'Manual goal',
        title: 'General savings',
      })
    );
  });

  it('logs and returns an empty wallet when multiple customer owners match', async () => {
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    setupSupabaseTables({
      customers: createResult([
        { id: 'customer-1', loyalty_points: 1200 },
        { id: 'customer-2', loyalty_points: 900 },
      ]),
    });

    const result = await fetchWalletData(null, 'merchant-1', 'user-1');

    expect(result.wallet.balance).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
      'Expected one customer wallet owner, received multiple rows',
      expect.objectContaining({
        merchantId: 'merchant-1',
        userId: 'user-1',
      })
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      'multiple_customer_wallet_owner',
      expect.objectContaining({ severity: 'data_integrity' })
    );

    warnSpy.mockRestore();
  });

  it('drops malformed funding account rows and requires consent', async () => {
    setupSupabaseTables({
      customer_wallet_payment_accounts: createResult({
        account_name: 'Ogabassey/Jane Doe',
        account_number: 'not-an-account',
        bank_name: 'Titan Paystack',
        provider: 'paystack',
      }),
    });

    const result = await fetchWalletData('customer-1', 'merchant-1', 'user-1');

    expect(result.wallet.funding_account).toBeNull();
    expect(result.wallet.requires_funding_account_consent).toBe(true);
  });

  it.each([
    ['customer lookup', 'customers'],
    ['wallet lookup', 'customer_wallets'],
    ['funding account lookup', 'customer_wallet_payment_accounts'],
    ['savings lookup', 'customer_savings_goals'],
    ['transaction lookup', 'customer_wallet_transactions'],
  ])('throws %s errors', async (_label, tableName) => {
    setupSupabaseTables({
      [tableName]: createResult(null, new Error(`${tableName} failed`)),
    });

    await expect(
      fetchWalletData('customer-1', 'merchant-1', 'user-1')
    ).rejects.toThrow(`${tableName} failed`);
  });
});
