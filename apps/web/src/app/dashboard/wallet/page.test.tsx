import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  })
);
const getUser = vi.hoisted(() => vi.fn());
const single = vi.hoisted(() => vi.fn());
const getWalletData = vi.hoisted(() => vi.fn());
const getTransactions = vi.hoisted(() => vi.fn());
const readBreakdown = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({})) }));
vi.mock('next/navigation', () => ({ redirect: redirectMock }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));
vi.mock('./actions', () => ({ getWalletData, getTransactions }));
vi.mock('@/lib/wallet/wallet-spendable-breakdown', () => ({
  readWalletSpendableBreakdown: readBreakdown,
}));
vi.mock('./wallet-client', () => ({ default: () => null }));

import WalletPage from './page';

const breakdown = {
  ok: true as const,
  spendableBalance: 100,
  settledToBankTotal: 500,
  pendingReconciliationTotal: 0,
};

async function propsOf() {
  const element = await WalletPage();
  return (element as { props: Record<string, unknown> }).props;
}

describe('WalletPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    single.mockResolvedValue({
      data: { id: 'm1', payout_currency: 'NGN' },
      error: null,
    });
    getWalletData.mockResolvedValue({
      wallet: { id: 'w1' },
      pendingSettlements: [],
    });
    getTransactions.mockResolvedValue([]);
    readBreakdown.mockResolvedValue(breakdown);
  });

  it('passes the spendable breakdown to the wallet client', async () => {
    const props = await propsOf();
    expect(readBreakdown).toHaveBeenCalledWith(expect.anything(), 'm1');
    expect(props.spendable).toEqual(breakdown);
    expect(props.merchantId).toBe('m1');
  });

  it('hides only the new cards when the breakdown read fails', async () => {
    readBreakdown.mockResolvedValue({ ok: false });
    const props = await propsOf();
    expect(props.spendable).toBeNull();
    expect(props.wallet).toEqual({ id: 'w1' });
  });

  it('does not fail the page when the breakdown read fails', async () => {
    readBreakdown.mockResolvedValue({ ok: false });
    await expect(WalletPage()).resolves.toBeTruthy();
  });

  it('still fails the page when the wallet itself cannot load', async () => {
    getWalletData.mockRejectedValue(new Error('db down'));
    await expect(WalletPage()).rejects.toThrow('Failed to load wallet data');
  });

  it('redirects to login when signed out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    await expect(WalletPage()).rejects.toThrow('NEXT_REDIRECT:/auth/login');
  });
});
