import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPayoutMerchantCommission = vi.fn();

const createWalletQuery = () => {
  const query = {
    eq: vi.fn(),
    gte: vi.fn(),
    select: vi.fn(),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return query;
};

const mockWalletQuery = createWalletQuery();
const mockSupabase = {
  from: vi.fn(() => mockWalletQuery),
  rpc: vi.fn(),
};

vi.mock('@/env', () => ({
  getCronSecret: () => 'cron-secret',
}));

vi.mock('@/lib/kuda', () => ({
  payoutMerchantCommission: (...args: unknown[]) =>
    mockPayoutMerchantCommission(...args),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockSupabase,
}));

import { GET, POST } from './route';

function cronRequest(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/wallet-payouts', {
    headers,
    method: 'POST',
  });
}

describe('/api/cron/wallet-payouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockWalletQuery, createWalletQuery());
    mockSupabase.from.mockReturnValue(mockWalletQuery);
    mockWalletQuery.gte.mockResolvedValue({ data: [], error: null });
  });

  it('returns 401 when cron authentication is missing', async () => {
    const response = await POST(cronRequest());

    expect(response.status).toBe(401);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('accepts lowercase bearer authorization for payout runs', async () => {
    const response = await POST(
      cronRequest({ authorization: 'bearer cron-secret' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      results: {
        processed: 0,
        successful: 0,
        failed: 0,
      },
    });
    expect(mockSupabase.from).toHaveBeenCalledWith('merchant_wallets');
  });

  it('keeps accepting legacy x-cron-secret requests', async () => {
    const response = await POST(
      cronRequest({ 'x-cron-secret': 'cron-secret' })
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.from).toHaveBeenCalledWith('merchant_wallets');
  });

  it('accepts lowercase bearer authorization for manual GET fallback', async () => {
    const response = await GET(
      new Request('http://localhost/api/cron/wallet-payouts', {
        headers: { authorization: 'bearer cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    expect(mockSupabase.from).toHaveBeenCalledWith('merchant_wallets');
  });
  describe('bugfix: payout amount is the spendable balance, not the raw balance', () => {
    const wallet = {
      id: 'w1',
      merchant_id: 'm1',
      available_balance: 10_000,
      min_payout_amount: 1_000,
      merchants: {
        id: 'm1',
        business_name: 'Shop',
        bank_account_number: '0123456789',
        bank_code: '058',
        bank_account_name: 'Shop Ltd',
      },
    };

    function mockRpcs(spendable: { data: unknown; error: unknown }) {
      mockSupabase.rpc.mockImplementation(async (name: string) => {
        if (name === 'get_merchant_wallet_spendable_balance') return spendable;
        if (name === 'debit_merchant_wallet') {
          return {
            data: [{ success: true, transaction_id: 'tx1' }],
            error: null,
          };
        }
        return { data: null, error: null };
      });
    }

    beforeEach(() => {
      mockWalletQuery.gte.mockResolvedValue({ data: [wallet], error: null });
      mockPayoutMerchantCommission.mockResolvedValue({
        success: true,
        reference: 'ref',
        message: 'ok',
      });
    });

    const authed = () => cronRequest({ authorization: 'Bearer cron-secret' });

    it('debits and transfers the spendable amount, not available_balance', async () => {
      mockRpcs({ data: 4_000, error: null });

      await POST(authed());

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_merchant_wallet_spendable_balance',
        { p_merchant_id: 'm1' }
      );
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'debit_merchant_wallet',
        expect.objectContaining({ p_amount: 4_000 })
      );
      expect(mockPayoutMerchantCommission).toHaveBeenCalledWith(
        expect.anything(),
        4_000,
        'm1'
      );
    });

    it('skips when the spendable balance is below the minimum payout', async () => {
      mockRpcs({ data: 500, error: null });

      const response = await POST(authed());

      await expect(response.json()).resolves.toMatchObject({
        results: { skipped: 1, processed: 0 },
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'debit_merchant_wallet',
        expect.anything()
      );
    });

    it('fails closed without debiting when the spendable RPC errors', async () => {
      mockRpcs({ data: null, error: { message: 'boom' } });

      const response = await POST(authed());

      await expect(response.json()).resolves.toMatchObject({
        results: { failed: 1, processed: 0 },
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'debit_merchant_wallet',
        expect.anything()
      );
      expect(mockPayoutMerchantCommission).not.toHaveBeenCalled();
    });

    it('fails closed when the spendable RPC returns a non-finite value', async () => {
      mockRpcs({ data: null, error: null });

      const response = await POST(authed());

      await expect(response.json()).resolves.toMatchObject({
        results: { failed: 1 },
      });
      expect(mockSupabase.rpc).not.toHaveBeenCalledWith(
        'debit_merchant_wallet',
        expect.anything()
      );
    });
  });
});
