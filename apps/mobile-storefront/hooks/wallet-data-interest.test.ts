// biome-ignore-all assist/source/organizeImports: support registers Jest mocks before the subject module loads.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
  createResult,
  mockReadPrimary,
  mockRpc,
  setupSupabaseTables,
} from './wallet-data.test-support';
import { fetchWalletData } from './wallet-data';

describe('fetchWalletData interest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadPrimary.mockResolvedValue({ status: 'unavailable' });
  });

  it('exposes accrued interest from the combined history snapshot RPC', async () => {
    setupSupabaseTables();
    mockRpc.mockImplementation(async () => ({
      data: {
        credited_interest_kobo: 125000,
        goal_interest_kobo: [],
        interest_history: [],
      },
      error: null,
    }));
    const merchantId = '10000000-0000-4000-8000-000000000001';

    const result = await fetchWalletData('customer-1', merchantId, 'user-1');

    expect(mockRpc).toHaveBeenCalledWith(
      'get_customer_savings_interest_snapshot',
      { p_merchant_id: merchantId }
    );
    expect(result.wallet).toMatchObject({
      earnings_available: true,
      earnings_balance: 1250,
    });
  });

  it('falls back to earnings RPC when the combined snapshot RPC is unavailable', async () => {
    setupSupabaseTables();
    mockRpc.mockImplementation(async (name) => {
      if (name === 'get_customer_savings_interest_snapshot')
        return {
          data: null,
          error: { code: 'PGRST202', message: 'snapshot RPC unavailable' },
        };
      return {
        data: { credited_interest_kobo: 125000, goal_interest_kobo: [] },
        error: null,
      };
    });
    const merchantId = '10000000-0000-4000-8000-000000000001';

    const result = await fetchWalletData('customer-1', merchantId, 'user-1');

    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'get_customer_savings_interest_snapshot',
      { p_merchant_id: merchantId }
    );
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'get_customer_savings_earnings',
      { p_merchant_id: merchantId, p_include_goals: true }
    );
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
});
