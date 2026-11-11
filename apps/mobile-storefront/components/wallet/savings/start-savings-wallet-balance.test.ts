import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import {
  FRESH_PRIMARY_BALANCE_TIMEOUT_MS,
  isWholeNairaAmount,
  readFreshPrimaryBalanceKobo,
  wholeNairaHeadStart,
} from './start-savings-wallet-balance';

jest.mock('@/lib/piggyvest-primary-wallet', () => ({
  piggyvestPrimaryWalletApi: { read: jest.fn() },
}));
let mockSignedIn = true;
jest.mock('@/stores/auth-store', () => ({
  useAuthStore: {
    getState: () => (mockSignedIn ? { user: { id: 'u' } } : { user: null }),
  },
}));

const account = {
  accountName: 'Verified',
  accountNumber: '0987654321',
  bankName: 'Provider Bank',
};
const read = jest.mocked(piggyvestPrimaryWalletApi.read);

describe('readFreshPrimaryBalanceKobo', () => {
  beforeEach(() => {
    mockSignedIn = true;
    read.mockReset();
  });

  it('returns the PiggyVest balance in whole kobo from a fresh read', async () => {
    read.mockResolvedValueOnce({ account, balanceKobo: 1_250_050 } as never);
    expect(await readFreshPrimaryBalanceKobo('m')).toBe(1_250_050);
    expect(read).toHaveBeenCalledWith('m', 'u');
  });

  it.each([
    ['no account', { account: null, balanceKobo: 100 }],
    ['no balance', { account, balanceKobo: null }],
    ['a negative balance', { account, balanceKobo: -1 }],
    ['a fractional balance', { account, balanceKobo: 1.5 }],
  ])('returns null for %s', async (_label, snapshot) => {
    read.mockResolvedValueOnce(snapshot as never);
    expect(await readFreshPrimaryBalanceKobo('m')).toBeNull();
  });

  it('returns null when a different account is signed in once the read answers', async () => {
    read.mockImplementationOnce(async () => {
      mockSignedIn = false;
      return { account, balanceKobo: 1_000 } as never;
    });
    expect(await readFreshPrimaryBalanceKobo('m')).toBeNull();
  });

  it('returns null when the read fails', async () => {
    read.mockRejectedValueOnce(new Error('timeout'));
    expect(await readFreshPrimaryBalanceKobo('m')).toBeNull();
  });

  it('gives up after the budget instead of hanging the form', async () => {
    jest.useFakeTimers();
    try {
      read.mockReturnValueOnce(new Promise(() => undefined));
      const pending = readFreshPrimaryBalanceKobo('m');
      jest.advanceTimersByTime(FRESH_PRIMARY_BALANCE_TIMEOUT_MS);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null without reading when no merchant is resolved', async () => {
    expect(await readFreshPrimaryBalanceKobo(null)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns null without reading when nobody is signed in', async () => {
    mockSignedIn = false;
    expect(await readFreshPrimaryBalanceKobo('m')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('wholeNairaHeadStart', () => {
  it.each([
    [10_000, 10_000],
    [10_000.1, 10_001],
    [10_000.01, 10_001],
    // A float artifact never asks for an extra naira.
    [20_000.0000001, 20_000],
    [19_999.9999999, 20_000],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [-5, 0],
  ])('moves %p naira as %p whole naira', (amount, expected) => {
    expect(wholeNairaHeadStart(amount)).toBe(expected);
  });
});

describe('isWholeNairaAmount', () => {
  it.each([
    [10_000, true],
    [20_000.0000001, true],
    [10_000.4, false],
    [10_000.01, false],
    // Dust below ₦1 would hand the wallet ₦0.
    [0.004, false],
    [0.009, false],
    [0, false],
    [Number.NaN, false],
  ])('treats %p as whole naira: %p', (amount, expected) => {
    expect(isWholeNairaAmount(amount)).toBe(expected);
  });
});
