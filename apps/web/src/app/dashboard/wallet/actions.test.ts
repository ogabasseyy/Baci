import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
    },
    from: mocks.from,
  })),
}));

const { getTransactions, getWalletData, updateWalletSettings } = await import(
  './actions'
);
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

function createQuery<TData>(result: { data: TData; error?: unknown }) {
  const query = {
    eq: vi.fn(),
    limit: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  query.single.mockResolvedValue(result);

  return query;
}

describe('wallet actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleError.mockClear();
    mocks.cookies.mockResolvedValue({});
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
  });

  it('does not fetch wallet data for unauthenticated callers', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = await getWalletData('merchant-1');

    expect(result).toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not fetch transactions for unauthenticated callers', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = await getTransactions('merchant-1');

    expect(result).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('does not update wallet settings for unauthenticated callers', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const result = await updateWalletSettings('merchant-1', {
      autoPayoutEnabled: false,
    });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('verifies merchant ownership before updating wallet settings', async () => {
    const merchantQuery = createQuery({ data: { id: 'merchant-1' } });
    const walletUpdateEq = vi.fn(async () => ({ error: null }));
    const walletQuery = {
      update: vi.fn(() => ({ eq: walletUpdateEq })),
    };

    mocks.from.mockImplementation((table: string) => {
      if (table === 'merchants') {
        return merchantQuery;
      }
      if (table === 'merchant_wallets') {
        return walletQuery;
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await updateWalletSettings('merchant-1', {
      autoPayoutEnabled: false,
      minPayoutAmount: 5000,
    });

    expect(result).toEqual({ success: true });
    expect(merchantQuery.eq).toHaveBeenCalledWith('id', 'merchant-1');
    expect(merchantQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(walletQuery.update).toHaveBeenCalledWith({
      auto_payout_enabled: false,
      min_payout_amount: 5000,
    });
    expect(walletUpdateEq).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/dashboard/wallet');
  });

  it('reads merchant history from wallet_transactions using its actual column contract', async () => {
    const merchantQuery = createQuery({ data: { id: 'merchant-1' } });
    const transactionsQuery = createQuery({
      data: [
        {
          id: 'wallet-transaction-1',
          type: 'credit',
          amount: '1200.50',
          balance_after: '5000.50',
          status: 'completed',
          description: null,
          created_at: null,
        },
      ],
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === 'merchants') return merchantQuery;
      if (table === 'wallet_transactions') return transactionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await getTransactions('merchant-1');

    expect(mocks.from).toHaveBeenCalledWith('wallet_transactions');
    expect(transactionsQuery.select).toHaveBeenCalledWith(
      'id, type, amount, balance_after, status, description, created_at'
    );
    expect(result).toEqual([
      {
        id: 'wallet-transaction-1',
        type: 'credit',
        amount: 1200.5,
        balanceAfter: 5000.5,
        status: 'completed',
        description: '',
        createdAt: '',
      },
    ]);
  });

  it('returns no history when the wallet transaction query fails', async () => {
    const merchantQuery = createQuery({ data: { id: 'merchant-1' } });
    const transactionsQuery = createQuery({
      data: null,
      error: { message: 'wallet query failed' },
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === 'merchants') return merchantQuery;
      if (table === 'wallet_transactions') return transactionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getTransactions('merchant-1')).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to fetch wallet transactions:',
      { message: 'wallet query failed' }
    );
  });

  it('preserves refund and processing ledger semantics', async () => {
    const merchantQuery = createQuery({ data: { id: 'merchant-1' } });
    const transactionsQuery = createQuery({
      data: [
        {
          id: 'wallet-refund-1',
          type: 'refund',
          amount: '700.00',
          balance_after: '5700.50',
          status: 'processing',
          description: 'Order refund',
          created_at: '2026-08-05T10:00:00.000Z',
        },
      ],
    });

    mocks.from.mockImplementation((table: string) => {
      if (table === 'merchants') return merchantQuery;
      if (table === 'wallet_transactions') return transactionsQuery;
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(getTransactions('merchant-1')).resolves.toEqual([
      expect.objectContaining({ type: 'refund', status: 'processing' }),
    ]);
  });
});
