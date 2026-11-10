import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { piggyvestPrimaryWalletApi } from '@/lib/piggyvest-primary-wallet';
import {
  FRESH_PRIMARY_BALANCE_TIMEOUT_MS,
  readFreshPrimaryBalance,
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

describe('readFreshPrimaryBalance', () => {
  beforeEach(() => {
    mockSignedIn = true;
    read.mockReset();
  });

  it('returns the PiggyVest balance in naira from a fresh read', async () => {
    read.mockResolvedValueOnce({ account, balanceKobo: 1_250_050 } as never);
    expect(await readFreshPrimaryBalance('m')).toBe(12_500.5);
    expect(read).toHaveBeenCalledWith('m', 'u');
  });

  it.each([
    ['no account', { account: null, balanceKobo: 100 }],
    ['no balance', { account, balanceKobo: null }],
    ['a negative balance', { account, balanceKobo: -1 }],
    ['a fractional balance', { account, balanceKobo: 1.5 }],
  ])('returns null for %s', async (_label, snapshot) => {
    read.mockResolvedValueOnce(snapshot as never);
    expect(await readFreshPrimaryBalance('m')).toBeNull();
  });

  it('returns null when the read fails', async () => {
    read.mockRejectedValueOnce(new Error('timeout'));
    expect(await readFreshPrimaryBalance('m')).toBeNull();
  });

  it('gives up after the budget instead of hanging the form', async () => {
    jest.useFakeTimers();
    try {
      read.mockReturnValueOnce(new Promise(() => undefined));
      const pending = readFreshPrimaryBalance('m');
      jest.advanceTimersByTime(FRESH_PRIMARY_BALANCE_TIMEOUT_MS);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns null without reading when no merchant is resolved', async () => {
    expect(await readFreshPrimaryBalance(null)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it('returns null without reading when nobody is signed in', async () => {
    mockSignedIn = false;
    expect(await readFreshPrimaryBalance('m')).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});
